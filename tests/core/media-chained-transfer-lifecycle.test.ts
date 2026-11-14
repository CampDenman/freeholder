// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// PREPARED / UNRUN. Actual services and fictional provider-shaped TCP metadata.
// No capability override, fake ServiceContext or actual account acceptance.
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from "vitest";
import {randomUUID} from "node:crypto";
import {eq,sql} from "drizzle-orm";
import {db} from "@/core/db";
import {users} from "@/core/auth/schema";
import {ready} from "@/core/runtime";
import {stopJobs} from "@/core/jobs";
import {resetEnvForTests} from "@/core/env";
import {resetStorageForTests} from "@/adapters/storage";
import {storage} from "@/adapters/storage";
import {adoptedPhysicalObject} from "@/core/media/transfer-resolver";
import {mediaStorageTransferReceipts as members} from "@/core/media/transfer-schema";
import {putWithReceipt} from "@/core/media/write-ledger";
import {mediaObjectWrites} from "@/core/media/write-schema";
import {mediaStorageTransferObjects as objects,mediaStorageTransferPlans as plans} from "@/core/media/transfer-schema";
import {lockTransferInventory} from "@/core/media/transfer-authority";
import {planStorageTransfer,advanceStorageTransfer} from "@/core/media/transfer-service";
import {chainedMediaRetirementProvider} from "../helpers/media-chained-retirement-provider";
import {closeDb,failure,hasDatabase,OWNER,truncateSpine} from "../helpers/spine";
const key="original/read-provenance.bin",body=new TextEncoder().encode("same bytes are not original authority");
describe.runIf(hasDatabase)("immutable chained physical transfer lineage (complete protocol dependent)",()=>{
 let provider:Awaited<ReturnType<typeof chainedMediaRetirementProvider>>;
 beforeAll(async()=>{await ready();await stopJobs();const[capability]=await db().execute<{present:boolean}>(sql`select to_regprocedure('freeholder_media_transfer_request_capability_v1()') is not null as present`);if(capability?.present!==true)throw Error("Prepared read provenance controls require the complete actual protocol; no fixture capability is substituted.");},60000);
 beforeEach(async()=>{await truncateSpine();await db().insert(users).values({id:OWNER.userId,email:"read-provenance-owner@example.test",role:"owner"});provider=await chainedMediaRetirementProvider();for(const[name,value]of Object.entries({NODE_ENV:"test",FREEHOLDER_STORAGE:"s3",S3_ENDPOINT:provider.endpoint,S3_REGION:"fixture",S3_BUCKET:"source",S3_ACCESS_KEY_ID:"synthetic",S3_SECRET_ACCESS_KEY:"synthetic",FREEHOLDER_STORAGE_QUOTA_BYTES:"",MEDIA_TRANSFER_TARGET_QUOTA_BYTES:"",MEDIA_TRANSFER_TARGET_STORAGE:"s3",MEDIA_TRANSFER_TARGET_S3_ENDPOINT:provider.endpoint,MEDIA_TRANSFER_TARGET_S3_REGION:"fixture",MEDIA_TRANSFER_TARGET_S3_BUCKET:"target",MEDIA_TRANSFER_TARGET_S3_ACCESS_KEY_ID:"synthetic",MEDIA_TRANSFER_TARGET_S3_SECRET_ACCESS_KEY:"synthetic"}))vi.stubEnv(name,value);resetEnvForTests();resetStorageForTests();await putWithReceipt({key,body,contentType:"application/octet-stream",role:"original"},OWNER);});
 afterEach(async()=>{await provider?.close();vi.unstubAllEnvs();resetEnvForTests();resetStorageForTests();});afterAll(closeDb);
 const plan=()=>planStorageTransfer.call({requestKey:randomUUID(),confirmation:"COPY ADOPT AND RETIRE ORIGINAL STORAGE"},OWNER);
 const advance=async(id:string)=>{await advanceStorageTransfer.call({id,action:"copy"},OWNER);await advanceStorageTransfer.call({id,action:"adopt"},OWNER);await advanceStorageTransfer.call({id,action:"retire"},OWNER);};
 const nextResource=()=>{vi.stubEnv("S3_BUCKET","target");vi.stubEnv("MEDIA_TRANSFER_TARGET_S3_BUCKET","third");resetEnvForTests();resetStorageForTests();};
 it("moves two actual physical generations and reads the original logical alias through exact original receipt ancestry",async()=>{
  const first=await plan();await advance(first.id);const[ancestor]=await db().select().from(objects).where(eq(objects.planId,first.id));if(!ancestor?.targetReceiptId)throw Error("Actual first target receipt missing");const before=await db().select().from(mediaObjectWrites),firstMembers=await db().select().from(members).where(eq(members.objectId,ancestor.id));nextResource();const second=await plan(),[child]=await db().select().from(objects).where(eq(objects.planId,second.id));expect(child?.key).toBe(ancestor.targetKey);expect((await db().select().from(members).where(eq(members.objectId,child!.id))).map(row=>row.receiptId)).toContain(ancestor.targetReceiptId);await advance(second.id);
  expect(provider.calls.filter(row=>row.method==="PUT")).toHaveLength(3);expect(provider.calls.filter(row=>row.method==="DELETE")).toHaveLength(2);expect(provider.objects.has(`/source/${key}`)).toBe(false);expect(provider.objects.has(`/target/${ancestor.targetKey}`)).toBe(false);expect(provider.objects.get(`/third/${child!.targetKey}`)?.body).toEqual(body);expect((await adoptedPhysicalObject(key))?.key).toBe(child!.targetKey);expect(await storage().get(key)).toEqual(body);
  for(const original of before.filter(row=>row.operation==="put"))expect((await db().select().from(mediaObjectWrites).where(eq(mediaObjectWrites.id,original.id)))[0]).toEqual(original);expect(await db().select().from(members).where(eq(members.objectId,ancestor.id))).toEqual(firstMembers);
 },60000);
 it("refuses another source claim while a real original multipart session remains in the current source inventory",async()=>{
  const first=await plan();await advance(first.id);const[ancestor]=await db().select().from(objects).where(eq(objects.planId,first.id));if(!ancestor)throw Error("Actual first copy missing");nextResource();provider.sessions.set("late-session",{key:`/target/${ancestor.targetKey}`,body:new Uint8Array(body)});const second=await plan(),beforeWrites=await db().select().from(mediaObjectWrites);expect((await failure(advanceStorageTransfer.call({id:second.id,action:"copy"},OWNER))).code).toBe("conflict");expect(provider.calls.filter(row=>row.method==="PUT")).toHaveLength(2);expect(provider.calls.filter(row=>row.method==="DELETE")).toHaveLength(1);expect(await db().select().from(mediaObjectWrites)).toEqual(beforeWrites);expect(provider.objects.get(`/target/${ancestor.targetKey}`)?.body).toEqual(body);expect(provider.sessions.get("late-session")?.body).toEqual(body);
 },60000);
 it("SQL independently refuses rebinding a genuine intermediate edge to another current receipt",async()=>{
  const first=await plan();await advance(first.id);nextResource();const second=await plan(),[child]=await db().select().from(objects).where(eq(objects.planId,second.id)),before=await db().select().from(members).where(eq(members.objectId,child!.id)),count=provider.calls.length;
  expect(await failure(db().transaction(async tx=>{await lockTransferInventory(tx);return tx.update(members).set({receiptId:randomUUID()}).where(eq(members.objectId,child!.id));}))).toMatchObject({cause:{code:"23514"}});expect(await db().select().from(members).where(eq(members.objectId,child!.id))).toEqual(before);expect(provider.calls.length).toBe(count);expect((await db().select().from(plans).where(eq(plans.id,second.id)))[0]?.adoptedAt).toBeNull();
 },60000);
});
