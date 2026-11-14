// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// PREPARED / UNRUN. Real service/TCP negative controls. Capture-only rows below
// supply NO actual kernel witness, verified stop, release or capability flag.
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
import {mediaStorageTransferObjects as objects,mediaStorageWriterDrains as drains} from "@/core/media/transfer-schema";
import {planStorageTransfer} from "@/core/media/transfer-service";
import {configuredTransferStores} from "@/core/media/transfer-storage";
import {admitTransferCall,transferRuntimeIdentity} from "@/core/media/transfer-callers";
import {withTransferRequestScope} from "@/core/media/transfer-requests";
import type {TransferDrainSnapshot} from "../../scripts/media-transfer-drain-proof.mjs";
import {ordinaryMediaRetirementProvider} from "../helpers/media-original-retirement-provider";
import {closeDb,failure,hasDatabase,OWNER,truncateSpine} from "../helpers/spine";
const key="original/recovery-drain.bin",body=new TextEncoder().encode("actual original recovery cohort");
describe.runIf(hasDatabase)("exact current transfer drain association refuses fabricated authority (complete protocol dependent)",()=>{
 let provider:Awaited<ReturnType<typeof ordinaryMediaRetirementProvider>>;
 beforeAll(async()=>{await ready();await stopJobs();const[capability]=await db().execute<{present:boolean}>(sql`select to_regprocedure('freeholder_media_transfer_request_capability_v1()') is not null as present`);if(capability?.present!==true)throw Error("Prepared drain controls require complete actual protocol; no fixture capability is substituted.");},60000);
 beforeEach(async()=>{await truncateSpine();await db().insert(users).values({id:OWNER.userId,email:"recovery-drain-owner@example.test",role:"owner"});provider=await ordinaryMediaRetirementProvider();for(const[name,value]of Object.entries({NODE_ENV:"test",FREEHOLDER_STORAGE:"s3",S3_ENDPOINT:provider.endpoint,S3_REGION:"fixture",S3_BUCKET:"source",S3_ACCESS_KEY_ID:"synthetic",S3_SECRET_ACCESS_KEY:"synthetic",FREEHOLDER_STORAGE_QUOTA_BYTES:"",MEDIA_TRANSFER_TARGET_QUOTA_BYTES:"",MEDIA_TRANSFER_TARGET_STORAGE:"s3",MEDIA_TRANSFER_TARGET_S3_ENDPOINT:provider.endpoint,MEDIA_TRANSFER_TARGET_S3_REGION:"fixture",MEDIA_TRANSFER_TARGET_S3_BUCKET:"target",MEDIA_TRANSFER_TARGET_S3_ACCESS_KEY_ID:"synthetic",MEDIA_TRANSFER_TARGET_S3_SECRET_ACCESS_KEY:"synthetic"}))vi.stubEnv(name,value);resetEnvForTests();resetStorageForTests();await putWithReceipt({key,body,contentType:"application/octet-stream",role:"original"},OWNER);});
 afterEach(async()=>{await provider?.close();vi.unstubAllEnvs();resetEnvForTests();resetStorageForTests();});afterAll(closeDb);
 async function captured(planId:string,namespace:string,change?:(snapshot:TransferDrainSnapshot)=>void){
  return db().transaction(async tx=>{await tx.execute(sql`select pg_advisory_xact_lock(1691709,82)`);await tx.execute(sql`select set_config('freeholder.media_transfer_operator_v1','1',true)`);const[row]=await tx.insert(drains).values({namespace,state:"capturing",sourceRevision:"e".repeat(40),executorIdentity:"synthetic-capture-only:NO-actual-kernel-proof"}).returning();const[current]=await tx.execute<{snapshot:TransferDrainSnapshot}>(sql`select freeholder_media_transfer_recovery_snapshot(${planId}::uuid,${namespace}) as snapshot`);if(!row||!current?.snapshot)throw Error("Actual plan cohort snapshot missing");change?.(current.snapshot);const[after]=await tx.update(drains).set({state:"captured",originalProcesses:{format:"synthetic-capture-only-not-a-process-stop",recovery:{format:"freeholder.media-transfer-drain/v1",planId,namespace,snapshot:current.snapshot}},updatedAt:new Date()}).where(eq(drains.id,row.id)).returning();return after!;});
 }
 it("retains a real plan/caller cohort but refuses release without an actual verified executor stop",async()=>{
  const plan=await planStorageTransfer.call({requestKey:randomUUID(),confirmation:"COPY ADOPT AND RETIRE ORIGINAL STORAGE"},OWNER),{source}=await configuredTransferStores(),originals=await db().select().from(mediaObjectWrites),drain=await captured(plan.id,source.binding.namespace),count=provider.calls.length;
  const[proof]=await db().execute<{allowed:boolean}>(sql`select freeholder_media_transfer_recovery_drain_releasable(${drain.id}::uuid) as allowed`);expect(proof?.allowed).toBe(false);
  expect(await failure(db().transaction(async tx=>{await tx.execute(sql`select set_config('freeholder.media_transfer_operator_v1','1',true)`);return tx.update(drains).set({state:"released",releasedAt:new Date(),updatedAt:new Date()}).where(eq(drains.id,drain.id));}))).toMatchObject({cause:{code:"23514"}});expect((await db().select().from(drains).where(eq(drains.id,drain.id)))[0]).toEqual(drain);expect(await db().select().from(mediaObjectWrites)).toEqual(originals);expect(provider.calls.length).toBe(count);
 },60000);
 it("refuses a subset of the genuine complete original caller cohort before the first association can seal",async()=>{
  const plan=await planStorageTransfer.call({requestKey:randomUUID(),confirmation:"COPY ADOPT AND RETIRE ORIGINAL STORAGE"},OWNER),{source}=await configuredTransferStores(),before=await db().select().from(mediaObjectWrites),count=provider.calls.length;
  expect(await failure(captured(plan.id,source.binding.namespace,snapshot=>{expect(snapshot.callers.length).toBeGreaterThan(0);snapshot.callers=[];}))).toMatchObject({cause:{code:"23514"}});expect(await db().select().from(drains)).toEqual([]);expect(await db().select().from(mediaObjectWrites)).toEqual(before);expect(provider.calls.length).toBe(count);expect(provider.objects.get(`/source/${key}`)?.body).toEqual(body);
 },60000);
 it("refuses an already captured, verified or released birth instead of accepting a fabricated terminal operator state",async()=>{
  const{source}=await configuredTransferStores(),before=await db().select().from(mediaObjectWrites),count=provider.calls.length;
  for(const state of ["captured","verified","released"]as const){const refused=await failure(db().transaction(async tx=>{await tx.execute(sql`select set_config('freeholder.media_transfer_operator_v1','1',true)`);return tx.insert(drains).values({namespace:source.binding.namespace,state,sourceRevision:"e".repeat(40),executorIdentity:"synthetic-forged-birth:NO-kernel-proof"});}));expect(refused).toMatchObject({cause:{code:"23514",message:expect.stringContaining("born capturing") as unknown}});}
  expect(await db().select().from(drains)).toEqual([]);expect(await db().select().from(mediaObjectWrites)).toEqual(before);expect(provider.calls.length).toBe(count);
 },60000);
 it("keeps an authentic pre-admitted target PUT fenced even when the later capture names its exact current plan",async()=>{
  const plan=await planStorageTransfer.call({requestKey:randomUUID(),confirmation:"COPY ADOPT AND RETIRE ORIGINAL STORAGE"},OWNER),[object]=await db().select().from(objects).where(eq(objects.planId,plan.id));if(!object)throw Error("Actual target object missing");const token=randomUUID()+randomUUID(),runtimeIdentity=await transferRuntimeIdentity(),call=await db().transaction(tx=>admitTransferCall(tx,{planId:plan.id,objectId:object.id,kind:"target_put",token,runtimeIdentity},OWNER)),{target}=await configuredTransferStores();await captured(plan.id,target.binding.namespace);const originals=await db().select().from(mediaObjectWrites),count=provider.calls.length;
  expect((await failure(withTransferRequestScope({callId:call.id,token,runtimeIdentity},()=>target.put(object.targetKey,body,"application/octet-stream")))).message).toContain("executor drain");expect(await db().select().from(mediaObjectWrites)).toEqual(originals);expect(provider.calls.length).toBe(count);expect(provider.objects.has(`/target/${object.targetKey}`)).toBe(false);
 },60000);
});
