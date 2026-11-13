// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Synthetic wire controls only: no native lifecycle/provider-account claim.
import {describe,expect,it,vi} from "vitest";
import {createS3MultipartProtocol} from "../../scripts/media-multipart-protocol.mjs";
import type {TransferRequestDescriptor,TransferRequestObservation,TransferRequestObserver} from "../../scripts/media-transfer.mjs";
const key="owned/original.bin",uploadId="original-private-session",namespace="a".repeat(64);
function harness(replies:Array<Response|Error>){
 const descriptors:TransferRequestDescriptor[]=[],facts:TransferRequestObservation[]=[];
 const fetch=vi.fn(async(_url:RequestInfo|URL|{toString():string},_init?:RequestInit)=>{const next=replies.shift();if(!next)throw new Error("Unexpected physical request");if(next instanceof Error)throw next;return next;});
 const observer:TransferRequestObserver=async(descriptor,operation)=>{descriptors.push(descriptor);return operation(async fact=>{facts.push(fact);},{id:"00000000-0000-4000-8000-000000000001",token:"synthetic-server-held-original-request-token"});};
 return{fetch,descriptors,facts,store:createS3MultipartProtocol({client:{fetch},binding:{kind:"s3",namespace,location:{bucket:"owned-private"}},url:key=>`https://provider.example.test/owned-private/${key}`,observer})};
}
const create=(actualKey=key)=>new Response(`<InitiateMultipartUploadResult><Key>${actualKey}</Key><UploadId>${uploadId}</UploadId></InitiateMultipartUploadResult>`);
const complete=(actualKey=key)=>new Response(`<CompleteMultipartUploadResult><Key>${actualKey}</Key><ETag>"original-etag"</ETag></CompleteMultipartUploadResult>`,{headers:{"x-amz-version-id":"original-version"}});
const parts=[{partNumber:1,etag:'"first-original-part"'}];
describe("C1.12/C11.08 actual multipart request accounting",()=>{
 it("tags the real original CREATE and retains its exact returned session before a caller callback can fail",async()=>{
  const h=harness([create()]);await expect(h.store.create(key,"image/png",async()=>{throw new Error("Local ACK persistence fault");})).rejects.toThrow("Local ACK");
  const headers=new Headers(h.fetch.mock.calls[0]![1]?.headers);expect(headers.get("x-amz-meta-freeholder-original-request")).toBe("00000000-0000-4000-8000-000000000001");expect(headers.get("x-amz-meta-freeholder-original-token")).toBe("synthetic-server-held-original-request-token");
  expect(h.facts.filter(row=>row.stage==="accepted"||row.stage==="session")).toEqual([{stage:"accepted",status:200,uploadId},{stage:"session",status:200,uploadId}]);expect(h.fetch).toHaveBeenCalledTimes(1);
 });
 it("refuses a CREATE acknowledgement for another key without adopting its session",async()=>{const h=harness([create("unrelated/later.bin")]);await expect(h.store.create(key,"image/png")).rejects.toThrow("another original key");expect(h.facts.some(row=>row.stage==="accepted")).toBe(false);});
 it("keeps an ambiguous CREATE connection loss distinct from absence and never retries it",async()=>{const h=harness([new Error("lost after send")]);await expect(h.store.create(key,"image/png")).rejects.toThrow("lost after send");expect(h.fetch).toHaveBeenCalledTimes(1);expect(h.facts).toEqual([]);});
 it("refuses multipart I/O when the actual request observer does not supply the original request identity",async()=>{
  const fetch=vi.fn(),observer:TransferRequestObserver=async(_descriptor,operation)=>operation(async()=>{});
  const store=createS3MultipartProtocol({client:{fetch},binding:{kind:"s3",namespace,location:{bucket:"owned-private"}},url:value=>`https://provider.example.test/${value}`,observer});await expect(store.create(key,"image/png")).rejects.toThrow("admission token");expect(fetch).not.toHaveBeenCalled();
 });
 it("binds COMPLETE to the original ordered manifest and pins its next metadata request to the actual returned version",async()=>{
  const h=harness([complete(),new Response(null,{headers:{etag:'"original-etag"',"x-amz-version-id":"original-version","content-length":"6","content-type":"image/png"}})]);
  expect(await h.store.complete(key,uploadId,parts)).toEqual({key,bytes:6,contentType:"image/png",etag:'"original-etag"'});
  expect(h.descriptors[0]).toMatchObject({kind:"multipart.complete",key,uploadId,createOnly:true});expect(h.descriptors[0]!.partsDigest).toMatch(/^[a-f0-9]{64}$/);expect(new Headers(h.fetch.mock.calls[0]![1]?.headers).get("if-none-match")).toBe("*");
  const actualUrl=h.fetch.mock.calls[1]![0];if(typeof actualUrl!=="string"&&!(actualUrl instanceof URL)&&!(actualUrl instanceof Request))throw new Error("The actual metadata request must retain its URL.");expect(new URL(typeof actualUrl==="string"?actualUrl:actualUrl instanceof URL?actualUrl.href:actualUrl.url).searchParams.get("versionId")).toBe("original-version");expect(new Headers(h.fetch.mock.calls[1]![1]?.headers).get("if-match")).toBe('"original-etag"');expect(h.facts.filter(row=>row.stage==="metadata")).toHaveLength(2);
 });
 it("retains the original COMPLETE ACK and revision when later metadata fails, with no second COMPLETE",async()=>{
  const h=harness([complete(),new Response(null,{status:503})]);await expect(h.store.complete(key,uploadId,parts)).rejects.toThrow("changed or is unavailable");expect(h.facts).toContainEqual({stage:"accepted",status:200,uploadId});expect(h.facts).toContainEqual({stage:"metadata",status:200,revision:{kind:"etag",key,namespace,value:'"original-etag"',versionId:"original-version"},uploadId});expect(h.fetch).toHaveBeenCalledTimes(2);
 });
 it("refuses an HTTP200 embedded COMPLETE error before recording an acceptance",async()=>{const h=harness([new Response("<Error><Code>InternalError</Code></Error>")]);await expect(h.store.complete(key,uploadId,parts)).rejects.toThrow("complete failed");expect(h.facts.some(row=>row.stage==="accepted")).toBe(false);expect(h.fetch).toHaveBeenCalledTimes(1);});
 it("refuses unordered or duplicate manifests before any provider request",async()=>{const h=harness([]);await expect(h.store.complete(key,uploadId,[{partNumber:2,etag:'"later"'}])).rejects.toThrow("ordered original multipart manifest");expect(h.fetch).not.toHaveBeenCalled();expect(h.descriptors).toEqual([]);});
 it("accepts only original NoSuchUpload as an absent session observation",async()=>{const h=harness([new Response("<Error><Code>NoSuchUpload</Code></Error>",{status:404})]);expect(await h.store.inspect(key,uploadId)).toEqual({state:"absent"});expect(h.facts).toContainEqual({stage:"absence",status:404,uploadId});});
 it("refuses a logical object404 as session absence",async()=>{const h=harness([new Response("<Error><Code>NoSuchKey</Code></Error>",{status:404})]);await expect(h.store.inspect(key,uploadId)).rejects.toThrow("context mismatch");expect(h.facts.some(row=>row.stage==="absence")).toBe(false);});
 it("refuses incomplete or misbound session part inventories",async()=>{
  const h=harness([new Response(`<ListPartsResult><Key>other.bin</Key><UploadId>${uploadId}</UploadId><IsTruncated>false</IsTruncated></ListPartsResult>`)]);await expect(h.store.inspect(key,uploadId)).rejects.toThrow("context mismatch");expect(h.facts.some(row=>row.stage==="inventory")).toBe(false);
 });
 it("records ABORT ACK for only its exact original session without asserting full object erasure",async()=>{const h=harness([new Response(null,{status:204})]);await h.store.abort(key,uploadId);expect(h.descriptors).toEqual([{kind:"multipart.abort",binding:{kind:"s3",namespace,location:{bucket:"owned-private"}},key,uploadId}]);expect(h.facts).toEqual([{stage:"response",status:204},{stage:"accepted",status:204,uploadId}]);expect(h.facts.some(row=>row.stage==="absence")).toBe(false);});
});
