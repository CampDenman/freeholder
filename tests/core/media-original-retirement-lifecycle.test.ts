// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// PREPARED / UNRUN. These real shared-infrastructure/TCP controls depend on the
// complete future request capability. They NEVER publish a fixture capability,
// fabricate a ServiceContext/old caller birth or claim actual account support.
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
import {putWithReceipt,deleteWithReceipt} from "@/core/media/write-ledger";
import {mediaObjects} from "@/core/media/schema";
import {mediaObjectWrites} from "@/core/media/write-schema";
import {mediaStorageTransferCalls as calls} from "@/core/media/transfer-schema";
import {mediaStorageTransferRequests as requests} from "@/core/media/transfer-request-schema";
import {ordinaryMediaRetirementProvider} from "../helpers/media-original-retirement-provider";
import {closeDb,failure,hasDatabase,OWNER,truncateSpine} from "../helpers/spine";
const SYSTEM={kind:"system"}as const,key="original-retirement/exact.bin",body=new TextEncoder().encode("exact original physical bytes");
describe.runIf(hasDatabase)("C1.12/C11.08 actual original conditional retirement (complete request capability dependent)",()=>{
 let provider:Awaited<ReturnType<typeof ordinaryMediaRetirementProvider>>;
 beforeAll(async()=>{await ready();await stopJobs();const[capability]=await db().execute<{present:boolean}>(sql`select to_regprocedure('freeholder_media_transfer_request_capability_v1()') is not null as present`);if(capability?.present!==true)throw Error("Prepared ordinary retirement controls require the complete actual request capability; no fixture flag or provider authority is substituted.");},60000);
 beforeEach(async()=>{await truncateSpine();provider=await ordinaryMediaRetirementProvider();for(const[name,value]of Object.entries({NODE_ENV:"test",FREEHOLDER_STORAGE:"s3",S3_ENDPOINT:provider.endpoint,S3_REGION:"fixture",S3_BUCKET:"source",S3_ACCESS_KEY_ID:"synthetic",S3_SECRET_ACCESS_KEY:"synthetic",FREEHOLDER_STORAGE_QUOTA_BYTES:"",FREEHOLDER_STORAGE_QUOTA_INITIALIZE_EMPTY:"false"}))vi.stubEnv(name,value);resetEnvForTests();resetStorageForTests();});
 afterEach(async()=>{await provider?.close();vi.unstubAllEnvs();resetEnvForTests();resetStorageForTests();});afterAll(closeDb);
 const write=()=>putWithReceipt({key,body,contentType:"application/octet-stream",role:"original"},SYSTEM);
 const history=()=>db().select().from(mediaObjectWrites).where(eq(mediaObjectWrites.key,key));
 it("conditionally retires only actual original bytes after all physical requests, pinned absence and complete inventories finish",async()=>{
  await write();const[original]=await history();expect(original?.originalReservationId).toBeTruthy();expect(provider.objects.get(`/source/${key}`)?.body).toEqual(body);
  expect(await deleteWithReceipt(key)).toBe(true);const retired=await history();expect(retired).toHaveLength(2);expect(retired.every(row=>row.deletedAt&&row.writerFinishedAt)).toBe(true);expect(retired.find(row=>row.id===original?.id)).toMatchObject({originalReservationId:original?.originalReservationId,providerRevisionDigest:original?.providerRevisionDigest,sha256:original?.sha256,bytes:body.byteLength});
  const deletes=provider.calls.filter(row=>row.method==="DELETE");expect(deletes).toHaveLength(1);expect(deletes[0]?.condition).toBe(original?.providerRevision?.value);expect(provider.objects.has(`/source/${key}`)).toBe(false);expect(await db().select().from(mediaObjects)).toEqual([]);expect((await db().select().from(calls)).every(row=>row.returnedAt&&row.state==="returned")).toBe(true);expect((await db().select().from(requests)).every(row=>row.returnedAt&&row.state==="returned")).toBe(true);
 },60000);
 for(const kind of ["version","session"]as const)it(`refuses real logical404 with retained original ${kind} bytes without deleting or rewriting original evidence`,async()=>{
  await write();const[original]=await history();if(kind==="version")provider.retainSourceVersion(key);else provider.retainSourceSession(key);
  expect((await fetch(`${provider.endpoint}/source/${key}`,{method:"HEAD"})).status).toBe(404);
  const physical=kind==="version"?[...provider.retainedVersions.values()]:[...provider.sessions.values()];expect(physical[0]?.body).toEqual(body);
  expect((await failure(deleteWithReceipt(key))).message).toContain("physical versions, retained bytes");const rows=await history();expect(rows.find(row=>row.id===original?.id)).toEqual(original);expect(rows.every(row=>row.deletedAt===null)).toBe(true);expect(provider.calls.filter(row=>row.method==="DELETE")).toEqual([]);expect((kind==="version"?[...provider.retainedVersions.values()]:[...provider.sessions.values()])[0]?.body).toEqual(body);
 },60000);
 it("refuses an actually paused admitted PUT despite real empty inventories and404, then retains its authentic late bytes and caller finish",async()=>{
  const gate=provider.pauseNextSourcePut(),writing=write();try{
   await gate.started;const before=await history();expect(before).toHaveLength(1);expect(before[0]?.writerFinishedAt).toBeNull();expect((await fetch(`${provider.endpoint}/source/${key}`,{method:"HEAD"})).status).toBe(404);expect(await(await fetch(`${provider.endpoint}/source?versions`)).text()).not.toContain("<Version>");expect(await(await fetch(`${provider.endpoint}/source?uploads`)).text()).not.toContain("<Upload>");
   await failure(deleteWithReceipt(key));expect(await history()).toEqual(before);expect(provider.calls.filter(row=>row.method==="DELETE")).toEqual([]);
  }finally{gate.release();await writing;}
  expect(provider.objects.get(`/source/${key}`)?.body).toEqual(body);const rows=await history();expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({state:"accepted",deletedAt:null});expect(rows[0]?.writerFinishedAt).toBeTruthy();expect((await db().select().from(calls)).filter(row=>row.kind==="ordinary_put")[0]?.returnedAt).toBeTruthy();
 },60000);
 it("preserves an unknown-owner original under an actual named privacy hold without admitting a DELETE or changing its first receipt",async()=>{
  await write();const before=await history(),beforeCalls=await db().select().from(calls);await db().insert(users).values({id:OWNER.userId,email:"retirement-hold-owner@example.test",role:"owner"});const contact=await createContact.call({name:"Original retention subject",email:"retirement-held@example.test"},OWNER),request=await createDataRequest.call({contactId:contact.id,request:{kind:"erasure"}},OWNER);await verifyDataRequest.call({id:request.id,method:"Fictional independently verified subject"},OWNER);await addRetentionException.call({dataRequestId:request.id,scope:"media.storageOperations",reason:"legal_claim",legalBasis:"Synthetic named original preservation control"},OWNER);
  expect((await failure(deleteWithReceipt(key))).message).toContain("named hold");expect(await history()).toEqual(before);expect(await db().select().from(calls)).toEqual(beforeCalls);expect(provider.objects.get(`/source/${key}`)?.body).toEqual(body);expect(provider.calls.filter(row=>row.method==="DELETE")).toEqual([]);
 },60000);
 it("retains the first actual DELETE and resumes only verification after a post-DELETE inventory interruption",async()=>{
  await write();provider.interruptInventoryAfterNextDelete();await failure(deleteWithReceipt(key));const before=await history(),deletion=before.find(row=>row.operation==="delete"),firstCalls=await db().select().from(calls),actual=firstCalls.find(row=>row.objectReceiptId===deletion?.id&&row.kind==="ordinary_delete");expect(actual).toMatchObject({state:"returned"});expect(actual?.returnedAt).toBeTruthy();expect(deletion?.writerFinishedAt).toBeTruthy();expect(provider.calls.filter(row=>row.method==="DELETE")).toHaveLength(1);
  expect(await deleteWithReceipt(key)).toBe(true);expect(provider.calls.filter(row=>row.method==="DELETE")).toHaveLength(1);expect((await db().select().from(calls)).find(row=>row.id===actual?.id)).toEqual(actual);expect((await history()).every(row=>row.deletedAt)).toBe(true);
 },60000);
 it("retains a genuinely unattempted caller and admits a separate new caller after a preflight inventory failure, with exactly one total physical DELETE",async()=>{
  await write();provider.interruptNextInventory();await failure(deleteWithReceipt(key));const before=await history(),first=before.find(row=>row.operation==="delete"),allFirstCalls=await db().select().from(calls),firstCaller=allFirstCalls.find(row=>row.objectReceiptId===first?.id&&row.kind==="ordinary_delete");expect(firstCaller).toMatchObject({state:"returned",observedAcceptedAt:null});expect(firstCaller?.returnedAt).toBeTruthy();expect(first?.writerFinishedAt).toBeTruthy();expect((await db().select().from(requests)).filter(row=>row.callId===firstCaller?.id)).toEqual([]);expect(provider.objects.get(`/source/${key}`)?.body).toEqual(body);expect(provider.calls.filter(row=>row.method==="DELETE")).toEqual([]);
  expect(await deleteWithReceipt(key)).toBe(true);const after=await history();expect(after).toHaveLength(3);expect(after.every(row=>row.deletedAt&&row.writerFinishedAt)).toBe(true);expect(after.find(row=>row.id===first?.id)).toMatchObject({state:"confirmed_absent",observedAcceptedAt:null,writerFinishedAt:first?.writerFinishedAt,createdAt:first?.createdAt,originalReservationId:first?.originalReservationId});expect((await db().select().from(calls)).find(row=>row.id===firstCaller?.id)).toEqual(firstCaller);expect((await db().select().from(calls)).filter(row=>row.kind==="ordinary_delete")).toHaveLength(2);expect(provider.calls.filter(row=>row.method==="DELETE")).toHaveLength(1);
 },60000);
});
