// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38/C9.38: PREPARED / UNRUN; pure policy and physical ancestry controls.
import { describe,expect,it } from "vitest";
import { drizzle } from "drizzle-orm/pg-proxy";
import type { Tx } from "@/core/service";
import { controlledTargetEconomics } from "@/modules/invoicing/controlled-target-financial-export";
import { requireControlledFinancialProtocol } from "@/modules/invoicing/controlled-provider-financial-protocol";
import { controlledPeriodAdmission } from "@/modules/invoicing/controlled-target-financial-policy";
import { controlledTargetAncestryComplete,controlledTargetEntries,type ControlledTargetHistory } from "@/modules/invoicing/controlled-target-financial-witness";
import { controlledFinancialWitness,type ControlledFinancialHistory } from "@/modules/invoicing/controlled-provider-financial-witness";
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const fingerprint="a".repeat(64);
function physical(){
 const transport:ControlledFinancialHistory={resources:[{id:id(1),subscriptionId:id(2),termsId:id(3),profileId:id(4),profileVersion:1,fingerprint}],
  operations:[{id:id(10),resourceId:id(1),kind:"read_calendar",fingerprint},{id:id(11),resourceId:id(1),kind:"read_customer_financials",fingerprint},
   {id:id(12),resourceId:id(1),kind:"preview_proration",fingerprint},{id:id(13),resourceId:id(1),kind:"preview_update",fingerprint},
   {id:id(14),resourceId:id(1),kind:"create_draft",fingerprint},{id:id(15),resourceId:id(1),kind:"read_manifest",fingerprint}],
  calls:[{id:id(16),operationId:id(15),fingerprint}],facts:[{id:id(17),callId:id(16),fingerprint}],finishes:[{id:id(16),fingerprint}],
  stops:[],verifications:[{id:id(15),callId:id(16),fingerprint}],chargeOrigins:[],closures:[],incomplete:false};
 const targets:ControlledTargetHistory={quotes:[{id:id(20),resourceId:id(1),subscriptionId:id(2),previousTermsId:id(3),kind:"period",canonicalSourceId:`${id(2)}:2026-11-13T00:00:00.000Z`,
  plannedProrationId:null,plannedCollectionId:id(21),calendarReadOperationId:id(10),customerFinancialOperationId:id(11),nativePreviewOperationId:id(12),updatePreviewOperationId:id(13),
  originalProfileId:id(4),originalProfileVersion:1,profileId:id(4),profileVersion:1,fingerprint}],
  collections:[{id:id(21),kind:"period",quoteId:id(20),prorationId:null,invoiceId:id(22),termsId:id(3),creditNoteId:null,fingerprint}],
  components:[{id:id(23),collectionId:id(21),kind:"net",fingerprint}],
  invoiceBindings:[{id:id(21),collectionId:id(21),resourceId:id(1),originKind:"created_draft",creatorOperationId:id(14),operationId:id(15),callId:id(16),factId:id(17),fingerprint}],
  itemReceipts:[{id:id(23),componentId:id(23),resourceId:id(1),originKind:"subscription_line",creatorOperationId:id(14),operationId:id(15),callId:id(16),factId:id(17),fingerprint}],
  invoiceProofs:[{id:id(24),collectionId:id(21),operationId:id(15),callId:id(16),fingerprint}],incomplete:false};
 return{transport,targets};
}
const period=()=>({subscriptionId:id(2),sourceId:`${id(2)}:2026-12-01T00:00:00.000Z`,now:new Date("2026-11-30T23:59:59.000Z"),pay:false,
 parentStart:"2026-11-01T00:00:00.000Z",parentEnd:"2026-12-01T00:00:00.000Z",trialEnd:null,originalStart:"2026-11-01T00:00:00.000Z",originalEnd:"2026-12-01T00:00:00.000Z",originalTrialEnd:null,
 periodStart:"2026-12-01T00:00:00.000Z",periodEnd:"2027-01-01T00:00:00.000Z",credits:[0,0,0,0]});
