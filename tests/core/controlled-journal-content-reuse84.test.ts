// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";
import manifest from "../../deploy/controlled-journal-content-reuse84-current.source.json";
import publicBoundary from "../../deploy/controlled-safe-public-boundary88.source.json";
import {restoreRowHashLedgerSource} from "../helpers/row-hash-ledger-forward";
const read=(path:string)=>readFileSync(new URL(`../../${path}`,import.meta.url),"utf8"),hash=(value:string)=>createHash("sha256").update(value).digest("hex");
describe("current controlled journal content-reuse source",()=>{
 it("reverses only the declared forward continuation and preserves the native oracle",()=>{
  const row=manifest.files[0]!,latest=publicBoundary.files.find(file=>file.path===row.path);if(!latest)throw Error("Require the newest journal source continuation.");let source=restoreRowHashLedgerSource(row.path,read(row.path));expect(hash(source)).toBe(latest.afterSha256);
  for(const edit of [...latest.edits].reverse()){expect(source.split(edit.after)).toHaveLength(2);source=source.replace(edit.after,()=>edit.before);}expect(hash(source)).toBe(latest.beforeSha256);
  expect(hash(source)).toBe(row.afterSha256);
  for(const edit of [...row.edits].reverse()){expect(source.split(edit.after)).toHaveLength(2);source=source.replace(edit.after,()=>edit.before);}
  expect(hash(source)).toBe(row.beforeSha256);expect(row.beforeSha256).toBe("292ebf4799a0383d7928ba3c1b897f4cbb57dc88e6d0bba6a1969b832fbda8af");
  for(const item of manifest.protected)expect(hash(restoreRowHashLedgerSource(item.path,read(item.path)))).toBe(item.sha256);
  expect(read("tests/modules/atomic-credit-fee-persistence84.test.ts")).toContain("timeout:180000");
 });
 it("certifies every physical family and binds MISS rows to their atomic certificate",()=>{
  const source=read(manifest.files[0]!.path),certificate=source.slice(source.indexOf("async function readJournalContent("),source.indexOf("function decodeJournalInventory("));
  const heads=read("db/migrations/0090_controlled_journal_heads.sql");
  for(const table of ["resources","operations","calls","facts","finishes","stops","verifications","charge_origins","closures"])expect(heads).toContain(`subscription_controlled_${table}`);
  expect(certificate).toContain("subscription_controlled_journal_heads");expect(certificate.match(/AS MATERIALIZED/g)).toHaveLength(12);
  for(const exact of ["ORDER BY o.ordinal LIMIT 5001","ORDER BY c.id LIMIT 5001","ORDER BY f.call_id,f.ordinal LIMIT 5001","ORDER BY o.receipt_id LIMIT 5001","LIMIT 2","h.fingerprint","1+physicalCount-content.counts.resources>5000"])expect(certificate).toContain(exact);
  const wrapper=source.slice(source.indexOf("export async function controlledProviderJournal("),source.indexOf("export async function assertControlledCallersQuiesced("));
  expect(wrapper.indexOf("await readJournalContent(tx,resourceId,false)")).toBeLessThan(wrapper.indexOf("decodedControlledJournals.get(tx)"));
  expect(wrapper).toContain("const atomic=await readJournalContent(tx,resourceId,true)");expect(wrapper).toContain("sameJournalContent(before.content,atomic.content)");expect(wrapper).toContain("decodeJournalInventory(atomic.inventory)");expect(wrapper).toContain("sameJournalContent(before.content,after.content)");
 });
 it("keeps current indexed predicates and resolves ordered fresh views before the final certificate",()=>{
  const source=read(manifest.files[0]!.path),base=source.slice(source.indexOf("function validateJournalBase("),source.indexOf("type RetainedJournal="));
  for(const exact of ["firstBy(operations,row=>row.id)","factsByCall.get(fact.callId)","validated.operation!==operation||validated.call!==call||validated.finish!==finish||!validated.finished","verification.actualResult.protocol!==CONTROLLED_HISTORICAL_FIN_PROTOCOL&&merchantTaxDigest(finish.actualResult.result)"])expect(base).toContain(exact);
  const pass=base.slice(base.indexOf(" const validatedCalls="),base.indexOf(" for(const origin of chargeOrigins)"));expect(pass).not.toMatch(/\bawait\b|\basync\b|\.then\(/);
  const wrapper=source.slice(source.indexOf("export async function controlledProviderJournal("),source.indexOf("export async function assertControlledCallersQuiesced("));
  const views=wrapper.indexOf("Promise.all(verifications.map"),after=wrapper.indexOf("const after=await readJournalContent");
  expect(views).toBeGreaterThan(-1);expect(after).toBeGreaterThan(views);expect(wrapper).toContain("return resolveControlledVerificationView(tx,operation,call,finish,verification)");expect(wrapper.indexOf("if(!hit)retainJournalBase")).toBeGreaterThan(after);
  expect(wrapper).toContain("reuseViews=retainedViews?.certificate===before.content.fingerprint");expect(wrapper).toContain("sameJournalContent(before.content,after.content)");
  expect(wrapper).toContain("const result={operations,calls,facts,finishes,stops,verifications,verificationViews,chargeOrigins,closures,unfinished,count,revision};journalCertificates.set(result,after.content.fingerprint);return result;");
 });
 it("bounds private raw snapshots by real Tx and never retains views or brands",()=>{
  const source=read(manifest.files[0]!.path),retained=source.slice(source.indexOf("type RetainedJournal="),source.indexOf("type VerificationView="))+source.slice(source.indexOf("function retainJournalBase"),source.indexOf("/** Every reuse"));
  expect(source).toContain("const decodedControlledJournals=new WeakMap<Tx,Map<string,RetainedJournal>>()");expect(source).toContain("resources:4,rows:10000,bytes:16*1024*1024");expect(retained).toContain("cloneJournalValue(rows)");expect(source).toContain("Object.freeze(value)");expect(source).toContain("value instanceof Date");expect(retained).toContain("content.counts.resources!==1");
  expect(retained).not.toMatch(/verificationViews|authenticViews|eligible|allowed|principal|fee|target/i);expect(source).toContain("cloneJournalValue(retained.rows)");
 });
});
