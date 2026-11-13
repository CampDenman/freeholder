// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: explicit genuine debt-observing bank evidence; no default relaxation.
import { eq } from "drizzle-orm";
import { ServiceError,type ServiceContext } from "@/core/service";
import { subscriptionProviderChargeReceipts } from "@/modules/subscriptions/schema";
import { readControlledCashInspectionObservationContext } from "./controlled-cash-inspection-observation-context";
import { merchantCashReturnInspections } from "./merchant-refund-schema";
import { merchantAgreementPaymentRoutes } from "./merchant-agreement-schema";
import { payments } from "./schema";
import type { MerchantRefundCashOrigin } from "./merchant-refund-origin";
import { originalCashInspectionBankFacts } from "./merchant-cash-inspection-bank-facts";
import { merchantTaxDigest } from "./merchant-tax-store";
/** Real context and already held contact→resource→parent→canonical→cash locks. The
 * private parent query authenticates FULL current coverage/callers/privacy and
 * the exact returned-own causal history, preserving every financial debt. No
 * generic post-application classifier, fake payment or financial flag override
 * supplies the first unapplied receipt's bank observation. */
export async function currentControlledCashInspection(ctx:ServiceContext,input:{collectionId:string;receiptId:string;inspectionId:string;observationId?:string}){
 const context=await readControlledCashInspectionObservationContext(ctx,input),source=context.source;
 const[inspection]=await ctx.tx.select().from(merchantCashReturnInspections).where(eq(merchantCashReturnInspections.id,input.inspectionId)).limit(1);
 const[receipt]=await ctx.tx.select().from(subscriptionProviderChargeReceipts).where(eq(subscriptionProviderChargeReceipts.id,source.receiptId)).limit(1);
 if(!inspection||!receipt||inspection.subscriptionChargeReceiptId!==source.receiptId||inspection.subscriptionChargeObservationId!==source.observationId||inspection.paymentId||inspection.originalObservationId)throw new ServiceError("conflict","Restore this exact source-owned actual inspection and original receipt; an equal payment or current account cannot adopt its evidence.");
 const routes=await ctx.tx.select({route:merchantAgreementPaymentRoutes,payment:payments}).from(merchantAgreementPaymentRoutes).innerJoin(payments,eq(payments.id,merchantAgreementPaymentRoutes.paymentId)).where(eq(merchantAgreementPaymentRoutes.originalChargeReceiptId,receipt.id)).limit(2);
 if(routes.length>1)throw new ServiceError("conflict","Restore the exact original receipt's unique canonical route; ambiguous application stays debt.");
 const cash:MerchantRefundCashOrigin={paymentId:null,originalObservationId:null,subscriptionChargeReceiptId:receipt.id,subscriptionChargeObservationId:source.observationId,
  providerPlatformAccountId:source.providerPlatformAccountId,chargeAccountId:source.chargeAccountId,providerApiVersion:source.providerApiVersion,providerRef:source.providerPaymentIntentRef,amountMinor:source.amountMinor,currency:source.currency,
  applied:routes.some(row=>row.payment.status==="succeeded"&&row.payment.providerRef===source.providerPaymentIntentRef),originalChargeRef:receipt.providerChargeRef,originalFeeRef:receipt.applicationFeeRef,
  subscriptionOrigin:{providerApiVersion:source.providerApiVersion,providerSubscriptionRef:source.providerSubscriptionRef,providerInvoiceRef:source.providerInvoiceRef,providerPaymentIntentRef:source.providerPaymentIntentRef}};
 const facts=await originalCashInspectionBankFacts(ctx.tx,inspection,cash,input.observationId);if(!facts)return null;
 return{...facts,observational:context,revision:merchantTaxDigest({factsRevision:merchantTaxDigest(facts),currentParentRevision:context.parent.revision,causalSourceRevision:context.parent.causalSourceRevision,sourceRevision:source.sourceRevision}),suppliesPrincipalAuthority:false as const,suppliesApplicationAuthority:false as const};
}
