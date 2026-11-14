// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38: ordinary full15 resolution reader; never edits raw facts or coverage.
import { and,desc,eq,inArray,sql } from "drizzle-orm";
import { ServiceError,type Tx } from "@/core/service";
import { controlledCollectionState } from "@/modules/subscriptions/controlled-provider-collection-state";
import type { controlledCollectionCoverage } from "@/modules/subscriptions/controlled-provider-collection-coverage";
import { subscriptionProviderChargeReceipts } from "@/modules/subscriptions/schema";
import { controlledProviderJournal } from "@/modules/subscriptions/controlled-provider-proof";
import { subscriptionControlledResources } from "@/modules/subscriptions/controlled-provider-schema";
import { subscriptionControlledChargeOrigins } from "@/modules/subscriptions/controlled-provider-schema";
import { merchantAgreementPaymentRoutes } from "./merchant-agreement-schema";
import { merchantPaymentObservations } from "./merchant-collection-schema";
import { payments } from "./schema";
import { parentFinancialGraphForTx } from "./controlled-provider-financial-parent";
import { classifyControlledTargetRawFacts,controlledCustomerRawReview,type ControlledRawTarget,type ControlledResolvedCash } from "./controlled-target-raw-policy";
import { merchantTaxDigest } from "./merchant-tax-store";
import { controlledCashProspectiveProjection } from "./controlled-cash-prospective-context";
type Coverage=Awaited<ReturnType<typeof controlledCollectionCoverage>>;
const hash=(row:unknown)=>sql<string>`encode(sha256(convert_to(to_jsonb(${row})::text,'UTF8')),'hex')`;
function refuse():never{throw new ServiceError("conflict","Restore complete exact original target, current bank facts, canonical receipt/route/payment and parent financial witnesses before resolving raw review.");}
export async function controlledTargetRawClassification(tx:Tx,subscriptionId:string,coverage:Coverage,knownParent?:Awaited<ReturnType<typeof parentFinancialGraphForTx>>){
 const graph=knownParent??await parentFinancialGraphForTx(tx,subscriptionId),entries=new Map<string,string>();
 const add=(table:string,id:string,fingerprint:string)=>{const key=`${table}:${id}`,prior=entries.get(key);if(prior&&prior!==fingerprint)refuse();entries.set(key,fingerprint);if(entries.size>5000)refuse();};
 for(const row of [...graph.physical,...graph.children.entries,...graph.proration.entries,...graph.controlled.entries])add(row.table,row.id,row.fingerprint);
 const rows=await tx.select({receipt:subscriptionProviderChargeReceipts,origin:subscriptionControlledChargeOrigins,route:merchantAgreementPaymentRoutes,payment:payments,observation:merchantPaymentObservations,
  receiptHash:hash(subscriptionProviderChargeReceipts),routeHash:hash(merchantAgreementPaymentRoutes),paymentHash:hash(payments),observationHash:hash(merchantPaymentObservations)})
  .from(subscriptionProviderChargeReceipts).innerJoin(subscriptionControlledChargeOrigins,eq(subscriptionControlledChargeOrigins.receiptId,subscriptionProviderChargeReceipts.id))
  .innerJoin(merchantAgreementPaymentRoutes,eq(merchantAgreementPaymentRoutes.originalChargeReceiptId,subscriptionProviderChargeReceipts.id))
  .innerJoin(payments,eq(payments.id,merchantAgreementPaymentRoutes.paymentId)).leftJoin(merchantPaymentObservations,and(eq(merchantPaymentObservations.paymentId,payments.id),eq(merchantPaymentObservations.providerRef,subscriptionProviderChargeReceipts.providerPaymentIntentRef)))
  .where(eq(subscriptionProviderChargeReceipts.subscriptionId,subscriptionId)).orderBy(subscriptionProviderChargeReceipts.id,desc(merchantPaymentObservations.observedAt),desc(merchantPaymentObservations.id)).limit(5001);
 if(rows.length>5000)refuse();
 const cash:ControlledResolvedCash[]=[],seen=new Set<string>();
 for(const row of rows){const{receipt,origin,route,payment,observation}=row;
  add("subscription_provider_charge_receipts",receipt.id,row.receiptHash);add("merchant_agreement_payment_routes",route.paymentId,row.routeHash);add("payments",payment.id,row.paymentHash);
  if(observation)add("merchant_payment_observations",observation.id,row.observationHash);
  if(seen.has(receipt.id))continue;seen.add(receipt.id);
  // Selection is through actual original receipt/FK/PI, before value checks.
  // NULL/unapplied payment, ambiguous route or current failed observation
  // cannot become owned by finding an equal successful amount. Existing
  // refund/dispute/fee/principal services still govern all outstanding debt.
  if(!observation||observation.status!=="succeeded"||receipt.subscriptionId!==subscriptionId||route.subscriptionId!==subscriptionId||route.originKind!=="provider_schedule"||route.providerApiVersion!=="2026-10-28.endive"
   ||route.providerPlatformAccountId!==receipt.providerPlatformAccountId||route.chargeAccountId!==receipt.chargeAccountId||route.providerSubscriptionRef!==receipt.providerSubscriptionRef
   ||route.providerInvoiceRef!==receipt.providerInvoiceRef||route.providerPaymentIntentRef!==receipt.providerPaymentIntentRef||route.providerChargeRef!==receipt.providerChargeRef
   ||!receipt.customerChargeVerified||!receipt.merchantRouteVerified||payment.provider!=="stripe"||payment.method!=="provider_schedule"||payment.status!=="succeeded"
   ||payment.providerRef!==receipt.providerPaymentIntentRef||payment.amountMinor!==receipt.amountMinor||payment.currency!==receipt.currency||!Number.isSafeInteger(payment.refundedMinor)||payment.refundedMinor<0||payment.refundedMinor>payment.amountMinor
   ||!observation.customerChargeVerified||!observation.routeVerified||observation.providerPlatformAccountId!==receipt.providerPlatformAccountId||observation.chargeAccountId!==receipt.chargeAccountId
   ||observation.recipientAccountId!==route.recipientAccountId||observation.settlementMerchantAccountId!==route.settlementMerchantAccountId||observation.amountMinor!==receipt.amountMinor||observation.currency!==receipt.currency
   ||observation.providerChargeRef!==receipt.providerChargeRef)continue;
  const original=coverage.transport.witness.chargeOrigins.filter(value=>value.id===receipt.id&&value.resourceId===origin.resourceId&&value.operationId===origin.operationId&&value.callId===origin.callId&&value.factId===origin.factId);
  if(original.length!==1)continue;
  cash.push({receiptId:receipt.id,paymentId:payment.id,resourceId:origin.resourceId,canonicalInvoiceId:payment.invoiceId,providerInvoiceRef:receipt.providerInvoiceRef,
   providerIntentRef:receipt.providerPaymentIntentRef,providerChargeRef:receipt.providerChargeRef,amountMinor:receipt.amountMinor,currency:receipt.currency});
 }
 const additionalReviewFactIds:string[]=[];
 const resources=coverage.transport.resourceIds.length?await tx.select({resource:subscriptionControlledResources,fingerprint:hash(subscriptionControlledResources)}).from(subscriptionControlledResources)
  .where(inArray(subscriptionControlledResources.id,coverage.transport.resourceIds)).limit(5001):[];
 if(resources.length!==coverage.transport.resourceIds.length)refuse();
 for(const row of resources){if(row.resource.subscriptionId!==subscriptionId)refuse();add("subscription_controlled_resources",row.resource.id,row.fingerprint);
  const history=await controlledProviderJournal(tx,row.resource.id);additionalReviewFactIds.push(...controlledCustomerRawReview(row.resource,history));
 }
 const targets:ControlledRawTarget[]=[];
 for(const collection of coverage.witness.collections){if(!collection.invoiceId)continue;
  const actual=await controlledCollectionState(tx,collection.id);
  if(actual.parent.id!==subscriptionId||actual.resource.subscriptionId!==subscriptionId||actual.collection.invoiceId!==collection.invoiceId)refuse();
  const prospective=controlledCashProspectiveProjection(tx,{resourceId:actual.resource.id,collectionId:actual.collection.id,invoiceId:actual.canonical.invoice.id});
  targets.push({resource:actual.resource,history:actual.history,manifest:actual.manifest,binding:actual.binding,proofs:actual.proofs,itemReceipts:actual.itemReceipts,components:actual.components,
   period:{periodAmountMinor:actual.terms.snapshot.periodAmountMinor,interval:actual.terms.snapshot.interval,intervalCount:actual.terms.snapshot.intervalCount},
   calendarAuthority:{periodStart:actual.review.calendar.expectedProviderPeriodStart,periodEnd:actual.review.calendar.expectedProviderPeriodEnd,anchor:actual.review.calendar.expectedProviderBillingAnchor,trialEnd:actual.review.calendar.expectedProviderTrialEndsAt,
    periodAmountMinor:actual.terms.snapshot.periodAmountMinor,interval:actual.terms.snapshot.interval,intervalCount:actual.terms.snapshot.intervalCount},
   canonicalPaidMinor:actual.canonical.invoice.paidMinor,canonicalRefundedMinor:actual.canonical.invoice.refundedMinor,cash:cash.filter(row=>row.resourceId===actual.resource.id&&row.canonicalInvoiceId===actual.canonical.invoice.id),...(prospective?{prospective}:{})});
 }
 const resolved=coverage.transport.unfinishedCalls.length?{resolutions:[],unresolvedFactIds:coverage.transport.rawCashReviewFactIds}:classifyControlledTargetRawFacts(targets);
 const unresolvedFactIds=[...new Set([...additionalReviewFactIds,...resolved.unresolvedFactIds,...coverage.transport.rawCashReviewFactIds.filter(id=>!resolved.resolutions.some(row=>row.factId===id))])].sort();
 if(coverage.transport.excludedOperationId)entries.delete(`subscription_controlled_operations:${coverage.transport.excludedOperationId}`);
 const evidenceEntries=[...entries].sort(([a],[b])=>a.localeCompare(b)).map(([key,fingerprint])=>{const at=key.indexOf(":");return{table:key.slice(0,at),id:key.slice(at+1),fingerprint};});
 const prospectiveRevisions=targets.flatMap(target=>target.prospective?[{collectionId:target.manifest.collectionId,revision:target.prospective.revision,parentPgRevision:target.prospective.parentPgRevision}]:[]).sort((a,b)=>a.collectionId.localeCompare(b.collectionId));
 return{resolutions:resolved.resolutions,unresolvedFactIds,additionalReviewFactIds:[...new Set(additionalReviewFactIds)].sort(),evidenceEntries,revision:merchantTaxDigest({coverageRevision:coverage.revision,resolutions:resolved.resolutions,unresolvedFactIds,evidenceEntries,...(prospectiveRevisions.length?{prospectiveRevisions}:{})})};
}
