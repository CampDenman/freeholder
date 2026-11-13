// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import {describe,expect,it} from "vitest";
import {originalObservationVersion,scopeOriginalProviderResources} from "@/core/media/original-provider-privacy";
const original="a".repeat(64),other="b".repeat(64),headers=[{id:"first-original-header",originalKeyDigest:original},{id:"second-original-header",originalKeyDigest:other}];
function version(){return{calls:[{id:"call-original",returnedAt:new Date("2026-11-13T00:00:00Z")}],requests:[{id:"request-original",returnedAt:new Date("2026-11-13T00:00:00Z"),observationCount:1}],facts:[{id:"fact-first",requestId:"request-original",ordinal:1,digest:"c".repeat(64)}]};}
describe("C1.12/C11.08 exact original provider privacy evidence",()=>{
 it("exports resource proof only under that header's exact original key, without borrowing another owned key in the same global inventory",()=>{
  const own={inventoryId:headers[0]!.id,keyDigest:original,proof:"original"},foreign={inventoryId:headers[0]!.id,keyDigest:other,proof:"foreign-equal-to-other-parent-key"};expect(scopeOriginalProviderResources([own,foreign],headers)).toEqual([own]);
 });
 it("refuses unknown headers or missing original parent digests",()=>expect(scopeOriginalProviderResources([{inventoryId:"uncaptured",keyDigest:original},{inventoryId:"missing-parent",keyDigest:original}],[...headers,{id:"missing-parent",originalKeyDigest:undefined}])).toEqual([]));
 it("leaves captured original membership and proof records unchanged",()=>{const entries=[{inventoryId:headers[0]!.id,keyDigest:original,proof:"immutable"}],before=structuredClone(entries);expect(scopeOriginalProviderResources(entries,headers)).toEqual(entries);expect(entries).toEqual(before);});
 it("changes late-evidence version for a new actual fact even when an earlier ACK timestamp would stay unchanged",()=>{const first=version(),before=originalObservationVersion(first);first.facts.push({id:"fact-actual-late",requestId:"request-original",ordinal:2,digest:"d".repeat(64)});first.requests[0]!.observationCount=2;expect(originalObservationVersion(first)).not.toBe(before);});
 it("uses retained proof digests rather than raw locators or a worker's current clock",()=>{const input=version(),before=originalObservationVersion(input);expect(originalObservationVersion(structuredClone(input))).toBe(before);});
 it("is stable across query ordering while retaining a genuine original finish change",()=>{const input=version();input.calls.push({id:"call-earlier",returnedAt:new Date("2026-11-12T00:00:00Z")});const before=originalObservationVersion(input);expect(originalObservationVersion({...input,calls:[...input.calls].reverse()})).toBe(before);input.calls[0]!.returnedAt=new Date("2026-11-13T00:01:00Z");expect(originalObservationVersion(input)).not.toBe(before);});
});
