// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// PREPARED / UNRUN. These real shared-infrastructure/TCP controls depend on the
// complete future request capability. They NEVER publish a fixture capability,
// fabricate a ServiceContext/old caller birth or claim actual account support.
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from "vitest";
import {randomUUID} from "node:crypto";
import {eq,sql} from "drizzle-orm";
import {db} from "@/core/db";
import {users} from "@/core/auth/schema";
import {createContact} from "@/core/contacts/service";
import {reconcileStorageOperation} from "@/core/media/write-recovery";
import {createDataRequest,verifyDataRequest,addRetentionException} from "@/core/privacy/service";
import {ready} from "@/core/runtime";
import {stopJobs} from "@/core/jobs";
import {resetEnvForTests} from "@/core/env";
import {resetStorageForTests} from "@/adapters/storage";
import {putWithReceipt,deleteWithReceipt,objectKeyDigest} from "@/core/media/write-ledger";
import {mediaObjects} from "@/core/media/schema";
import {mediaObjectWrites} from "@/core/media/write-schema";
import {minimizeMediaStorageOperations} from "@/core/media/write-privacy";
import {lockTransferInventory} from "@/core/media/transfer-authority";
import {mediaStorageTransferReviews as reviews} from "@/core/media/transfer-schema";
import {mediaStorageTransferCalls as calls} from "@/core/media/transfer-schema";
import {mediaStorageTransferRequests as requests} from "@/core/media/transfer-request-schema";
import {monotonicDeleteProvider} from "../helpers/media-monotonic-delete-provider";
import {closeDb,failure,hasDatabase,OWNER,truncateSpine} from "../helpers/spine";
const SYSTEM={kind:"system"}as const,key="original-retirement/exact.bin",body=new TextEncoder().encode("exact original physical bytes");
describe.runIf(hasDatabase)("monotonic original DELETE recovery (complete request capability dependent)",()=>{
 let provider:Awaited<ReturnType<typeof monotonicDeleteProvider>>;
 beforeAll(async()=>{await ready();await stopJobs();const[capability]=await db().execute<{present:boolean}>(sql`select to_regprocedure('freeholder_media_transfer_request_capability_v1()') is not null as present`);if(capability?.present!==true)throw Error("Prepared ordinary retirement controls require the complete actual request capability; no fixture flag or provider authority is substituted.");},60000);
 beforeEach(async()=>{await truncateSpine();provider=await monotonicDeleteProvider();for(const[name,value]of Object.entries({NODE_ENV:"test",FREEHOLDER_STORAGE:"s3",S3_ENDPOINT:provider.endpoint,S3_REGION:"fixture",S3_BUCKET:"source",S3_ACCESS_KEY_ID:"synthetic",S3_SECRET_ACCESS_KEY:"synthetic",FREEHOLDER_STORAGE_QUOTA_BYTES:"",FREEHOLDER_STORAGE_QUOTA_INITIALIZE_EMPTY:"false"}))vi.stubEnv(name,value);resetEnvForTests();resetStorageForTests();});
 afterEach(async()=>{await provider?.close();vi.unstubAllEnvs();resetEnvForTests();resetStorageForTests();});afterAll(closeDb);
 const write=()=>putWithReceipt({key,body,contentType:"application/octet-stream",role:"original"},SYSTEM);
 const history=()=>db().select().from(mediaObjectWrites).where(eq(mediaObjectWrites.key,key));
 const lose=async()=>{await write();provider.loseNextDeleteReply();await failure(deleteWithReceipt(key));const rows=await history(),deletion=rows.find(row=>row.operation==="delete"),caller=(await db().select().from(calls)).find(row=>row.objectReceiptId===deletion?.id&&row.kind==="ordinary_delete");if(!deletion||!caller)throw Error("Actual original lost-DELETE-response evidence missing");expect(caller.observedAcceptedAt).toBeNull();expect(deletion.observedAcceptedAt).toBeNull();expect(caller.returnedAt).toBeInstanceOf(Date);expect(deletion.writerFinishedAt).toBeInstanceOf(Date);expect(provider.calls.filter(row=>row.method==="DELETE")).toHaveLength(1);expect(provider.objects.has(`/source/${key}`)).toBe(false);return{rows,deletion,caller};};
 it("verifies monotonic byte removal without another DELETE, provider ACK or replacement of the actual first failure",async()=>{
  const first=await lose(),physicalBefore=await db().select().from(requests).where(eq(requests.callId,first.caller.id));expect(await deleteWithReceipt(key)).toBe(true);const[actual]=await db().select().from(calls).where(eq(calls.id,first.caller.id)),physicalAfter=await db().select().from(requests).where(eq(requests.callId,first.caller.id));expect(actual).toMatchObject({state:"stopped",observedAcceptedAt:null,returnedAt:first.caller.returnedAt,resultDigest:first.caller.resultDigest,physicalReceiptId:first.caller.physicalReceiptId,runtimeId:first.caller.runtimeId});expect(actual?.stopReceiptId).toBeTruthy();for(const before of physicalBefore){const after=physicalAfter.find(row=>row.id===before.id);expect(after).toMatchObject({descriptorDigest:before.descriptorDigest,tokenDigest:before.tokenDigest,returnedAt:before.returnedAt,runtimeIdentity:before.runtimeIdentity});}expect((await history()).find(row=>row.id===first.deletion.id)).toMatchObject({state:"confirmed_absent",observedAcceptedAt:null,writerFinishedAt:first.deletion.writerFinishedAt});expect((await history()).every(row=>row.deletedAt)).toBe(true);expect(provider.calls.filter(row=>row.method==="DELETE")).toHaveLength(1);expect(await db().select().from(mediaObjects)).toEqual([]);
  const[proof]=await db().execute<{review:boolean;retired:boolean}>(sql`select freeholder_media_original_monotonic_delete_review(${first.caller.id}::uuid) as review,freeholder_media_original_reservation_retired(${first.deletion.originalReservationId}::uuid) as retired`);expect(proof).toEqual({review:true,retired:true});
 },60000);
 it("keeps permanent namespace/key fencing after raw-key minimization and independently refuses a new reservation's forged physical PUT even with writer flags",async()=>{
  const first=await lose();expect(await deleteWithReceipt(key)).toBe(true);await db().transaction(async tx=>{await lockTransferInventory(tx);expect(await minimizeMediaStorageOperations(tx,first.rows.map(row=>row.id))).toBe(first.rows.length);});const before=await db().select().from(mediaObjectWrites),count=provider.calls.length;expect(before.every(row=>row.redactedAt&&row.key===`retained:${objectKeyDigest(key)}`)).toBe(true);
  const[scope]=await db().execute<{same:boolean;different:boolean;retired:boolean}>(sql`select freeholder_media_original_key_recreation_fenced(${first.deletion.namespace},${objectKeyDigest(key)}) as same,freeholder_media_original_key_recreation_fenced(${'f'.repeat(64)},${objectKeyDigest(key)}) as different,freeholder_media_original_reservation_retired(${first.deletion.originalReservationId}::uuid) as retired`);expect(scope).toEqual({same:true,different:false,retired:true});
  expect(await failure(db().transaction(async tx=>{await lockTransferInventory(tx);const[pointer]=await tx.insert(mediaObjects).values({key,role:"original",state:"pending",bytes:body.byteLength,contentType:"application/octet-stream"}).returning();return tx.insert(mediaObjectWrites).values({id:randomUUID(),originalReservationId:pointer!.reservationId,key,keyDigest:objectKeyDigest(key),operation:"put",namespace:first.deletion.namespace,storageKind:first.deletion.storageKind,storageLocation:first.deletion.storageLocation,sha256:first.deletion.sha256,bytes:body.byteLength,contentType:first.deletion.contentType,actor:"system:negative-tombstone-forgery",state:"started",writerRuntimeId:first.deletion.writerRuntimeId,writerProtocol:"single-put-v1"});}))).toMatchObject({cause:{code:"23514",message:expect.stringContaining("permanent original namespace/key")}});expect(await db().select().from(mediaObjectWrites)).toEqual(before);expect(await db().select().from(mediaObjects)).toEqual([]);expect(provider.calls.length).toBe(count);expect(provider.objects.has(`/source/${key}`)).toBe(false);
 },60000);
 for(const kind of ["version","session"]as const)it(`refuses logical404 after lost DELETE when retained original ${kind} bytes remain`,async()=>{
  const first=await lose();if(kind==="version")provider.retainedVersions.set("retained-after-delete",{key:`/source/${key}`,body:new Uint8Array(body),etag:'"retained-original"'});else provider.sessions.set("retained-after-delete",{key:`/source/${key}`,body:new Uint8Array(body)});
  expect((await fetch(`${provider.endpoint}/source/${key}`,{method:"HEAD"})).status).toBe(404);await failure(deleteWithReceipt(key));expect(await history()).toEqual(first.rows);expect(provider.calls.filter(row=>row.method==="DELETE")).toHaveLength(1);expect(await db().select().from(reviews)).toEqual([]);expect((kind==="version"?[...provider.retainedVersions.values()]:[...provider.sessions.values()])[0]?.body).toEqual(body);
 },60000);
 it("uses the existing fresh-person recovery service for only the selected original DELETE and refuses not-applied without provider I/O",async()=>{
  const first=await lose();if(!first.deletion.namespace)throw Error("Actual original namespace missing");await db().insert(users).values({id:OWNER.userId,email:"monotonic-recovery-owner@example.test",role:"owner"});const input={id:first.deletion.id,expectedUpdatedAt:first.deletion.updatedAt.toISOString(),originalNamespace:first.deletion.namespace,outcome:"applied"as const,providerFinalReference:"fictional-original-conditional-removal",providerEvidence:"Actual fictional TCP pinned absence plus complete two-pass original version/session inventory.",stoppedWriterEvidence:"Actual original local finishes are retained; this text supplies no independent stop or remote ACK.",confirmation:"ORIGINAL STORAGE OUTCOME CONFIRMED"as const},count=provider.calls.length;
  expect((await failure(reconcileStorageOperation.call({...input,outcome:"not_applied"},OWNER))).code).toBe("conflict");expect(provider.calls.length).toBe(count);expect(await history()).toEqual(first.rows);expect(await reconcileStorageOperation.call(input,OWNER)).toEqual({ok:true});expect(provider.calls.filter(row=>row.method==="DELETE")).toHaveLength(1);expect((await db().select().from(calls).where(eq(calls.id,first.caller.id)))[0]).toMatchObject({resultDigest:first.caller.resultDigest,returnedAt:first.caller.returnedAt,observedAcceptedAt:null,state:"stopped"});expect((await history()).every(row=>row.deletedAt)).toBe(true);
 },60000);
 it("preserves the exact original failed removal under a later genuine named hold and performs no additional DELETE",async()=>{
  const first=await lose();await db().insert(users).values({id:OWNER.userId,email:"monotonic-hold-owner@example.test",role:"owner"});const contact=await createContact.call({name:"Original hold subject",email:"monotonic-held@example.test"},OWNER),request=await createDataRequest.call({contactId:contact.id,request:{kind:"erasure"}},OWNER);await verifyDataRequest.call({id:request.id,method:"Fictional independently verified subject"},OWNER);await addRetentionException.call({dataRequestId:request.id,scope:"media.storageOperations",reason:"legal_claim",legalBasis:"Synthetic named original preservation control"},OWNER);expect((await failure(deleteWithReceipt(key))).message).toContain("named hold");expect(await history()).toEqual(first.rows);expect(provider.calls.filter(row=>row.method==="DELETE")).toHaveLength(1);expect(await db().select().from(reviews)).toEqual([]);
 },60000);
});
