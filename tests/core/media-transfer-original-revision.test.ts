// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C11.08: immutable first actual provider results, no current-key adoption.
import { describe, expect, it } from "vitest";
import { originalCapturedSourceRevision } from "@/core/media/transfer-original-revision";
import { transferDigest } from "@/core/media/transfer-proof";
const key="original/private.pdf",namespace="a".repeat(64),revision={kind:"etag"as const,key,namespace,value:'"original-etag"',versionId:"original-version"};
const snapshot={operation:"put",state:"accepted",key,namespace,writerRuntimeId:"00000000-0000-4000-8000-000000000001",writerFinishedAt:"2026-11-13T01:00:00.000Z",writerProtocol:"single-put-v1",providerRevision:revision,providerRevisionDigest:transferDigest(revision),deletedAt:null};
const capture=(value:Record<string,unknown>)=>({originalSnapshot:value,originalSnapshotDigest:transferDigest(value)});
describe("C1.12/C11.08 original captured provider result",()=>{
 it("uses the exact immutable first result without inspecting a later current generation",()=>{
  const original=capture(snapshot);expect(originalCapturedSourceRevision([original],key)).toEqual(revision);expect(original).toEqual(capture(snapshot));
 });
 it("refuses byte-for-byte first-capture corruption even when its revision looks valid",()=>{
  const original=capture(snapshot);expect(()=>originalCapturedSourceRevision([{...original,originalSnapshot:{...snapshot,writerFinishedAt:"2026-11-13T02:00:00.000Z"}}],key)).toThrow();expect(original).toEqual(capture(snapshot));
 });
 it("refuses missing original result, early ACK without actual finish and missing original protocol",()=>{
  for(const patch of [{providerRevision:undefined,providerRevisionDigest:null},{writerFinishedAt:null},{writerRuntimeId:null},{writerProtocol:null}])expect(()=>originalCapturedSourceRevision([capture({...snapshot,...patch})],key)).toThrow();
 });
 it("refuses conflicting original generations without rebinding the first receipt",()=>{
  const later={...revision,versionId:"later-generation"},original=capture(snapshot),other=capture({...snapshot,providerRevision:later,providerRevisionDigest:transferDigest(later)});
  expect(()=>originalCapturedSourceRevision([original,other],key)).toThrow();expect(originalCapturedSourceRevision([original],key)).toEqual(revision);
 });
});
