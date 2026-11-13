// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: table-bound physical history; no registration or provider I/O.
import { sql } from "drizzle-orm";
import type { Tx } from "@/core/service";
import { ServiceError } from "@/core/service";
import { controlledProviderWitnesses, exportControlledProviderHistory } from "@/modules/subscriptions/controlled-provider-witnesses";
import { readControlledReceiptNamespace } from "@/modules/subscriptions/controlled-provider-cash-namespace";
import { controlledProviderCoverage } from "@/modules/subscriptions/controlled-provider-coverage";
import { merchantTaxDigest } from "./merchant-tax-store";

export const controlledFinancialTables = {
 resources: "subscription_controlled_resources", operations: "subscription_controlled_operations", calls: "subscription_controlled_calls",
 facts: "subscription_controlled_facts", finishes: "subscription_controlled_finishes", stops: "subscription_controlled_stops",
 verifications: "subscription_controlled_verifications", chargeOrigins: "subscription_controlled_charge_origins", closures: "subscription_controlled_closures",
} as const;
export type ControlledFinancialHistory = Awaited<ReturnType<typeof controlledProviderWitnesses>>;
export type ControlledFinancialEntry = { table: string; id: string; fingerprint: string };
const families = Object.keys(controlledFinancialTables) as Array<keyof typeof controlledFinancialTables>;
export function controlledFinancialEntries(history: ControlledFinancialHistory): ControlledFinancialEntry[] {
 return families.flatMap(family => history[family].map(row => ({ table: controlledFinancialTables[family], id: row.id, fingerprint: row.fingerprint })))
  .sort((a,b) => a.table.localeCompare(b.table) || a.id.localeCompare(b.id));
}
/** FK closure is checked independently of opaque hashes. Authentication of
 * actual original/finish/stop signatures remains the coverage reader's job. */
export function controlledFinancialAncestryComplete(history: ControlledFinancialHistory): boolean {
 const resources=new Set(history.resources.map(row=>row.id)),operations=new Map(history.operations.map(row=>[row.id,row.resourceId]));
 const calls=new Map(history.calls.map(row=>[row.id,row.operationId])),facts=new Map(history.facts.map(row=>[row.id,row.callId]));
 const finishes=new Set(history.finishes.map(row=>row.id)),stops=new Set(history.stops.map(row=>row.id));
 return !history.incomplete && families.every(family=>new Set(history[family].map(row=>row.id)).size===history[family].length)
  && history.operations.every(row=>resources.has(row.resourceId))&&history.calls.every(row=>operations.has(row.operationId))
  &&history.facts.every(row=>calls.has(row.callId))&&history.finishes.every(row=>calls.has(row.id)&&!stops.has(row.id))
  &&history.stops.every(row=>calls.has(row.id)&&!finishes.has(row.id))
  &&history.verifications.every(row=>calls.get(row.callId)===row.id&&operations.has(row.id))
  &&history.chargeOrigins.every(row=>operations.get(row.operationId)===row.resourceId&&calls.get(row.callId)===row.operationId&&facts.get(row.factId)===row.callId)
  &&history.closures.every(row=>resources.has(row.id));
}
export type ControlledFinancialScope = { subscriptionIds?: readonly string[]; receiptIds?: readonly string[]; paymentIds?: readonly string[]; invoiceIds?: readonly string[]; profileIds?: readonly string[] };
const list = (values: readonly string[]) => values.length ? sql.join(values.map(id=>sql`${id}::uuid`),sql`,`) : sql`null::uuid`;
/** Invoice membership follows actual subscription event/accepted target and
 * payment→canonical receipt FKs, never a source-prefix/account/amount guess.
 * Profile mode follows accepted terms; it does not authorize a collection on
 * a shared mixed invoice. A collection supplies its exact original payments. */
