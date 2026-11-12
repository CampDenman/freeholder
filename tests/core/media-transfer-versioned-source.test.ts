// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C11.08: actual transport factory guards, synthetic provider only.
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import { createReplitStore,createS3Store } from "../../scripts/media-transfer.mjs";
import { storageNamespace } from "@/core/media/storage-quota";
type Metadata=Record<string,unknown>;
const provider=vi.hoisted(()=>({
 metadata:vi.fn<()=>Promise<[Metadata]>>(),download:vi.fn<()=>Promise<[Buffer]>>(),
 remove:vi.fn<(options:{ifGenerationMatch:string})=>Promise<void>>(),
 file:vi.fn<(key:string,options?:{generation:string})=>{getMetadata:()=>Promise<[Metadata]>;download:()=>Promise<[Buffer]>;delete:(options:{ifGenerationMatch:string})=>Promise<void>}>(),
}));
vi.mock("@replit/object-storage",()=>({Client:class{}}));
vi.mock("@google-cloud/storage",()=>({Storage:class{bucket(){return{file:provider.file};}}}));
const bytes=new TextEncoder().encode("original source"),key="private/original.bin";
const config={SOURCE_S3_ENDPOINT:"https://synthetic-s3.example.test",SOURCE_S3_BUCKET:"original",SOURCE_S3_REGION:"us-east-1",SOURCE_S3_ACCESS_KEY_ID:"SYNTHETIC_KEY",SOURCE_S3_SECRET_ACCESS_KEY:"synthetic-fixture-only-secret"};
const etag='"original-revision"';
describe("version-bound source cleanup transport",()=>{
 beforeEach(()=>{provider.metadata.mockReset();provider.download.mockReset();provider.remove.mockReset();provider.file.mockReset();provider.file.mockImplementation(()=>({getMetadata:provider.metadata,download:provider.download,delete:provider.remove}));});
 afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
 it("binds the S3 revision to the actual GET, key and original resource",async()=>{
  const requests:Request[]=[];
  vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{const request=input instanceof Request?input:new Request(input,init);requests.push(request);return request.method==="GET"?new Response(bytes,{headers:{etag,"content-type":"application/octet-stream"}}):new Response(null,{status:204});}));
  const store=createS3Store(config,"SOURCE"),read=await store.readVersioned(key);
  expect(store.binding.namespace).toBe(storageNamespace({id:"s3",endpoint:config.SOURCE_S3_ENDPOINT,bucket:config.SOURCE_S3_BUCKET}));
  expect(read!.body).toEqual(bytes);
  await store.deleteVersioned(key,read!.revision);
  expect(requests.map(request=>request.method)).toEqual(["GET","DELETE"]);expect(requests[1]!.headers.get("if-match")).toBe(etag);
 });
 it("preserves a newer S3 writer and never retries without the precondition",async()=>{
  let current=etag,deletes=0;
  vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{const request=input instanceof Request?input:new Request(input,init);if(request.method==="GET")return new Response(bytes,{headers:{etag:current}});deletes++;return new Response(null,{status:request.headers.get("if-match")===current?204:412});}));
  const store=createS3Store(config,"SOURCE"),read=await store.readVersioned(key);current='"newer-writer"';
  await expect(store.deleteVersioned(key,read!.revision)).rejects.toThrow("412");expect(current).toBe('"newer-writer"');expect(deletes).toBe(1);
 });
 it("refuses a different key or namespace before S3 deletion",async()=>{
  const fetch=vi.fn(async()=>new Response(bytes,{headers:{etag}}));vi.stubGlobal("fetch",fetch);
  const store=createS3Store(config,"SOURCE"),read=await store.readVersioned(key);
  await expect(store.deleteVersioned("private/replacement.bin",read!.revision)).rejects.toThrow();
  await expect(createS3Store({...config,SOURCE_S3_BUCKET:"replacement"},"SOURCE").deleteVersioned(key,read!.revision)).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(1);
 });
 it.each([undefined,"*",'W/"weak"'])("refuses missing or weak S3 revision %s",async value=>{
  vi.stubGlobal("fetch",vi.fn(async()=>new Response(bytes,{headers:value?{etag:value}:{}})));
  await expect(createS3Store(config,"SOURCE").readVersioned(key)).rejects.toThrow();
 });
 it("treats only a successful S3 404 as source absence",async()=>{
  vi.stubGlobal("fetch",vi.fn(async()=>new Response(null,{status:404})));expect(await createS3Store(config,"SOURCE").readVersioned(key)).toBeUndefined();
  vi.stubGlobal("fetch",vi.fn(async()=>new Response(null,{status:403})));await expect(createS3Store(config,"SOURCE").readVersioned(key)).rejects.toThrow("403");
 });
 it("pins Replit body reads and deletion to one exact generation",async()=>{
  provider.metadata.mockResolvedValue([{generation:"1234567890123456789",size:String(bytes.byteLength),contentType:"application/octet-stream"}]);provider.download.mockResolvedValue([Buffer.from(bytes)]);provider.remove.mockResolvedValue();
  const store=await createReplitStore({SOURCE_REPLIT_BUCKET_ID:"original"},"SOURCE"),read=await store.readVersioned(key);
  expect(read!.body).toEqual(bytes);expect(provider.file.mock.calls).toContainEqual([key,{generation:"1234567890123456789"}]);
  await store.deleteVersioned(key,read!.revision);expect(provider.remove.mock.calls).toEqual([[{ifGenerationMatch:"1234567890123456789"}]]);
 });
 it("preserves a newer Replit object after a conditional conflict",async()=>{
  provider.metadata.mockResolvedValue([{generation:"17",size:String(bytes.byteLength)}]);provider.download.mockResolvedValue([Buffer.from(bytes)]);provider.remove.mockRejectedValue(Object.assign(new Error("Synthetic newer generation"),{code:412}));
  const store=await createReplitStore({SOURCE_REPLIT_BUCKET_ID:"original"},"SOURCE"),read=await store.readVersioned(key);
  await expect(store.deleteVersioned(key,read!.revision)).rejects.toThrow("412");expect(provider.remove).toHaveBeenCalledTimes(1);
 });
 it("never turns a failed pinned-body read into current source absence",async()=>{
  provider.metadata.mockResolvedValue([{generation:"17",size:String(bytes.byteLength)}]);provider.download.mockRejectedValue(Object.assign(new Error("Synthetic old generation disappeared"),{code:404}));
  const store=await createReplitStore({SOURCE_REPLIT_BUCKET_ID:"original"},"SOURCE");await expect(store.readVersioned(key)).rejects.toThrow("body read failed (404)");expect(provider.remove).not.toHaveBeenCalled();
 });
 it("refuses replacement Replit resources and never deletes through an emulator",async()=>{
  const revision={kind:"generation" as const,key,namespace:storageNamespace({id:"replit",bucket:"original"}),value:"17"};
  const store=await createReplitStore({SOURCE_REPLIT_BUCKET_ID:"replacement"},"SOURCE");await expect(store.deleteVersioned(key,revision)).rejects.toThrow();expect(provider.file).not.toHaveBeenCalled();
  vi.stubEnv("STORAGE_EMULATOR_HOST","http://synthetic.invalid");await expect(createReplitStore({SOURCE_REPLIT_BUCKET_ID:"original"},"SOURCE")).rejects.toThrow("STORAGE_EMULATOR_HOST");
 });
});
