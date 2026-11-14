// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38: complete source preservation of closure and both genuine owner paths.
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";
import manifest from "../../deploy/atomic-auxiliary-fee-closure-owner85.manifest.json";
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
  const sql=read(manifest.normal85.path),tail=read(manifest.tail.path);
  expect(sql).toEqual(read(manifest.normal85.ownedPath));
  expect(sql.length).toBe(manifest.normal85.bytes);expect(hash(sql)).toBe(manifest.normal85.sha256);
  expect(hash(sql.subarray(0,manifest.priorWholePrefix.bytes))).toBe(manifest.priorWholePrefix.sha256);
  expect(sql.subarray(manifest.priorWholePrefix.bytes)).toEqual(Buffer.concat([Buffer.from("\n--> statement-breakpoint\n"),tail]));
  expect(hash(tail)).toBe(manifest.tail.sha256);
  for(const entry of manifest.successors)expect(tail.toString()).toContain(entry.afterStatement+";");
  for(const count of [manifest.newFunctions,manifest.newModels,manifest.newColumns,manifest.newTriggers,manifest.newServices])expect(count).toBe(0);
 });
 it("keeps the predecessor prefix control exact through its one declared extension",()=>{
  const change=manifest.predecessorSourceControlContinuation,actual=read(change.path).toString();
  expect(hash(actual)).toBe(change.afterSha256);
  expect(actual.replace(change.finiteDelta.after,()=>change.finiteDelta.before)).toBe(change.beforeWholeFile);
  expect(hash(change.beforeWholeFile)).toBe(change.beforeSha256);
 });
 it("keeps all original money oracles in the genuine receipt-owner companion",()=>{
  const change=manifest.receiptOwnerCompanion;let actual=read(change.path).toString();
  expect(hash(actual)).toBe(change.afterSha256);
  for(const edit of [...change.finiteDelta].reverse()){
   expect(actual.split(edit.after)).toHaveLength(2);actual=actual.replace(edit.after,()=>edit.before);
  }
  expect(actual).toBe(read(change.originalPath).toString());expect(hash(actual)).toBe(change.originalSha256);
  expect(actual).toContain("timeout:180000");
 });
});
