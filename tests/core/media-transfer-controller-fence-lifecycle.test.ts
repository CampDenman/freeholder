// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// PREPARED / UNRUN. Real shared admissions and synthetic private provider;
// capture-only drains claim no real process stop. No fixture capability.
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from "vitest";
import {randomUUID} from "node:crypto";
import {eq,sql} from "drizzle-orm";
import {db} from "@/core/db";
import {users} from "@/core/auth/schema";
import {ready} from "@/core/runtime";
import {stopJobs} from "@/core/jobs";
import {resetEnvForTests} from "@/core/env";
import {resetStorageForTests} from "@/adapters/storage";
import {putWithReceipt} from "@/core/media/write-ledger";
import {mediaObjectWrites} from "@/core/media/write-schema";
import {mediaStorageTransferCalls as calls,mediaStorageTransferObjects as objects,mediaStorageTransferPlans as plans,mediaStorageWriterDrains as drains} from "@/core/media/transfer-schema";
import {mediaStorageTransferRequests as requests} from "@/core/media/transfer-request-schema";
import {planStorageTransfer} from "@/core/media/transfer-service";
import {admitTransferCall,transferRuntimeIdentity} from "@/core/media/transfer-callers";
import {configuredTransferStores} from "@/core/media/transfer-storage";
import {withTransferRequestScope} from "@/core/media/transfer-requests";
import {lockTransferInventory} from "@/core/media/transfer-authority";
import {transferDigest} from "@/core/media/transfer-proof";
import {ordinaryMediaRetirementProvider} from "../helpers/media-original-retirement-provider";
import {closeDb,failure,hasDatabase,OWNER,truncateSpine} from "../helpers/spine";
const key="original/controller.bin",body=new TextEncoder().encode("exact original controller bytes");
describe.runIf(hasDatabase)("genuine transfer caller across later namespace controllers (full request capability dependent)",()=>{
 let provider:Awaited<ReturnType<typeof ordinaryMediaRetirementProvider>>;
 beforeAll(async()=>{await ready();await stopJobs();const[capability]=await db().execute<{present:boolean}>(sql`select to_regprocedure('freeholder_media_transfer_request_capability_v1()') is not null as present`);if(capability?.present!==true)throw Error("Prepared controller controls require complete actual protocol; no fixture flag is substituted.");},60000);
 beforeEach(async()=>{await truncateSpine();await db().insert(users).values({id:OWNER.userId,email:"controller-owner@example.test",role:"owner"});provider=await ordinaryMediaRetirementProvider();for(const[name,value]of Object.entries({NODE_ENV:"test",FREEHOLDER_STORAGE:"s3",S3_ENDPOINT:provider.endpoint,S3_REGION:"fixture",S3_BUCKET:"source",S3_ACCESS_KEY_ID:"synthetic",S3_SECRET_ACCESS_KEY:"synthetic",FREEHOLDER_STORAGE_QUOTA_BYTES:"",MEDIA_TRANSFER_TARGET_QUOTA_BYTES:"",MEDIA_TRANSFER_TARGET_STORAGE:"s3",MEDIA_TRANSFER_TARGET_S3_ENDPOINT:provider.endpoint,MEDIA_TRANSFER_TARGET_S3_REGION:"fixture",MEDIA_TRANSFER_TARGET_S3_BUCKET:"target",MEDIA_TRANSFER_TARGET_S3_ACCESS_KEY_ID:"synthetic",MEDIA_TRANSFER_TARGET_S3_SECRET_ACCESS_KEY:"synthetic"}))vi.stubEnv(name,value);resetEnvForTests();resetStorageForTests();await putWithReceipt({key,body,contentType:"application/octet-stream",role:"original"},OWNER);});
 afterEach(async()=>{await provider?.close();vi.unstubAllEnvs();resetEnvForTests();resetStorageForTests();});afterAll(closeDb);
 async function admittedTarget(){const plan=await planStorageTransfer.call({requestKey:randomUUID(),confirmation:"COPY ADOPT AND RETIRE ORIGINAL STORAGE"},OWNER),[object]=await db().select().from(objects).where(eq(objects.planId,plan.id));if(!object)throw Error("Actual first plan object is missing.");const token=randomUUID()+randomUUID(),runtimeIdentity=await transferRuntimeIdentity(),call=await db().transaction(tx=>admitTransferCall(tx,{planId:plan.id,objectId:object.id,kind:"target_put",token,runtimeIdentity},OWNER));return{plan,object,callId:call.id,token,runtimeIdentity};}
 it("refuses both SQL and actual-factory children of an authentic pre-admitted plan A target PUT after a new unrelated target-namespace drain",async()=>{
  const admission=await admittedTarget(),{target}=await configuredTransferStores(),before=await db().select().from(calls),writes=await db().select().from(mediaObjectWrites),beforeRequests=await db().select().from(requests),count=provider.calls.length;
  await db().transaction(async tx=>{await tx.execute(sql`select pg_advisory_xact_lock(1691709,82)`);await tx.execute(sql`select set_config('freeholder.media_transfer_operator_v1','1',true)`);await tx.insert(drains).values({namespace:target.binding.namespace,state:"capturing",sourceRevision:"e".repeat(40),executorIdentity:"synthetic-capture-only:not-a-stop-proof"});});
  const[control]=await db().execute<{allowed:boolean}>(sql`select freeholder_media_transfer_namespace_control(${admission.object.id}::uuid,${target.binding.namespace},'target_put') as allowed`);expect(control?.allowed).toBe(false);
  const descriptor={kind:"object.put"as const,binding:target.binding,key:admission.object.targetKey,createOnly:true,sha256:admission.object.sha256,bytes:admission.object.bytes};const refused=await failure(db().transaction(async tx=>{await lockTransferInventory(tx);return tx.insert(requests).values({callId:admission.callId,descriptor,keyDigest:admission.object.targetKeyDigest,descriptorDigest:transferDigest(descriptor),tokenDigest:transferDigest(randomUUID()+randomUUID()),runtimeIdentity:admission.runtimeIdentity});}));expect(refused).toMatchObject({cause:{code:"23514"}});
  expect((await failure(withTransferRequestScope({callId:admission.callId,token:admission.token,runtimeIdentity:admission.runtimeIdentity},()=>target.put(admission.object.targetKey,body,"application/octet-stream")))).message).toContain("executor drain");expect(await db().select().from(calls)).toEqual(before);expect(await db().select().from(mediaObjectWrites)).toEqual(writes);expect(await db().select().from(requests)).toEqual(beforeRequests);expect(provider.calls.length).toBe(count);expect(provider.objects.has(`/target/${admission.object.targetKey}`)).toBe(false);expect(provider.objects.get(`/source/${key}`)?.body).toEqual(body);
 },60000);
 it("refuses genuine plan B source capture while plan A still owns an authentic admitted target caller",async()=>{
  const admission=await admittedTarget(),before=await db().select().from(plans),beforeObjects=await db().select().from(objects),beforeCalls=await db().select().from(calls),count=provider.calls.length;
  vi.stubEnv("S3_BUCKET","target");vi.stubEnv("MEDIA_TRANSFER_TARGET_S3_BUCKET","next-private");resetEnvForTests();resetStorageForTests();expect((await failure(planStorageTransfer.call({requestKey:randomUUID(),confirmation:"COPY ADOPT AND RETIRE ORIGINAL STORAGE"},OWNER))).message).toContain("existing original transfer");expect(await db().select().from(plans)).toEqual(before);expect(await db().select().from(objects)).toEqual(beforeObjects);expect(await db().select().from(calls)).toEqual(beforeCalls);expect(provider.calls.length).toBe(count);expect(admission.plan.id).toBe(before[0]?.id);
 },60000);
});
