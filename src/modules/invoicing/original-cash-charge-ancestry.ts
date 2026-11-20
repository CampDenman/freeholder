// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: a raw charge ID follows actual positive original cash, never an amount.
import { and,asc,eq,inArray,or,sql } from "drizzle-orm";
import { ServiceError,type Tx } from "@/core/service";
import { subscriptionProviderChargeReceipts } from "@/modules/subscriptions/schema";
import { merchantPaymentObservations } from "./merchant-collection-schema";
import { merchantAgreementPaymentRoutes } from "./merchant-agreement-schema";
import type { LegacyBankFeedbackEvidence } from "./legacy-bank-feedback-proof";
import { merchantTaxDigest } from "./merchant-tax-store";
export interface OriginalChargeFeedbackSource {paymentId:string|null;subscriptionChargeReceiptId:string|null;platform:string;account:string|null;paymentRef:string;
 kind:"payment_observation"|"charge_receipt";id:string;fingerprint:string}
export function chargeOnlyFeedbackMatchesOriginal(evidence:Pick<LegacyBankFeedbackEvidence,"observedPaymentRef"|"observedChargeRef"|"observedPlatformAccountId"|"observedChargeAccountId">,
 source:{platform:string;account:string|null;chargeRef:string|null}){
 return evidence.observedPaymentRef===null&&evidence.observedChargeRef!==null&&evidence.observedPlatformAccountId!==null
  &&evidence.observedChargeRef===source.chargeRef&&evidence.observedPlatformAccountId===source.platform&&evidence.observedChargeAccountId===source.account;
}
function unresolved():never{throw new ServiceError("conflict","Retain the exact charge-only refund feedback as review debt until one authentic original charge namespace and its actual receipt aliases are complete.");}
/** No ServiceContext, caller claims or side effects. A missing authenticated
 * observed platform cannot be replaced by today's account; known resource
 * bindings may separately prove that historical feedback's owner. */
export async function originalChargeFeedbackAncestry(tx:Tx,evidence:LegacyBankFeedbackEvidence){
 if(evidence.observedPaymentRef!==null||!evidence.observedChargeRef||!evidence.observedPlatformAccountId)return null;
 const positive=await tx.select().from(merchantPaymentObservations).where(and(eq(merchantPaymentObservations.status,"succeeded"),sql`${merchantPaymentObservations.amountMinor}>0`,
  eq(merchantPaymentObservations.providerChargeRef,evidence.observedChargeRef),eq(merchantPaymentObservations.providerPlatformAccountId,evidence.observedPlatformAccountId),
  sql`${merchantPaymentObservations.chargeAccountId} is not distinct from ${evidence.observedChargeAccountId}`)).orderBy(asc(merchantPaymentObservations.id)).limit(5001);
 const receipts=await tx.select().from(subscriptionProviderChargeReceipts).where(and(sql`${subscriptionProviderChargeReceipts.amountMinor}>0`,
  eq(subscriptionProviderChargeReceipts.providerChargeRef,evidence.observedChargeRef),eq(subscriptionProviderChargeReceipts.providerPlatformAccountId,evidence.observedPlatformAccountId),
  sql`${subscriptionProviderChargeReceipts.chargeAccountId} is not distinct from ${evidence.observedChargeAccountId}`)).orderBy(asc(subscriptionProviderChargeReceipts.id)).limit(5001);
 if(positive.length+receipts.length>5000||positive.some(cash=>!chargeOnlyFeedbackMatchesOriginal(evidence,{platform:cash.providerPlatformAccountId,account:cash.chargeAccountId,chargeRef:cash.providerChargeRef}))
  ||receipts.some(cash=>!chargeOnlyFeedbackMatchesOriginal(evidence,{platform:cash.providerPlatformAccountId,account:cash.chargeAccountId,chargeRef:cash.providerChargeRef})))unresolved();
 const receiptIds=receipts.map(row=>row.id),paymentIds=[...new Set(positive.map(row=>row.paymentId))];
 const routes=receiptIds.length||paymentIds.length?await tx.select().from(merchantAgreementPaymentRoutes).where(or(
  receiptIds.length?inArray(merchantAgreementPaymentRoutes.originalChargeReceiptId,receiptIds):undefined,
  paymentIds.length?inArray(merchantAgreementPaymentRoutes.paymentId,paymentIds):undefined)).orderBy(asc(merchantAgreementPaymentRoutes.paymentId)).limit(5001):[];
 if(positive.length+receipts.length+routes.length>5000)unresolved();
 const aliases:Array<{paymentId:string;receiptId:string}>=[];
 for(const route of routes){if(!route.originalChargeReceiptId)continue;const receipt=receipts.find(row=>row.id===route.originalChargeReceiptId);
  if(!receipt||route.originKind!=="provider_schedule"||route.subscriptionId!==receipt.subscriptionId||route.providerPlatformAccountId!==receipt.providerPlatformAccountId
   ||route.chargeAccountId!==receipt.chargeAccountId||route.providerInvoiceRef!==receipt.providerInvoiceRef||route.providerPaymentIntentRef!==receipt.providerPaymentIntentRef
   ||route.providerChargeRef!==receipt.providerChargeRef||route.providerSubscriptionRef!==receipt.providerSubscriptionRef||route.providerApiVersion!==receipt.providerApiVersion)unresolved();
  aliases.push({paymentId:route.paymentId,receiptId:receipt.id});
 }
 const candidates:OriginalChargeFeedbackSource[]=[...positive.map(cash=>({paymentId:cash.paymentId,subscriptionChargeReceiptId:null,platform:cash.providerPlatformAccountId,account:cash.chargeAccountId,
  paymentRef:cash.providerRef,kind:"payment_observation" as const,id:cash.id,fingerprint:merchantTaxDigest(cash)})),...receipts.map(cash=>({paymentId:null,subscriptionChargeReceiptId:cash.id,
   platform:cash.providerPlatformAccountId,account:cash.chargeAccountId,paymentRef:cash.providerPaymentIntentRef,kind:"charge_receipt" as const,id:cash.id,fingerprint:merchantTaxDigest(cash)}))];
 const owners=new Set<string>(),namespaces=new Set<string>(),aliasOwners=new Map<string,string>();
 for(const alias of aliases){const prior=aliasOwners.get(alias.receiptId);if(prior&&prior!==alias.paymentId)unresolved();aliasOwners.set(alias.receiptId,alias.paymentId);}
 for(const candidate of candidates){const paymentId=candidate.paymentId??(candidate.subscriptionChargeReceiptId?aliasOwners.get(candidate.subscriptionChargeReceiptId):undefined);
  owners.add(paymentId?`payment:${paymentId}`:`subscription:${candidate.subscriptionChargeReceiptId}`);
  namespaces.add(merchantTaxDigest({platform:candidate.platform,account:candidate.account,paymentRef:candidate.paymentRef}));
 }
 if(owners.size>1||namespaces.size>1)unresolved();
 return{candidates,aliases,identities:[...positive.map(row=>({table:"merchant_payment_observations",id:row.id})),...receipts.map(row=>({table:"subscription_provider_charge_receipts",id:row.id})),
  ...routes.map(row=>({table:"merchant_agreement_payment_routes",id:row.paymentId}))]};
}
