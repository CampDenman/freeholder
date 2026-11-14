// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C1.08/C12.38: exact actual parent scope, no collector or money recursion.
import {sql} from "drizzle-orm";
import {ServiceError,type Tx} from "@/core/service";
import type {ControlledFinancialScope} from "./controlled-provider-financial-witness";
import type {ControlledTargetHistory} from "./controlled-target-financial-witness";
import {atomicCreditFeeTables,atomicCreditFeePartitionWitnesses,exportAtomicCreditFeePartitionHistory,type AtomicCreditFeeWitnessScope,type AtomicCreditFeeWitnessEntry} from "./atomic-credit-fee-financial";
import {merchantTaxDigest} from "./merchant-tax-store";
const unique=(values:readonly string[])=>[...new Set(values)].sort();
const list=(values:readonly string[])=>values.length?sql.join(values.map(id=>sql`${id}::uuid`),sql`, `):sql`null::uuid`;
function refuse():never{throw new ServiceError("conflict","Restore the exact complete B purpose parents and owned source/target credit ancestry before financial review.");}
/** Actual original input IDs remain distinct from invoice-discovered transport
 * ancestors. The latter never select every funding on another subscription.
 * Root-owned readers already authenticate their exact target quote scope. */
export async function atomicCreditFinancialWitness(tx:Tx,scope:ControlledFinancialScope,targets:ControlledTargetHistory){
 const scopes:AtomicCreditFeeWitnessScope[]=[],entries=new Map<string,AtomicCreditFeeWitnessEntry>(),dependencies=new Map<string,{table:string;id:string;fingerprint:string}>();
 const invoiceIds=unique(scope.invoiceIds??[]),paymentIds=unique(scope.paymentIds??[]),receiptIds=unique(scope.receiptIds??[]),profileIds=unique(scope.profileIds??[]);
 const partitions=profileIds.length?profileIds.map(profileId=>({profileId,quoteIds:targets.quotes.filter(row=>row.profileId===profileId).map(row=>row.id)})):[{profileId:undefined,quoteIds:targets.quotes.map(row=>row.id)}];
 for(const partition of partitions){
  if(!partition.quoteIds.length&&!invoiceIds.length&&!paymentIds.length&&!receiptIds.length)continue;
  const parents=await tx.execute<{id:string}>(sql`select actual_funding.id::text as id from invoice_credit_funding actual_funding
   join subscription_prorations actual_acceptance on actual_acceptance.id=actual_funding.proration_id
   join subscription_controlled_quotes actual_quote on actual_quote.planned_proration_id=actual_acceptance.id and actual_quote.quote_digest=actual_acceptance.accepted_quote_digest
    and actual_quote.profile_id=actual_acceptance.profile_id and actual_quote.profile_version=actual_acceptance.profile_version
   where(actual_quote.id in(${list(partition.quoteIds)}) or actual_funding.source_invoice_id in(${list(invoiceIds)}) or actual_funding.source_payment_id in(${list(paymentIds)})
    or exists(select 1 from merchant_agreement_payment_routes original_route where original_route.payment_id=actual_funding.source_payment_id and original_route.original_charge_receipt_id in(${list(receiptIds)}))
    or exists(select 1 from invoice_credit_reservations original_reservation join invoice_credit_applications original_application on original_application.reservation_id=original_reservation.id where original_reservation.funding_id=actual_funding.id and original_application.invoice_id in(${list(invoiceIds)})))
    ${partition.profileId?sql`and actual_quote.profile_id=${partition.profileId}::uuid`:sql``}
   order by actual_funding.id limit 5001`);
  if(parents.length>5000)refuse();if(!parents.length)continue;
  const selectedScope={fundingIds:unique(parents.map(row=>row.id)),...(partition.profileId?{profileId:partition.profileId}:{})},selected=await atomicCreditFeePartitionWitnesses(tx,selectedScope);
  if(!selected.entries.length)continue;scopes.push(selectedScope);
  for(const row of selected.entries){const key=`${row.table}:${row.id}`,prior=entries.get(key);if(prior&&merchantTaxDigest(prior)!==merchantTaxDigest(row))refuse();entries.set(key,row);}
  for(const row of selected.dependencies){const key=`${row.table}:${row.id}`,prior=dependencies.get(key);if(prior&&prior.fingerprint!==row.fingerprint)refuse();dependencies.set(key,row);}
  if(new Set([...entries.keys(),...dependencies.keys()]).size>5000)refuse();
 }
 // B ancestor purposes are new physical families too. Count/hash them once,
 // while old funding/reservation/application parents remain in the existing
 // credit families and are never counted again as new controlled children.
 const dependencyEntries=[...dependencies.values()].filter(row=>(row.table===atomicCreditFeeTables.fundings||row.table===atomicCreditFeeTables.reservations)&&!entries.has(`${row.table}:${row.id}`));
 return{entries:[...entries.values()].sort((a,b)=>a.table.localeCompare(b.table)||a.id.localeCompare(b.id)),dependencyEntries:dependencyEntries.sort((a,b)=>a.table.localeCompare(b.table)||a.id.localeCompare(b.id)),dependencies:[...dependencies.values()].sort((a,b)=>a.table.localeCompare(b.table)||a.id.localeCompare(b.id)),scopes};
}
export type AtomicCreditFinancialHistory=Awaited<ReturnType<typeof atomicCreditFinancialWitness>>;
/** Ancestors stay internal physical dependencies; only selected exact owners
 * enter the archive. Existing parents are unioned by actual table+UUID rather
 * than counted again as new B children. */
export async function exportAtomicCreditFinancialHistory(tx:Tx,selected:AtomicCreditFinancialHistory,existingIdentities:readonly string[],merchant:boolean){
 const entries=new Map<string,AtomicCreditFeeWitnessEntry>(),fundings:Array<Awaited<ReturnType<typeof exportAtomicCreditFeePartitionHistory>>["exported"]["fundings"][number]>=[],reservations:Array<Awaited<ReturnType<typeof exportAtomicCreditFeePartitionHistory>>["exported"]["reservations"][number]>=[];
 for(const scope of selected.scopes){const actual=await exportAtomicCreditFeePartitionHistory(tx,scope,{merchant,existingIdentities});for(const row of actual.selected.entries){const key=`${row.table}:${row.id}`;if(entries.has(key))refuse();entries.set(key,row);}fundings.push(...actual.exported.fundings);reservations.push(...actual.exported.reservations);}
 const actual=[...entries.values()].sort((a,b)=>a.table.localeCompare(b.table)||a.id.localeCompare(b.id));if(merchantTaxDigest(actual)!==merchantTaxDigest(selected.entries)||fundings.length+reservations.length!==actual.length)refuse();
 return{fundings,reservations};
}
