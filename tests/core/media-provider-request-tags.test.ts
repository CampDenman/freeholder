// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C11.08: synthetic actual protocol tags, no provider/account acceptance.
import { describe, expect, it, vi } from "vitest";
import type { SaveOptions } from "@google-cloud/storage";
import { createS3TransferProtocol, createReplitTransferProtocol } from "../../scripts/media-transfer-protocol.mjs";
import type { TransferRequestIdentity, TransferRequestObserver, TransferRequestObservation } from "../../scripts/media-transfer.mjs";
import { transferDigest } from "@/core/media/transfer-proof";
const key="original/private.bin",body=new Uint8Array([0,255,13,10,128,0]);
function server(){const identities:TransferRequestIdentity[]=[],facts:TransferRequestObservation[]=[];const observer:TransferRequestObserver=async(_descriptor,operation)=>{const id=`00000000-0000-4000-8000-${String(identities.length+1).padStart(12,"0")}`,identity={id,token:`synthetic-original-request-token-${id}`};identities.push(identity);return operation(async fact=>{facts.push(fact);},identity);};return{observer,identities,facts};}
describe("C1.12/C11.08 original provider request tag round trip",()=>{
 it("binds actual S3 create-only headers to the original request and returns only their digest on readback",async()=>{
  const runtime=server(),binding={kind:"s3"as const,namespace:"a".repeat(64),location:{bucket:"original-private"}};
  let stored:Headers|undefined;
  const request=vi.fn(async(_input:RequestInfo|URL,init?:RequestInit)=>{
   if(init?.method==="PUT"){stored=new Headers(init.headers);return new Response(null,{headers:{etag:'"original-etag"',"x-amz-version-id":"original-version"}});}
   if(!stored)throw new Error("Original actual PUT was not observed");
   return new Response(body,{headers:{etag:'"original-etag"',"x-amz-version-id":"original-version","x-amz-meta-freeholder-original-request":stored.get("x-amz-meta-freeholder-original-request")!,"x-amz-meta-freeholder-original-token":stored.get("x-amz-meta-freeholder-original-token")!}});
  });
  const store=createS3TransferProtocol({client:{fetch:request},binding,url:value=>`https://storage.example.test/original-private/${value}`,observer:runtime.observer});
  await store.put(key,body,"application/octet-stream");const first=runtime.identities[0]!;
  expect(stored?.get("if-none-match")).toBe("*");expect(stored?.get("x-amz-meta-freeholder-original-request")).toBe(first.id);expect(stored?.get("x-amz-meta-freeholder-original-token")).toBe(first.token);
  const actual=await store.readVersioned(key);expect(actual?.body).toEqual(body);expect(actual?.requestProof).toEqual({id:first.id,tokenDigest:transferDigest(first.token)});
  expect(JSON.stringify(actual)).not.toContain(first.token);expect(runtime.facts.some(fact=>fact.requestProof?.id===first.id)).toBe(true);expect(request).toHaveBeenCalledTimes(2);
 });
 it("binds non-resumable Replit CREATE-only metadata to the original request before pinned metadata/body readback",async()=>{
  const runtime=server(),binding={kind:"replit"as const,namespace:"b".repeat(64),location:{bucket:"original-private"}};
  const metadata={name:key,bucket:binding.location.bucket,generation:"9007199254740993",size:String(body.byteLength),metadata:{}as Record<string,string>};
  const save=vi.fn(async(_body:Buffer,options:SaveOptions)=>{const values=options.metadata?.metadata;if(typeof values?.freeholderOriginalRequest!=="string"||typeof values.freeholderOriginalToken!=="string")throw new Error("Original server request tags are missing");metadata.metadata={freeholderOriginalRequest:values.freeholderOriginalRequest,freeholderOriginalToken:values.freeholderOriginalToken};});
  const download=vi.fn(async()=>[Buffer.from(body)]),files:Array<{key:string;generation:unknown}>=[];
  const store=createReplitTransferProtocol({binding,destination:async()=>({file:(name:string,options?:{generation?:string})=>{files.push({key:name,generation:options?.generation});return{metadata,save,getMetadata:async()=>[metadata],download};}}),requireOriginalEndpoint:()=>{},observer:runtime.observer});
  await store.put(key,body,"application/octet-stream");const first=runtime.identities[0]!;
  expect(save).toHaveBeenCalledWith(Buffer.from(body),expect.objectContaining({resumable:false,validation:false,preconditionOpts:{ifGenerationMatch:0}}));
  const actual=await store.readVersioned(key,{kind:"generation",key,namespace:binding.namespace,value:metadata.generation});
  expect(actual?.requestProof).toEqual({id:first.id,tokenDigest:transferDigest(first.token)});expect(actual?.body).toEqual(body);expect(JSON.stringify(actual)).not.toContain(first.token);
  expect(files.at(-1)).toEqual({key,generation:metadata.generation});expect(download).toHaveBeenCalledWith({validation:false,decompress:false});expect(runtime.identities).toHaveLength(3);
 });
});
