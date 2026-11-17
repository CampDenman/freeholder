// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C11.08: preserve supported direct uploads in their original resource.
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from "vitest";
import {createHash} from "node:crypto";
import {db} from "@/core/db";
import {users} from "@/core/auth/schema";
import {eq} from "drizzle-orm";
import {contacts} from "@/core/contacts/schema";
import {createContact} from "@/core/contacts/service";
import {resetEnvForTests} from "@/core/env";
import {ready} from "@/core/runtime";
import {resetStorageForTests} from "@/adapters/storage";
import {resetMalwareScannerForTests} from "@/adapters/malware";
import {abortUpload,beginUpload,completeUpload,declareUploadParts,signUploadParts} from "@/core/media/service";
import {mediaMultipartOperations,mediaMultipartResources} from "@/core/media/multipart-schema";
import {mediaObjectWrites} from "@/core/media/write-schema";
import {listMultipartOperations,reconcileMultipartOperation} from "@/core/media/multipart-recovery";
import {createDataRequest,verifyDataRequest,fulfillDataRequest} from "@/core/privacy/service";
import {dataRequests} from "@/core/privacy/schema";
import {stopJobs} from "@/core/jobs";
import type {ServiceError} from "@/core/service";
import {closeDb,failure,hasDatabase,OWNER,truncateSpine} from "../helpers/spine";

