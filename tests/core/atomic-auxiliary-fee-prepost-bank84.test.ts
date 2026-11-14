// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: preserve full prior bank and guard predicates during own dispatch.
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";
import manifest from "../../deploy/atomic-auxiliary-fee-prepost-bank85.manifest.json";
const read=(path:string)=>readFileSync(new URL("../../"+path,import.meta.url));
const hash=(value:string|Buffer)=>createHash("sha256").update(value).digest("hex");
const body=(statement:string)=>statement.match(/AS \$\$([\s\S]*)\$\$/)?.[1]??"";
function reverse(statement:string,changes:readonly {before:string;after:string}[]){
 for(const change of [...changes].reverse()){
  expect(statement.split(change.after)).toHaveLength(2);
  statement=statement.replace(change.after,()=>change.before);
 }
 return statement;
}
describe("actual own auxiliary pre-POST bank preservation",()=>{
 it("inherits every complete generic bank predicate and full physical witness",()=>{
  const entry=manifest.newFunctions[0];
  expect(hash(body(entry.beforeStatement))).toBe(entry.beforeBodySha256);
  expect(hash(body(entry.afterStatement))).toBe(entry.afterBodySha256);
  expect(reverse(entry.afterStatement,entry.reversal)).toBe(entry.beforeStatement);
  expect(entry.afterStatement).toContain("physical_call.id<>own_call.id");
  expect(entry.afterStatement).toContain("own_call.nonce_hash IS DISTINCT FROM");
  expect(entry.afterStatement).toContain("terminal.kind IN('finish','stop','ack','resource')");
 });
 it.each(manifest.successors)("reverses the entire prior $name statement",entry=>{
  expect(hash(body(entry.beforeStatement))).toBe(entry.beforeBodySha256);
  expect(hash(body(entry.afterStatement))).toBe(entry.afterBodySha256);
  expect(reverse(entry.afterStatement,entry.reversal)).toBe(entry.beforeStatement);
 });
 it("retains the entire preceding migration and identical owned SQL",()=>{
  const sql=read(manifest.normal85.path),owned=read(manifest.normal85.ownedPath),tail=read(manifest.tail.path);
  expect(sql).toEqual(owned);
  expect(sql.length).toBe(manifest.normal85.bytes);
  expect(hash(sql)).toBe(manifest.normal85.sha256);
  expect(hash(sql.subarray(0,manifest.priorWholePrefix.bytes))).toBe(manifest.priorWholePrefix.sha256);
  expect(sql.subarray(manifest.priorWholePrefix.bytes)).toEqual(Buffer.concat([Buffer.from("\n--> statement-breakpoint\n"),tail]));
  expect(hash(tail)).toBe(manifest.tail.sha256);
  for(const entry of [...manifest.newFunctions,...manifest.successors])expect(tail.toString()).toContain(entry.afterStatement+";");
 });
 it("adds only one private SQL reader and no schema, caller, or service authority",()=>{
  expect(manifest.newFunctions).toHaveLength(1);
  expect(manifest.successors).toHaveLength(2);
  for(const count of [manifest.newModels,manifest.newColumns,manifest.newTriggers,manifest.newServices])expect(count).toBe(0);
  expect(read(manifest.tail.path).toString()).not.toMatch(/CREATE\s+(?:TABLE|TRIGGER|INDEX)|ALTER\s+TABLE/i);
 });
 it("keeps the real process-held preflight and all original 180-second native assertions",()=>{
  for(const [path,entry] of Object.entries(manifest.preservedOriginalInputs)){
   const bytes=read(path);expect(bytes.length).toBe(entry.bytes);expect(hash(bytes)).toBe(entry.sha256);
  }
  expect(read("tests/modules/atomic-auxiliary-fee84.test.ts").toString()).toContain("timeout:180000");
 });
});
