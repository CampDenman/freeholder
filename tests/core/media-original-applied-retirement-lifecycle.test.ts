// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// PREPARED / UNRUN. Genuine shared services/private fictional TCP. The portable
// review exercises the same consumer; actual stopped-executor acceptance still
// needs an independently executed platform witness, never seeded kernel proof.
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from "vitest";
import {eq,sql} from "drizzle-orm";
import {db} from "@/core/db";
import {users} from "@/core/auth/schema";
import {createContact} from "@/core/contacts/service";
import {createDataRequest,verifyDataRequest,addRetentionException} from "@/core/privacy/service";
import {ready} from "@/core/runtime";
import {stopJobs} from "@/core/jobs";
import {resetEnvForTests} from "@/core/env";
import {resetStorageForTests} from "@/adapters/storage";
import {putWithReceipt,deleteWithReceipt,allowMediaReceiptWrites} from "@/core/media/write-ledger";
import {reconcileStorageOperation} from "@/core/media/write-recovery";
import {minimizeOriginalProviderReservation} from "@/core/media/original-provider-minimization";
import {mediaObjectWrites} from "@/core/media/write-schema";
import {mediaStorageTransferCalls as callers,mediaStorageTransferReviews as reviews} from "@/core/media/transfer-schema";
import {mediaStorageTransferRequests as requests} from "@/core/media/transfer-request-schema";
import {mediaStorageProviderInventories as inventories} from "@/core/media/transfer-inventory-schema";
import {ordinaryMediaRetirementProvider} from "../helpers/media-original-retirement-provider";
import {closeDb,failure,hasDatabase,OWNER,truncateSpine} from "../helpers/spine";
const key="private/applied-retirement.bin",body=new Uint8Array([0,255,13,10,128,0]);
describe.runIf(hasDatabase)("C1.12/C11.08 original applied-review retirement consumer (complete protocol dependent)",()=>{
 let provider:Awaited<ReturnType<typeof ordinaryMediaRetirementProvider>>;
 beforeAll(async()=>{await ready();await stopJobs();const[capability]=await db().execute<{present:boolean}>(sql`select to_regprocedure('freeholder_media_transfer_request_capability_v1()') is not null as present`);if(capability?.present!==true)throw Error("Prepared original applied-review retirement requires the actual complete protocol; no fixture capability is substituted.");},60000);
 beforeEach(async()=>{await truncateSpine();await db().insert(users).values({id:OWNER.userId,email:"applied-retirement-owner@example.test",role:"owner"});provider=await ordinaryMediaRetirementProvider();for(const[name,value]of Object.entries({NODE_ENV:"test",FREEHOLDER_STORAGE:"s3",S3_ENDPOINT:provider.endpoint,S3_REGION:"fixture",S3_BUCKET:"source",S3_ACCESS_KEY_ID:"synthetic",S3_SECRET_ACCESS_KEY:"synthetic",FREEHOLDER_STORAGE_QUOTA_BYTES:"",FREEHOLDER_STORAGE_QUOTA_INITIALIZE_EMPTY:"false"}))vi.stubEnv(name,value);resetEnvForTests();resetStorageForTests();});
 afterEach(async()=>{provider?.releaseAll();await provider?.close();vi.unstubAllEnvs();resetEnvForTests();resetStorageForTests();});afterAll(closeDb);
 async function applied(){
  provider.loseNextSourcePutReply();await failure(putWithReceipt({key,body,contentType:"application/octet-stream",role:"original"},OWNER));const[row]=await db().select().from(mediaObjectWrites);if(!row?.namespace||!row.originalReservationId)throw Error("Actual original birth missing");
  await reconcileStorageOperation.call({id:row.id,expectedUpdatedAt:row.updatedAt.toISOString(),originalNamespace:row.namespace,outcome:"applied",providerFinalReference:"fictional-original-revision",providerEvidence:"Actual fictional TCP original nonce, exact full bytes and complete two-pass inventory.",stoppedWriterEvidence:"Actual originating finish is retained. This text is not executor proof.",confirmation:"ORIGINAL STORAGE OUTCOME CONFIRMED"},OWNER);
  const[receipt]=await db().select().from(mediaObjectWrites).where(eq(mediaObjectWrites.id,row.id)),[caller]=await db().select().from(callers).where(eq(callers.objectReceiptId,row.id));if(!receipt||!caller)throw Error("Actual applied review missing");
  const originalRequests=await db().select().from(requests).where(eq(requests.callId,caller.id)),originalReviews=await db().select().from(reviews),originalInventories=await db().select().from(inventories);expect(caller).toMatchObject({state:"stopped"});expect(caller.returnedAt).toBeInstanceOf(Date);return{receipt,caller,originalRequests,originalReviews,originalInventories,reservationId:row.originalReservationId};
 }
 it("retires a genuinely reviewed lost-reply PUT through one exact conditional DELETE without rewriting its original review or return",async()=>{
  const original=await applied();expect(await deleteWithReceipt(key)).toBe(true);
  expect((await db().select().from(callers).where(eq(callers.id,original.caller.id)))[0]).toEqual(original.caller);expect(await db().select().from(requests).where(eq(requests.callId,original.caller.id))).toEqual(original.originalRequests);expect(await db().select().from(reviews)).toEqual(original.originalReviews);
  for(const header of original.originalInventories)expect((await db().select().from(inventories).where(eq(inventories.id,header.id)))[0]).toEqual(header);
  const[retired]=await db().select().from(mediaObjectWrites).where(eq(mediaObjectWrites.id,original.receipt.id));expect(retired).toMatchObject({writerRuntimeId:original.receipt.writerRuntimeId,writerFinishedAt:original.receipt.writerFinishedAt,providerRevision:original.receipt.providerRevision,providerRevisionDigest:original.receipt.providerRevisionDigest,evidenceDigest:original.receipt.evidenceDigest});expect(retired?.deletedAt).toBeInstanceOf(Date);
  expect(provider.calls.filter(row=>row.method==="PUT")).toHaveLength(1);expect(provider.calls.filter(row=>row.method==="DELETE")).toHaveLength(1);expect(provider.calls.find(row=>row.method==="DELETE")?.condition).toBe(original.receipt.providerRevision?.value);expect(provider.objects.has(`/source/${key}`)).toBe(false);
  expect(await deleteWithReceipt(key)).toBe(true);expect(provider.calls.filter(row=>row.method==="DELETE")).toHaveLength(1);
 },60000);
 it("keeps the proven retired review authoritative during guarded raw-evidence minimization without changing its original digest or return",async()=>{
  const original=await applied();expect(await deleteWithReceipt(key)).toBe(true);
  expect(await db().transaction(async tx=>{await allowMediaReceiptWrites(tx);return minimizeOriginalProviderReservation(tx,original.reservationId);})).toBe(true);
  const[proof]=await db().execute<{retired:boolean}>(sql`select freeholder_media_original_reservation_retired(${original.reservationId}::uuid) as retired`);expect(proof?.retired).toBe(true);expect(await db().select().from(reviews)).toEqual(original.originalReviews);
  const[caller]=await db().select().from(callers).where(eq(callers.id,original.caller.id));expect(caller).toMatchObject({stopReceiptId:original.caller.stopReceiptId,returnedAt:original.caller.returnedAt,resultDigest:original.caller.resultDigest,runtimeIdentity:original.caller.runtimeIdentity});expect(caller?.redactedAt).toBeInstanceOf(Date);
  for(const before of original.originalRequests){const[after]=await db().select().from(requests).where(eq(requests.id,before.id));expect(after).toMatchObject({tokenDigest:before.tokenDigest,descriptorDigest:before.descriptorDigest,returnedAt:before.returnedAt,stopReceiptId:before.stopReceiptId});expect(after?.redactedAt).toBeInstanceOf(Date);}
  expect(provider.calls.filter(row=>row.method==="PUT")).toHaveLength(1);expect(provider.calls.filter(row=>row.method==="DELETE")).toHaveLength(1);
 },60000);
 it("keeps an applied original and complete first review under a later named hold without admitting a DELETE",async()=>{
  const original=await applied(),contact=await createContact.call({name:"Applied original hold",email:"applied-retirement-held@example.test"},OWNER),request=await createDataRequest.call({contactId:contact.id,request:{kind:"erasure"}},OWNER);await verifyDataRequest.call({id:request.id,method:"Synthetic verified subject"},OWNER);await addRetentionException.call({dataRequestId:request.id,scope:"media.storageOperations",reason:"legal_claim",legalBasis:"Synthetic original-byte preservation control"},OWNER);
  expect((await failure(deleteWithReceipt(key))).code).toBe("conflict");expect((await db().select().from(mediaObjectWrites).where(eq(mediaObjectWrites.id,original.receipt.id)))[0]).toEqual(original.receipt);expect((await db().select().from(callers).where(eq(callers.id,original.caller.id)))[0]).toEqual(original.caller);expect(await db().select().from(reviews)).toEqual(original.originalReviews);expect(provider.objects.get(`/source/${key}`)?.body).toEqual(body);expect(provider.calls.filter(row=>row.method==="DELETE")).toEqual([]);
 },60000);
});
