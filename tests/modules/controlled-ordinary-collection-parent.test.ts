// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38: PREPARED / UNRUN; actual ordinary SQL adapter, no fake service context.
import { drizzle } from "drizzle-orm/pg-proxy";
import { describe,expect,it } from "vitest";
import type { Tx } from "@/core/service";
import { lockControlledOrdinaryCollectionParent,type ControlledOrdinaryCollectionParent } from "@/modules/invoicing/controlled-ordinary-collection-parent";
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
function original():ControlledOrdinaryCollectionParent{return{collectionId:id(1),quoteId:id(2),resourceId:id(3),subscriptionId:id(4),invoiceId:id(5),kind:"period",profileId:id(6),profileVersion:1,
 canonicalSourceId:`${id(4)}:2026-11-13T00:00:00.000Z`,sourceId:`${id(4)}:2026-11-13T00:00:00.000Z`,sourceType:"subscription",quoteKind:"period"};}
function driver(rows:unknown[],changed?:unknown[],locked=true){
 const steps:string[]=[],parameters:unknown[][]=[];let reads=0;
 const tx=drizzle(async(query,params)=>{
  parameters.push(params);
  if(query.includes("pg_try_advisory_xact_lock_shared")){expect(query).toContain("contact-identity-privacy");steps.push("contact");return{rows:[{locked}]};}
  if(query.includes("from subscription_controlled_collections collection")){
   expect(query).toContain("left join subscription_controlled_quotes quote on quote.id=collection.quote_id");
   expect(query).toContain("left join subscription_controlled_resources resource on resource.id=quote.resource_id");
   expect(query).toContain("left join invoices invoice on invoice.id=collection.invoice_id");expect(query).toContain("where collection.invoice_id=");
   expect(query.trimEnd()).toMatch(/limit 2$/);expect(params).toEqual([id(5)]);expect(query).not.toMatch(/amount_minor|email|current_account|contact_id/);
   steps.push("exact-target");return{rows:reads++&&changed?changed:rows};
  }
  if(query.includes("pg_advisory_xact_lock")){expect(params).toEqual([`controlled-provider:${id(3)}`]);steps.push("resource-advisory");return{rows:[]};}
  if(query.includes("from subscription_controlled_resources")){expect(query).toContain("for update");expect(params).toEqual([id(3)]);steps.push("resource-row");return{rows:[{id:id(3)}]};}
  if(query.includes("from subscriptions")){expect(query).toContain("for update");expect(params).toEqual([id(4)]);steps.push("parent-row");return{rows:[{id:id(4)}]};}
  throw new Error(`Unexpected controlled pre-admission query: ${query}`);
 }) as unknown as Tx;
 return{tx,steps,parameters};
}
describe("ordinary controlled invoice pre-admission locking",()=>{
 it("locks contact then exact resource then actual subscription before any canonical payment/invoice lock",async()=>{
  const d=driver([original()]);expect(await lockControlledOrdinaryCollectionParent(d.tx,id(5))).toEqual(original());
  expect(d.steps).toEqual(["contact","exact-target","resource-advisory","resource-row","parent-row","exact-target"]);
  expect(d.parameters.flat().some(value=>typeof value==="string"&&/^(invoice|payment|credit-note):/.test(value))).toBe(false);
 });
 it("retains the actual legacy no-target path without inventing a controlled parent",async()=>{
  const d=driver([]);expect(await lockControlledOrdinaryCollectionParent(d.tx,id(5))).toBeNull();expect(d.steps).toEqual(["contact","exact-target"]);
 });
 it.each(["ambiguous","missing-parent","foreign-source","wrong-kind"] as const)("refuses %s instead of treating an incomplete target as legacy",async change=>{
  const actual=original();let rows:unknown[]=[actual];
  if(change==="ambiguous")rows=[actual,{...actual,collectionId:id(90)}];
  if(change==="missing-parent")rows=[{...actual,resourceId:null}];
  if(change==="foreign-source")rows=[{...actual,sourceId:`${id(90)}:2026-11-13T00:00:00.000Z`}];
  if(change==="wrong-kind")rows=[{...actual,quoteKind:"proration"}];
  const d=driver(rows);await expect(lockControlledOrdinaryCollectionParent(d.tx,id(5))).rejects.toMatchObject({code:"conflict"});expect(d.steps).toEqual(["contact","exact-target"]);
 });
 it("rereads the same complete frozen target after locking and rejects a changed owner epoch",async()=>{
  const d=driver([original()],[{...original(),profileVersion:2}]);await expect(lockControlledOrdinaryCollectionParent(d.tx,id(5))).rejects.toMatchObject({code:"conflict"});
  expect(d.steps.at(-1)).toBe("exact-target");expect(d.steps).toContain("parent-row");
 });
 it("refuses contact merge/erasure cutover before reading or locking any target",async()=>{
  const d=driver([original()],undefined,false);await expect(lockControlledOrdinaryCollectionParent(d.tx,id(5))).rejects.toMatchObject({code:"conflict"});expect(d.steps).toEqual(["contact"]);
 });
});
