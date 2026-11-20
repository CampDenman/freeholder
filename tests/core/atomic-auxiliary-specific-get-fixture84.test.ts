// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38: recover genuine created fixture resources without changing old oracles.
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {expect,it} from "vitest";
import manifest from "../../deploy/atomic-auxiliary-specific-get-fixture-root-continuation.manifest.json";
import bContinuation from "../../deploy/atomic-credit-fee-root-controls-continuation-20261114.json";
import receiptCheckpoint from "../../deploy/atomic-auxiliary-three-original-native-checkpoint-20261114.json";
const read=(path:string)=>readFileSync(new URL("../../"+path,import.meta.url),"utf8");
const hash=(value:string)=>createHash("sha256").update(value).digest("hex");
it("keeps every original HTTP bank branch and whole 180s native unchanged",()=>{
 let actual=read(manifest.source);
 expect(hash(actual)).toBe(bContinuation.fixture.afterSha256);
 for(const edit of [...bContinuation.fixture.finiteDelta].reverse()){
  expect(actual.split(edit.after)).toHaveLength(2);actual=actual.replace(edit.after,()=>edit.before);
 }
 expect(actual).toBe(bContinuation.fixture.beforeWholeFile);expect(hash(actual)).toBe(bContinuation.fixture.beforeSha256);
 expect(hash(actual)).toBe(manifest.afterSha256);
 expect(actual.split(manifest.finiteDelta.after)).toHaveLength(2);
 expect(actual.replace(manifest.finiteDelta.after,()=>manifest.finiteDelta.before)).toBe(manifest.beforeWholeFile);
 expect(hash(manifest.beforeWholeFile)).toBe(manifest.beforeSha256);
 for(const [path,digest] of Object.entries(manifest.preservedOriginalNatives)){
  let source=read(path);
  if(path==="tests/modules/atomic-auxiliary-fee-receipt-owner84.test.ts"){
   const change=receiptCheckpoint.receiptCompanionWitnessSourceContinuation;
   expect(hash(source)).toBe(change.afterSha256);
   for(const edit of [...change.finiteDelta].reverse()){
    const count="count" in edit&&typeof edit.count==="number"?edit.count:1;
    expect(source.split(edit.after)).toHaveLength(count+1);
    source=source.replaceAll(edit.after,()=>edit.before);
   }
   expect(source).toBe(change.beforeWholeFile);expect(hash(source)).toBe(change.beforeSha256);
  }
  expect(hash(source)).toBe(digest);expect(source).toContain("timeout:180000");
 }
});
