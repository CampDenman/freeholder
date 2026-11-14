// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38: authentic admission→actual shared payments in ONE transaction.
import { eq,inArray,sql } from "drizzle-orm";
import { z } from "zod";
import { getService,ServiceError,type ServiceContext } from "@/core/service";
import { subscriptionProviderChargeReceipts } from "@/modules/subscriptions/schema";
import { CONTROLLED_COLLECTION_PROTOCOL } from "@/modules/subscriptions/controlled-provider-collection-protocol";
import { admitControlledCashApplication } from "./controlled-cash-application-admission";
import { readControlledCashApplicationStage,controlledCashStageEvidence } from "./controlled-cash-application-stage";
import { CONTROLLED_CASH_BATCH_MARKER,controlledCashBatchPointer } from "@/modules/subscriptions/controlled-cash-batch-pointer";
import { merchantAgreementPaymentRoutes } from "./merchant-agreement-schema";
import { recordMerchantPaymentObservation } from "./merchant-payment-observations";
import { invoices } from "./schema";
import { merchantTaxDigest } from "./merchant-tax-store";
const inputSchema=z.object({collectionId:z.uuid(),receiptIds:z.array(z.uuid()).min(1).max(5000),requiredProtocol:z.literal(CONTROLLED_COLLECTION_PROTOCOL)}).strict();
const paymentResult=z.object({id:z.uuid(),invoiceId:z.uuid(),provider:z.literal("stripe"),method:z.literal("provider_schedule"),amountMinor:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),currency:z.string(),status:z.enum(["created","processing","succeeded"]),providerRef:z.string().nullable()});
function refuse():never{throw new ServiceError("conflict","Restore the genuine signed original batch admission, exact actual canonical prefix and complete current bank/parent proof before cash application. Retain all raw cash; do not clip, duplicate or infer an owner from equal amounts.");}
/** Ordinary/unregistered until the entire genuine route/SQL protocol qualifies.
 * No bank POST, return owner, synthetic ServiceContext or direct access effect.
 * Errors propagate through the caller's real transaction. Deferred conservation
 * refuses every incomplete batch, even if an outer caller catches a refusal.
 */
