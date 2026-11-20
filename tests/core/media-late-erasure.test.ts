// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C11.08: a late physical fact invalidates an original completion claim.
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from "vitest";
import {eq} from "drizzle-orm";
import {db} from "@/core/db";
import {users} from "@/core/auth/schema";
import {contacts} from "@/core/contacts/schema";
import {createContact} from "@/core/contacts/service";
import {createDataRequest,verifyDataRequest,fulfillDataRequest,addRetentionException} from "@/core/privacy/service";
import {dataRequests,dataRequestArtifacts} from "@/core/privacy/schema";
import {uploadAsset} from "@/core/media/service";
import {assets} from "@/core/media/schema";
import {mediaObjectWrites} from "@/core/media/write-schema";
import {observeStorageOperation,MEDIA_WRITES_SCOPE} from "@/core/media/write-ledger";
import {reconcileStorageOperation} from "@/core/media/write-recovery";
import {eraseMediaStorageOperations,MEDIA_WRITE_ERASURE_JOB} from "@/core/media/write-privacy";
import {resetStorageForTests,storage} from "@/adapters/storage";
import {resetEnvForTests} from "@/core/env";
import {getJob,stopJobs} from "@/core/jobs";
import {ready} from "@/core/runtime";
import {closeDb,failure,hasDatabase,OWNER,truncateSpine} from "../helpers/spine";
import {ordinaryMediaRecoveryProvider} from "../helpers/media-original-provider-recovery";
const UPLOADER={...OWNER,userId:"00000000-0000-4000-8000-000000000003",role:"customer",grants:[]};
const syntheticOrigin="https://s3.us-east-1.amazonaws.com",realFetch=globalThis.fetch.bind(globalThis);
describe.runIf(hasDatabase)("late original media erasure evidence (C11.08)",()=>{
 let provider:Awaited<ReturnType<typeof ordinaryMediaRecoveryProvider>>;
 beforeAll(ready,60000);
 beforeEach(async()=>{await truncateSpine();await db().insert(users).values([{id:OWNER.userId,email:"owner@example.test",role:"owner"},{id:UPLOADER.userId,email:"original-uploader@example.test",role:"customer"}]);provider=await ordinaryMediaRecoveryProvider();vi.stubGlobal("fetch",async(input:RequestInfo|URL,init?:RequestInit)=>{const url=new URL(input instanceof Request?input.url:String(input));if(url.origin!==syntheticOrigin)return realFetch(input,init);const target=new URL(`${url.pathname}${url.search}`,provider.endpoint);if(input instanceof Request)return realFetch(target,{method:input.method,headers:input.headers,body:input.body===null?undefined:await input.arrayBuffer()});return realFetch(target,init);});for(const[name,value]of Object.entries({NODE_ENV:"test",FREEHOLDER_STORAGE:"s3",S3_ENDPOINT:syntheticOrigin,S3_REGION:"fixture",S3_BUCKET:"source",S3_ACCESS_KEY_ID:"synthetic",S3_SECRET_ACCESS_KEY:"synthetic",S3_PUBLIC:"false",MALWARE_SCANNER:"none",FREEHOLDER_STORAGE_QUOTA_BYTES:""}))vi.stubEnv(name,value);resetEnvForTests();resetStorageForTests();});
 afterEach(async()=>{await provider?.close();vi.restoreAllMocks();vi.unstubAllEnvs();vi.unstubAllGlobals();resetEnvForTests();resetStorageForTests();});
 afterAll(async()=>{await stopJobs();await closeDb();});
 const review=(row:typeof mediaObjectWrites.$inferSelect,outcome="applied")=>({id:row.id,expectedUpdatedAt:row.updatedAt.toISOString(),originalNamespace:row.namespace!,outcome,
  providerFinalReference:"synthetic-original-provider-final",providerEvidence:"Synthetic provider evidence verifies the original operation outcome.",stoppedWriterEvidence:"Synthetic original writers were reported stopped before this review.",confirmation:"ORIGINAL STORAGE OUTCOME CONFIRMED"});
 it("reopens completed erasure after a contradictory late PUT and requires restored original proof before cleanup",async()=>{
  const contact=await createContact.call({name:"Original uploader",email:"original-uploader@example.test"},OWNER);await db().update(contacts).set({userId:UPLOADER.userId}).where(eq(contacts.id,contact.id));
  const store=storage(),bytes=new Uint8Array(Buffer.from("%PDF-1.7\nSynthetic late original provider fixture.\n%%EOF\n"));
  await uploadAsset.call({filename:"original.pdf",contentType:"application/pdf",bytes},UPLOADER);const original=(await db().select().from(mediaObjectWrites))[0]!;
  const request=await createDataRequest.call({contactId:contact.id,request:{kind:"erasure"}},OWNER);await verifyDataRequest.call({id:request.id,method:"Synthetic original-owner identity verification"},OWNER);const result=await fulfillDataRequest.call({id:request.id,confirmation:"ERASE"},OWNER);
  const {eraseMultipartOperations,MULTIPART_ERASURE_JOB}=await import("@/core/media/multipart-privacy");
  for(const scope of (result.artifact.body as {outcomes:Array<{scope:string;pendingJobs?:string[]}>}).outcomes)for(const id of scope.pendingJobs??[]){const name=scope.scope===MEDIA_WRITES_SCOPE?MEDIA_WRITE_ERASURE_JOB:scope.scope==="media.multipartOperations"?MULTIPART_ERASURE_JOB:null;if(!name)continue;const job=await getJob(name,id);await(name===MEDIA_WRITE_ERASURE_JOB?eraseMediaStorageOperations(job!.data):eraseMultipartOperations(job!.data));}
  expect((await db().select().from(dataRequests).where(eq(dataRequests.id,request.id)))[0]?.status).toBe("completed");expect((await db().select().from(mediaObjectWrites))[0]?.redactedAt).not.toBeNull();
  provider.reapplyOriginalSourcePut(`/source/${original.key}`);expect(await store.get(original.key)).toEqual(bytes);await observeStorageOperation(original.id,true);
  expect((await db().select().from(dataRequests).where(eq(dataRequests.id,request.id)))[0]?.status).toBe("in_progress");
  const artifact=(await db().select().from(dataRequestArtifacts).where(eq(dataRequestArtifacts.dataRequestId,request.id)))[0]!,scope=(artifact.body as {outcomes:Array<{scope:string;outcome:string;pendingJobs?:string[]}>}).outcomes.find(row=>row.scope===MEDIA_WRITES_SCOPE)!;
  expect(scope.outcome).toBe("pending");const job=await getJob(MEDIA_WRITE_ERASURE_JOB,scope.pendingJobs![0]!);await failure(eraseMediaStorageOperations(job!.data));
  const unresolved=(await db().select().from(mediaObjectWrites).where(eq(mediaObjectWrites.id,original.id)))[0]!;
  expect((await failure(reconcileStorageOperation.call({...review(unresolved),originalKey:"different/provider-key.pdf"},OWNER))).code).toBe("conflict");
  await failure(reconcileStorageOperation.call({...review(unresolved),originalKey:original.key},OWNER));await failure(eraseMediaStorageOperations(job!.data));
  expect(await store.get(original.key)).toEqual(bytes);expect((await db().select().from(dataRequests).where(eq(dataRequests.id,request.id)))[0]?.status).toBe("in_progress");
  expect(unresolved).toMatchObject({state:"unknown",deletedAt:null});expect(unresolved.redactedAt).not.toBeNull();
 });
 it("retires an original subject's published asset while preserving unrelated library media",async()=>{
  const contact=await createContact.call({name:"Original uploader",email:"original-uploader@example.test"},OWNER);await db().update(contacts).set({userId:UPLOADER.userId}).where(eq(contacts.id,contact.id));
  const bytes=new Uint8Array(Buffer.from("%PDF-1.7\nSynthetic published original fixture.\n%%EOF\n"));
  const own=await uploadAsset.call({filename:"original.pdf",contentType:"application/pdf",bytes},UPLOADER),other=await uploadAsset.call({filename:"unrelated.pdf",contentType:"application/pdf",bytes},OWNER);
  const request=await createDataRequest.call({contactId:contact.id,request:{kind:"erasure"}},OWNER);await verifyDataRequest.call({id:request.id,method:"Synthetic published-file owner verification"},OWNER);const result=await fulfillDataRequest.call({id:request.id,confirmation:"ERASE"},OWNER);
  expect(await db().select().from(assets).where(eq(assets.id,own.id))).toHaveLength(0);expect(await db().select().from(assets).where(eq(assets.id,other.id))).toHaveLength(1);
  const {eraseMultipartOperations,MULTIPART_ERASURE_JOB}=await import("@/core/media/multipart-privacy");
  for(const scope of (result.artifact.body as {outcomes:Array<{scope:string;pendingJobs?:string[]}>}).outcomes)for(const id of scope.pendingJobs??[]){const name=scope.scope==="media.storageOperations"?MEDIA_WRITE_ERASURE_JOB:scope.scope==="media.multipartOperations"?MULTIPART_ERASURE_JOB:null;if(!name)continue;const job=await getJob(name,id);await(name===MEDIA_WRITE_ERASURE_JOB?eraseMediaStorageOperations(job!.data):eraseMultipartOperations(job!.data));}
  expect(await storage().get(own.storageKey)).toBeUndefined();expect(await storage().get(other.storageKey)).toEqual(bytes);expect((await db().select().from(dataRequests).where(eq(dataRequests.id,request.id)))[0]?.status).toBe("completed");
 });
 it.each(["media.storageOperations","media.multipartOperations"])("preserves published bytes and truthful retained outcomes under a named %s hold",async scope=>{
  const contact=await createContact.call({name:"Original uploader",email:"original-uploader@example.test"},OWNER);await db().update(contacts).set({userId:UPLOADER.userId}).where(eq(contacts.id,contact.id));
  const bytes=new Uint8Array(Buffer.from("%PDF-1.7\nSynthetic held original file.\n%%EOF\n")),asset=await uploadAsset.call({filename:"held.pdf",contentType:"application/pdf",bytes},UPLOADER);
  const request=await createDataRequest.call({contactId:contact.id,request:{kind:"erasure"}},OWNER);await verifyDataRequest.call({id:request.id,method:"Synthetic held-file owner verification"},OWNER);await addRetentionException.call({dataRequestId:request.id,scope,reason:"legal_obligation",legalBasis:"Synthetic named original file is preserved for the verified legal obligation."},OWNER);
  const result=await fulfillDataRequest.call({id:request.id,confirmation:"ERASE"},OWNER),outcomes=(result.artifact.body as {outcomes:Array<{scope:string;outcome:string}>}).outcomes;
  for(const scope of ["media.storageOperations","media.multipartOperations"])expect(outcomes.find(row=>row.scope===scope)?.outcome).toBe("retained");
  expect((await db().select().from(dataRequests).where(eq(dataRequests.id,request.id)))[0]?.status).toBe("partially_completed");expect(await db().select().from(assets).where(eq(assets.id,asset.id))).toHaveLength(1);expect(await storage().get(asset.storageKey)).toEqual(bytes);
 });
});
