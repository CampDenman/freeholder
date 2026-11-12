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
import {abortUpload,beginUpload,completeUpload} from "@/core/media/service";
import {mediaMultipartOperations,mediaMultipartResources} from "@/core/media/multipart-schema";
import {mediaObjectWrites} from "@/core/media/write-schema";
import {listMultipartOperations,reconcileMultipartOperation} from "@/core/media/multipart-recovery";
import {observeMultipart} from "@/core/media/multipart-operations";
import {createDataRequest,verifyDataRequest,fulfillDataRequest} from "@/core/privacy/service";
import {dataRequests,dataRequestArtifacts} from "@/core/privacy/schema";
import {getJob,stopJobs} from "@/core/jobs";
import {eraseMultipartOperations,MULTIPART_ERASURE_JOB,MULTIPART_PRIVACY_SCOPE} from "@/core/media/multipart-privacy";
import type {ServiceError} from "@/core/service";
import {closeDb,failure,hasDatabase,OWNER,truncateSpine} from "../helpers/spine";

const ORIGINAL="https://original-multipart.example.test",REPLACEMENT="https://replacement-multipart.example.test";
const pdf=new Uint8Array(Buffer.from("%PDF-1.7\nSynthetic private multipart fixture.\n%%EOF\n"));
describe.runIf(hasDatabase)("original multipart operation receipts (C1.12)",()=>{
 let calls:{method:string;url:URL}[];let assembled:boolean,aborted:boolean,created:boolean,lostCreate:boolean,headFailures:number,abortStaysOpen:boolean,lateCreate:boolean;
 let completionGates:Array<()=>Promise<void>>;
 beforeAll(ready,60000);
 beforeEach(async()=>{
  await truncateSpine();await db().insert(users).values({id:OWNER.userId,email:"owner@example.test",role:"owner"});
  calls=[];assembled=false;aborted=false;created=false;lostCreate=false;headFailures=0;abortStaysOpen=false;lateCreate=false;
  completionGates=[];
  for(const[name,value]of Object.entries({FREEHOLDER_STORAGE:"s3",S3_ENDPOINT:ORIGINAL,S3_REGION:"test-1",S3_BUCKET:"media",S3_ACCESS_KEY_ID:"synthetic-only",S3_SECRET_ACCESS_KEY:"synthetic-only",S3_PUBLIC:"false",MALWARE_SCANNER:"none"}))vi.stubEnv(name,value);
  resetEnvForTests();resetStorageForTests();resetMalwareScannerForTests();
  vi.spyOn(globalThis,"fetch").mockImplementation(async(input,init)=>{
   const request=input instanceof Request?input:new Request(input,init),url=new URL(request.url);calls.push({method:request.method,url});
   if(request.method==="POST"&&url.searchParams.has("uploads")){created=!lateCreate;if(lostCreate)throw new Error("Synthetic CREATE reply lost after provider admission");return new Response("<InitiateMultipartUploadResult><UploadId>original-upload</UploadId></InitiateMultipartUploadResult>");}
   if(request.method==="POST"&&url.searchParams.has("uploadId")){const gate=completionGates.shift();if(gate)await gate();if(assembled)return new Response("<Error><Code>NoSuchUpload</Code></Error>",{status:404});assembled=true;return new Response("<CompleteMultipartUploadResult><ETag>original-object</ETag></CompleteMultipartUploadResult>");}
   if(request.method==="DELETE"&&url.searchParams.has("uploadId")){aborted=!abortStaysOpen;return new Response(null,{status:204});}
   if(request.method==="DELETE"){assembled=false;return new Response(null,{status:204});}
   if(request.method==="GET"&&url.searchParams.has("uploads"))return new Response(`<ListMultipartUploadsResult>${created&&!aborted&&!assembled?`<Upload><Key>${url.searchParams.get("prefix")!}</Key><UploadId>original-upload</UploadId></Upload>`:""}<IsTruncated>false</IsTruncated></ListMultipartUploadsResult>`);
   if(request.method==="GET"&&url.searchParams.has("uploadId"))return aborted||assembled?new Response("<Error><Code>NoSuchUpload</Code></Error>",{status:404}):new Response("<ListPartsResult><Part><PartNumber>1</PartNumber><ETag>original-part</ETag><Size>"+pdf.byteLength+"</Size></Part></ListPartsResult>");
   if(request.method==="HEAD"){if(headFailures>0){headFailures--;throw new Error("Synthetic object inspection unavailable");}return assembled||url.origin===REPLACEMENT?new Response(null,{headers:{"content-length":String(pdf.byteLength),"content-type":"application/pdf","etag":"original-object"}}):new Response(null,{status:404});}
   if(request.method==="GET")return new Response(pdf,{status:request.headers.has("range")?206:200,headers:{"content-type":"application/pdf"}});
   return new Response(null,{status:500});
  });
 });
 afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();resetEnvForTests();resetStorageForTests();resetMalwareScannerForTests();});
 afterAll(async()=>{await stopJobs();await closeDb();});
 const begin=()=>beginUpload.call({filename:"private.pdf",contentType:"application/pdf",bytes:pdf.byteLength},OWNER);
 const complete=(id:string,etag="original-part")=>completeUpload.call({id,parts:[{partNumber:1,etag}]},OWNER);
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
 it("retains a lost CREATE and recovers its original ID from exact-key inventory",async()=>{
  lostCreate=true;await failure(begin());const [resource]=await db().select().from(mediaMultipartResources);expect(resource?.state).toBe("unknown");expect(resource?.providerUploadId).toBeNull();
  const rows=(await listMultipartOperations.call({},OWNER)).rows;expect(rows).toHaveLength(1);await reconcileMultipartOperation.call(review(rows[0]!),OWNER);
  expect((await db().select().from(mediaMultipartResources))[0]?.providerUploadId).toBe("original-upload");await abortUpload.call({id:resource!.uploadId},OWNER);
  expect(calls.filter(call=>call.method==="POST"&&call.url.searchParams.has("uploads"))).toHaveLength(1);
 });
 it("retains positive COMPLETE ACK and rechecks the original object without replay",async()=>{
  const reservation=await begin();headFailures=1;await failure(complete(reservation.id));const [operation]=(await db().select().from(mediaMultipartOperations)).filter(row=>row.kind==="complete");expect(operation?.providerAcceptedAt).not.toBeNull();expect(operation?.state).toBe("unknown");
  expect((await failure(complete(reservation.id,"changed-part"))).code).toBe("conflict");expect((await complete(reservation.id)).ok).toBe(true);expect(calls.filter(call=>call.method==="POST"&&call.url.searchParams.has("uploadId"))).toHaveLength(1);
 });
 it("keeps a positively acknowledged ABORT pending until ListParts verifies retirement",async()=>{
  const reservation=await begin();abortStaysOpen=true;expect((await failure(abortUpload.call({id:reservation.id},OWNER))).code).toBe("conflict");
  const [operation]=(await db().select().from(mediaMultipartOperations)).filter(row=>row.kind==="abort");expect(operation?.providerAcceptedAt).not.toBeNull();expect((await db().select().from(mediaMultipartResources))[0]?.retiredAt).toBeNull();
  expect((await failure(abortUpload.call({id:reservation.id},OWNER))).code).toBe("conflict");expect(calls.filter(call=>call.method==="DELETE"&&call.url.searchParams.has("uploadId"))).toHaveLength(1);
  const row=(await listMultipartOperations.call({},OWNER)).rows[0]!;await reconcileMultipartOperation.call(review(row),OWNER);abortStaysOpen=false;
  const known=(await listMultipartOperations.call({},OWNER)).rows[0]!;await reconcileMultipartOperation.call(review(known,"cleanup"),OWNER);
  expect((await db().select().from(mediaMultipartResources))[0]?.state).toBe("aborted");expect((await db().select().from(mediaMultipartResources))[0]?.retiredAt).not.toBeNull();expect(calls.filter(call=>call.method==="DELETE"&&call.url.searchParams.has("uploadId"))).toHaveLength(2);
 });
 it("keeps the original reservation owner when a different owner executes completion",async()=>{
  const uploader={...OWNER,userId:"00000000-0000-4000-8000-000000000003",role:"customer",grants:[]};await db().insert(users).values({id:uploader.userId,email:"original-uploader@example.test",role:"customer"});
  const contact=await createContact.call({name:"Original uploader",email:"original-uploader@example.test"},OWNER);await db().update(contacts).set({userId:uploader.userId}).where(eq(contacts.id,contact.id));
  const reservation=await beginUpload.call({filename:"private.pdf",contentType:"application/pdf",bytes:pdf.byteLength},uploader);expect((await complete(reservation.id)).ok).toBe(true);
  const [receipt]=await db().select().from(mediaObjectWrites),[resource]=await db().select().from(mediaMultipartResources);expect(receipt?.contactId).toBe(contact.id);expect(resource?.contactId).toBe(contact.id);expect(receipt?.actor).toBe(`user:${OWNER.userId}`);
 });
 it("reopens a minimized original CREATE after late allocation and verifies original multipart erasure",async()=>{
  const uploader={...OWNER,userId:"00000000-0000-4000-8000-000000000003",role:"customer",grants:[]};await db().insert(users).values({id:uploader.userId,email:"original-uploader@example.test",role:"customer"});
  const contact=await createContact.call({name:"Original uploader",email:"original-uploader@example.test"},OWNER);await db().update(contacts).set({userId:uploader.userId}).where(eq(contacts.id,contact.id));
  lostCreate=true;lateCreate=true;await failure(beginUpload.call({filename:"private.pdf",contentType:"application/pdf",bytes:pdf.byteLength},uploader));
  const original=(await db().select().from(mediaMultipartResources))[0]!,operation=(await db().select().from(mediaMultipartOperations))[0]!;
  await reconcileMultipartOperation.call(review((await listMultipartOperations.call({},OWNER)).rows[0]!,"not_applied"),OWNER);
  const request=await createDataRequest.call({contactId:contact.id,request:{kind:"erasure"}},OWNER);await verifyDataRequest.call({id:request.id,method:"Synthetic original multipart owner verification"},OWNER);await fulfillDataRequest.call({id:request.id,confirmation:"ERASE"},OWNER);
  expect((await db().select().from(dataRequests).where(eq(dataRequests.id,request.id)))[0]?.status).toBe("completed");expect((await db().select().from(mediaMultipartResources))[0]?.redactedAt).not.toBeNull();
  created=true;await observeMultipart(operation.id,{accepted:true,uploadId:"original-upload",originalKey:original.key});
  expect((await db().select().from(dataRequests).where(eq(dataRequests.id,request.id)))[0]?.status).toBe("in_progress");
  const artifact=(await db().select().from(dataRequestArtifacts).where(eq(dataRequestArtifacts.dataRequestId,request.id)))[0]!,scope=(artifact.body as {outcomes:Array<{scope:string;pendingJobs?:string[]}>}).outcomes.find(row=>row.scope===MULTIPART_PRIVACY_SCOPE)!;
  const job=await getJob(MULTIPART_ERASURE_JOB,scope.pendingJobs![0]!);await failure(eraseMultipartOperations(job!.data));
  const unresolved=(await listMultipartOperations.call({},OWNER)).rows[0]!;await reconcileMultipartOperation.call({...review(unresolved),originalKey:original.key},OWNER);await eraseMultipartOperations(job!.data);
  expect((await db().select().from(dataRequests).where(eq(dataRequests.id,request.id)))[0]?.status).toBe("completed");expect((await db().select().from(mediaMultipartResources))[0]?.state).toBe("aborted");expect((await db().select().from(mediaMultipartResources))[0]?.contactId).toBeNull();
  expect(calls.filter(call=>call.method==="POST"&&call.url.searchParams.has("uploads"))).toHaveLength(1);expect(calls.filter(call=>call.method==="DELETE"&&call.url.searchParams.has("uploadId"))).toHaveLength(1);
 });
 it("preserves a refused peer COMPLETE separately from the original finalized object",async()=>{
  const reservation=await begin();let releaseFirst!:()=>void,releaseSecond!:()=>void;
  completionGates=[()=>new Promise<void>(resolve=>{releaseFirst=resolve;}),()=>new Promise<void>(resolve=>{releaseSecond=resolve;})];
  const first=complete(reservation.id).then(result=>({result}),(_error:unknown)=>({failed:true}));let second:ReturnType<typeof first.then>|undefined;
  try{
   await vi.waitFor(()=>expect(releaseFirst).toBeTypeOf("function"),{timeout:5000});
   const original=(await listMultipartOperations.call({},OWNER)).rows[0]!;await reconcileMultipartOperation.call(review(original,"not_applied"),OWNER);
   second=complete(reservation.id,"new-part").then(result=>({result}),(_error:unknown)=>({failed:true}));await vi.waitFor(()=>expect(releaseSecond).toBeTypeOf("function"),{timeout:5000});
   releaseFirst();const outcome=await first;expect(outcome).toMatchObject({result:{ok:true}});
   const resource=(await db().select().from(mediaMultipartResources))[0]!;expect(resource.retiredAt).not.toBeNull();expect(resource.state).toBe("completed");expect(resource.providerUploadId).toBe("original-upload");
   const journal=await db().select().from(mediaMultipartOperations);expect(journal.filter(row=>row.kind==="complete"&&row.state==="started")).toHaveLength(1);
   releaseSecond();expect(await second).toMatchObject({failed:true});
   const unresolved=(await listMultipartOperations.call({},OWNER)).rows.find(row=>row.operation?.kind==="complete")!;
   await reconcileMultipartOperation.call({...review(unresolved,"not_applied"),sha256:createHash("sha256").update(pdf).digest("hex"),bytes:pdf.byteLength},OWNER);
   const settled=(await db().select().from(mediaMultipartOperations)).filter(row=>row.kind==="complete");expect(settled.filter(row=>row.state==="accepted")).toHaveLength(1);expect(settled.filter(row=>row.state==="not_applied")).toHaveLength(1);
  }finally{releaseFirst?.();releaseSecond?.();await Promise.allSettled([first,...(second?[second]:[])]);}
 });
});
