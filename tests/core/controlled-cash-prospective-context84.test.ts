// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN source boundaries; not actual bank/parent/native acceptance.
import { readFileSync } from "node:fs";
import { describe,expect,it } from "vitest";
const read=(path:string)=>readFileSync(new URL(`../../${path}`,import.meta.url),"utf8"),context=read("src/modules/invoicing/controlled-cash-prospective-context.ts"),policy=read("src/modules/invoicing/controlled-target-raw-policy.ts");
describe("genuine private retained-unapplied prospective source",()=>{
 it("installs context only from the actual real-context bank reader, with no caller proof/flag/session setter",()=>{
  expect(context).toContain("const active=new WeakMap<Tx,ControlledCashProspectiveProjection>()");expect(context).toContain("const proof=await readControlledCollectionCashAuthority(ctx,request)");
  expect(context).toContain("active.set(ctx.tx,projection)");expect(context).toContain("finally{active.delete(ctx.tx);}");expect(context).not.toContain("current_setting(");expect(context).not.toContain("ctx.metadata");expect(context).not.toContain("export function set");
 });
 it("keeps actual full bank and complete PG parent evidence fresh across read-only evaluation",()=>{
  expect(context).toContain("physical.get(`${row.table}:${row.id}`)!==row.fingerprint");expect(context).toContain("const afterProof=await readControlledCollectionCashAuthority(ctx,request)");
  expect(context).toContain("merchantTaxDigest(afterProof)!==merchantTaxDigest(proof)");expect(context).toContain("after.revision!==before.revision");expect(context).toContain("JSON.stringify(after.entries)!==JSON.stringify(before.entries)");
 });
 it("avoids eager service import cycles and represents retained receipts without a fictional payment UUID",()=>{
  expect(context).toContain('await import("@/modules/subscriptions/controlled-provider-collection-cash")');expect(context).not.toContain('from "@/modules/subscriptions/controlled-provider-collection-cash"');
  const start=context.indexOf("export type RetainedUnappliedControlledCash="),end=context.indexOf("export type ControlledCashProspectiveProjection=",start);expect(context.slice(start,end)).not.toContain("paymentId");expect(context.slice(start,end)).toContain('kind:"retained_unapplied"');
  expect(policy).toContain("inventory.paidMinor)!==BigInt(target.canonicalPaidMinor)+prospective.receipts.reduce");expect(policy).not.toContain("target.canonicalPaidMinor=");
 });
 it("requires exact complete known atom owner sets while retaining unknown/ambiguous raw debt and original default revisions",()=>{
  expect(policy).toContain("owners.length===1?owners[0]:null");expect(policy).toContain("new Set(pages.map(row=>ref(row.id))).size===pages.length");expect(policy).toContain("if(!actual||!exactInvoiceSnapshot(owner,actual,data,fact.callId))return false");
  expect(policy).toContain("if(targets.some(candidate=>candidate.resource.id===target.resource.id&&candidate.binding?.providerInvoiceRef===ref(data.id)))return false");
  expect(policy).toContain("if(!preparation||!exactBootstrapZeroSnapshot(target,preparation,data))return false");
  expect(policy).toContain("collectionId:null,collectionIds:listOwners.map");expect(policy).toContain("canonicalRefunds:listOwners.map");
  expect(read("src/modules/invoicing/controlled-target-raw-classification.ts")).toContain("...(prospectiveRevisions.length?{prospectiveRevisions}:{})");expect(context).not.toContain("defineService(");
 });
});
