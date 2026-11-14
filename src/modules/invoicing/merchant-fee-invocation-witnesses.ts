// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: exact financial children, no process/nonce evidence in archives.
import {inArray,sql} from "drizzle-orm";
import {z} from "zod";
import {ServiceError,type Tx} from "@/core/service";
import {merchantFeeRefundInvocations} from "./merchant-fee-invocation-schema";
import {verifiedMerchantFeeInvocation} from "./merchant-fee-invocation-proof";
import {originalCashEvidenceKeys} from "./original-cash-recovery-store";
import {controlledCashApplicationBatches,controlledCashApplicationReceipts} from "./controlled-cash-application-protocol-schema";
import {verifiedControlledCashBatch,verifiedControlledCashReceipt} from "./controlled-cash-application-protocol-proof";
export type MerchantFeeInvocationScope={paymentIds?:readonly string[];receiptIds?:readonly string[];invoiceIds?:readonly string[];collectionIds?:readonly string[];profileId?:string};
type Parents={feeOperationId:string|null;parentInvocationId:string|null;paymentId:string;receiptId:string;invoiceId:string;collectionId:string;subscriptionId:string;profileId:string;profileVersion:number;batchId:string;receiptProofId:string};
export type MerchantFeeInvocationEntry={table:"merchant_fee_refund_invocations";id:string;fingerprint:string;parents:Parents};
const ids=(values:readonly string[])=>values.length?sql.join(values.map(id=>sql`${id}::uuid`),sql`, `):sql`null::uuid`;
function refuse():never{throw new ServiceError("conflict","Restore the complete exact original fee invocation ancestry, signatures and financial inventory; a shared profile, current account or matching amount cannot select another seller's callers.");}
export async function merchantFeeInvocationFinancialWitness(tx:Tx,input:MerchantFeeInvocationScope){
 const scope={paymentIds:[...new Set(input.paymentIds??[])],receiptIds:[...new Set(input.receiptIds??[])],invoiceIds:[...new Set(input.invoiceIds??[])]},all=Object.values(scope).flat(),collections=input.collectionIds?[...new Set(input.collectionIds)]:undefined;
 if(all.length+(collections?.length??0)>5000||[...all,...(collections??[])].some(id=>!z.uuid().safeParse(id).success)||input.profileId&&!z.uuid().safeParse(input.profileId).success)refuse();
 if(!all.length){if(input.profileId||collections?.length)refuse();return{entries:[] as MerchantFeeInvocationEntry[],rows:[] as (typeof merchantFeeRefundInvocations.$inferSelect)[]};}
 const candidates=await tx.execute<MerchantFeeInvocationEntry&{sourceMatches:boolean}>(sql`select 'merchant_fee_refund_invocations'::text as table,invocation.id::text as id,encode(sha256(convert_to(to_jsonb(invocation)::text,'UTF8')),'hex') as fingerprint,
  (((invocation.kind='source_inspect' and invocation.fee_operation_id is null and invocation.fee_operation_fingerprint is null)
   or (invocation.kind in ('post','recover_get') and fee.id is not null and fee.payment_id=p.id and fee.original_charge_receipt_id=original_receipt.id
    and invocation.fee_operation_fingerprint=encode(sha256(convert_to((to_jsonb(fee)-array['status','provider_ref','dispatched_at','accepted_at','updated_at'])::text,'UTF8')),'hex')
    and fee.provider_platform_account_id=original_receipt.provider_platform_account_id and fee.provider_charge_ref=original_receipt.provider_charge_ref
    and fee.application_fee_ref=coalesce(original_receipt.application_fee_ref,initial_bank.evidence->'fee'->>'providerRef') and fee.currency=p.currency))
   and invocation.original_charge_receipt_id=original_receipt.id
   and invocation.namespace_key=original_receipt.provider_platform_account_id||':'||coalesce(original_receipt.charge_account_id,'')||':'||original_receipt.provider_payment_intent_ref
   and invocation.request->>'paymentId'=p.id::text and invocation.request->>'invoiceId'=p.invoice_id::text and invocation.request->>'originalChargeReceiptId'=original_receipt.id::text
   and invocation.request->>'providerRef'=original_receipt.provider_payment_intent_ref and invocation.request->>'providerChargeRef'=original_receipt.provider_charge_ref
   and invocation.request->>'providerPlatformAccountId'=original_receipt.provider_platform_account_id
   and invocation.request->>'providerAccountId' is not distinct from original_receipt.charge_account_id
   and original_receipt.provider_platform_account_id=route_row.provider_platform_account_id
   and (route_row.application_fee_minor=0 or (initial_bank.evidence->'fee'->>'amountMinor'=route_row.application_fee_minor::text
    and initial_bank.evidence->'fee'->>'originatingChargeRef'=original_receipt.provider_charge_ref and initial_bank.evidence->'fee'->>'accountId'=route_row.recipient_account_id))
   and initial_bank.evidence->>'providerPlatformAccountId'=original_receipt.provider_platform_account_id and initial_bank.evidence->>'chargeAccountId' is not distinct from original_receipt.charge_account_id
   and p.currency=original_receipt.currency and p.provider_ref=original_receipt.provider_payment_intent_ref
   and original_receipt.subscription_id=batch_row.subscription_id and receipt_proof.amount_minor=p.amount_minor and receipt_proof.currency=p.currency
   and receipt_proof.fee_minor=route_row.application_fee_minor and collection_row.terms_id=batch_row.terms_id
   and exists(select 1 from jsonb_array_elements(batch_row.before_entries) frozen where frozen->>'table'='merchant_cash_return_observations' and frozen->>'id'=initial_bank.id::text and frozen->>'hashDomain'='postgres_row'
    and frozen->>'fingerprint'=encode(sha256(convert_to(to_jsonb(initial_bank)::text,'UTF8')),'hex'))) is true as "sourceMatches",
  jsonb_build_object('feeOperationId',fee.id,'parentInvocationId',invocation.request->>'parentFeeInvocationId','paymentId',p.id,'receiptId',original_receipt.id,'invoiceId',p.invoice_id,'collectionId',collection_row.id,'subscriptionId',batch_row.subscription_id,
   'profileId',quote_row.profile_id,'profileVersion',quote_row.profile_version,'batchId',batch_row.id,'receiptProofId',receipt_proof.id) as parents
  from merchant_fee_refund_invocations invocation join payments p on p.id=invocation.payment_id left join merchant_fee_refunds fee on fee.id=invocation.fee_operation_id
  left join merchant_agreement_payment_routes route_row on route_row.payment_id=p.id
  left join subscription_provider_charge_receipts original_receipt on original_receipt.id=route_row.original_charge_receipt_id and original_receipt.id=invocation.original_charge_receipt_id
  left join controlled_cash_application_links actual_link on actual_link.payment_id=p.id and actual_link.receipt_id=original_receipt.id
  left join controlled_cash_application_receipts receipt_proof on receipt_proof.id=actual_link.receipt_proof_id and receipt_proof.receipt_id=actual_link.receipt_id and receipt_proof.batch_id=actual_link.batch_id
  left join merchant_cash_return_observations initial_bank on initial_bank.id=receipt_proof.bank_observation_id and initial_bank.inspection_id=receipt_proof.bank_inspection_id
  left join controlled_cash_application_batches batch_row on batch_row.id=actual_link.batch_id and batch_row.invoice_id=p.invoice_id
  left join subscription_controlled_collections collection_row on collection_row.id=batch_row.collection_id and collection_row.invoice_id=p.invoice_id and collection_row.quote_id=batch_row.quote_id
  left join subscription_controlled_quotes quote_row on quote_row.id=collection_row.quote_id and quote_row.resource_id=batch_row.resource_id
  where (p.id in(${ids(scope.paymentIds)}) or p.invoice_id in(${ids(scope.invoiceIds)}) or invocation.original_charge_receipt_id in(${ids(scope.receiptIds)}))
   order by invocation.id limit 5001`);
 if(candidates.length>5000||candidates.some(row=>row.sourceMatches!==true||!z.uuid().safeParse(row.id).success||!/^[a-f0-9]{64}$/.test(row.fingerprint)||Object.entries(row.parents).some(([key,value])=>key==="profileVersion"?!Number.isSafeInteger(value)||Number(value)<=0:["feeOperationId","parentInvocationId"].includes(key)&&value===null?false:!z.uuid().safeParse(value).success)))refuse();
 const entries:MerchantFeeInvocationEntry[]=candidates.filter(row=>(!input.profileId||row.parents.profileId===input.profileId)&&(!collections||collections.includes(row.parents.collectionId))).map(row=>({table:row.table,id:row.id,fingerprint:row.fingerprint,parents:row.parents}));
 const rowIds=entries.map(row=>row.id),batchIds=[...new Set(entries.map(row=>row.parents.batchId))],proofIds=[...new Set(entries.map(row=>row.parents.receiptProofId))];
 const rows=rowIds.length?await tx.select().from(merchantFeeRefundInvocations).where(inArray(merchantFeeRefundInvocations.id,rowIds)).limit(5001):[];
 const batches=batchIds.length?await tx.select().from(controlledCashApplicationBatches).where(inArray(controlledCashApplicationBatches.id,batchIds)).limit(5001):[];
 const proofs=proofIds.length?await tx.select().from(controlledCashApplicationReceipts).where(inArray(controlledCashApplicationReceipts.id,proofIds)).limit(5001):[];
 const keys=originalCashEvidenceKeys();
 if(rows.length!==rowIds.length||batches.length!==batchIds.length||proofs.length!==proofIds.length||rows.length+batches.length+proofs.length>5000||rows.some(row=>!verifiedMerchantFeeInvocation(row,keys))||batches.some(row=>!verifiedControlledCashBatch(row))||proofs.some(row=>!verifiedControlledCashReceipt(row)))refuse();
 const{merchantFeeInvocations}=await import("./merchant-fee-invocation-store");for(const paymentId of [...new Set(entries.map(row=>row.parents.paymentId))])await merchantFeeInvocations(tx,paymentId);
 const current=rowIds.length?await tx.execute<{id:string;fingerprint:string}>(sql`select invocation.id::text,encode(sha256(convert_to(to_jsonb(invocation)::text,'UTF8')),'hex') as fingerprint from merchant_fee_refund_invocations invocation where invocation.id in(${ids(rowIds)}) order by invocation.id`):[];
 if(current.length!==entries.length||current.some(row=>entries.find(entry=>entry.id===row.id)?.fingerprint!==row.fingerprint))refuse();
 return{entries:[...entries],rows};
}

