// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// SOURCE PREPARED, UNRUN. Actual services + real TCP/private synthetic storage;
// no actual provider account, SDK/HTTP/MCP ingress or cross-target claim.
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from "vitest";
import {randomUUID} from "node:crypto";
import {eq} from "drizzle-orm";
import {z} from "zod";
import {createContact} from "@/core/contacts/service";
import {contacts} from "@/core/contacts/schema";
import {addRetentionException,createDataRequest,verifyDataRequest,fulfillDataRequest} from "@/core/privacy/service";
import {dataRequests} from "@/core/privacy/schema";
import {getJob} from "@/core/jobs";
import {TRANSFER_PRIVACY_SCOPE,TRANSFER_ERASURE_JOB} from "@/core/media/transfer-privacy";
import {eraseStorageTransferLineage} from "@/core/media/transfer-erasure";
import {db} from "@/core/db";
import {users} from "@/core/auth/schema";
import {ready} from "@/core/runtime";
import {resetEnvForTests} from "@/core/env";
import {resetStorageForTests,storage} from "@/adapters/storage";
import {putWithReceipt} from "@/core/media/write-ledger";
import {mediaObjectWrites} from "@/core/media/write-schema";
import {mediaStorageTransferCalls,mediaStorageTransferObjects,mediaStorageTransferPlans,mediaStorageTransferErasureScopes,mediaStorageTransferErasureMembers} from "@/core/media/transfer-schema";
import {advanceStorageTransfer,planStorageTransfer} from "@/core/media/transfer-service";
import {mediaTransferProvider} from "../helpers/media-transfer-provider";
import {closeDb,failure,hasDatabase,OWNER,CUSTOMER,truncateSpine} from "../helpers/spine";
const body=new Uint8Array(Buffer.from("%PDF-1.7\nOriginal fictional private byte witness.\n%%EOF\n")),key="original/private.pdf";
describe.runIf(hasDatabase)("durable verified media-transfer lifecycle",()=>{
 let provider:Awaited<ReturnType<typeof mediaTransferProvider>>,running:Promise<unknown>[];
 beforeAll(ready,60_000);
 beforeEach(async()=>{
  running=[];await truncateSpine();await db().insert(users).values({id:OWNER.userId,email:"transfer-owner@example.test",role:"owner"});
  provider=await mediaTransferProvider();
  for(const[name,value]of Object.entries({NODE_ENV:"test",FREEHOLDER_STORAGE:"s3",S3_ENDPOINT:provider.endpoint,S3_REGION:"fixture",S3_BUCKET:"source",S3_ACCESS_KEY_ID:"synthetic",S3_SECRET_ACCESS_KEY:"synthetic",MEDIA_TRANSFER_TARGET_STORAGE:"s3",MEDIA_TRANSFER_TARGET_S3_ENDPOINT:provider.endpoint,MEDIA_TRANSFER_TARGET_S3_REGION:"fixture",MEDIA_TRANSFER_TARGET_S3_BUCKET:"target",MEDIA_TRANSFER_TARGET_S3_ACCESS_KEY_ID:"synthetic",MEDIA_TRANSFER_TARGET_S3_SECRET_ACCESS_KEY:"synthetic"}))vi.stubEnv(name,value);
  resetEnvForTests();resetStorageForTests();await putWithReceipt({key,body,contentType:"application/pdf",role:"original"},OWNER);
 });
 afterEach(async()=>{provider?.releaseAll();await Promise.allSettled(running??[]);await provider?.close();vi.unstubAllEnvs();resetEnvForTests();resetStorageForTests();});afterAll(closeDb);
 async function subjectOriginal(){
  const userId=randomUUID();await db().insert(users).values({id:userId,email:`transfer-subject-${userId}@example.test`,role:"customer"});
  const contact=await createContact.call({name:"Original private fixture subject",email:`transfer-subject-${userId}@example.test`},OWNER);
  await db().update(contacts).set({userId}).where(eq(contacts.id,contact.id));
  const ownedKey=`original/${contact.id}.pdf`;
  await putWithReceipt({key:ownedKey,body,contentType:"application/pdf",role:"original"},{kind:"user",userId,role:"customer",grants:[]});
  return{contact,ownedKey};
 }
 async function erasure(contactId:string){const request=await createDataRequest.call({contactId,request:{kind:"erasure"}},OWNER);await verifyDataRequest.call({id:request.id,method:"Synthetic original transfer subject verification"},OWNER);return request;}
 const plan=()=>planStorageTransfer.call({requestKey:randomUUID(),confirmation:"COPY ADOPT AND RETIRE ORIGINAL STORAGE"},OWNER);
 it("copies, adopts and conditionally retires exact bytes without marking the original lineage erased",async()=>{
  const[original]=await db().select().from(mediaObjectWrites);expect(original?.writerRuntimeId).toBeTruthy();expect(original?.writerFinishedAt).toBeInstanceOf(Date);
  const claimed=await plan();await advanceStorageTransfer.call({id:claimed.id,action:"copy"},OWNER);
  const beforeAdoption=await db().select().from(mediaObjectWrites).where(eq(mediaObjectWrites.id,original!.id));expect(beforeAdoption[0]).toEqual(original);
  await advanceStorageTransfer.call({id:claimed.id,action:"adopt"},OWNER);const finished=await advanceStorageTransfer.call({id:claimed.id,action:"retire"},OWNER);
  expect(finished).toMatchObject({state:"complete",objects:1,verified:1,retired:1,pendingRecovery:false});
  const[object]=await db().select().from(mediaStorageTransferObjects);expect(provider.objects.has(`/source/${key}`)).toBe(false);expect(provider.objects.get(`/target/${object!.targetKey}`)?.body).toEqual(body);expect(await storage().get(key)).toEqual(body);
  expect((await db().select().from(mediaObjectWrites).where(eq(mediaObjectWrites.id,original!.id)))[0]).toEqual(original);
  expect(provider.calls.filter(call=>call.method==="DELETE")).toHaveLength(1);expect(provider.calls.find(call=>call.method==="DELETE")?.condition).toBeTruthy();
  const calls=await db().select().from(mediaStorageTransferCalls);expect(calls.length).toBeGreaterThanOrEqual(7);expect(calls.every(call=>call.state==="returned"&&call.returnedAt)).toBe(true);
 },60_000);
 it("refuses adoption until the entire original inventory has verified target bytes",async()=>{
  const claimed=await plan();expect((await failure(advanceStorageTransfer.call({id:claimed.id,action:"adopt"},OWNER))).code).toBe("conflict");
  expect(provider.calls.filter(call=>call.method==="DELETE"||call.key.startsWith("/target/")&&call.method==="PUT")).toHaveLength(0);
  expect((await db().select().from(mediaStorageTransferPlans))[0]?.adoptedAt).toBeNull();
 });
 it("preserves an occupied target even when its bytes are identical",async()=>{
  const claimed=await plan(),[object]=await db().select().from(mediaStorageTransferObjects);
  provider.objects.set(`/target/${object!.targetKey}`,{body,type:"application/pdf",etag:'"unrelated-existing-revision"'});
  await failure(advanceStorageTransfer.call({id:claimed.id,action:"copy"},OWNER));
  expect(provider.calls.filter(call=>call.method==="PUT"&&call.key.startsWith("/target/"))).toHaveLength(0);expect(provider.calls.filter(call=>call.method==="DELETE")).toHaveLength(0);expect(provider.objects.get(`/target/${object!.targetKey}`)?.etag).toBe('"unrelated-existing-revision"');
 });
 it("retains an unknown physical PUT and refuses automatic resend, adoption or source deletion",async()=>{
  const claimed=await plan();provider.loseNextTargetPutReply();await failure(advanceStorageTransfer.call({id:claimed.id,action:"copy"},OWNER));
  const first=provider.calls.filter(call=>call.method==="PUT"&&call.key.startsWith("/target/"));expect(first).toHaveLength(1);
  await failure(advanceStorageTransfer.call({id:claimed.id,action:"copy"},OWNER));await failure(advanceStorageTransfer.call({id:claimed.id,action:"adopt"},OWNER));
  expect(provider.calls.filter(call=>call.method==="PUT"&&call.key.startsWith("/target/"))).toHaveLength(1);expect(provider.calls.filter(call=>call.method==="DELETE")).toHaveLength(0);
  expect((await db().select().from(mediaStorageTransferCalls)).some(call=>call.kind==="target_put"&&call.state==="unknown")).toBe(true);expect(provider.objects.has(`/source/${key}`)).toBe(true);
 },60_000);
 it("keeps the immutable first capture and refuses denied principals without physical side effects",async()=>{
  const requestKey=randomUUID(),claimed=await planStorageTransfer.call({requestKey,confirmation:"COPY ADOPT AND RETIRE ORIGINAL STORAGE"},OWNER),before=await db().select().from(mediaStorageTransferPlans),count=provider.calls.length;
  expect((await planStorageTransfer.call({requestKey,confirmation:"COPY ADOPT AND RETIRE ORIGINAL STORAGE"},OWNER)).id).toBe(claimed.id);
  for(const actor of [CUSTOMER,{...OWNER,keyScopes:["*"]}])expect((await failure(planStorageTransfer.call({requestKey:randomUUID(),confirmation:"COPY ADOPT AND RETIRE ORIGINAL STORAGE"},actor))).code).toBe("permission");
  expect(await db().select().from(mediaStorageTransferPlans)).toEqual(before);expect(provider.calls.length).toBe(count);
 });
 it("refuses new copy work after an original verified erasure without adopting another plan member",async()=>{
  const{contact}=await subjectOriginal(),claimed=await plan();await erasure(contact.id);const before=provider.calls.length;
  expect((await failure(advanceStorageTransfer.call({id:claimed.id,action:"copy"},OWNER))).code).toBe("conflict");
  expect(provider.calls.length).toBe(before);expect(provider.calls.filter(call=>call.method==="PUT"&&call.key.startsWith("/target/"))).toHaveLength(0);
 });
 it("preserves exact original and copied bytes under a newly recorded named hold",async()=>{
  const{contact,ownedKey}=await subjectOriginal(),claimed=await plan(),object=(await db().select().from(mediaStorageTransferObjects)).find(row=>row.key===ownedKey)!;
  await advanceStorageTransfer.call({id:claimed.id,objectId:object.id,action:"copy"},OWNER);
  const request=await erasure(contact.id);await addRetentionException.call({dataRequestId:request.id,scope:TRANSFER_PRIVACY_SCOPE,reason:"legal_obligation",legalBasis:"Synthetic named original transfer hold preserves both exact physical copies."},OWNER);
  const before=provider.calls.length;expect((await failure(eraseStorageTransferLineage.call({id:claimed.id,objectId:object.id},{kind:"system"}))).code).toBe("conflict");
  expect(provider.calls.length).toBe(before);expect(provider.objects.get(`/source/${ownedKey}`)?.body).toEqual(body);expect(provider.objects.get(`/target/${object.targetKey}`)?.body).toEqual(body);
 });
 it("keeps erasure pending during an actual admitted TCP PUT and retains its later original ACK without changing first capture",async()=>{
  const{contact,ownedKey}=await subjectOriginal(),claimed=await plan(),object=(await db().select().from(mediaStorageTransferObjects)).find(row=>row.key===ownedKey)!,gate=provider.pauseNextTargetPut();
  const copying=advanceStorageTransfer.call({id:claimed.id,objectId:object.id,action:"copy"},OWNER);running.push(copying);await gate.started;
  const request=await erasure(contact.id),result=await fulfillDataRequest.call({id:request.id,confirmation:"ERASE"},OWNER);
  const parsed=z.object({outcomes:z.array(z.object({scope:z.string(),outcome:z.string(),pendingJobs:z.array(z.uuid()).optional()}))}).parse(result.artifact.body),outcome=parsed.outcomes.find(row=>row.scope===TRANSFER_PRIVACY_SCOPE)!;
  expect(outcome.outcome).toBe("pending");expect(outcome.pendingJobs?.length).toBeGreaterThan(0);
  const queued=await getJob(TRANSFER_ERASURE_JOB,outcome.pendingJobs![0]!);expect(queued?.data).toMatchObject({requestId:request.id,originalJobId:queued!.id,objectIds:[object.id]});
  const scopes=await db().select().from(mediaStorageTransferErasureScopes),members=await db().select().from(mediaStorageTransferErasureMembers);
  expect(scopes).toHaveLength(1);expect(scopes[0]).toMatchObject({requestId:request.id,objectCount:1,complete:true});expect(members.map(row=>row.objectId)).toEqual([object.id]);
  gate.release();await failure(copying);
  expect(await db().select().from(mediaStorageTransferErasureScopes)).toEqual(scopes);expect(await db().select().from(mediaStorageTransferErasureMembers)).toEqual(members);
  const calls=await db().select().from(mediaStorageTransferCalls);expect(calls.find(row=>row.objectId===object.id&&row.kind==="target_put")).toMatchObject({state:"returned",physicalKey:object.targetKey});
  expect(calls.find(row=>row.objectId===object.id&&row.kind==="target_put")?.observedAcceptedAt).toBeInstanceOf(Date);
  expect(provider.objects.get(`/target/${object.targetKey}`)?.body).toEqual(body);expect(provider.objects.get(`/source/${ownedKey}`)?.body).toEqual(body);
  expect((await db().select().from(dataRequests).where(eq(dataRequests.id,request.id)))[0]?.status).not.toBe("completed");expect(provider.calls.filter(call=>call.method==="DELETE")).toHaveLength(0);
 },60_000);
 it("retires both original physical copies while preserving unrelated originals and queued erasure acknowledgement",async()=>{
  const{contact,ownedKey}=await subjectOriginal(),claimed=await plan(),object=(await db().select().from(mediaStorageTransferObjects)).find(row=>row.key===ownedKey)!;
  await advanceStorageTransfer.call({id:claimed.id,objectId:object.id,action:"copy"},OWNER);const request=await erasure(contact.id);await fulfillDataRequest.call({id:request.id,confirmation:"ERASE"},OWNER);
  await eraseStorageTransferLineage.call({id:claimed.id,objectId:object.id},{kind:"system"});
  expect(provider.objects.has(`/source/${ownedKey}`)).toBe(false);expect(provider.objects.has(`/target/${object.targetKey}`)).toBe(false);expect(provider.objects.get(`/source/${key}`)?.body).toEqual(body);
  const writes=await db().select().from(mediaObjectWrites);expect(writes.filter(row=>[object.keyDigest,object.targetKeyDigest].includes(row.keyDigest)).every(row=>row.deletedAt&&!["unverified","started","unknown"].includes(row.state))).toBe(true);
  expect(provider.calls.filter(call=>call.method==="DELETE")).toHaveLength(2);expect(provider.calls.filter(call=>call.method==="DELETE").every(call=>call.condition)).toBe(true);
  // This control exercises actual shared physical retirement, not a fabricated
  // job context or an actual-worker/whole-request completion claim.
  expect((await db().select().from(dataRequests).where(eq(dataRequests.id,request.id)))[0]?.status).not.toBe("completed");
 },60_000);

});
