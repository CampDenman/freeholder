// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38: consume a genuine finished original inspection, never invent its producer.
import { desc,eq } from "drizzle-orm";
import { ServiceError,type ServiceContext } from "@/core/service";
import { controlledCollectionState } from "@/modules/subscriptions/controlled-provider-collection-state";
import { controlledCashEvidence,readOriginalControlledChargeAuthority } from "@/modules/subscriptions/controlled-provider-cash-origin";
import { subscriptionProviderChargeReceipts } from "@/modules/subscriptions/schema";
import { merchantCashReturnInspections } from "./merchant-refund-schema";
import { currentOriginalCashInspection } from "./merchant-cash-inspection-current";
import { commercialInvoiceCashHistory } from "./commercial-attestations";
import { invoiceCashFeeAllocation } from "./invoice-credit-cash-fee";
import { controlledCashBankApplicationEvidence } from "./controlled-cash-application-bank-policy";
import { merchantTaxDigest } from "./merchant-tax-store";
function refuse():never{throw new ServiceError("conflict","Retain this exact receipt's latest genuine original charge/refund/dispute inspection and actual fee/recipient state before prospective application. Missing, stale, returned or contradictory bank money cannot fall back to an earlier read.");}
/** Caller already holds the REAL resource→parent→canonical locks. Read-only,
 * no ServiceContext fabrication, SDK call, return intent or allowed result.
 * Existing ec57 defaults remain strict; absent prospective observation context
 * still refuses. This does not manufacture the missing future15 producer. */
export async function readControlledCashApplicationBank(ctx:ServiceContext,input:{collectionId:string;receiptId:string}){
 const source=await controlledCollectionState(ctx.tx,input.collectionId),{resource,parent,canonical,history}=source;
 const[receipt]=await ctx.tx.select().from(subscriptionProviderChargeReceipts).where(eq(subscriptionProviderChargeReceipts.id,input.receiptId)).limit(1);
 const origin=history.chargeOrigins.find(row=>row.receiptId===input.receiptId),fact=origin?history.facts.find(row=>row.id===origin.factId&&row.callId===origin.callId&&row.actual.kind==="cash_observed"):null;
 if(!receipt||!origin||!fact||origin.resourceId!==resource.id||receipt.subscriptionId!==parent.id||receipt.providerInvoiceRef!==source.binding?.providerInvoiceRef||!receipt.providerChargeRef)refuse();
 const original=await readOriginalControlledChargeAuthority(ctx.tx,controlledCashEvidence.parse(fact.actual.raw.cash),{resourceId:resource.id,callId:origin.callId,factId:origin.factId});
 if(original.controlledOrigin.operationId!==origin.operationId||original.controlledOrigin.originalEvidenceDigest!==origin.originalEvidenceDigest||original.controlledCash.providerPaymentIntentRef!==receipt.providerPaymentIntentRef
  ||original.controlledCash.providerInvoiceRef!==receipt.providerInvoiceRef||original.controlledCash.providerChargeRef!==receipt.providerChargeRef||original.controlledCash.amountMinor!==receipt.amountMinor||original.controlledCash.currency!==receipt.currency)refuse();
 const[inspection]=await ctx.tx.select().from(merchantCashReturnInspections).where(eq(merchantCashReturnInspections.subscriptionChargeReceiptId,receipt.id))
  .orderBy(desc(merchantCashReturnInspections.createdAt),desc(merchantCashReturnInspections.id)).limit(1);if(!inspection)refuse();
 const current=await currentOriginalCashInspection(ctx,{inspectionId:inspection.id});
 if(!current||current.source.kind!=="subscription"||current.source.receiptId!==receipt.id||current.cash.subscriptionChargeReceiptId!==receipt.id||current.cash.applied||current.history.feeDebt
  ||current.cash.providerPlatformAccountId!==receipt.providerPlatformAccountId||current.cash.chargeAccountId!==receipt.chargeAccountId||current.cash.providerRef!==receipt.providerPaymentIntentRef)refuse();
 const previous=await commercialInvoiceCashHistory(ctx,canonical.invoice);
 if(previous.pending||previous.cash!==BigInt(canonical.invoice.paidMinor))refuse();
 const allocation=await invoiceCashFeeAllocation(ctx,canonical.invoice,canonical.marketPolicy.feeMinor,{amountMinor:receipt.amountMinor,priorCashMinor:Number(previous.cash),priorAllocatedFeeMinor:Number(previous.allocatedFee)});
 const paymentEvidence=controlledCashBankApplicationEvidence({...resource.originalScope,providerRef:receipt.providerPaymentIntentRef,chargeRef:receipt.providerChargeRef,
  amountMinor:receipt.amountMinor,currency:receipt.currency,feeMinor:allocation.feeMinor,originalFeeRef:receipt.applicationFeeRef,
  customerChargeVerified:receipt.customerChargeVerified&&original.controlledCash.customerChargeVerified,merchantRouteVerified:receipt.merchantRouteVerified&&original.controlledCash.merchantRouteVerified},current.evidence);
 if(!paymentEvidence)refuse();
 return{receiptId:receipt.id,inspectionId:current.inspection.id,observationId:current.observation.id,processedAt:current.observation.createdAt,inspectionRevision:current.revision,paymentEvidence,
  revision:merchantTaxDigest({collectionId:source.collection.id,receipt,origin,currentInspectionRevision:current.revision,allocation,previous,paymentEvidence})};
}
