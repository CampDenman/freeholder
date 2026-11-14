// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: real immutable prewrite admissions in ONE caller transaction.
import { randomUUID } from "node:crypto";
import { inArray,sql } from "drizzle-orm";
import { z } from "zod";
import { ServiceError,type ServiceContext } from "@/core/service";
import { CONTROLLED_COLLECTION_PROTOCOL } from "@/modules/subscriptions/controlled-provider-collection-protocol";
import { CONTROLLED_CASH_ATOMIC_PROTOCOL,CONTROLLED_CASH_LEGACY_PROTOCOL } from "./controlled-cash-application-protocol";
import { readControlledCashApplicationEvaluation } from "./controlled-cash-application-evaluation";
import { controlledCashApplicationBatches,controlledCashApplicationReceipts } from "./controlled-cash-application-protocol-schema";
import { signControlledCashBatch,signControlledCashReceipt,verifiedControlledCashBatch,verifiedControlledCashReceipt } from "./controlled-cash-application-protocol-proof";
import { readControlledCashApplicationStage } from "./controlled-cash-application-stage";
import { merchantCashReturnInspections,merchantCashReturnObservations } from "./merchant-refund-schema";
import { CONTROLLED_CASH_APPLICATION_SHAPE_SHA } from "./controlled-cash-application-complete-proof";
import { merchantTaxDigest } from "./merchant-tax-store";
const sha=z.string().regex(/^[a-f0-9]{64}$/),minor=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const mutableRows=z.array(z.object({table:z.enum(["payment_plans","payment_plan_installments"]),id:z.uuid(),fingerprint:sha,fields:z.object({paid_minor:minor,status:z.string().min(1),updated_at:z.string().min(1)}).strict()}).strict()).max(5000);
const invoiceBefore=z.object({fingerprint:sha,status:z.string(),paidMinor:minor,creditedMinor:minor,refundedMinor:z.literal(0),paidAt:z.string().nullable(),updatedAt:z.string().min(1)}).strict();
function refuse():never{throw new ServiceError("conflict","Install the complete actual staged receipt route guards and preserve genuine unchanged bank/parent prewrite evidence before any application admission. No pointer, cached scalar or planned payment UUID is authority.");}
/** Mechanical installed capability only, NEVER permission for money. The real
 * current original bank/parent proof is evaluated independently below. */
export async function requireControlledCashApplicationRuntime(ctx:ServiceContext){
 const[installed]=await ctx.tx.execute<{present:boolean}>(sql`select to_regprocedure('freeholder_controlled_subscription_route_ready()') is not null
  and to_regprocedure('freeholder_controlled_cash_stage(uuid,uuid,uuid)') is not null
  and to_regprocedure('freeholder_controlled_cash_before_settlement(uuid)') is not null as present`);
 const[protocol]=await ctx.tx.execute<{complete:boolean}>(sql`with expected(table_name,trigger_name,fn_signature,kind,is_deferrable,is_deferred) as(values
  ('controlled_cash_application_batches','controlled_cash_batches_immutable','freeholder_controlled_cash_guard_batch()',31,false,false),
  ('controlled_cash_application_receipts','controlled_cash_receipts_immutable','freeholder_controlled_cash_guard_receipt()',31,false,false),
  ('controlled_cash_application_links','controlled_cash_links_immutable','freeholder_controlled_cash_guard_link()',31,false,false),
  ('payments','controlled_cash_payment_birth','freeholder_controlled_cash_link_created_payment()',5,false,false),
  ('payments','controlled_cash_payment_transition','freeholder_controlled_cash_guard_payment_transition()',19,false,false),
  ('controlled_cash_application_batches','controlled_cash_batch_complete','freeholder_controlled_cash_application_complete()',5,true,true),
  ('controlled_cash_application_receipts','controlled_cash_receipt_complete','freeholder_controlled_cash_application_complete()',5,true,true),
  ('controlled_cash_application_links','controlled_cash_link_complete','freeholder_controlled_cash_application_complete()',5,true,true),
  ('payments','controlled_cash_payment_complete','freeholder_controlled_cash_application_complete()',21,true,true),
  ('invoices','controlled_cash_invoice_complete','freeholder_controlled_cash_application_complete()',17,true,true),
  ('payments','subscription_controlled_cash_payment_complete','freeholder_controlled_cash_application_guard()',21,true,true),
  ('merchant_agreement_payment_routes','subscription_controlled_cash_route_complete','freeholder_controlled_cash_application_guard()',21,true,true),
  ('invoices','subscription_controlled_cash_invoice_complete','freeholder_controlled_cash_application_guard()',21,true,true))
  select count(*)=13 and bool_and(coalesce(not t.tgisinternal and t.tgenabled in('O','A') and t.tgfoid=to_regprocedure(e.fn_signature) and t.tgtype::integer=e.kind and t.tgdeferrable=e.is_deferrable and t.tginitdeferred=e.is_deferred,false))
   and exists(select 1 from pg_proc p where p.oid=to_regprocedure('freeholder_controlled_cash_application_shape(uuid)') and p.provolatile='v'
    and encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')=${CONTROLLED_CASH_APPLICATION_SHAPE_SHA}) as complete
   from expected e left join pg_trigger t on t.tgrelid=to_regclass(e.table_name) and t.tgname=e.trigger_name`);
 if(installed?.present!==true||protocol?.complete!==true)refuse();const[ready]=await ctx.tx.execute<{ready:boolean}>(sql`select freeholder_controlled_subscription_route_ready() as ready`);if(ready?.ready!==true)refuse();
}
/** Caller must complete the genuine staged shared writer in this SAME TX.
 * Deferred guards refuse a committed admission without its actual conserved
 * payment prefix. No service is registered and no external proof is supplied.
 */