const ORIGINAL="https://s3.us-east-1.amazonaws.com",REPLACEMENT="https://s3.us-west-2.amazonaws.com";
const pdf=new Uint8Array(Buffer.from("%PDF-1.7\nSynthetic private multipart fixture.\n%%EOF\n"));
describe.runIf(hasDatabase)("original multipart operation receipts (C1.12)",()=>{
 let calls:{method:string;url:URL}[];let assembled:boolean,aborted:boolean,created:boolean,lostCreate:boolean,headFailures:number,abortStaysOpen:boolean,lateCreate:boolean,partUploaded:boolean;
 let completionGates:Array<()=>Promise<void>>,partChecksum:string,originalRequest:string,originalToken:string,sessionKey:string,preparation:Map<string,Promise<void>>;
 beforeAll(ready,60000);
 beforeEach(async()=>{
  await truncateSpine();await db().insert(users).values({id:OWNER.userId,email:"owner@example.test",role:"owner"});
  calls=[];assembled=false;aborted=false;created=false;lostCreate=false;headFailures=0;abortStaysOpen=false;lateCreate=false;partUploaded=false;
  completionGates=[];partChecksum="";originalRequest="";originalToken="";sessionKey="";preparation=new Map();
  for(const[name,value]of Object.entries({FREEHOLDER_STORAGE:"s3",S3_ENDPOINT:ORIGINAL,S3_REGION:"test-1",S3_BUCKET:"media",S3_ACCESS_KEY_ID:"synthetic-only",S3_SECRET_ACCESS_KEY:"synthetic-only",S3_PUBLIC:"false",MALWARE_SCANNER:"none"}))vi.stubEnv(name,value);
  resetEnvForTests();resetStorageForTests();resetMalwareScannerForTests();
  vi.spyOn(globalThis,"fetch").mockImplementation(async(input,init)=>{
   const request=input instanceof Request?input:new Request(input,init),url=new URL(request.url);calls.push({method:request.method,url});
   const key=decodeURIComponent(url.pathname.slice("/media/".length)),proof={"x-amz-meta-freeholder-original-request":originalRequest,"x-amz-meta-freeholder-original-token":originalToken};
   if(request.method==="GET"&&url.pathname==="/media"){
    if(url.searchParams.has("versioning"))return new Response("<VersioningConfiguration/>");
    if(url.searchParams.has("versions"))return new Response(`<ListVersionsResult><Name>media</Name><EncodingType>url</EncodingType><IsTruncated>false</IsTruncated>${assembled?`<Version><Key>${encodeURIComponent(sessionKey)}</Key><VersionId>null</VersionId><IsLatest>true</IsLatest><ETag>&quot;original-object&quot;</ETag><Size>${pdf.byteLength}</Size></Version>`:""}</ListVersionsResult>`);
    if(url.searchParams.has("list-type"))return new Response(`<ListBucketResult><Name>media</Name><EncodingType>url</EncodingType><KeyCount>${assembled?1:0}</KeyCount><IsTruncated>false</IsTruncated>${assembled?`<Contents><Key>${encodeURIComponent(sessionKey)}</Key><ETag>&quot;original-object&quot;</ETag><Size>${pdf.byteLength}</Size></Contents>`:""}</ListBucketResult>`);
    if(url.searchParams.has("uploads"))return new Response(`<ListMultipartUploadsResult><Bucket>media</Bucket><EncodingType>url</EncodingType><IsTruncated>false</IsTruncated>${created&&!aborted&&!assembled?`<Upload><Key>${encodeURIComponent(sessionKey)}</Key><UploadId>original-upload</UploadId></Upload>`:""}</ListMultipartUploadsResult>`);
   }
   if(request.method==="POST"&&url.searchParams.has("uploads")){created=!lateCreate;sessionKey=key;originalRequest=request.headers.get("x-amz-meta-freeholder-original-request")??"";originalToken=request.headers.get("x-amz-meta-freeholder-original-token")??"";if(lostCreate)throw new Error("Synthetic CREATE reply lost after provider admission");return new Response(`<InitiateMultipartUploadResult><Bucket>media</Bucket><Key>${key}</Key><UploadId>original-upload</UploadId></InitiateMultipartUploadResult>`);}
   if(request.method==="PUT"&&url.searchParams.has("uploadId")){const body=new Uint8Array(await request.arrayBuffer());partChecksum=createHash("sha256").update(body).digest("base64");if(request.headers.get("x-amz-checksum-sha256")!==partChecksum||!request.headers.has("x-freeholder-original-part-id"))return new Response(null,{status:400});partUploaded=true;return new Response(null,{headers:{etag:"original-part","x-amz-checksum-sha256":partChecksum}});}
   if(request.method==="POST"&&url.searchParams.has("uploadId")){const gate=completionGates.shift();if(gate)await gate();if(assembled)return new Response("<Error><Code>NoSuchUpload</Code></Error>",{status:404});assembled=true;return new Response(`<CompleteMultipartUploadResult><Bucket>media</Bucket><Key>${key}</Key><ETag>"original-object"</ETag></CompleteMultipartUploadResult>`);}
   if(request.method==="DELETE"&&url.searchParams.has("uploadId")){aborted=!abortStaysOpen;return new Response(null,{status:204});}
   if(request.method==="DELETE"){assembled=false;return new Response(null,{status:204});}
   if(request.method==="GET"&&url.searchParams.has("uploadId"))return aborted||assembled?new Response("<Error><Code>NoSuchUpload</Code></Error>",{status:404}):new Response(`<ListPartsResult><Bucket>media</Bucket><Key>${key}</Key><UploadId>original-upload</UploadId><IsTruncated>false</IsTruncated>${partUploaded?`<Part><PartNumber>1</PartNumber><ETag>original-part</ETag><Size>${pdf.byteLength}</Size><ChecksumSHA256>${partChecksum}</ChecksumSHA256></Part>`:""}</ListPartsResult>`);
   if(request.method==="HEAD"){if(headFailures>0){headFailures--;throw new Error("Synthetic object inspection unavailable");}return assembled||url.origin===REPLACEMENT?new Response(null,{headers:{"content-length":String(pdf.byteLength),"content-type":"application/pdf","etag":'"original-object"',...proof}}):new Response(null,{status:404});}
   if(request.method==="GET")return new Response(pdf,{status:request.headers.has("range")?206:200,headers:{"content-type":"application/pdf","etag":'"original-object"',...proof}});
   return new Response(null,{status:500});
  });
 });
 afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();resetEnvForTests();resetStorageForTests();resetMalwareScannerForTests();});
 afterAll(async()=>{await stopJobs();await closeDb();});
 const begin=()=>beginUpload.call({filename:"private.pdf",contentType:"application/pdf",bytes:pdf.byteLength},OWNER);
 async function prepare(id:string){let pending=preparation.get(id);if(!pending){pending=(async()=>{await declareUploadParts.call({id,parts:[{partNumber:1,bytes:pdf.byteLength,sha256:createHash("sha256").update(pdf).digest("hex")}]},OWNER);const signed=await signUploadParts.call({id,partNumbers:[1]},OWNER),part=signed.parts[0]!;expect((await fetch(part.url,{method:part.method,headers:part.headers,body:pdf})).ok).toBe(true);})();preparation.set(id,pending);}await pending;}
 const complete=async(id:string,etag="original-part")=>{await prepare(id);return completeUpload.call({id,parts:[{partNumber:1,etag}]},OWNER);};
 const review=(row:Awaited<ReturnType<typeof listMultipartOperations.call>>["rows"][number],action="applied")=>({resourceId:row.resource.id,operationId:row.operation?.id,expectedWitness:row.witness,originalNamespace:row.resource.namespace!,action,
  providerFinalReference:"synthetic-original-provider-final",providerEvidence:"Synthetic provider evidence verifies the exact original physical resource.",stoppedWriterEvidence:"Synthetic previous original writers have actually stopped and drained.",confirmation:"ORIGINAL MULTIPART RESOURCE CONFIRMED"});
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
 it("completes and idempotently returns the original asset without a second COMPLETE",async()=>{
  const reservation=await begin(),first=await complete(reservation.id),second=await complete(reservation.id);expect(first.ok).toBe(true);expect(second).toEqual(first);
  expect(calls.filter(call=>call.method==="POST"&&call.url.searchParams.has("uploadId"))).toHaveLength(1);expect((await db().select().from(mediaMultipartResources))[0]?.state).toBe("completed");expect((await db().select().from(mediaObjectWrites))[0]?.state).toBe("accepted");
 });
 it("retains a lost CREATE without adopting its ID from exact-key inventory",async()=>{
  lostCreate=true;await failure(begin());const [resource]=await db().select().from(mediaMultipartResources);expect(resource?.state).toBe("unknown");expect(resource?.providerUploadId).toBeNull();
  const rows=(await listMultipartOperations.call({},OWNER)).rows;expect(rows).toHaveLength(1);expect((await failure(reconcileMultipartOperation.call(review(rows[0]!),OWNER))).message).toContain("genuinely retained first provider acknowledgement");
  expect((await db().select().from(mediaMultipartResources))[0]?.providerUploadId).toBeNull();
  expect(calls.filter(call=>call.method==="POST"&&call.url.searchParams.has("uploads"))).toHaveLength(1);expect(calls.filter(call=>call.method==="DELETE"&&call.url.searchParams.has("uploadId"))).toHaveLength(0);
 });
 it("retains positive COMPLETE ACK and rechecks the original object without replay",async()=>{
  const reservation=await begin();headFailures=1;await failure(complete(reservation.id));const [operation]=(await db().select().from(mediaMultipartOperations)).filter(row=>row.kind==="complete");expect(operation?.providerAcceptedAt).not.toBeNull();expect(operation?.state).toBe("unknown");
  expect((await failure(complete(reservation.id,"changed-part"))).code).toBe("conflict");const unresolved=(await listMultipartOperations.call({},OWNER)).rows.find(row=>row.operation?.kind==="complete")!;await reconcileMultipartOperation.call(review(unresolved),OWNER);expect((await complete(reservation.id)).ok).toBe(true);expect(calls.filter(call=>call.method==="POST"&&call.url.searchParams.has("uploadId"))).toHaveLength(1);
 });
 it("keeps a positively acknowledged ABORT pending until ListParts verifies retirement",async()=>{
  const reservation=await begin();abortStaysOpen=true;expect((await failure(abortUpload.call({id:reservation.id},OWNER))).code).toBe("conflict");
  const [operation]=(await db().select().from(mediaMultipartOperations)).filter(row=>row.kind==="abort");expect(operation?.providerAcceptedAt).not.toBeNull();expect((await db().select().from(mediaMultipartResources))[0]?.retiredAt).toBeNull();
  expect((await failure(abortUpload.call({id:reservation.id},OWNER))).code).toBe("conflict");expect(calls.filter(call=>call.method==="DELETE"&&call.url.searchParams.has("uploadId"))).toHaveLength(1);
  const row=(await listMultipartOperations.call({},OWNER)).rows[0]!;expect((await failure(reconcileMultipartOperation.call(review(row,"cleanup"),OWNER))).message).toContain("still retains bytes");abortStaysOpen=false;aborted=true;
  const known=(await listMultipartOperations.call({},OWNER)).rows[0]!;await reconcileMultipartOperation.call(review(known,"cleanup"),OWNER);
  expect((await db().select().from(mediaMultipartResources))[0]?.state).toBe("aborted");expect((await db().select().from(mediaMultipartResources))[0]?.retiredAt).not.toBeNull();expect(calls.filter(call=>call.method==="DELETE"&&call.url.searchParams.has("uploadId"))).toHaveLength(1);
 });
 it("keeps the original reservation owner when a different owner executes completion",async()=>{
  const uploader={...OWNER,userId:"00000000-0000-4000-8000-000000000003",role:"customer",grants:[]};await db().insert(users).values({id:uploader.userId,email:"original-uploader@example.test",role:"customer"});
  const contact=await createContact.call({name:"Original uploader",email:"original-uploader@example.test"},OWNER);await db().update(contacts).set({userId:uploader.userId}).where(eq(contacts.id,contact.id));
  const reservation=await beginUpload.call({filename:"private.pdf",contentType:"application/pdf",bytes:pdf.byteLength},uploader);expect((await complete(reservation.id)).ok).toBe(true);
  const [receipt]=await db().select().from(mediaObjectWrites),[resource]=await db().select().from(mediaMultipartResources);expect(receipt?.contactId).toBe(contact.id);expect(resource?.contactId).toBe(contact.id);expect(receipt?.actor).toBe(`user:${OWNER.userId}`);
 });
 it("keeps an actually lost original CREATE pending through erasure instead of minimizing unknown custody",async()=>{
  const uploader={...OWNER,userId:"00000000-0000-4000-8000-000000000003",role:"customer",grants:[]};await db().insert(users).values({id:uploader.userId,email:"original-uploader@example.test",role:"customer"});
  const contact=await createContact.call({name:"Original uploader",email:"original-uploader@example.test"},OWNER);await db().update(contacts).set({userId:uploader.userId}).where(eq(contacts.id,contact.id));
  lostCreate=true;lateCreate=true;await failure(beginUpload.call({filename:"private.pdf",contentType:"application/pdf",bytes:pdf.byteLength},uploader));
  const original=(await db().select().from(mediaMultipartResources))[0]!;
  await failure(reconcileMultipartOperation.call(review((await listMultipartOperations.call({},OWNER)).rows[0]!,"not_applied"),OWNER));
  const request=await createDataRequest.call({contactId:contact.id,request:{kind:"erasure"}},OWNER);await verifyDataRequest.call({id:request.id,method:"Synthetic original multipart owner verification"},OWNER);await fulfillDataRequest.call({id:request.id,confirmation:"ERASE"},OWNER);
  expect((await db().select().from(dataRequests).where(eq(dataRequests.id,request.id)))[0]?.status).toBe("in_progress");expect((await db().select().from(mediaMultipartResources))[0]).toEqual(original);
  expect(calls.filter(call=>call.method==="POST"&&call.url.searchParams.has("uploads"))).toHaveLength(1);expect(calls.filter(call=>call.method==="DELETE"&&call.url.searchParams.has("uploadId"))).toHaveLength(0);
 });
 it("returns the original finalized object without admitting a changed peer COMPLETE",async()=>{
  const reservation=await begin(),first=await complete(reservation.id);expect(first.ok).toBe(true);expect(await complete(reservation.id,"new-part")).toEqual(first);
  const resource=(await db().select().from(mediaMultipartResources))[0]!;expect(resource.retiredAt).toBeNull();expect(resource.state).toBe("completed");expect(resource.providerUploadId).toBe("original-upload");
  const journal=await db().select().from(mediaMultipartOperations);expect(journal.filter(row=>row.kind==="complete"&&row.state==="accepted")).toHaveLength(1);expect(journal.filter(row=>row.kind==="complete"&&row.state==="started")).toHaveLength(0);
  expect(calls.filter(call=>call.method==="POST"&&call.url.searchParams.has("uploadId"))).toHaveLength(1);expect(await db().select().from(mediaObjectWrites)).toHaveLength(1);
 });
});
