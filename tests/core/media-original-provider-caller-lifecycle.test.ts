// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// SOURCE PREPARED, UNRUN. Actual shared infrastructure + private fictional TCP
// storage. No genuine ingress, worker, account, stop or full erasure claim.
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from "vitest";
import {createHash,randomUUID} from "node:crypto";
import {eq} from "drizzle-orm";
import {db} from "@/core/db";
import {users} from "@/core/auth/schema";
import {contacts} from "@/core/contacts/schema";
import {createContact} from "@/core/contacts/service";
import {createDataRequest,verifyDataRequest,fulfillDataRequest} from "@/core/privacy/service";
import {dataRequests} from "@/core/privacy/schema";
import {ready} from "@/core/runtime";
import {stopJobs} from "@/core/jobs";
import {resetEnvForTests} from "@/core/env";
import {resetStorageForTests} from "@/adapters/storage";
import {putWithReceipt} from "@/core/media/write-ledger";
import {mediaObjectWrites} from "@/core/media/write-schema";
import {mediaStorageTransferCalls} from "@/core/media/transfer-schema";
import {mediaStorageTransferRequests,mediaStorageTransferRequestObservations} from "@/core/media/transfer-request-schema";
import {admitOriginalMediaCaller} from "@/core/media/provider-callers";
import {actualStorageCallerRuntimeIdentity} from "@/core/media/physical-caller-runtime";
import {transferDigest} from "@/core/media/transfer-proof";
import {ordinaryMediaRequestProvider} from "../helpers/media-original-provider-requests";
import {closeDb,failure,hasDatabase,OWNER,CUSTOMER,truncateSpine} from "../helpers/spine";
const body=new Uint8Array([0,255,13,10,128,0]),key="private/exact-original.bin";
describe.runIf(hasDatabase)("C1.12/C11.08 original ordinary provider caller lifecycle",()=>{
 let provider:Awaited<ReturnType<typeof ordinaryMediaRequestProvider>>,running:Promise<unknown>[];
 beforeAll(async()=>{await ready();await stopJobs();},60000);
 beforeEach(async()=>{running=[];await truncateSpine();await db().insert(users).values([{id:OWNER.userId,email:"original-owner@example.test",role:"owner"},{id:CUSTOMER.userId,email:"original-subject@example.test",role:"customer"}]);provider=await ordinaryMediaRequestProvider();for(const[name,value]of Object.entries({NODE_ENV:"test",FREEHOLDER_STORAGE:"s3",S3_ENDPOINT:provider.endpoint,S3_REGION:"fixture",S3_BUCKET:"source",S3_ACCESS_KEY_ID:"synthetic",S3_SECRET_ACCESS_KEY:"synthetic"}))vi.stubEnv(name,value);resetEnvForTests();resetStorageForTests();});
 afterEach(async()=>{provider?.releaseAll();await Promise.allSettled(running??[]);await provider?.close();vi.unstubAllEnvs();resetEnvForTests();resetStorageForTests();});afterAll(closeDb);
 it("retains the original admission, exact actual PUT nonce, provider revision and independent caller/request finishes",async()=>{
  await putWithReceipt({key,body,contentType:"application/octet-stream",role:"original"},OWNER);
  const[receipt]=await db().select().from(mediaObjectWrites),[caller]=await db().select().from(mediaStorageTransferCalls),[request]=await db().select().from(mediaStorageTransferRequests),facts=await db().select().from(mediaStorageTransferRequestObservations);
  expect(receipt).toMatchObject({key,sha256:createHash("sha256").update(body).digest("hex"),bytes:body.byteLength,state:"accepted"});expect(receipt?.writerFinishedAt).toBeInstanceOf(Date);
  expect(caller).toMatchObject({objectId:null,objectReceiptId:receipt!.id,multipartOperationId:null,kind:"ordinary_put",state:"returned"});expect(caller?.returnedAt).toBeInstanceOf(Date);expect(request?.returnedAt).toBeInstanceOf(Date);expect(request?.callId).toBe(caller?.id);
  const tags=provider.originalRequestTags.get(`/source/${key}`)!;expect(tags.id).toBe(request?.id);expect(transferDigest(tags.token)).toBe(request?.tokenDigest);expect(request?.descriptorDigest).toBe(transferDigest(request?.descriptor));expect(request?.descriptor).toMatchObject({kind:"object.put",key,createOnly:true,sha256:receipt?.sha256,bytes:body.byteLength});
  expect(facts.some(row=>row.facts.stage==="accepted")).toBe(true);expect(facts.some(row=>row.facts.stage==="metadata"&&transferDigest(row.facts.revision)===receipt?.providerRevisionDigest)).toBe(true);expect(provider.calls.filter(call=>call.method==="PUT")).toHaveLength(1);expect(provider.calls.filter(call=>call.method==="DELETE")).toHaveLength(0);
 },60000);
 it("keeps erasure pending through an actual paused original PUT despite real404 and empty inventories, and retains its later ACK",async()=>{
  const contact=await createContact.call({name:"Original fictional subject",email:"original-subject@example.test"},OWNER);await db().update(contacts).set({userId:CUSTOMER.userId}).where(eq(contacts.id,contact.id));
  const gate=provider.pauseNextSourcePut(),writing=putWithReceipt({key,body,contentType:"application/octet-stream",role:"original"},CUSTOMER);running.push(writing);await gate.started;
  expect((await fetch(`${provider.endpoint}/source/${key}`,{method:"HEAD"})).status).toBe(404);
  for(const query of ["list-type=2","versions=","uploads="]){const actual=await fetch(`${provider.endpoint}/source?${query}`);expect(actual.status).toBe(200);expect(await actual.text()).toContain("<IsTruncated>false</IsTruncated>");}expect(provider.objects.size).toBe(0);
  const[captured]=await db().select().from(mediaObjectWrites),[originalCall]=await db().select().from(mediaStorageTransferCalls),[originalRequest]=await db().select().from(mediaStorageTransferRequests);expect(originalCall?.state).toBe("admitted");expect(originalCall?.returnedAt).toBeNull();expect(originalRequest?.returnedAt).toBeNull();
  const request=await createDataRequest.call({contactId:contact.id,request:{kind:"erasure"}},OWNER);await verifyDataRequest.call({id:request.id,method:"Synthetic original subject verified"},OWNER);await fulfillDataRequest.call({id:request.id,confirmation:"ERASE"},OWNER);
  expect((await db().select().from(dataRequests).where(eq(dataRequests.id,request.id)))[0]?.status).not.toBe("completed");expect(provider.calls.filter(call=>call.method==="DELETE")).toHaveLength(0);
  gate.release();await Promise.allSettled([writing]);
  const[retained]=await db().select().from(mediaObjectWrites).where(eq(mediaObjectWrites.id,captured!.id)),[finished]=await db().select().from(mediaStorageTransferCalls).where(eq(mediaStorageTransferCalls.id,originalCall!.id));
  expect(retained).toMatchObject({id:captured!.id,keyDigest:captured!.keyDigest,namespace:captured!.namespace,sha256:captured!.sha256,deletedAt:null});expect(retained?.writerFinishedAt).toBeInstanceOf(Date);expect(finished?.observedAcceptedAt).toBeInstanceOf(Date);expect(finished?.returnedAt).toBeInstanceOf(Date);expect(provider.objects.get(`/source/${key}`)?.body).toEqual(body);expect((await db().select().from(dataRequests).where(eq(dataRequests.id,request.id)))[0]?.status).not.toBe("completed");expect(provider.calls.filter(call=>call.method==="DELETE")).toHaveLength(0);
 },60000);
 it("refuses a new dispatch birth for an earlier immutable intent without changing the original caller or sending a second PUT",async()=>{
  await putWithReceipt({key,body,contentType:"application/octet-stream",role:"original"},OWNER);const[receipt]=await db().select().from(mediaObjectWrites),before=await db().select().from(mediaStorageTransferCalls),runtimeIdentity=await actualStorageCallerRuntimeIdentity();
  expect((await failure(db().transaction(tx=>admitOriginalMediaCaller(tx,{kind:"ordinary_put",objectReceiptId:receipt!.id,token:randomUUID()+randomUUID(),runtimeIdentity},OWNER)))).code).toBe("conflict");expect(await db().select().from(mediaStorageTransferCalls)).toEqual(before);expect((await db().select().from(mediaObjectWrites))[0]).toEqual(receipt);expect(provider.calls.filter(call=>call.method==="PUT")).toHaveLength(1);expect(provider.calls.filter(call=>call.method==="DELETE")).toHaveLength(0);
 },60000);
});
