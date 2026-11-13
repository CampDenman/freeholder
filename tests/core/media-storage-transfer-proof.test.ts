// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C11.08: meaningful authority refusals, no provider/DB acceptance claim.
import {createHash} from "node:crypto";
import {describe,expect,it} from "vitest";
import {checkedTransferRevision,requireCompleteTransferInventory,requireFinishedTransferRead,requireNoOutstandingTransferCalls,verifiedTransferBytes,type TransferCallerProof} from "@/core/media/transfer-proof";
import {transferCallApplied,transferCallRetryPermitted} from "@/core/media/transfer-reviewed-call";
import {transferDigest} from "@/core/media/transfer-proof";
const body=new Uint8Array([0,1,255,42]),sha256=createHash("sha256").update(body).digest("hex"),binding={kind:"s3" as const,namespace:"a".repeat(64),location:{endpoint:"https://storage.example.test",bucket:"source"}},key="original/private.bin";
const proof=():TransferCallerProof=>({id:"original-call",state:"returned",kind:"source_read",namespace:binding.namespace,physicalKey:key,returnedAt:new Date("2026-11-13T00:00:00Z"),observedAcceptedAt:null,resultRevision:{kind:"etag",key,namespace:binding.namespace,value:'"opaque-revision"'},resultSha256:sha256,resultBytes:body.byteLength,resultAbsent:null});
describe("verified original storage-transfer authority",()=>{
 it("refuses a missing, duplicate or newly added original inventory member",()=>{
  expect(()=>requireCompleteTransferInventory(["a","b"],["b","a"])).not.toThrow();
  for(const current of [["a"],["a","b","b"],["a","b","c"]])expect(()=>requireCompleteTransferInventory(["a","b"],current)).toThrow();
 });
 it("requires complete SHA bytes and exact length, independently of provider ETags",()=>{
  expect(()=>verifiedTransferBytes(body,{sha256,bytes:4})).not.toThrow();
  expect(()=>verifiedTransferBytes(new Uint8Array([0,1,255,43]),{sha256,bytes:4})).toThrow();
  expect(()=>verifiedTransferBytes(body,{sha256,bytes:3})).toThrow();
 });
 it("refuses weak ETags and a different key or namespace",()=>{
  const revision=proof().resultRevision!;expect(checkedTransferRevision(revision,binding,key)).toEqual(revision);
  for(const changed of [{...revision,value:'W/"weak"'},{...revision,key:"other"},{...revision,namespace:"b".repeat(64)}])expect(()=>checkedTransferRevision(changed,binding,key)).toThrow();
 });
 it("preserves an opaque large Replit generation without numeric conversion",()=>{
  const replit={kind:"replit" as const,namespace:"b".repeat(64),location:{bucket:"original"}},revision={kind:"generation" as const,key,namespace:replit.namespace,value:"9007199254740993123"};
  expect(checkedTransferRevision(revision,replit,key).value).toBe("9007199254740993123");
  expect(()=>checkedTransferRevision({...revision,value:"9.007199254740993e18"},replit,key)).toThrow();
 });
 it("refuses an admitted or unknown caller even after its timeout or physical reply",()=>{
  for(const state of ["admitted","unknown"])expect(()=>requireNoOutstandingTransferCalls([{state,returnedAt:new Date()}])).toThrow();
  expect(()=>requireNoOutstandingTransferCalls([{state:"returned",returnedAt:null}])).toThrow();
  expect(()=>requireNoOutstandingTransferCalls([{state:"returned",returnedAt:new Date()}])).not.toThrow();
 });
 it("does not use a positive ACK as an actual finished current byte read",()=>{
  const original=proof();expect(requireFinishedTransferRead(original,binding,key,{sha256,bytes:4})).toEqual(original.resultRevision);
  for(const changed of [{...original,returnedAt:null},{...original,state:"unknown"},{...original,resultSha256:"c".repeat(64)},{...original,resultAbsent:new Date()},{...original,physicalKey:"different"}])expect(()=>requireFinishedTransferRead(changed,binding,key,{sha256,bytes:4})).toThrow();
 });
 it("requires an exact stopped-caller receipt and rejects a bare stopped label",()=>{
  expect(()=>requireNoOutstandingTransferCalls([{state:"stopped",returnedAt:null}])).toThrow();
  expect(()=>requireNoOutstandingTransferCalls([{state:"stopped",returnedAt:null,stoppedAt:new Date(),stopReceiptId:"exact-review"}])).not.toThrow();
 });
 it("distinguishes actual acknowledgements from exact human reviews and explicit retries",()=>{
  const call={id:"original",state:"stopped",stopReceiptId:"review",returnedAt:null,observedAcceptedAt:null};
  expect(transferCallApplied(call,[{id:"review",callId:"other",outcome:"applied",permitsRetry:false}])).toBe(false);
  expect(transferCallApplied(call,[{id:"review",callId:"original",outcome:"applied",permitsRetry:false}])).toBe(true);
  expect(transferCallRetryPermitted(call,[{id:"review",callId:"original",outcome:"not_applied",permitsRetry:false}])).toBe(false);
  expect(transferCallRetryPermitted(call,[{id:"review",callId:"original",outcome:"not_applied",permitsRetry:true}])).toBe(true);
 });
 it("permits a known never-attempted caller only from its exact actual server return digest",()=>{
  const call={id:"original",state:"returned",stopReceiptId:null,returnedAt:new Date(),observedAcceptedAt:null,resultDigest:transferDigest({notAttempted:true})};
  expect(transferCallRetryPermitted(call,[])).toBe(true);
  expect(transferCallRetryPermitted({...call,resultDigest:"a".repeat(64)},[])).toBe(false);
  expect(transferCallRetryPermitted({...call,observedAcceptedAt:new Date()},[])).toBe(false);
 });

});
