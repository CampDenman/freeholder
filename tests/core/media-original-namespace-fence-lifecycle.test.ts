// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// PREPARED / UNRUN: actual shared admission/factory + synthetic private TCP.
// Capture-only drain rows claim NO executor stop or provider/account support.
// Full real capability is required; tests never publish a fixture capability.
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from "vitest";
import {randomUUID} from "node:crypto";
import {eq,sql} from "drizzle-orm";
import {boundStorage,resetStorageForTests} from "@/adapters/storage";
import {db} from "@/core/db";
import {users} from "@/core/auth/schema";
import {ready} from "@/core/runtime";
import {stopJobs} from "@/core/jobs";
import {resetEnvForTests} from "@/core/env";
import {actorString} from "@/core/service";
import {putWithReceipt} from "@/core/media/write-ledger";
import {mediaObjectWrites} from "@/core/media/write-schema";
import {mediaStorageWriterDrains,mediaStorageTransferCalls as calls,mediaStorageTransferObjects as objects} from "@/core/media/transfer-schema";
import {mediaStorageTransferRequests as requests} from "@/core/media/transfer-request-schema";
import {admitOriginalMediaCaller,retainOriginalMediaCallerReturn} from "@/core/media/provider-callers";
import {actualStorageCallerRuntimeIdentity,mediaWriterRuntimeId} from "@/core/media/physical-caller-runtime";
import {lockTransferInventory} from "@/core/media/transfer-authority";
import {configuredOriginalRequestStore} from "@/core/media/transfer-storage";
import {withTransferRequestScope} from "@/core/media/transfer-requests";
import {transferDigest} from "@/core/media/transfer-proof";
import {planStorageTransfer,advanceStorageTransfer} from "@/core/media/transfer-service";
import {ordinaryMediaRetirementProvider} from "../helpers/media-original-retirement-provider";
import {closeDb,failure,hasDatabase,OWNER,truncateSpine} from "../helpers/spine";
const key="original/fenced.bin",body=new TextEncoder().encode("original namespace fence bytes");
describe.runIf(hasDatabase)("ordinary logical and physical namespace fences (complete request capability dependent)",()=>{
 let provider:Awaited<ReturnType<typeof ordinaryMediaRetirementProvider>>;
 beforeAll(async()=>{await ready();await stopJobs();const[capability]=await db().execute<{present:boolean}>(sql`select to_regprocedure('freeholder_media_transfer_request_capability_v1()') is not null as present`);if(capability?.present!==true)throw Error("Prepared namespace mutation controls require the complete actual protocol; no fixture capability is published.");},60000);
 beforeEach(async()=>{await truncateSpine();await db().insert(users).values({id:OWNER.userId,email:"fenced-owner@example.test",role:"owner"});provider=await ordinaryMediaRetirementProvider();for(const[name,value]of Object.entries({NODE_ENV:"test",FREEHOLDER_STORAGE:"s3",S3_ENDPOINT:provider.endpoint,S3_REGION:"fixture",S3_BUCKET:"source",S3_ACCESS_KEY_ID:"synthetic",S3_SECRET_ACCESS_KEY:"synthetic",FREEHOLDER_STORAGE_QUOTA_BYTES:"",FREEHOLDER_STORAGE_QUOTA_INITIALIZE_EMPTY:"false",MEDIA_TRANSFER_TARGET_QUOTA_BYTES:"",MEDIA_TRANSFER_TARGET_STORAGE:"s3",MEDIA_TRANSFER_TARGET_S3_ENDPOINT:provider.endpoint,MEDIA_TRANSFER_TARGET_S3_REGION:"fixture",MEDIA_TRANSFER_TARGET_S3_BUCKET:"target",MEDIA_TRANSFER_TARGET_S3_ACCESS_KEY_ID:"synthetic",MEDIA_TRANSFER_TARGET_S3_SECRET_ACCESS_KEY:"synthetic"}))vi.stubEnv(name,value);resetEnvForTests();resetStorageForTests();});
 afterEach(async()=>{provider?.releaseAll();await provider?.close();vi.unstubAllEnvs();resetEnvForTests();resetStorageForTests();});afterAll(closeDb);
 const write=(physicalKey=key)=>putWithReceipt({key:physicalKey,body,contentType:"application/octet-stream",role:"original"},OWNER);
 async function captureDrain(namespace:string){return db().transaction(async tx=>{await tx.execute(sql`select pg_advisory_xact_lock(1691709,82)`);await tx.execute(sql`select set_config('freeholder.media_transfer_operator_v1','1',true)`);const[row]=await tx.insert(mediaStorageWriterDrains).values({namespace,state:"capturing",sourceRevision:"e".repeat(40),executorIdentity:"synthetic-capture-only:no-stop-or-kernel-proof"}).returning();return row!;});}
 async function source(){const captured=await boundStorage();return{...captured,rows:await db().select().from(mediaObjectWrites)};}
 // This is a real new guarded infrastructure admission, not a historical seed
 // or fake ServiceContext. Its actual private token stays in this invocation.
 async function admitNewSameKey(){const original=(await db().select().from(mediaObjectWrites))[0];if(!original?.originalReservationId)throw Error("Actual original PUT is required.");const token=randomUUID()+randomUUID(),runtimeIdentity=await actualStorageCallerRuntimeIdentity();return db().transaction(async tx=>{await lockTransferInventory(tx);const id=randomUUID();await tx.insert(mediaObjectWrites).values({id,originalReservationId:original.originalReservationId,operation:"put",key:original.key,keyDigest:original.keyDigest,namespace:original.namespace,storageKind:original.storageKind,storageLocation:original.storageLocation,sha256:original.sha256,bytes:original.bytes,contentType:original.contentType,actor:actorString(OWNER),contactId:original.contactId,state:"started",writerRuntimeId:mediaWriterRuntimeId});const call=await admitOriginalMediaCaller(tx,{kind:"ordinary_put",objectReceiptId:id,token,runtimeIdentity},OWNER);return{callId:call.id,token,runtimeIdentity,original};});}
 it("refuses a cold actual ordinary writer under a captured drain without provider I/O or a new birth",async()=>{
  await write();const original=await source();await captureDrain(original.binding.namespace);const before=await db().select().from(calls),count=provider.calls.length;expect((await failure(write("original/later.bin"))).message).toContain("fenced");expect(await db().select().from(mediaObjectWrites)).toEqual(original.rows);expect(await db().select().from(calls)).toEqual(before);expect(provider.calls.length).toBe(count);expect(provider.objects.get(`/source/${key}`)?.body).toEqual(body);
 },60000);
 it("refuses a same-key parent forged with the shared full-writer flag when no genuine transfer caller is born with it",async()=>{
  await write();const original=await source(),row=original.rows[0]!;await captureDrain(original.binding.namespace);const count=provider.calls.length;
  const refused=await failure(db().transaction(async tx=>{await lockTransferInventory(tx);await tx.execute(sql`select set_config('freeholder.media_transfer_v1','1',true)`);return tx.insert(mediaObjectWrites).values({originalReservationId:row.originalReservationId,operation:"put",key,keyDigest:row.keyDigest,namespace:row.namespace,storageKind:row.storageKind,storageLocation:row.storageLocation,sha256:row.sha256,bytes:row.bytes,contentType:row.contentType,actor:actorString(OWNER),state:"started",writerRuntimeId:mediaWriterRuntimeId});}));expect(refused).toMatchObject({cause:{code:"23514"}});expect(await db().select().from(mediaObjectWrites)).toEqual(original.rows);expect(provider.calls.length).toBe(count);
 },60000);
 it("fences both raw-SQL and real factory mutation children of a warm caller admitted before capture, without forbidding GET recovery",async()=>{
  await write();const original=await source(),warm=await admitNewSameKey();await captureDrain(original.binding.namespace);const count=provider.calls.length,descriptor={kind:"object.put"as const,binding:original.binding,key,createOnly:true,sha256:warm.original.sha256!,bytes:body.byteLength};
  const refused=await failure(db().transaction(async tx=>{await lockTransferInventory(tx);return tx.insert(requests).values({callId:warm.callId,descriptor,keyDigest:warm.original.keyDigest,descriptorDigest:transferDigest(descriptor),tokenDigest:transferDigest(randomUUID()+randomUUID()),runtimeIdentity:warm.runtimeIdentity});}));expect(refused).toMatchObject({cause:{code:"23514"}});
  const store=await configuredOriginalRequestStore(original.binding);expect((await failure(withTransferRequestScope(warm,()=>store.put(key,body,"application/octet-stream")))).message).toContain("fenced");expect((await db().select().from(requests)).filter(row=>row.callId===warm.callId)).toEqual([]);expect(provider.calls.length).toBe(count);await retainOriginalMediaCallerReturn(warm.callId,warm.token,{notAttempted:true});
  const token=randomUUID()+randomUUID(),runtimeIdentity=await actualStorageCallerRuntimeIdentity(),read=await db().transaction(async tx=>{await lockTransferInventory(tx);return admitOriginalMediaCaller(tx,{kind:"ordinary_recovery_read",objectReceiptId:warm.original.id,token,runtimeIdentity,expectedRevision:warm.original.providerRevision!},OWNER);});const result=await withTransferRequestScope({callId:read.id,token,runtimeIdentity},()=>store.readVersioned(key,warm.original.providerRevision!));expect(result?.body).toEqual(body);await retainOriginalMediaCallerReturn(read.id,token,{accepted:true,revision:result!.revision,sha256:warm.original.sha256!,bytes:body.byteLength,requestProof:result!.requestProof});
 },60000);
 it("refuses same-key ordinary logical admission under an actual immutable active source transfer claim",async()=>{
  await write();const claimed=await planStorageTransfer.call({requestKey:randomUUID(),confirmation:"COPY ADOPT AND RETIRE ORIGINAL STORAGE"},OWNER),before=await db().select().from(mediaObjectWrites),count=provider.calls.length;expect((await failure(admitNewSameKey())).message).toContain("fenced");expect(await db().select().from(mediaObjectWrites)).toEqual(before);expect(provider.calls.length).toBe(count);expect(claimed.id).toBeTruthy();
 },60000);
 it("permits the actual matching transfer caller ancestry to conditionally retire its fenced source after verified copy and adoption",async()=>{
  await write();const claimed=await planStorageTransfer.call({requestKey:randomUUID(),confirmation:"COPY ADOPT AND RETIRE ORIGINAL STORAGE"},OWNER);await advanceStorageTransfer.call({id:claimed.id,action:"copy"},OWNER);await advanceStorageTransfer.call({id:claimed.id,action:"adopt"},OWNER);const finished=await advanceStorageTransfer.call({id:claimed.id,action:"retire"},OWNER),[object]=await db().select().from(objects);expect(finished.state).toBe("complete");expect(provider.objects.has(`/source/${key}`)).toBe(false);expect(provider.objects.get(`/target/${object!.targetKey}`)?.body).toEqual(body);const deletes=provider.calls.filter(row=>row.method==="DELETE");expect(deletes).toHaveLength(1);expect(deletes[0]?.condition).toBeTruthy();
 },60000);
 it("retains a genuine already-dispatched late PUT after capture and refuses a mismatched later physical child without erasing its original facts",async()=>{
  const gate=provider.pauseNextSourcePut(),writing=write();try{await gate.started;const captured=await boundStorage();await captureDrain(captured.binding.namespace);}finally{gate.release();await writing;}
  const before=await db().select().from(mediaObjectWrites),original=before[0]!,allCalls=await db().select().from(calls),actual=allCalls.find(row=>row.kind==="ordinary_put")!,beforeRequests=await db().select().from(requests),count=provider.calls.length;expect(original).toMatchObject({state:"accepted",deletedAt:null});expect(original.writerFinishedAt).toBeTruthy();expect(actual.returnedAt).toBeTruthy();expect(provider.objects.get(`/source/${key}`)?.body).toEqual(body);
  const captured=await boundStorage(),descriptor={kind:"object.put"as const,binding:{...captured.binding,namespace:"f".repeat(64)},key:"other/current-generation.bin",createOnly:true,sha256:original.sha256!,bytes:body.byteLength};const refused=await failure(db().transaction(async tx=>{await lockTransferInventory(tx);return tx.insert(requests).values({callId:actual.id,descriptor,descriptorDigest:transferDigest(descriptor),tokenDigest:transferDigest(randomUUID()+randomUUID()),runtimeIdentity:actual.runtimeIdentity});}));expect(refused).toMatchObject({cause:{code:"23514"}});expect(await db().select().from(mediaObjectWrites)).toEqual(before);expect(await db().select().from(requests)).toEqual(beforeRequests);expect(await db().select().from(calls)).toEqual(allCalls);expect(provider.calls.length).toBe(count);
 },60000);
});