/** Profiles restrict the same exact actual parent subgraph; never discover
 * every seller sharing a platform profile or expose the invocation header. */
export async function exportMerchantFeeInvocationHistory(tx:Tx,scope:MerchantFeeInvocationScope,options:{existingRows?:number}={}){
 const existing=options.existingRows??0;if(!Number.isInteger(existing)||existing<0||existing>5000)refuse();
 const selected=await merchantFeeInvocationFinancialWitness(tx,scope);if(existing+selected.entries.length>5000)refuse();
 const byId=new Map(selected.entries.map(row=>[row.id,row]));
 const exported=selected.rows.map(row=>{const entry=byId.get(row.id);if(!entry)refuse();return{id:row.id,feeOperationId:entry.parents.feeOperationId,parentInvocationId:entry.parents.parentInvocationId,paymentId:entry.parents.paymentId,receiptId:entry.parents.receiptId,invoiceId:entry.parents.invoiceId,kind:row.kind,readKind:row.request.readKind??null,createdAt:row.createdAt,
  callerClosed:Boolean(row.finish||row.stop),outcome:row.finish?.body.outcome??null};});
 const after=await merchantFeeInvocationFinancialWitness(tx,scope);if(JSON.stringify(after.entries)!==JSON.stringify(selected.entries))refuse();
 return{selected,exported};
}