export async function applyControlledReceiptBatch(ctx:ServiceContext,value:z.input<typeof inputSchema>){
 const input=inputSchema.parse(value);if(ctx.actor.kind!=="system"||new Set(input.receiptIds).size!==input.receiptIds.length)refuse();
 const create=getService("invoicing.createPayment"),settle=getService("invoicing.settlePayment");if(!create||!settle)refuse();
 const admission=await admitControlledCashApplication(ctx,input),{batch}=admission;
 const ordered=[...admission.receipts].sort((a,b)=>a.ordinal-b.ordinal);
 if(JSON.stringify(ordered.map(row=>row.receiptId))!==JSON.stringify(batch.requestedReceiptIds))refuse();
 const originalReceipts=await ctx.tx.select().from(subscriptionProviderChargeReceipts).where(inArray(subscriptionProviderChargeReceipts.id,batch.requestedReceiptIds)).limit(5001);
 if(originalReceipts.length!==ordered.length)refuse();
 const result:Array<{receiptId:string;paymentId:string}>=[];
 for(const receipt of ordered){
  const bank=admission.bank.receipts.find(row=>row.receiptId===receipt.receiptId),original=originalReceipts.find(row=>row.id===receipt.receiptId);
  if(!bank||!original||bank.existingPaymentId!==null||bank.amountMinor!==receipt.amountMinor||bank.currency!==receipt.currency||bank.immutableBankRevision!==receipt.immutableBankRevision
   ||merchantTaxDigest(bank.actualPaymentEvidence)!==receipt.paymentEvidenceDigest||bank.actualPaymentEvidence.providerRef!==original.providerPaymentIntentRef
   ||bank.actualPaymentEvidence.providerChargeRef!==original.providerChargeRef||original.providerChargeRef===null||bank.actualPaymentEvidence.amountMinor!==original.amountMinor||bank.actualPaymentEvidence.currency!==original.currency)refuse();
  // This is a genuine current FULL normalized parent stage, not a fresh scalar
  // bank read that would misinterpret our own prior/pending canonical writes.
  const before=await readControlledCashApplicationStage(ctx,{batchId:batch.id,receiptId:receipt.receiptId});
  if(before.batch.digest!==batch.digest||before.evidence.settledReceiptIds.length!==receipt.ordinal-1||before.links.some(row=>row.receiptId===receipt.receiptId))refuse();
  const pointer=controlledCashBatchPointer.parse({batchId:batch.id,collectionId:batch.collectionId,receiptId:receipt.receiptId,admissionDigest:batch.digest});
  await ctx.tx.execute(sql`select set_config(${CONTROLLED_CASH_BATCH_MARKER},${JSON.stringify(pointer)},true)`);
  // reserveMerchantCharge executes the real prebirth route verifier here. The
  // actual payment UUID is generated ONLY by the shared payment INSERT; SQL
  // immediately links that real row and independently revalidates its birth.
  const created=paymentResult.parse(await ctx.callAsSystem(create,{invoiceId:batch.invoiceId,provider:"stripe",method:"provider_schedule",amountMinor:receipt.amountMinor,idempotencyKey:receipt.paymentIdempotencyKey,subscriptionChargeReceiptId:receipt.receiptId,metadata:{}}));
  if(created.invoiceId!==batch.invoiceId||created.amountMinor!==receipt.amountMinor||created.currency!==receipt.currency||created.status!=="created"||created.providerRef!==null)refuse();
  const born=await readControlledCashApplicationStage(ctx,{batchId:batch.id,receiptId:receipt.receiptId,paymentId:created.id});
  if(!born.links.some(row=>row.receiptId===receipt.receiptId&&row.receiptProofId===receipt.id&&row.paymentId===created.id))refuse();
  const[route]=await ctx.tx.select().from(merchantAgreementPaymentRoutes).where(eq(merchantAgreementPaymentRoutes.paymentId,created.id)).limit(1);
  if(!route||route.originalChargeReceiptId!==receipt.receiptId||route.subscriptionId!==batch.subscriptionId||route.providerPlatformAccountId!==original.providerPlatformAccountId||route.chargeAccountId!==original.chargeAccountId
   ||route.providerInvoiceRef!==original.providerInvoiceRef||route.providerPaymentIntentRef!==original.providerPaymentIntentRef||route.providerChargeRef!==original.providerChargeRef||route.applicationFeeMinor!==receipt.feeMinor)refuse();
  await ctx.callAsSystem(recordMerchantPaymentObservation,{paymentId:created.id,providerEventRef:`controlled-cash-bank:${receipt.bankObservationId}:${receipt.receiptId}`,evidence:bank.actualPaymentEvidence});
  const observed=await readControlledCashApplicationStage(ctx,{batchId:batch.id,receiptId:receipt.receiptId,paymentId:created.id});
  if(observed.batch.digest!==batch.digest)refuse();
  const[boundary]=await ctx.tx.execute<{evidence:unknown}>(sql`select freeholder_controlled_cash_before_settlement(${created.id}::uuid) as evidence`);
  const ready=controlledCashStageEvidence.parse(boundary?.evidence);
  if(ready.batchId!==batch.id||ready.receiptId!==receipt.receiptId||ready.paymentId!==created.id||ready.complete||merchantTaxDigest(ready)!==merchantTaxDigest(observed.evidence))refuse();
  const settled=paymentResult.parse(await ctx.callAsSystem(settle,{id:created.id,providerRef:original.providerPaymentIntentRef,processedAt:receipt.processedAt}));
  if(settled.id!==created.id||settled.status!=="succeeded"||settled.providerRef!==original.providerPaymentIntentRef||settled.amountMinor!==receipt.amountMinor||settled.currency!==receipt.currency)refuse();
  const after=await readControlledCashApplicationStage(ctx,{batchId:batch.id,receiptId:receipt.receiptId,paymentId:settled.id});
  if(after.batch.digest!==batch.digest||!after.evidence.settledReceiptIds.includes(receipt.receiptId)||after.evidence.settledReceiptIds.length!==receipt.ordinal)refuse();
  result.push({receiptId:receipt.receiptId,paymentId:settled.id});
 }
 const complete=await readControlledCashApplicationStage(ctx,{batchId:batch.id});
 if(!complete.evidence.complete||complete.evidence.settledReceiptIds.length!==ordered.length)refuse();
 const[invoice]=await ctx.tx.select().from(invoices).where(eq(invoices.id,batch.invoiceId)).limit(1);if(!invoice)refuse();
 const expected=BigInt(batch.invoiceBeforePaidMinor)+BigInt(batch.expectedCashMinor),outstanding=BigInt(invoice.totalMinor)-BigInt(invoice.creditedMinor)-BigInt(invoice.paidMinor);
 if(BigInt(invoice.paidMinor)!==expected||invoice.creditedMinor!==batch.invoiceBeforeCreditedMinor||invoice.refundedMinor!==0||invoice.currency!==batch.currency||outstanding<0n
  ||outstanding>0n&&invoice.status!=="partially_paid"||outstanding===0n&&invoice.status!=="paid")refuse();
 await ctx.tx.execute(sql`select set_config(${CONTROLLED_CASH_BATCH_MARKER},'',true)`);
 // The shared committed paid spine owns invoice.paid dispatch. Period/proration
 // access effects belong to a SEPARATE real transaction after this commit.
 ctx.setSubject("invoice",invoice.id);return{invoiceId:invoice.id,batchId:batch.id,payments:result,outstandingMinor:Number(outstanding),batchRevision:complete.revision,suppliesAccessAuthority:false as const};
}
