// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// SOURCE PREPARED, UNRUN. Actual shared services + fictional private TCP;
// no ingress, actual worker/provider account or physical-erasure acceptance.
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from "vitest";
import {randomUUID} from "node:crypto";
import {eq} from "drizzle-orm";
import {db} from "@/core/db";
import {users} from "@/core/auth/schema";
import {ready} from "@/core/runtime";
import {stopJobs} from "@/core/jobs";
import {resetEnvForTests} from "@/core/env";
import {initializeStorageQuota,storageInventorySha256,storageNamespace} from "@/core/media/storage-quota";
import {storageQuotaObjects} from "@/core/media/storage-quota-schema";
import {resetStorageForTests} from "@/adapters/storage";
import {putWithReceipt} from "@/core/media/write-ledger";
import {reconcileStorageOperation} from "@/core/media/write-recovery";
import {mediaObjectWrites} from "@/core/media/write-schema";
import {mediaStorageTransferCalls as callers,mediaStorageTransferReviews as reviews} from "@/core/media/transfer-schema";
import {mediaStorageTransferRequests as requests,mediaStorageTransferRequestObservations as facts} from "@/core/media/transfer-request-schema";
import {mediaStorageProviderInventories as inventories} from "@/core/media/transfer-inventory-schema";
import {ordinaryMediaRecoveryProvider} from "../helpers/media-original-provider-recovery";
import {closeDb,failure,hasDatabase,OWNER,truncateSpine} from "../helpers/spine";
const key="private/actual-original.bin",body=new Uint8Array([0,255,13,10,128,0]);
describe.runIf(hasDatabase)("C1.12/C11.08 finished unknown original PUT recovery",()=>{
 let provider:Awaited<ReturnType<typeof ordinaryMediaRecoveryProvider>>,running:Promise<unknown>[];
 beforeAll(async()=>{await ready();await stopJobs();},60000);
 beforeEach(async()=>{running=[];await truncateSpine();await db().insert(users).values({id:OWNER.userId,email:"original-recovery-owner@example.test",role:"owner"});provider=await ordinaryMediaRecoveryProvider();for(const[name,value]of Object.entries({NODE_ENV:"test",FREEHOLDER_STORAGE:"s3",S3_ENDPOINT:provider.endpoint,S3_REGION:"fixture",S3_BUCKET:"source",S3_ACCESS_KEY_ID:"synthetic",S3_SECRET_ACCESS_KEY:"synthetic"}))vi.stubEnv(name,value);resetEnvForTests();resetStorageForTests();});
 afterEach(async()=>{provider?.releaseAll();await Promise.allSettled(running??[]);await provider?.close();vi.unstubAllEnvs();resetEnvForTests();resetStorageForTests();});afterAll(closeDb);
 function confirmation(row:typeof mediaObjectWrites.$inferSelect){if(!row.namespace)throw new Error("Original fixture namespace is missing");return{id:row.id,expectedUpdatedAt:row.updatedAt.toISOString(),originalNamespace:row.namespace,outcome:"applied"as const,providerFinalReference:"synthetic-original-provider-recovery",providerEvidence:"Fictional private TCP provider: exact original request nonce and complete two-pass physical inventory.",stoppedWriterEvidence:"This manual text is not stop proof. Only the actual retained originating caller/request finishes authorize this portable review.",confirmation:"ORIGINAL STORAGE OUTCOME CONFIRMED"as const};}
 async function unknownOriginal(){provider.loseNextSourcePutReply();await failure(putWithReceipt({key,body,contentType:"application/octet-stream",role:"original"},OWNER));const[row]=await db().select().from(mediaObjectWrites);if(!row)throw new Error("Actual original PUT intent missing");expect(row.state).toBe("unknown");expect(row.writerFinishedAt).toBeInstanceOf(Date);return row;}
 it("recovers only the exact actually finished lost-reply PUT through its nonce, full bytes and complete inventories without replacing original return or retrying PUT",async()=>{
  const row=await unknownOriginal(),[before]=await db().select().from(callers).where(eq(callers.objectReceiptId,row.id)),originalRequests=await db().select().from(requests).where(eq(requests.callId,before!.id)),originalFacts=await db().select().from(facts);
  expect(await reconcileStorageOperation.call(confirmation(row),OWNER)).toEqual({ok:true});
  const[after]=await db().select().from(callers).where(eq(callers.id,before!.id)),[recovered]=await db().select().from(mediaObjectWrites).where(eq(mediaObjectWrites.id,row.id));
  expect(after).toMatchObject({id:before!.id,requestDigest:before!.requestDigest,callerTokenDigest:before!.callerTokenDigest,runtimeIdentity:before!.runtimeIdentity,returnedAt:before!.returnedAt,resultDigest:before!.resultDigest,state:"stopped"});expect(recovered).toMatchObject({id:row.id,keyDigest:row.keyDigest,namespace:row.namespace,sha256:row.sha256,bytes:row.bytes,state:"accepted",writerRuntimeId:row.writerRuntimeId,writerFinishedAt:row.writerFinishedAt});
  const[originalRequest]=await db().select().from(requests).where(eq(requests.id,originalRequests[0]!.id));expect(originalRequest).toMatchObject({id:originalRequests[0]!.id,descriptor:originalRequests[0]!.descriptor,descriptorDigest:originalRequests[0]!.descriptorDigest,tokenDigest:originalRequests[0]!.tokenDigest,returnedAt:originalRequests[0]!.returnedAt,state:"stopped"});
  for(const fact of originalFacts)expect((await db().select().from(facts).where(eq(facts.id,fact.id)))[0]).toEqual(fact);
  const[review]=await db().select().from(reviews),[inventory]=await db().select().from(inventories);expect(review).toMatchObject({objectId:null,objectReceiptId:row.id,callId:before!.id,outcome:"applied",permitsRetry:false,stopDrainId:null,inventoryId:inventory!.id});expect(inventory).toMatchObject({planId:null,objectReceiptId:row.id,purpose:"recovery",state:"complete"});expect(inventory?.firstDigest).toBe(inventory?.confirmedDigest);expect(provider.objects.get(`/source/${key}`)?.body).toEqual(body);expect(provider.calls.filter(call=>call.method==="PUT")).toHaveLength(1);expect(provider.calls.filter(call=>call.method==="DELETE")).toHaveLength(0);
 },60000);
 it("settles only the original captured hosted-quota token after actual lost-reply recovery",async()=>{
  vi.stubEnv("FREEHOLDER_STORAGE_QUOTA_BYTES","100");vi.stubEnv("FREEHOLDER_STORAGE_QUOTA_INITIALIZE_EMPTY","false");resetEnvForTests();resetStorageForTests();
  // Actual fictional operator inventory of a fresh empty bucket, before any
  // reservation. This is not the unfinished automatic initializer contract.
  for(const query of ["list-type=2","versions=","uploads="]){const response=await fetch(`${provider.endpoint}/source?${query}`);expect(response.status).toBe(200);expect(await response.text()).toContain("<IsTruncated>false</IsTruncated>");}
  expect(provider.objects.size).toBe(0);const namespace=storageNamespace({id:"s3",endpoint:provider.endpoint,bucket:"source"});await initializeStorageQuota(namespace,100,[],storageInventorySha256([]));
  const row=await unknownOriginal(),[caller]=await db().select().from(callers).where(eq(callers.objectReceiptId,row.id)),[reserved]=await db().select().from(storageQuotaObjects);expect(caller?.quotaToken).toBeTruthy();expect(reserved).toMatchObject({namespace,objectKey:key,bytes:body.byteLength,pendingToken:caller!.quotaToken,lastSettledToken:null});
  expect(await reconcileStorageOperation.call(confirmation(row),OWNER)).toEqual({ok:true});expect((await db().select().from(storageQuotaObjects))[0]).toMatchObject({namespace,objectKey:key,bytes:body.byteLength,pendingToken:null,lastSettledToken:caller!.quotaToken});expect(provider.calls.filter(call=>call.method==="PUT")).toHaveLength(1);expect(provider.calls.filter(call=>call.method==="DELETE")).toHaveLength(0);
 },60000);
 it("refuses equal current bytes with another original nonce without changing the original receipt/caller or retrying/deleting",async()=>{
  const row=await unknownOriginal(),[before]=await db().select().from(callers).where(eq(callers.objectReceiptId,row.id));provider.originalRequestTags.set(`/source/${key}`,{id:randomUUID(),token:"fictional-unrelated-later-request-token"});
  expect((await failure(reconcileStorageOperation.call(confirmation(row),OWNER))).code).toBe("conflict");expect((await db().select().from(mediaObjectWrites).where(eq(mediaObjectWrites.id,row.id)))[0]).toEqual(row);expect((await db().select().from(callers).where(eq(callers.id,before!.id)))[0]).toEqual(before);expect(await db().select().from(reviews)).toEqual([]);expect(await db().select().from(inventories)).toEqual([]);expect(provider.objects.get(`/source/${key}`)?.body).toEqual(body);expect(provider.calls.filter(call=>call.method==="PUT")).toHaveLength(1);expect(provider.calls.filter(call=>call.method==="DELETE")).toHaveLength(0);
 },60000);
 it("refuses a still-active actual original caller before fresh provider requests even with written stopped-writer evidence",async()=>{
  const gate=provider.pauseNextSourcePut(),writing=putWithReceipt({key,body,contentType:"application/octet-stream",role:"original"},OWNER);running.push(writing);await gate.started;const[row]=await db().select().from(mediaObjectWrites),before=provider.calls.length;
  expect((await failure(reconcileStorageOperation.call(confirmation(row!),OWNER))).code).toBe("conflict");expect(provider.calls.length).toBe(before);expect(await db().select().from(reviews)).toEqual([]);expect(await db().select().from(inventories)).toEqual([]);expect((await db().select().from(mediaObjectWrites))[0]).toEqual(row);expect(provider.objects.size).toBe(0);gate.release();await writing;
 },60000);
});
