// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN. Full old comparison/inverse preservation and real ordering.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
const read=(path:string)=>readFileSync(new URL(`../../${path}`,import.meta.url),"utf8");
const sha=(value:string)=>createHash("sha256").update(value).digest("hex");
const manifest=z.object({
 sourcePatch:z.object({path:z.string(),sha256:z.string()}),
 files:z.array(z.object({path:z.string(),beforeSha256:z.string(),afterSha256:z.string()})),
 native:z.object({path:z.string(),sha256:z.string()}),
 lockProvider:z.object({path:z.string(),sha256:z.string(),prefix:z.array(z.string())}),
 oldRestoreBodies:z.record(z.string(),z.object({path:z.string(),body:z.string(),sha256:z.string()})),
}).parse(JSON.parse(read("deploy/verified-financial-contact-undo.manifest.json")));
const lines=(value:string)=>value.split("\n").map(line=>line.trim()).filter(Boolean);
function prepareBody(path:string,start:string,end:string){
 const source=read(path),a=source.indexOf(start),b=source.indexOf(end,a);
 if(a<0||b<0)throw Error("Preserve the actual complete private preparer.");
 const body=source.slice(a+start.length,b);
 const split=body.indexOf("return async () => {");
 if(split<0||!body.trimEnd().endsWith("};"))throw Error("The real same-TX inverse must follow all old validation.");
 return body.slice(0,split)+body.slice(split+"return async () => {".length,body.lastIndexOf("};"));
}
describe("financial contact undo preimage preservation",()=>{
 it("preserves every original subscription comparison, historical refusal and actual inverse statement",()=>{
  const old=manifest.oldRestoreBodies.subscription;if(!old)throw Error("Retain the whole original subscription inverse.");
  expect(sha(old.body)).toBe(old.sha256);
  expect(lines(prepareBody(old.path,'const prepareSubscriptionUndo: NonNullable<ContactReference["prepareUndo"]> = async (tx, before, after, duplicateId, survivingId) => {',"\n};\n\nregisterContactReference"))).toEqual(lines(old.body));
 });
 it("preserves every original invoice pointer/fingerprint comparison and all four exact inverse branches",()=>{
  const old=manifest.oldRestoreBodies.invoice;if(!old)throw Error("Retain the whole original invoice inverse.");
  expect(sha(old.body)).toBe(old.sha256);
  expect(lines(prepareBody(old.path,'const prepareUndo: NonNullable<ContactReference["prepareUndo"]> = async (tx, beforeState, afterState, duplicateId, survivingId) => {',"\n  };\n  registerContactReference"))).toEqual(lines(old.body));
 });
 it("collects all verifications before any contact or reference inverse and preserves original inverse ordering",()=>{
  const core=read("src/core/contacts/service.ts"),undo=core.slice(core.indexOf("export const undoContactMerge ="),core.indexOf("export const updateContact ="));
  const locks=undo.indexOf("for (const lock of lockProviders)"),prepare=undo.indexOf("await reference.prepareUndo("),contact=undo.indexOf("await ctx.tx.insert(contacts)"),inverse=undo.indexOf("for (const inverse of inverses)");
  expect(locks).toBeGreaterThan(0);expect(prepare).toBeGreaterThan(locks);expect(contact).toBeGreaterThan(prepare);expect(inverse).toBeGreaterThan(contact);
  expect(undo).toContain("new Set(undoReferences.flatMap");expect(undo).not.toContain("undoReferences.reverse(");
  for(const path of ["src/modules/subscriptions/service.ts","src/modules/invoicing/invoice-service.ts"]){const source=read(path);expect(source).toContain("lockForUndo: lockContactFinancialUndo");expect(source).toContain("await lockContactFinancialUndo(tx, duplicateId, survivingId)");}
 });
 it("locks the complete pair graph before comparison and refuses changed discovery instead of acquiring reverse locks",()=>{
  const source=read(manifest.lockProvider.path);expect(sha(source)).toBe(manifest.lockProvider.sha256);
  const prefixes=["await lockContactIdentity(tx)",'ids("resource")','ids("subscription")','[["payment", "payment"], ["invoice", "invoice"], ["note", "credit-note"]]',"for (const namespace of namespaces)","for (const id of before.inspections)","merchantTaxDigest(await discover(tx, contacts))"];
  let prior=-1;for(const part of prefixes){const at=source.indexOf(part);expect(at).toBeGreaterThan(prior);prior=at;}
  expect(source).toContain("pg_try_advisory_xact_lock(hashtext(${`merchant-return-read:${id}`}))");
  expect(source).not.toContain("pg_advisory_xact_lock(hashtext(${`merchant-return-read:");
  expect(source).toContain("p.debit_invoice_id=i.id");expect(source).toContain("nodes.length + namespaces.length + inspections.length > 5000");
 });
 it("keeps the original full paid-period/merge/undo oracle unchanged",()=>{expect(sha(read(manifest.native.path))).toBe(manifest.native.sha256);});
 it("pins the exact reviewable source diff and all three changed original files",()=>{
  expect(sha(read(manifest.sourcePatch.path))).toBe(manifest.sourcePatch.sha256);
  for(const file of manifest.files)expect(sha(read(file.path))).toBe(file.afterSha256);
 });
});