describe("controlled accepted target financial boundaries",()=>{
 it.each([false,null,undefined])("refuses missing/partial installed protocol (%s) before positive admission",async ready=>{
  let reads=0;
  const tx=drizzle(async query=>{reads++;expect(query).toContain("count(*)=24");expect(query).toContain("t.tgenabled in('O','A')");
   expect(query).toContain("subscription_controlled_quotes_complete");expect(query).toContain("subscription_controlled_invoice_proofs_complete");
   expect(query).toContain("targetFinancialRevision");expect(query).toContain("freeholder_controlled_target_operation_admissible");
   return{rows:[{ready}]};}) as unknown as Tx;
  await expect(requireControlledFinancialProtocol(tx)).rejects.toMatchObject({code:"conflict"});expect(reads).toBe(1);
 });
 it("projects buyer consideration explicitly and exposes commission only to the frozen merchant mode",()=>{
  const review={debitNetMinor:1000,debitTaxMinor:50,creditNetMinor:200,creditTaxMinor:10,creditAppliedMinor:210,cashDueMinor:840,residualCreditMinor:0,
   feeReview:{debitFeeObligationMinor:100,creditFeeObligationMinor:20,appliedFeeObligationMinor:20,appliedFeeProvenCollectedMinor:10,remainingNewCashFeeMinor:80,
    separateMerchantReceivableMinor:10,originalOverTargetMinor:0,originalSourceDebt:true,sources:[]},privateRaw:"private-marker",taxDestination:{postalCode:"private-marker"}};
  const buyer=controlledTargetEconomics(review),merchant=controlledTargetEconomics(review,true);
  expect(buyer).toEqual({debitNetMinor:1000,debitTaxMinor:50,creditNetMinor:200,creditTaxMinor:10,creditAppliedMinor:210,cashDueMinor:840,residualCreditMinor:0});
  expect(merchant).toMatchObject({commission:{remainingNewCashFeeMinor:80,separateMerchantReceivableMinor:10}});
  expect(JSON.stringify([buyer,merchant])).not.toMatch(/private-marker|sources|taxDestination|originalSourceDebt/);
 });
 it("keeps creator, real observer and physical table identity distinct",()=>{
  const{transport,targets}=physical();expect(controlledTargetAncestryComplete(targets,transport)).toBe(true);
  const entries=controlledTargetEntries(targets);expect(new Set(entries.map(row=>row.table)).size).toBe(6);
  expect(entries.filter(row=>row.id===id(21))).toHaveLength(2);expect(entries.filter(row=>row.id===id(23))).toHaveLength(2);
  targets.invoiceBindings[0]!.creatorOperationId=id(90);expect(controlledTargetAncestryComplete(targets,transport)).toBe(false);
 });
 it.each(["profile-version","observer","fact","proof-kind","binding","component-parent","period-proration"] as const)("rejects substituted %s even with an equal full hash",change=>{
  const{transport,targets}=physical();
  if(change==="profile-version")targets.quotes[0]!.originalProfileVersion=2;
  if(change==="observer")targets.invoiceBindings[0]!.operationId=id(14);
  if(change==="fact")targets.itemReceipts[0]!.factId=id(90);
  if(change==="proof-kind")transport.operations[5]!.kind="read_invoice";
  if(change==="binding")targets.invoiceBindings=[];
  if(change==="component-parent")targets.components[0]!.collectionId=id(90);
  if(change==="period-proration")targets.collections[0]!.prorationId=id(90);
  expect(controlledTargetAncestryComplete(targets,transport)).toBe(false);
 });
 it("bounds all fifteen real families together, rather than allowing six and nine independent allowances",async()=>{
  const{transport,targets}=physical();
  const tables={subscription_controlled_quotes:targets.quotes,subscription_controlled_collections:targets.collections,
   subscription_controlled_components:Array.from({length:4985},(_,n)=>({...targets.components[0]!,id:n===0?id(23):id(100+n)})),
   subscription_controlled_invoice_bindings:targets.invoiceBindings,subscription_controlled_item_receipts:targets.itemReceipts,subscription_controlled_invoice_proofs:targets.invoiceProofs,
   subscription_controlled_resources:transport.resources,subscription_controlled_operations:transport.operations,subscription_controlled_calls:transport.calls,
   subscription_controlled_facts:transport.facts,subscription_controlled_finishes:transport.finishes,subscription_controlled_stops:transport.stops,
   subscription_controlled_verifications:transport.verifications,subscription_controlled_charge_origins:transport.chargeOrigins,subscription_controlled_closures:transport.closures};
  const queried=new Set<string>();
  const tx=drizzle(async(query,params)=>{
   const table=Object.keys(tables).find(name=>query.includes(`from "${name}"`));if(!table)throw new Error(`Unexpected exact target read: ${query}`);
   queried.add(table);expect(query).toContain("sha256");expect(params).toContain(5001);
   if(table==="subscription_controlled_quotes"){
    expect(query).toContain('"subscription_commercial_terms"."subscription_id" = "subscription_controlled_resources"."subscription_id"');expect(params).toContain(id(2));
   }
   const rows=tables[table as keyof typeof tables];return{rows:rows.map(row=>Object.values(row))};
  }) as unknown as Tx;
  expect(await controlledFinancialWitness(tx,{subscriptionIds:[id(2)]})).toMatchObject({incomplete:true,entries:[]});
  expect(queried.size).toBe(15);
 });
 it("allows a retained cashless quote before an invoice without inventing a canonical payment",()=>{
  const{transport,targets}=physical();targets.collections=[];targets.components=[];targets.invoiceBindings=[];targets.itemReceipts=[];targets.invoiceProofs=[];
  expect(controlledTargetAncestryComplete(targets,transport)).toBe(true);expect(controlledTargetEntries(targets)).toHaveLength(1);
 });
 it("prepares the exact next period but cannot finalize/pay before service starts",()=>{
  expect(controlledPeriodAdmission(period())).toBe(true);expect(controlledPeriodAdmission({...period(),pay:true})).toBe(false);
  expect(controlledPeriodAdmission({...period(),pay:true,now:new Date("2026-12-01T00:00:00.000Z")})).toBe(true);
 });
 it("permits an original due renewal after its start, without a proration effectiveAt cutoff",()=>{
  expect(controlledPeriodAdmission({...period(),pay:true,now:new Date("2026-12-12T00:00:00.000Z")})).toBe(true);
  expect(controlledPeriodAdmission({...period(),pay:true,now:new Date("2027-01-01T00:00:00.000Z")})).toBe(false);
 });
 it("preserves the actual trial, accepts no trial-window service and creates no old trial credit",()=>{
  const trial={...period(),trialEnd:"2026-12-01T00:00:00.000Z",originalTrialEnd:"2026-12-01T00:00:00.000Z"};
  expect(controlledPeriodAdmission(trial)).toBe(true);
  expect(controlledPeriodAdmission({...trial,trialEnd:"2026-12-02T00:00:00.000Z"})).toBe(false);
  expect(controlledPeriodAdmission({...trial,credits:[0,1,0,0]})).toBe(false);
  expect(controlledPeriodAdmission({...trial,periodStart:"2026-11-01T00:00:00.000Z",sourceId:`${id(2)}:2026-11-01T00:00:00.000Z`})).toBe(false);
 });
 it.each(["foreign-source","calendar-replaced","unowned-window","invalid-clock"] as const)("refuses %s for otherwise equal economics",change=>{
  const input=period();if(change==="foreign-source")input.sourceId=`${id(90)}:${input.periodStart}`;
  if(change==="calendar-replaced")input.parentEnd="2026-12-02T00:00:00.000Z";
  if(change==="unowned-window"){input.periodStart="2026-12-02T00:00:00.000Z";input.sourceId=`${id(2)}:${input.periodStart}`;}
  if(change==="invalid-clock")input.now=new Date(Number.NaN);
  expect(controlledPeriodAdmission(input)).toBe(false);
 });
});
