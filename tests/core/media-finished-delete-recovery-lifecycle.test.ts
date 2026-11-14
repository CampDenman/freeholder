// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// PREPARED / UNRUN. Actual shared provider path plus a narrowly scoped real
// local commit fault after genuine DELETE ACK; no authorization/context mock.
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from "vitest";
import {eq,sql} from "drizzle-orm";
import {db} from "@/core/db";
import {ready} from "@/core/runtime";
import {stopJobs} from "@/core/jobs";
import {resetEnvForTests} from "@/core/env";
import {resetStorageForTests} from "@/adapters/storage";
import {putWithReceipt,deleteWithReceipt} from "@/core/media/write-ledger";
import {mediaObjectWrites} from "@/core/media/write-schema";
import {mediaStorageTransferCalls as calls,mediaStorageTransferReviews as reviews} from "@/core/media/transfer-schema";
import {mediaStorageTransferRequests as requests,mediaStorageTransferRequestObservations as facts} from "@/core/media/transfer-request-schema";
import {ordinaryMediaRetirementProvider} from "../helpers/media-original-retirement-provider";
import {closeDb,failure,hasDatabase,truncateSpine} from "../helpers/spine";
const SYSTEM={kind:"system"}as const,key="finished-delete/original.bin",body=new TextEncoder().encode("original acknowledged delete bytes");
describe.runIf(hasDatabase)("actual acknowledged DELETE finish recovery (complete request capability dependent)",()=>{
 let provider:Awaited<ReturnType<typeof ordinaryMediaRetirementProvider>>;
 beforeAll(async()=>{await ready();await stopJobs();const[capability]=await db().execute<{present:boolean}>(sql`select to_regprocedure('freeholder_media_transfer_request_capability_v1()') is not null as present`);if(capability?.present!==true)throw Error("Prepared acknowledged DELETE recovery requires complete real request protocol; no fixture capability is enabled.");},60000);
 beforeEach(async()=>{await truncateSpine();provider=await ordinaryMediaRetirementProvider();for(const[name,value]of Object.entries({NODE_ENV:"test",FREEHOLDER_STORAGE:"s3",S3_ENDPOINT:provider.endpoint,S3_REGION:"fixture",S3_BUCKET:"source",S3_ACCESS_KEY_ID:"synthetic",S3_SECRET_ACCESS_KEY:"synthetic",FREEHOLDER_STORAGE_QUOTA_BYTES:""}))vi.stubEnv(name,value);resetEnvForTests();resetStorageForTests();});
 afterEach(async()=>{await provider?.close();vi.unstubAllEnvs();resetEnvForTests();resetStorageForTests();});afterAll(closeDb);
 it("keeps the actual first failed local return/ACK and closes only fresh full physical proof with exactly one DELETE",async()=>{
  await putWithReceipt({key,body,contentType:"application/octet-stream",role:"original"},SYSTEM);
  // New test-only function/trigger names, never replacement of a product
  // guard. This fault rejects only successful ordinary DELETE local outcome
  // retention, after its actual physical ACK/finish have committed. The real
  // owning closure then records its first failure and actual caller finish.
  await db().execute(sql`create function freeholder_test_finished_delete_commit_fault() returns trigger language plpgsql as $$ begin if NEW.kind='ordinary_delete' and NEW.state='returned' and NEW.result_digest=freeholder_media_transfer_fact_digest(jsonb_build_object('accepted',true)) then raise exception 'Synthetic local commit fault after actual DELETE ACK' using errcode='23514'; end if; return NEW; end $$`);
  try{
   await db().execute(sql`create trigger test_finished_delete_commit_fault before update on media_storage_transfer_calls for each row execute function freeholder_test_finished_delete_commit_fault()`);
   await failure(deleteWithReceipt(key));const writes=await db().select().from(mediaObjectWrites),deletion=writes.find(row=>row.operation==="delete")!,[originalCaller]=await db().select().from(calls).where(eq(calls.objectReceiptId,deletion.id));expect(originalCaller).toMatchObject({state:"unknown"});expect(originalCaller?.returnedAt).toBeTruthy();expect(originalCaller?.observedAcceptedAt).toBeTruthy();expect(deletion.writerFinishedAt).toBeTruthy();const originalRequests=await db().select().from(requests).where(eq(requests.callId,originalCaller!.id)),originalFacts=await db().select().from(facts).where(eq(facts.requestId,originalRequests[0]!.id));expect(originalRequests).toHaveLength(1);expect(originalRequests[0]?.returnedAt).toBeTruthy();expect(originalFacts.some(row=>row.facts.stage==="accepted"&&row.facts.status===204)).toBe(true);expect(provider.calls.filter(row=>row.method==="DELETE")).toHaveLength(1);expect(provider.objects.has(`/source/${key}`)).toBe(false);
   expect(await deleteWithReceipt(key)).toBe(true);expect(provider.calls.filter(row=>row.method==="DELETE")).toHaveLength(1);const[after]=await db().select().from(calls).where(eq(calls.id,originalCaller!.id));expect(after).toMatchObject({id:originalCaller!.id,state:"stopped",returnedAt:originalCaller!.returnedAt,resultDigest:originalCaller!.resultDigest,observedAcceptedAt:originalCaller!.observedAcceptedAt,callerTokenDigest:originalCaller!.callerTokenDigest,runtimeIdentity:originalCaller!.runtimeIdentity});expect(await db().select().from(requests).where(eq(requests.callId,originalCaller!.id))).toEqual(originalRequests);expect(await db().select().from(facts).where(eq(facts.requestId,originalRequests[0]!.id))).toEqual(originalFacts);expect((await db().select().from(mediaObjectWrites)).every(row=>row.deletedAt&&row.writerFinishedAt)).toBe(true);const[review]=await db().select().from(reviews).where(eq(reviews.callId,originalCaller!.id));expect(review).toMatchObject({objectReceiptId:deletion.id,outcome:"retired",stopDrainId:null,permitsRetry:false,reviewedBy:"system:media-cleanup"});expect(review?.inventoryId).toBeTruthy();expect(review?.readCallId).toBeTruthy();
  }finally{await db().execute(sql`drop trigger if exists test_finished_delete_commit_fault on media_storage_transfer_calls`);await db().execute(sql`drop function freeholder_test_finished_delete_commit_fault()`);}
 },60000);
});
