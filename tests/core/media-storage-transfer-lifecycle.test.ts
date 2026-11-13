// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// SOURCE PREPARED, UNRUN. Actual services + real TCP/private synthetic storage;
// no actual provider account, SDK/HTTP/MCP ingress or cross-target claim.
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from "vitest";
import {randomUUID} from "node:crypto";
import {eq} from "drizzle-orm";
import {db} from "@/core/db";
import {users} from "@/core/auth/schema";
import {ready} from "@/core/runtime";
import {resetEnvForTests} from "@/core/env";
import {resetStorageForTests,storage} from "@/adapters/storage";
import {putWithReceipt} from "@/core/media/write-ledger";
import {mediaObjectWrites} from "@/core/media/write-schema";
import {mediaStorageTransferCalls,mediaStorageTransferObjects,mediaStorageTransferPlans} from "@/core/media/transfer-schema";
import {advanceStorageTransfer,planStorageTransfer} from "@/core/media/transfer-service";
import {mediaTransferProvider} from "../helpers/media-transfer-provider";
import {closeDb,failure,hasDatabase,OWNER,CUSTOMER,truncateSpine} from "../helpers/spine";
const body=new Uint8Array(Buffer.from("%PDF-1.7\nOriginal fictional private byte witness.\n%%EOF\n")),key="original/private.pdf";
describe.runIf(hasDatabase)("durable verified media-transfer lifecycle",()=>{
 let provider:Awaited<ReturnType<typeof mediaTransferProvider>>;
 beforeAll(ready,60_000);
 beforeEach(async()=>{
  await truncateSpine();await db().insert(users).values({id:OWNER.userId,email:"transfer-owner@example.test",role:"owner"});
  provider=await mediaTransferProvider();
  for(const[name,value]of Object.entries({NODE_ENV:"test",FREEHOLDER_STORAGE:"s3",S3_ENDPOINT:provider.endpoint,S3_REGION:"fixture",S3_BUCKET:"source",S3_ACCESS_KEY_ID:"synthetic",S3_SECRET_ACCESS_KEY:"synthetic",MEDIA_TRANSFER_TARGET_STORAGE:"s3",MEDIA_TRANSFER_TARGET_S3_ENDPOINT:provider.endpoint,MEDIA_TRANSFER_TARGET_S3_REGION:"fixture",MEDIA_TRANSFER_TARGET_S3_BUCKET:"target",MEDIA_TRANSFER_TARGET_S3_ACCESS_KEY_ID:"synthetic",MEDIA_TRANSFER_TARGET_S3_SECRET_ACCESS_KEY:"synthetic"}))vi.stubEnv(name,value);
  resetEnvForTests();resetStorageForTests();await putWithReceipt({key,body,contentType:"application/pdf",role:"original"},OWNER);
 });
 afterEach(async()=>{await provider.close();vi.unstubAllEnvs();resetEnvForTests();resetStorageForTests();});afterAll(closeDb);
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
});