export async function controlledFinancialWitness(tx: Tx, scope: ControlledFinancialScope) {
 const input = { subscriptionIds:[...new Set(scope.subscriptionIds??[])].sort(), receiptIds:[...new Set(scope.receiptIds??[])].sort(),
  paymentIds:[...new Set(scope.paymentIds??[])].sort(), invoiceIds:[...new Set(scope.invoiceIds??[])].sort(), profileIds:[...new Set(scope.profileIds??[])].sort() };
 const empty = await controlledProviderWitnesses(tx,{});
 const failed = () => ({ version:1 as const, history:empty, entries:[] as ControlledFinancialEntry[], receiptIds:[] as string[], incomplete:true });
 if(Object.values(input).some(ids=>ids.length>5000)) return failed();
 const links = input.paymentIds.length || input.invoiceIds.length ? await tx.execute<{subscriptionId:string|null;receiptId:string|null}>(sql`
  select route.subscription_id::text as "subscriptionId",route.original_charge_receipt_id::text as "receiptId"
   from merchant_agreement_payment_routes route join payments p on p.id=route.payment_id
   where p.id in (${list(input.paymentIds)}) or p.invoice_id in (${list(input.invoiceIds)})
  union select cash.subscription_id::text,cash.id::text from subscription_provider_charge_receipts cash
   join merchant_payment_observations observed on observed.provider_platform_account_id=cash.provider_platform_account_id
    and observed.charge_account_id is not distinct from cash.charge_account_id and observed.provider_ref=cash.provider_payment_intent_ref
   join payments p on p.id=observed.payment_id where p.id in (${list(input.paymentIds)}) or p.invoice_id in (${list(input.invoiceIds)})
  union select e.subscription_id::text,null::text from subscription_events e where e.invoice_id in (${list(input.invoiceIds)})
  union select p.subscription_id::text,null::text from subscription_prorations p join invoices i on i.id=p.debit_invoice_id
   where i.id in (${list(input.invoiceIds)}) and i.source_type='subscription' and i.source_id=p.subscription_id::text||':proration:'||p.id::text
  limit 5001`) : [];
 if(links.length>5000) return failed();
 input.subscriptionIds=[...new Set([...input.subscriptionIds,...links.flatMap(row=>row.subscriptionId?[row.subscriptionId]:[])])].sort();
 input.receiptIds=[...new Set([...input.receiptIds,...links.flatMap(row=>row.receiptId?[row.receiptId]:[])])].sort();
 if(input.subscriptionIds.length+input.receiptIds.length>5000)return failed();
 const groups: ControlledFinancialHistory[]=[await controlledProviderWitnesses(tx,{subscriptionIds:input.subscriptionIds,receiptIds:input.receiptIds})];
 for(const profileId of input.profileIds)groups.push(await controlledProviderWitnesses(tx,{profileId}));
 const history:ControlledFinancialHistory={...empty};
 for(const family of families){
  const rows=new Map<string,ControlledFinancialHistory[typeof family][number]>();
  for(const group of groups)for(const row of group[family]){
   const previous=rows.get(row.id);if(previous&&merchantTaxDigest(previous)!==merchantTaxDigest(row))return failed();rows.set(row.id,row);
  }
  // Each branch retains its exact family's typed ancestry; do not collapse
  // equal UUIDs across physical tables into one row.
  Object.assign(history,{[family]:[...rows.values()].sort((a,b)=>a.id.localeCompare(b.id))});
 }
 const entries=controlledFinancialEntries(history);
 if(groups.some(group=>group.incomplete)||entries.length>5000||!controlledFinancialAncestryComplete(history))return failed();
 if(input.profileIds.length&&!input.subscriptionIds.length&&!input.receiptIds.length&&history.resources.some(row=>!input.profileIds.includes(row.profileId)))return failed();
 return{version:1 as const,history,entries,receiptIds:input.receiptIds,incomplete:false};
}
/** Authentication/debt is separate from a privacy fingerprint. Missing exact
 * controlled bridge must remain applies=true debt, never a legacy fallback. */
const primaryControlledKinds=new Set(["bootstrap","discover_bootstrap","pause_drafts","read_bootstrap","list_invoices","create_schedule","read_calendar","update_calendar","read_invoice","finalize_invoice","pay_invoice","cancel_calendar","void_invoice","delete_draft"]);
export async function controlledCashFinancialHistory(tx:Tx,receiptIds:readonly string[],subscriptionIds:readonly string[] = []){
 const witness=await controlledFinancialWitness(tx,{receiptIds,subscriptionIds});
 const namespaces=[];for(const id of [...new Set(receiptIds)].sort())namespaces.push({receiptId:id,...await readControlledReceiptNamespace(tx,id)});
 const coverage=[];for(const id of [...new Set(witness.history.resources.map(row=>row.subscriptionId))].sort())coverage.push(await controlledProviderCoverage(tx,{subscriptionId:id}));
 return{...witness,namespaces,coverage,incomplete:witness.incomplete||namespaces.some(row=>row.applies&&(!row.verified||row.rawCashReview))
   ||coverage.some(row=>row.rawCashReviewFactIds.length>0),
  principalCallerDebt:namespaces.some(row=>row.applies&&row.principalCallerDebt)||coverage.some(row=>row.unfinishedCalls.some(call=>primaryControlledKinds.has(call.kind))),
  financialCallerDebt:namespaces.some(row=>row.applies&&row.financialCallerDebt)||coverage.some(row=>row.unfinishedCalls.length>0)};
}
export async function exportControlledFinancialHistory(tx:Tx,scope:ControlledFinancialScope){
 const selected=await controlledFinancialWitness(tx,scope);
 if(selected.incomplete)throw new ServiceError("conflict","Restore the complete exact original controlled provider financial history before export.");
 const receiptIds=[...new Set([...selected.receiptIds,...selected.history.chargeOrigins.map(row=>row.id)])];
 const receipts=receiptIds.length?await tx.execute<{id:string;subscriptionId:string;providerInvoiceRef:string;providerPaymentIntentRef:string;amountMinor:number;currency:string;customerChargeVerified:boolean;merchantRouteVerified:boolean;createdAt:string;observedApplicationFeeMinor?:number|null;observedApplicationFeeCurrency?:string|null}>(sql`
  select r.id::text,r.subscription_id::text as "subscriptionId",r.provider_invoice_ref as "providerInvoiceRef",r.provider_payment_intent_ref as "providerPaymentIntentRef",
   r.amount_minor::float8 as "amountMinor",r.currency,r.customer_charge_verified as "customerChargeVerified",r.merchant_route_verified as "merchantRouteVerified",r.created_at::text as "createdAt"
   ${scope.profileIds?.length?sql`,r.observed_application_fee_minor::float8 as "observedApplicationFeeMinor",r.observed_application_fee_currency as "observedApplicationFeeCurrency"`:sql``}
  from subscription_provider_charge_receipts r where r.id in (${list(receiptIds)}) order by r.id limit 5001`):[];
 if(receipts.length!==receiptIds.length||selected.entries.length+receipts.length>5000)throw new ServiceError("conflict","Restore the complete actual controlled canonical cash identity before export.");
 const after=await controlledFinancialWitness(tx,scope);
 if(after.incomplete||merchantTaxDigest(after)!==merchantTaxDigest(selected))throw new ServiceError("conflict","The original controlled financial history changed during export.");
 return{selected,exported:{...exportControlledProviderHistory(selected.history),originalCashReceipts:receipts}};
}
