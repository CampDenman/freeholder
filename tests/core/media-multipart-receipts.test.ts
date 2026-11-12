// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C11.08: preserve supported direct uploads in their original resource.
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from "vitest";
import {db} from "@/core/db";
import {users} from "@/core/auth/schema";
import {resetEnvForTests} from "@/core/env";
import {ready} from "@/core/runtime";
import {resetStorageForTests} from "@/adapters/storage";
import {resetMalwareScannerForTests} from "@/adapters/malware";
import {abortUpload,beginUpload,completeUpload} from "@/core/media/service";
import type {ServiceError} from "@/core/service";
import {closeDb,hasDatabase,OWNER,truncateSpine} from "../helpers/spine";

const ORIGINAL="https://original-multipart.example.test",REPLACEMENT="https://replacement-multipart.example.test";
const pdf=new Uint8Array(Buffer.from("%PDF-1.7\nSynthetic private multipart fixture.\n%%EOF\n"));
describe.runIf(hasDatabase)("original multipart operation receipts (C1.12)",()=>{
 let calls:{method:string;url:URL}[];let assembled:boolean,aborted:boolean;
 beforeAll(ready,60000);
 beforeEach(async()=>{
  await truncateSpine();await db().insert(users).values({id:OWNER.userId,email:"owner@example.test",role:"owner"});
  calls=[];assembled=false;aborted=false;
  for(const[name,value]of Object.entries({FREEHOLDER_STORAGE:"s3",S3_ENDPOINT:ORIGINAL,S3_REGION:"test-1",S3_BUCKET:"media",S3_ACCESS_KEY_ID:"synthetic-only",S3_SECRET_ACCESS_KEY:"synthetic-only",S3_PUBLIC:"false",MALWARE_SCANNER:"none"}))vi.stubEnv(name,value);
  resetEnvForTests();resetStorageForTests();resetMalwareScannerForTests();
  vi.spyOn(globalThis,"fetch").mockImplementation(async(input,init)=>{
   const request=input instanceof Request?input:new Request(input,init),url=new URL(request.url);calls.push({method:request.method,url});
   if(request.method==="POST"&&url.searchParams.has("uploads"))return new Response("<InitiateMultipartUploadResult><UploadId>original-upload</UploadId></InitiateMultipartUploadResult>");
   if(request.method==="POST"&&url.searchParams.has("uploadId")){assembled=true;return new Response("<CompleteMultipartUploadResult><ETag>original-object</ETag></CompleteMultipartUploadResult>");}
   if(request.method==="DELETE"&&url.searchParams.has("uploadId")){aborted=true;return new Response(null,{status:204});}
   if(request.method==="DELETE"){assembled=false;return new Response(null,{status:204});}
   if(request.method==="GET"&&url.searchParams.has("uploadId"))return aborted?new Response("<Error><Code>NoSuchUpload</Code></Error>",{status:404}):new Response("<ListPartsResult><Part><PartNumber>1</PartNumber><ETag>original-part</ETag><Size>"+pdf.byteLength+"</Size></Part></ListPartsResult>");
   if(request.method==="HEAD")return assembled||url.origin===REPLACEMENT?new Response(null,{headers:{"content-length":String(pdf.byteLength),"content-type":"application/pdf","etag":"original-object"}}):new Response(null,{status:404});
   if(request.method==="GET")return new Response(pdf,{status:request.headers.has("range")?206:200,headers:{"content-type":"application/pdf"}});
   return new Response(null,{status:500});
  });
 });
 afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();resetEnvForTests();resetStorageForTests();resetMalwareScannerForTests();});
 afterAll(closeDb);
 const begin=()=>beginUpload.call({filename:"private.pdf",contentType:"application/pdf",bytes:pdf.byteLength},OWNER);
 // This positive control was red on root75's deliberately conservative WIP;
 // the original main72 cancellation flow works and must remain supported.
 it("preserves the supported direct cancellation path",async()=>{
  const reservation=await begin();expect(reservation.strategy).toBe("direct_multipart");
  expect(await abortUpload.call({id:reservation.id},OWNER)).toEqual({ok:true});
  expect(calls.filter(call=>call.method==="DELETE"&&call.url.searchParams.get("uploadId")==="original-upload")).toHaveLength(1);
 });
 it("refuses completion in a replacement namespace before touching that resource",async()=>{
  const reservation=await begin();vi.stubEnv("S3_ENDPOINT",REPLACEMENT);resetEnvForTests();resetStorageForTests();
  let error:ServiceError|undefined,completed=false;
  try{completed=(await completeUpload.call({id:reservation.id,parts:[{partNumber:1,etag:"original-part"}]},OWNER)).ok;}catch(caught){error=caught as ServiceError;}
  expect({error:error?.code??null,completed,replacementCalls:calls.filter(call=>call.url.origin===REPLACEMENT).length}).toEqual({error:"conflict",completed:false,replacementCalls:0});
 });
});
