// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38: complete source preservation of closure and both genuine owner paths.
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";
import readyContinuation from "../../deploy/atomic-credit-fee-ready-identity85.manifest.json";
import bAssembly from "../../deploy/atomic-credit-fee-root-assembly-20261114.json";
import manifest from "../../deploy/atomic-auxiliary-fee-closure-owner85.manifest.json";
import calendarNativePreservation from "../../deploy/controlled-calendar-native-preservation84.source-preservation.json";
import publicBoundary from "../../deploy/controlled-safe-public-boundary88.source.json";
const read=(path:string)=>readFileSync(new URL("../../"+path,import.meta.url));
const hash=(value:string|Buffer)=>createHash("sha256").update(value).digest("hex");
const body=(statement:string)=>statement.match(/AS \$\$([\s\S]*)\$\$/)?.[1]??"";
describe("whole auxiliary closure and original-owner continuation",()=>{
 it.each(manifest.successors)("preserves every previous $name predicate",entry=>{
  expect(hash(body(entry.beforeStatement))).toBe(entry.beforeBodySha256);
  expect(hash(body(entry.afterStatement))).toBe(entry.afterBodySha256);
  let actual=entry.afterStatement;
  for(const edit of [...entry.edits].reverse()){
   expect(actual.split(edit.after)).toHaveLength(2);
   actual=actual.replace(edit.after,()=>edit.before);
  }
  expect(actual).toBe(entry.beforeStatement);
 });
 it("retains the complete prior migration and every current owned statement",()=>{
  const current=read(manifest.normal85.path),currentOwned=read(manifest.normal85.ownedPath),extension=readyContinuation;
  expect(current).toEqual(currentOwned);expect(current.length).toBe(extension.normal85.bytes);expect(hash(current)).toBe(extension.normal85.sha256);
  expect(current.subarray(extension.priorWholePrefix.bytes)).toEqual(Buffer.concat([Buffer.from("\n--> statement-breakpoint\n"),read(extension.tail.path)]));
  const combined=current.subarray(0,extension.priorWholePrefix.bytes),owned=currentOwned.subarray(0,extension.priorWholePrefix.bytes),b=bAssembly.normal85;
  expect(combined).toEqual(owned);expect(combined.length).toBe(b.afterBytes);expect(hash(combined)).toBe(b.afterSha256);
  expect(b.beforeBytes).toBe(manifest.normal85.bytes);expect(b.beforeSha256).toBe(manifest.normal85.sha256);
  expect(combined.subarray(b.beforeBytes)).toEqual(Buffer.concat([Buffer.from(b.separator),read("deploy/atomic-credit-fee-partition84.fragment.sql")]));
  const sql=combined.subarray(0,manifest.normal85.bytes),tail=read(manifest.tail.path);
  expect(sql).toEqual(owned.subarray(0,manifest.normal85.bytes));
  expect(sql.length).toBe(manifest.normal85.bytes);expect(hash(sql)).toBe(manifest.normal85.sha256);
  expect(hash(sql.subarray(0,manifest.priorWholePrefix.bytes))).toBe(manifest.priorWholePrefix.sha256);
  expect(sql.subarray(manifest.priorWholePrefix.bytes)).toEqual(Buffer.concat([Buffer.from("\n--> statement-breakpoint\n"),tail]));
  expect(hash(tail)).toBe(manifest.tail.sha256);
  for(const entry of manifest.successors)expect(tail.toString()).toContain(entry.afterStatement+";");
  for(const count of [manifest.newFunctions,manifest.newModels,manifest.newColumns,manifest.newTriggers,manifest.newServices])expect(count).toBe(0);
 });
 it("keeps the predecessor prefix control exact through its one declared extension",()=>{
  const change=manifest.predecessorSourceControlContinuation;let actual=read(change.path).toString();
  const latest=publicBoundary.files.find(file=>file.path===change.path);if(!latest)throw Error("Require the newest predecessor continuation.");expect(hash(actual)).toBe(latest.afterSha256);
  for(const delta of [...latest.edits].reverse()){expect(actual.split(delta.after)).toHaveLength(2);actual=actual.replace(delta.after,()=>delta.before);}expect(hash(actual)).toBe(latest.beforeSha256);
  const exact=calendarNativePreservation.files[0];if(!exact)throw Error("Require the exact calendar-native preservation continuation.");expect(hash(actual)).toBe(exact.afterSha256);
  for(const delta of [...exact.finiteDelta].reverse()){expect(actual.split(delta.after)).toHaveLength(2);actual=actual.replace(delta.after,()=>delta.before);}
  expect(hash(actual)).toBe(exact.beforeSha256);
  expect(hash(actual)).toBe(change.afterSha256);
  expect(actual.replace(change.finiteDelta.after,()=>change.finiteDelta.before)).toBe(change.beforeWholeFile);
  expect(hash(change.beforeWholeFile)).toBe(change.beforeSha256);
 });
 it("keeps all original money oracles in the genuine receipt-owner companion",()=>{
  const change=manifest.receiptOwnerCompanion;let actual=read(change.path).toString();
  expect(hash(actual)).toBe(change.afterSha256);
  for(const edit of [...change.finiteDelta].reverse()){
   const count="count" in edit&&typeof edit.count==="number"?edit.count:1;expect(actual.split(edit.after)).toHaveLength(count+1);actual=actual.replaceAll(edit.after,()=>edit.before);
  }
  expect(actual).toBe(read(change.originalPath).toString());expect(hash(actual)).toBe(change.originalSha256);
  expect(actual).toContain("timeout:180000");
 });
});