export async function admitControlledCashApplication(ctx:ServiceContext,input:{collectionId:string;receiptIds:readonly string[];requiredProtocol:typeof CONTROLLED_COLLECTION_PROTOCOL}){
 if(ctx.actor.kind!=="system")refuse();await requireControlledCashApplicationRuntime(ctx);
 const request={collectionId:input.collectionId,receiptIds:[...input.receiptIds],requiredProtocol:input.requiredProtocol};
 const first=await readControlledCashApplicationEvaluation(ctx,request);
 const current=await readControlledCashApplicationEvaluation(ctx,request);
 if(first.parentRevision!==current.parentRevision||first.parentPgRevision!==current.parentPgRevision||first.bankRevision!==current.bankRevision||first.preApplicationRevision!==current.preApplicationRevision)refuse();
 const{plan}=current,proof=plan.proof;
 const[invoiceRow]=await ctx.tx.execute<{before:unknown}>(sql`select jsonb_build_object('fingerprint',encode(sha256(convert_to(to_jsonb(i)::text,'UTF8')),'hex'),'status',i.status,'paidMinor',i.paid_minor,'creditedMinor',i.credited_minor,'refundedMinor',i.refunded_minor,
  'paidAt',to_jsonb(i)->>'paid_at','updatedAt',to_jsonb(i)->>'updated_at') as before from invoices i where i.id=${current.invoiceId}::uuid`);
 const before=invoiceBefore.parse(invoiceRow?.before);
 if(plan.snapshot.entries.find(row=>row.table==="invoices"&&row.id===current.invoiceId)?.fingerprint!==before.fingerprint||before.paidMinor!==proof.canonical.paidMinor||before.creditedMinor!==proof.canonical.creditedMinor)refuse();
 const[plans]=await ctx.tx.execute<{rows:unknown}>(sql`select coalesce(jsonb_agg(jsonb_build_object('table',candidate.family,'id',candidate.identity,'fingerprint',candidate.fingerprint,'fields',candidate.fields) order by candidate.family,candidate.identity),'[]'::jsonb) as rows from(
  select 'payment_plans'::text family,p.id::text identity,encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex') fingerprint,jsonb_build_object('paid_minor',p.paid_minor,'status',p.status,'updated_at',to_jsonb(p)->>'updated_at') fields from payment_plans p where p.invoice_id=${current.invoiceId}::uuid
  union all select 'payment_plan_installments',i.id::text,encode(sha256(convert_to(to_jsonb(i)::text,'UTF8')),'hex'),jsonb_build_object('paid_minor',i.paid_minor,'status',i.status,'updated_at',to_jsonb(i)->>'updated_at')
   from payment_plan_installments i join payment_plans p on p.id=i.plan_id where p.invoice_id=${current.invoiceId}::uuid) candidate`);
 const mutableBeforeRows=mutableRows.parse(plans?.rows);if(mutableBeforeRows.some(row=>plan.snapshot.entries.find(entry=>entry.table===row.table&&entry.id===row.id)?.fingerprint!==row.fingerprint))refuse();
 const inspections=await ctx.tx.select().from(merchantCashReturnInspections).where(inArray(merchantCashReturnInspections.id,plan.pending.map(row=>row.inspectionId))).limit(5001);
 const bankObservations=await ctx.tx.select().from(merchantCashReturnObservations).where(inArray(merchantCashReturnObservations.id,plan.pending.map(row=>row.bankObservationId))).limit(5001);
 if(inspections.length!==plan.pending.length||bankObservations.length!==plan.pending.length)refuse();
 const[transaction]=await ctx.tx.execute<{id:string}>(sql`select txid_current()::text as id`);if(!transaction||!/^\d+$/.test(transaction.id))refuse();
 const batch:Omit<typeof controlledCashApplicationBatches.$inferSelect,"digest"|"authentication">={id:randomUUID(),collectionId:proof.collectionId,quoteId:proof.quoteId,resourceId:proof.resourceId,subscriptionId:proof.subscriptionId,invoiceId:proof.invoiceId,termsId:proof.termsId,protocol:proof.atomicFeePolicy?CONTROLLED_CASH_ATOMIC_PROTOCOL:CONTROLLED_CASH_LEGACY_PROTOCOL,
  admissionTransactionId:transaction.id,bankRevision:current.bankRevision,parentRevision:current.parentRevision,parentPgRevision:current.parentPgRevision,preApplicationRevision:current.preApplicationRevision,acceptedQuoteDigest:proof.acceptedQuoteDigest,canonicalTargetDigest:proof.canonicalTargetDigest,
  beforeEntries:plan.snapshot.entries,mutableBeforeRows,requestedReceiptIds:plan.requestedReceiptIds,rawBindings:proof.prospectiveRawBindings,invoiceBeforeFingerprint:before.fingerprint,invoiceBeforeStatus:before.status,invoiceBeforePaidMinor:before.paidMinor,invoiceBeforeCreditedMinor:before.creditedMinor,invoiceBeforeRefundedMinor:0,invoiceBeforePaidAt:before.paidAt,invoiceBeforeUpdatedAt:before.updatedAt,
  expectedCashMinor:plan.expectedCashMinor,expectedFeeMinor:plan.expectedFeeMinor,currency:proof.bankInvoice.currency,createdAt:new Date()};
 const receipts=plan.pending.map((row,index)=>{
  const inspection=inspections.find(actual=>actual.id===row.inspectionId),observation=bankObservations.find(actual=>actual.id===row.bankObservationId);
  const receiptFingerprint=plan.snapshot.entries.find(entry=>entry.table==="subscription_provider_charge_receipts"&&entry.id===row.receiptId)?.fingerprint;
  if(!inspection||!inspection.subscriptionChargeObservationId||inspection.subscriptionChargeReceiptId!==row.receiptId||inspection.paymentId!==null||!row.originalObservationIds.includes(inspection.subscriptionChargeObservationId)
   ||!observation||observation.inspectionId!==inspection.id||inspection.caller.id!==row.finishCallerId||!receiptFingerprint)refuse();
  const paymentIdempotencyKey=`controlled-receipt:${batch.collectionId}:${row.receiptId}`;
  const paymentRequest={invoiceId:batch.invoiceId,provider:"stripe",method:"provider_schedule",amountMinor:row.amountMinor,idempotencyKey:paymentIdempotencyKey,subscriptionChargeReceiptId:row.receiptId,metadata:{}};
  const body:Omit<typeof controlledCashApplicationReceipts.$inferSelect,"digest"|"authentication">={id:randomUUID(),batchId:batch.id,receiptId:row.receiptId,ordinal:index+1,originalObservationId:inspection.subscriptionChargeObservationId,
   originOperationId:row.originOperationId,originCallId:row.originCallId,originFactId:row.originFactId,bankInspectionId:row.inspectionId,bankObservationId:row.bankObservationId,bankFinishCallerId:row.finishCallerId,immutableBankRevision:row.immutableBankRevision,namespaceRevision:row.namespaceRevision,receiptFingerprint,originalObservationIds:row.originalObservationIds,
   amountMinor:row.amountMinor,currency:row.currency,priorCashMinor:row.feeAllocation.priorCashMinor,priorAllocatedFeeMinor:row.feeAllocation.priorAllocatedFeeMinor,feeMinor:row.feeAllocation.feeMinor,feeAllocationRevision:row.feeAllocation.revision,paymentEvidenceDigest:merchantTaxDigest(row.actualPaymentEvidence),paymentIdempotencyKey,paymentRequestHash:merchantTaxDigest(paymentRequest),processedAt:observation.createdAt,createdAt:new Date()};
  return{...body,...signControlledCashReceipt(body)};
 });
 // No mutation has occurred. Recheck the whole genuine evaluator immediately
 // before INSERT; SQL independently compares the complete current PG preimage.
 const final=await readControlledCashApplicationEvaluation(ctx,request);
 if(final.parentRevision!==current.parentRevision||final.parentPgRevision!==current.parentPgRevision||final.bankRevision!==current.bankRevision||final.preApplicationRevision!==current.preApplicationRevision)refuse();
 const[stored]=await ctx.tx.insert(controlledCashApplicationBatches).values({...batch,...signControlledCashBatch(batch)}).returning();if(!stored||!verifiedControlledCashBatch(stored))refuse();
 for(const receipt of receipts){const[actual]=await ctx.tx.insert(controlledCashApplicationReceipts).values(receipt).returning();if(!actual||!verifiedControlledCashReceipt(actual))refuse();}
 const next=receipts[0];if(!next)refuse();const stage=await readControlledCashApplicationStage(ctx,{batchId:stored.id,receiptId:next.receiptId});
 if(stage.batch.digest!==stored.digest||stage.evidence.settledReceiptIds.length)refuse();
 return{batch:stored,receipts:stage.receipts,bank:plan.proof,initialParentRevision:current.parentRevision,suppliesApplicationAuthority:false as const,suppliesAccessAuthority:false as const};
}
