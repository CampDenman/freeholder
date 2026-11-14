// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: collector-free exact-owner application proof fingerprints.
import { inArray,sql } from "drizzle-orm";
import { z } from "zod";
import { ServiceError,type Tx } from "@/core/service";
import { controlledCashApplicationBatches,controlledCashApplicationReceipts } from "./controlled-cash-application-protocol-schema";
import { verifiedControlledCashBatch,verifiedControlledCashReceipt } from "./controlled-cash-application-protocol-proof";
export const controlledCashApplicationTables={batches:"controlled_cash_application_batches",receipts:"controlled_cash_application_receipts",links:"controlled_cash_application_links"} as const;
export type ControlledCashApplicationWitnessScope={subscriptionIds?:readonly string[];invoiceIds?:readonly string[];receiptIds?:readonly string[];profileId?:string};
export type ControlledCashApplicationWitnessEntry={table:typeof controlledCashApplicationTables[keyof typeof controlledCashApplicationTables];id:string;fingerprint:string;
 parents:{batchId:string;collectionId:string;quoteId:string;subscriptionId:string;invoiceId:string;profileId:string;profileVersion:number;receiptId:string|null;paymentId:string|null}};
const list=(values:readonly string[])=>values.length?sql.join(values.map(id=>sql`${id}::uuid`),sql`, `):sql`null::uuid`;
function refuse():never{throw new ServiceError("conflict","Restore complete exact original application proof ownership; a shared profile or equal amount cannot select another seller's history.");}
/** Profile is a RESTRICTION of exact actual parent IDs, never a profile-wide
 * discovery shortcut. Root parent selectors derive their frozen collection/
 * subscription/invoice/receipt subgraph. Empty old histories remain empty. */
