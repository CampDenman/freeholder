// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: PREPARED / UNRUN. Real SQL adapter, synthetic read results only.
import { drizzle } from "drizzle-orm/pg-proxy";
import { describe,expect,it } from "vitest";
import type { Tx } from "@/core/service";
import { controlledFinancialAncestryComplete,controlledFinancialEntries,controlledFinancialWitness,exportControlledFinancialHistory,type ControlledFinancialHistory } from "@/modules/invoicing/controlled-provider-financial-witness";
import { invoiceMerchantDependencyFingerprints } from "@/modules/invoicing/merchant-payment-dependencies";

const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const hash="a".repeat(64);
function history():ControlledFinancialHistory{return{
 resources:[{id:id(1),subscriptionId:id(10),termsId:id(20),profileId:id(30),profileVersion:1,fingerprint:hash},
  {id:id(2),subscriptionId:id(10),termsId:id(20),profileId:id(30),profileVersion:1,fingerprint:hash}],
 operations:[{id:id(3),resourceId:id(1),kind:"read_invoice",fingerprint:hash},{id:id(4),resourceId:id(1),kind:"read_calendar",fingerprint:hash}],
 calls:[{id:id(5),operationId:id(3),fingerprint:hash},{id:id(6),operationId:id(4),fingerprint:hash}],
 facts:[{id:id(7),callId:id(5),fingerprint:hash}],finishes:[{id:id(5),fingerprint:hash}],stops:[{id:id(6),fingerprint:hash}],
 verifications:[{id:id(3),callId:id(5),fingerprint:hash}],chargeOrigins:[{id:id(8),resourceId:id(1),operationId:id(3),callId:id(5),factId:id(7),fingerprint:hash}],
 closures:[{id:id(2),kind:"zero_transport",fingerprint:hash}],incomplete:false,
};}
function reader(source:ControlledFinancialHistory,inspect?:(query:string,params:unknown[])=>void){
 const proxy=drizzle(async(query,params)=>{
  inspect?.(query,params);
  if(query.includes("from merchant_agreement_payment_routes route join payments p"))return{rows:[{subscriptionId:id(10),receiptId:null}]};
  if(query.includes('from "subscription_controlled_resources"'))return{rows:source.resources.map(row=>[row.id,row.subscriptionId,row.termsId,row.profileId,row.profileVersion,row.fingerprint])};
  if(query.includes('from "subscription_controlled_operations"'))return{rows:source.operations.map(row=>[row.id,row.resourceId,row.kind,row.fingerprint])};
  if(query.includes('from "subscription_controlled_calls"'))return{rows:source.calls.map(row=>[row.id,row.operationId,row.fingerprint])};
  if(query.includes('from "subscription_controlled_facts"'))return{rows:source.facts.map(row=>[row.id,row.callId,row.fingerprint])};
  if(query.includes('from "subscription_controlled_finishes"'))return{rows:source.finishes.map(row=>[row.id,row.fingerprint])};
  if(query.includes('from "subscription_controlled_stops"'))return{rows:source.stops.map(row=>[row.id,row.fingerprint])};
  if(query.includes('from "subscription_controlled_verifications"'))return{rows:source.verifications.map(row=>[row.id,row.callId,row.fingerprint])};
  if(query.includes('from "subscription_controlled_charge_origins"'))return{rows:source.chargeOrigins.map(row=>[row.id,row.resourceId,row.operationId,row.callId,row.factId,row.fingerprint])};
  if(query.includes('from "subscription_controlled_closures"'))return{rows:source.closures.map(row=>[row.id,row.kind,row.fingerprint])};
  if(query.includes("from subscription_provider_charge_receipts r"))return{rows:[{id:id(8),subscriptionId:id(10),providerInvoiceRef:"in_original",providerPaymentIntentRef:"pi_original",amountMinor:500,currency:"CAD",customerChargeVerified:true,merchantRouteVerified:false,createdAt:"2026-11-13 00:00:00+00"}]};
  throw new Error(`Unexpected read outside the exact controlled fixture: ${query}`);
 });
 return proxy as unknown as Tx;
}
describe("controlled parent original financial integration",()=>{
 it("keeps all nine physical identities, including equal UUIDs across call/finish and operation/verification tables",()=>{
  const source=history(),entries=controlledFinancialEntries(source);
  expect(controlledFinancialAncestryComplete(source)).toBe(true);expect(new Set(entries.map(row=>row.table)).size).toBe(9);
  expect(entries.filter(row=>row.id===id(5)).map(row=>row.table)).toEqual(["subscription_controlled_calls","subscription_controlled_finishes"]);
  expect(entries.filter(row=>row.id===id(3))).toHaveLength(2);
 });
 it.each(["operation","call","fact","finish","verification","origin","closure"] as const)("refuses a substituted %s parent without accepting an opaque equal hash",kind=>{
  const source=history();
  if(kind==="operation")source.operations[0]!.resourceId=id(90);
  if(kind==="call")source.calls[0]!.operationId=id(90);
  if(kind==="fact")source.facts[0]!.callId=id(90);
  if(kind==="finish")source.finishes[0]!.id=id(90);
  if(kind==="verification")source.verifications[0]!.callId=id(6);
  if(kind==="origin")source.chargeOrigins[0]!.factId=id(90);
  if(kind==="closure")source.closures[0]!.id=id(90);
  expect(controlledFinancialAncestryComplete(source)).toBe(false);
 });
 it("refuses duplicate physical rows and a finish/stop substitution for the same actual call",()=>{
  const source=history();source.stops.push({id:id(5),fingerprint:hash});expect(controlledFinancialAncestryComplete(source)).toBe(false);
  const duplicate=history();duplicate.facts.push({...duplicate.facts[0]!});expect(controlledFinancialAncestryComplete(duplicate)).toBe(false);
 });
 it("selects cashless merchant resources through the frozen accepted profile and full physical PostgreSQL row SHA",async()=>{
  const queries:string[]=[];
  const result=await controlledFinancialWitness(reader(history(),(query,params)=>{
   queries.push(query);expect(query).toContain("sha256");expect(params).toContain(5001);
   if(query.includes('from "subscription_controlled_resources"')){
    expect(query).toContain('"subscription_commercial_terms"."profile_id"');expect(params).toContain(id(30));
    expect(query).not.toContain("contact_id");expect(query).not.toContain("amount_minor");
   }
  }),{profileIds:[id(30)]});
  expect(result.incomplete).toBe(false);expect(result.entries).toHaveLength(12);expect(queries).toHaveLength(9);
 });
 it("discovers invoice history through actual event/target and original PI parents before a payment route exists",async()=>{
  let selected=false;
  const result=await controlledFinancialWitness(reader(history(),(query,params)=>{
   if(!query.includes("from merchant_agreement_payment_routes route join payments p"))return;
   selected=true;expect(params).toContain(id(70));expect(query).toContain("e.invoice_id in");
   expect(query).toContain("i.id=p.debit_invoice_id");expect(query).toContain("p.subscription_id::text||':proration:'||p.id::text");
   expect(query).toContain("observed.charge_account_id is not distinct from cash.charge_account_id");
   expect(query).toContain("observed.provider_ref=cash.provider_payment_intent_ref");
   expect(query).not.toMatch(/amount_minor|email|split_part|current_account/);
  }),{invoiceIds:[id(70)]});
  expect(selected).toBe(true);expect(result.incomplete).toBe(false);expect(result.entries).toHaveLength(12);
 });
 it("refuses a foreign frozen profile from the actual scoped read and a combined family overflow",async()=>{
  const foreign=history();foreign.resources[0]!.profileId=id(31);
  expect((await controlledFinancialWitness(reader(foreign),{profileIds:[id(30)]})).incomplete).toBe(true);
  const large=history();large.facts=Array.from({length:4990},(_,n)=>({id:id(100+n),callId:id(5),fingerprint:hash}));
  expect(await controlledFinancialWitness(reader(large),{subscriptionIds:[id(10)]})).toMatchObject({incomplete:true,entries:[]});
 });
 it("exports exact safe ancestry and original principal while retaining all full private row hashes internally",async()=>{
  const exported=await exportControlledFinancialHistory(reader(history()),{profileIds:[id(30)]});
  expect(exported.selected.entries.some(row=>row.fingerprint===hash)).toBe(true);
  expect(exported.exported.originalCashReceipts[0]).toMatchObject({id:id(8),amountMinor:500,currency:"CAD"});
  expect(JSON.stringify(exported.exported)).not.toMatch(/fingerprint|nonce|signature|providerCustomerRef|providerMethodRef|admission|hosting|recordedBy/);
 });
 it("preserves the empty path without reading any table and rejects a guessed external budget identity",async()=>{
  const untouched=reader(history(),()=>{throw Error("An empty scope queried provider history");});
  expect(await controlledFinancialWitness(untouched,{})).toMatchObject({incomplete:false,entries:[]});
  expect(await invoiceMerchantDependencyFingerprints(untouched,[],undefined,1,[{table:"subscription_controlled_facts",id:`${hash}:${id(7)}`,fingerprint:hash}])).toBeNull();
  expect(await invoiceMerchantDependencyFingerprints(untouched,[],undefined,0,[{table:"subscription_controlled_facts",id:id(7),fingerprint:hash}])).toBeNull();
 });
});