export async function controlledCashApplicationWitnesses(tx:Tx,input:ControlledCashApplicationWitnessScope){
 const scope={subscriptionIds:[...new Set(input.subscriptionIds??[])].sort(),invoiceIds:[...new Set(input.invoiceIds??[])].sort(),receiptIds:[...new Set(input.receiptIds??[])].sort()};
 const requested=Object.values(scope).flat();if(requested.length>5000||requested.some(id=>!z.uuid().safeParse(id).success)||input.profileId&&!z.uuid().safeParse(input.profileId).success)refuse();
 if(!requested.length){if(input.profileId)refuse();return{version:1 as const,entries:[] as ControlledCashApplicationWitnessEntry[],incomplete:false};}
 const[ownership]=await tx.execute<{complete:boolean}>(sql`with candidates as(
  select batch_row.* from controlled_cash_application_batches batch_row where batch_row.subscription_id in(${list(scope.subscriptionIds)}) or batch_row.invoice_id in(${list(scope.invoiceIds)})
   or exists(select 1 from controlled_cash_application_receipts receipt_proof where receipt_proof.batch_id=batch_row.id and receipt_proof.receipt_id in(${list(scope.receiptIds)}))
 ) select(select count(*)<=5000 from candidates) and not exists(
  select 1 from candidates batch_row left join subscription_controlled_collections collection_row on collection_row.id=batch_row.collection_id
   left join subscription_controlled_quotes quote_row on quote_row.id=batch_row.quote_id
   left join subscription_controlled_resources resource_row on resource_row.id=quote_row.resource_id
  where collection_row.id is null or quote_row.id is null or resource_row.id is null or collection_row.quote_id is distinct from batch_row.quote_id or collection_row.invoice_id is distinct from batch_row.invoice_id
   or collection_row.terms_id is distinct from batch_row.terms_id or quote_row.resource_id is distinct from batch_row.resource_id or resource_row.subscription_id is distinct from batch_row.subscription_id
 ) and not exists(
  select 1 from controlled_cash_application_receipts receipt_proof join candidates batch_row on batch_row.id=receipt_proof.batch_id
   left join subscription_provider_charge_receipts original_receipt on original_receipt.id=receipt_proof.receipt_id
   left join subscription_controlled_charge_origins original_origin on original_origin.receipt_id=receipt_proof.receipt_id
   left join merchant_cash_return_inspections actual_inspection on actual_inspection.id=receipt_proof.bank_inspection_id
   left join merchant_cash_return_observations actual_bank on actual_bank.id=receipt_proof.bank_observation_id
  where original_receipt.id is null or original_receipt.subscription_id is distinct from batch_row.subscription_id or original_receipt.amount_minor is distinct from receipt_proof.amount_minor or original_receipt.currency is distinct from receipt_proof.currency
   or original_origin.receipt_id is null or original_origin.resource_id is distinct from batch_row.resource_id or original_origin.operation_id is distinct from receipt_proof.origin_operation_id or original_origin.call_id is distinct from receipt_proof.origin_call_id or original_origin.fact_id is distinct from receipt_proof.origin_fact_id
   or actual_inspection.id is null or actual_inspection.payment_id is not null or actual_inspection.subscription_charge_receipt_id is distinct from receipt_proof.receipt_id or actual_inspection.subscription_charge_observation_id is distinct from receipt_proof.original_observation_id
   or actual_bank.id is null or actual_bank.inspection_id is distinct from receipt_proof.bank_inspection_id
 ) and not exists(
  select 1 from controlled_cash_application_links actual_link join candidates batch_row on batch_row.id=actual_link.batch_id
   left join controlled_cash_application_receipts receipt_proof on receipt_proof.id=actual_link.receipt_proof_id left join payments actual_payment on actual_payment.id=actual_link.payment_id
  where receipt_proof.id is null or receipt_proof.batch_id is distinct from actual_link.batch_id or receipt_proof.receipt_id is distinct from actual_link.receipt_id
   or actual_payment.id is null or actual_payment.invoice_id is distinct from batch_row.invoice_id or actual_payment.provider is distinct from 'stripe' or actual_payment.method is distinct from 'provider_schedule'
   or actual_payment.amount_minor is distinct from receipt_proof.amount_minor or actual_payment.currency is distinct from receipt_proof.currency or actual_payment.idempotency_key is distinct from receipt_proof.payment_idempotency_key or actual_payment.request_hash is distinct from receipt_proof.payment_request_hash
 ) as complete`);
 if(ownership?.complete!==true)refuse();
 const rows=await tx.execute<ControlledCashApplicationWitnessEntry>(sql`with owned_batches as(
  select batch_row.id,quote_row.profile_id,quote_row.profile_version from controlled_cash_application_batches batch_row
  join subscription_controlled_collections collection_row on collection_row.id=batch_row.collection_id and collection_row.quote_id=batch_row.quote_id and collection_row.invoice_id=batch_row.invoice_id and collection_row.terms_id=batch_row.terms_id
  join subscription_controlled_quotes quote_row on quote_row.id=batch_row.quote_id and quote_row.resource_id=batch_row.resource_id
  join subscription_controlled_resources resource_row on resource_row.id=quote_row.resource_id and resource_row.subscription_id=batch_row.subscription_id
  where(batch_row.subscription_id in(${list(scope.subscriptionIds)}) or batch_row.invoice_id in(${list(scope.invoiceIds)}) or exists(
   select 1 from controlled_cash_application_receipts receipt_proof where receipt_proof.batch_id=batch_row.id and receipt_proof.receipt_id in(${list(scope.receiptIds)})))
   ${input.profileId?sql`and quote_row.profile_id=${input.profileId}::uuid`:sql``}
 ),physical as(
  select 'controlled_cash_application_batches'::text as table,batch_row.id::text as id,encode(sha256(convert_to(to_jsonb(batch_row)::text,'UTF8')),'hex') as fingerprint,
   jsonb_build_object('batchId',batch_row.id,'collectionId',batch_row.collection_id,'quoteId',batch_row.quote_id,'subscriptionId',batch_row.subscription_id,'invoiceId',batch_row.invoice_id,'profileId',owned.profile_id,'profileVersion',owned.profile_version,'receiptId',null,'paymentId',null) as parents
  from controlled_cash_application_batches batch_row join owned_batches owned on owned.id=batch_row.id
  union all select 'controlled_cash_application_receipts',receipt_proof.id::text,encode(sha256(convert_to(to_jsonb(receipt_proof)::text,'UTF8')),'hex'),
   jsonb_build_object('batchId',batch_row.id,'collectionId',batch_row.collection_id,'quoteId',batch_row.quote_id,'subscriptionId',batch_row.subscription_id,'invoiceId',batch_row.invoice_id,'profileId',owned.profile_id,'profileVersion',owned.profile_version,'receiptId',receipt_proof.receipt_id,'paymentId',actual_link.payment_id)
  from controlled_cash_application_receipts receipt_proof join owned_batches owned on owned.id=receipt_proof.batch_id join controlled_cash_application_batches batch_row on batch_row.id=receipt_proof.batch_id
   left join controlled_cash_application_links actual_link on actual_link.receipt_proof_id=receipt_proof.id and actual_link.batch_id=receipt_proof.batch_id and actual_link.receipt_id=receipt_proof.receipt_id
  union all select 'controlled_cash_application_links',actual_link.receipt_id::text,encode(sha256(convert_to(to_jsonb(actual_link)::text,'UTF8')),'hex'),
   jsonb_build_object('batchId',batch_row.id,'collectionId',batch_row.collection_id,'quoteId',batch_row.quote_id,'subscriptionId',batch_row.subscription_id,'invoiceId',batch_row.invoice_id,'profileId',owned.profile_id,'profileVersion',owned.profile_version,'receiptId',actual_link.receipt_id,'paymentId',actual_link.payment_id)
  from controlled_cash_application_links actual_link join owned_batches owned on owned.id=actual_link.batch_id join controlled_cash_application_batches batch_row on batch_row.id=actual_link.batch_id
 ) select * from physical order by 1,2 limit 5001`);
 if(rows.length>5000)refuse();
 const keys=new Set<string>();for(const row of rows){const key=`${row.table}:${row.id}`;if(keys.has(key)||!z.uuid().safeParse(row.id).success||!/^[a-f0-9]{64}$/.test(row.fingerprint))refuse();keys.add(key);}
 const batchIds=rows.filter(row=>row.table===controlledCashApplicationTables.batches).map(row=>row.id),receiptProofIds=rows.filter(row=>row.table===controlledCashApplicationTables.receipts).map(row=>row.id);
 const batches=batchIds.length?await tx.select().from(controlledCashApplicationBatches).where(inArray(controlledCashApplicationBatches.id,batchIds)).limit(5001):[];
 const receipts=receiptProofIds.length?await tx.select().from(controlledCashApplicationReceipts).where(inArray(controlledCashApplicationReceipts.id,receiptProofIds)).limit(5001):[];
 if(batches.length!==batchIds.length||receipts.length!==receiptProofIds.length||batches.some(row=>!verifiedControlledCashBatch(row))||receipts.some(row=>!verifiedControlledCashReceipt(row)))refuse();
 return{version:1 as const,entries:[...rows],incomplete:false};
}

/** Explicit private subject projection. Full internal SHA/before-entry/raw
 * bindings/HMAC/transaction ID/provider payloads are NOT archive fields. Fee
 * amounts are included only for an exact merchant subject projection. */
export async function exportControlledCashApplicationHistory(tx:Tx,scope:ControlledCashApplicationWitnessScope,options:{merchant:boolean;existingRows?:number}){
 const existing=options.existingRows??0;if(!Number.isInteger(existing)||existing<0||existing>5000)refuse();
 const selected=await controlledCashApplicationWitnesses(tx,scope);if(existing+selected.entries.length>5000)refuse();
 const batchIds=selected.entries.filter(row=>row.table===controlledCashApplicationTables.batches).map(row=>row.id);
 const batches=batchIds.length?await tx.execute<{id:string;collectionId:string;subscriptionId:string;invoiceId:string;currency:string;amountMinor:number;createdAt:string;feeMinor?:number}>(sql`
  select batch_row.id::text,batch_row.collection_id::text as "collectionId",batch_row.subscription_id::text as "subscriptionId",batch_row.invoice_id::text as "invoiceId",batch_row.currency,batch_row.expected_cash_minor::float8 as "amountMinor",batch_row.created_at::text as "createdAt"
   ${options.merchant?sql`,batch_row.expected_fee_minor::float8 as "feeMinor"`:sql``} from controlled_cash_application_batches batch_row where batch_row.id in(${list(batchIds)}) order by batch_row.id limit 5001`):[];
 const receiptProofIds=selected.entries.filter(row=>row.table===controlledCashApplicationTables.receipts).map(row=>row.id);
 const receipts=receiptProofIds.length?await tx.execute<{id:string;batchId:string;receiptId:string;amountMinor:number;currency:string;processedAt:string;createdAt:string;feeMinor?:number}>(sql`
  select receipt_proof.id::text,receipt_proof.batch_id::text as "batchId",receipt_proof.receipt_id::text as "receiptId",receipt_proof.amount_minor::float8 as "amountMinor",receipt_proof.currency,receipt_proof.processed_at::text as "processedAt",receipt_proof.created_at::text as "createdAt"
   ${options.merchant?sql`,receipt_proof.fee_minor::float8 as "feeMinor"`:sql``} from controlled_cash_application_receipts receipt_proof where receipt_proof.id in(${list(receiptProofIds)}) order by receipt_proof.id limit 5001`):[];
 const receiptIds=selected.entries.filter(row=>row.table===controlledCashApplicationTables.links).map(row=>row.id);
 const links=receiptIds.length?await tx.execute<{receiptId:string;receiptProofId:string;batchId:string;paymentId:string;createdAt:string}>(sql`
  select actual_link.receipt_id::text as "receiptId",actual_link.receipt_proof_id::text as "receiptProofId",actual_link.batch_id::text as "batchId",actual_link.payment_id::text as "paymentId",actual_link.created_at::text as "createdAt"
  from controlled_cash_application_links actual_link where actual_link.receipt_id in(${list(receiptIds)}) order by actual_link.receipt_id limit 5001`):[];
 if(batches.length!==batchIds.length||receipts.length!==receiptProofIds.length||links.length!==receiptIds.length||existing+batches.length+receipts.length+links.length>5000)refuse();
 const after=await controlledCashApplicationWitnesses(tx,scope);if(JSON.stringify(after)!==JSON.stringify(selected))refuse();
 return{selected,exported:{batches,receipts,links}};
}
