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
import {putWithReceipt} from "@/core/media/write-ledger";
import {mediaObjectWrites} from "@/core/media/write-schema";
import {mediaStorageTransferCalls as calls,mediaStorageTransferObjects as objects,mediaStorageTransferPlans as plans} from "@/core/media/transfer-schema";
import {lockTransferInventory} from "@/core/media/transfer-authority";
import {planStorageTransfer,advanceStorageTransfer} from "@/core/media/transfer-service";
import {ordinaryMediaRetirementProvider} from "../helpers/media-original-retirement-provider";
import {closeDb,failure,hasDatabase,OWNER,truncateSpine} from "../helpers/spine";
const key="original/read-provenance.bin",body=new TextEncoder().encode("same bytes are not original authority");
describe.runIf(hasDatabase)("fresh exact original transfer read provenance (complete protocol dependent)",()=>{
 let provider:Awaited<ReturnType<typeof ordinaryMediaRetirementProvider>>;
 beforeAll(async()=>{await ready();await stopJobs();const[capability]=await db().execute<{present:boolean}>(sql`select to_regprocedure('freeholder_media_transfer_request_capability_v1()') is not null as present`);if(capability?.present!==true)throw Error("Prepared read provenance controls require the complete actual protocol; no fixture capability is substituted.");},60000);
 beforeEach(async()=>{await truncateSpine();await db().insert(users).values({id:OWNER.userId,email:"read-provenance-owner@example.test",role:"owner"});provider=await ordinaryMediaRetirementProvider();for(const[name,value]of Object.entries({NODE_ENV:"test",FREEHOLDER_STORAGE:"s3",S3_ENDPOINT:provider.endpoint,S3_REGION:"fixture",S3_BUCKET:"source",S3_ACCESS_KEY_ID:"synthetic",S3_SECRET_ACCESS_KEY:"synthetic",FREEHOLDER_STORAGE_QUOTA_BYTES:"",MEDIA_TRANSFER_TARGET_QUOTA_BYTES:"",MEDIA_TRANSFER_TARGET_STORAGE:"s3",MEDIA_TRANSFER_TARGET_S3_ENDPOINT:provider.endpoint,MEDIA_TRANSFER_TARGET_S3_REGION:"fixture",MEDIA_TRANSFER_TARGET_S3_BUCKET:"target",MEDIA_TRANSFER_TARGET_S3_ACCESS_KEY_ID:"synthetic",MEDIA_TRANSFER_TARGET_S3_SECRET_ACCESS_KEY:"synthetic"}))vi.stubEnv(name,value);resetEnvForTests();resetStorageForTests();await putWithReceipt({key,body,contentType:"application/octet-stream",role:"original"},OWNER);});
 afterEach(async()=>{await provider?.close();vi.unstubAllEnvs();resetEnvForTests();resetStorageForTests();});afterAll(closeDb);
 const plan=()=>planStorageTransfer.call({requestKey:randomUUID(),confirmation:"COPY ADOPT AND RETIRE ORIGINAL STORAGE"},OWNER);
 it("refuses a source with equal bytes and unchanged ETag but another actual returned provider nonce before any target PUT",async()=>{
  const claimed=await plan(),before=await db().select().from(mediaObjectWrites),original=provider.objects.get(`/source/${key}`),otherId=randomUUID();provider.originalRequestTags.set(`/source/${key}`,{id:otherId,token:"fictional-later-admission-token-"+randomUUID()});
  expect((await failure(advanceStorageTransfer.call({id:claimed.id,action:"copy"},OWNER))).code).toBe("conflict");expect(await db().select().from(mediaObjectWrites)).toEqual(before);expect(provider.objects.get(`/source/${key}`)).toEqual(original);expect(provider.calls.filter(row=>row.method==="PUT")).toHaveLength(1);expect(provider.calls.filter(row=>row.method==="DELETE")).toEqual([]);
  const returned=(await db().select().from(calls)).find(row=>row.kind==="source_read");expect(returned).toMatchObject({state:"returned",resultRequestProof:{id:otherId}});expect(returned?.returnedAt).toBeInstanceOf(Date);expect((await db().select().from(plans))[0]?.adoptedAt).toBeNull();
 },60000);
 it("reads the target again at adoption and refuses a different nonce despite equal current bytes/ETag without changing first copy evidence",async()=>{
  const claimed=await plan();await advanceStorageTransfer.call({id:claimed.id,action:"copy"},OWNER);const[original]=await db().select().from(objects),beforeCalls=await db().select().from(calls),beforeWrites=await db().select().from(mediaObjectWrites),beforePlan=(await db().select().from(plans))[0];if(!original)throw Error("Actual original copy missing");const bytes=provider.objects.get(`/target/${original.targetKey}`),otherId=randomUUID();provider.originalRequestTags.set(`/target/${original.targetKey}`,{id:otherId,token:"fictional-later-target-token-"+randomUUID()});
  expect((await failure(advanceStorageTransfer.call({id:claimed.id,action:"adopt"},OWNER))).code).toBe("conflict");expect((await db().select().from(objects))[0]).toEqual(original);expect((await db().select().from(plans))[0]).toEqual(beforePlan);expect(await db().select().from(mediaObjectWrites)).toEqual(beforeWrites);for(const before of beforeCalls)expect((await db().select().from(calls).where(eq(calls.id,before.id)))[0]).toEqual(before);
  expect(provider.objects.get(`/target/${original.targetKey}`)).toEqual(bytes);expect(provider.objects.get(`/source/${key}`)?.body).toEqual(body);expect(provider.calls.filter(row=>row.method==="PUT")).toHaveLength(2);expect(provider.calls.filter(row=>row.method==="DELETE")).toEqual([]);expect((await db().select().from(calls)).some(row=>row.kind==="target_verify"&&row.resultRequestProof?.id===otherId)).toBe(true);
 },60000);
 it("independently refuses direct SQL adoption reusing copy-time reads without fresh provider requests",async()=>{
  const claimed=await plan();await advanceStorageTransfer.call({id:claimed.id,action:"copy"},OWNER);const[verified]=await db().select().from(objects),beforeCalls=await db().select().from(calls),count=provider.calls.length;if(!verified)throw Error("Actual verified copy missing");
  expect(await failure(db().transaction(async tx=>{await lockTransferInventory(tx);return tx.update(objects).set({state:"adopted",updatedAt:new Date()}).where(eq(objects.id,verified.id));}))).toMatchObject({cause:{code:"23514",message:expect.stringContaining("new actual full-byte reads")}});expect((await db().select().from(objects))[0]).toEqual(verified);expect(await db().select().from(calls)).toEqual(beforeCalls);expect(provider.calls.length).toBe(count);expect(provider.calls.filter(row=>row.method==="DELETE")).toEqual([]);
 },60000);
 it("uses new exact full-byte source/target proofs at atomic adoption and preserves old proof rows and original copy privacy lineage through conditional source retirement",async()=>{
  const claimed=await plan();await advanceStorageTransfer.call({id:claimed.id,action:"copy"},OWNER);const[verified]=await db().select().from(objects),oldCalls=await db().select().from(calls);if(!verified)throw Error("Actual verified object missing");expect(await advanceStorageTransfer.call({id:claimed.id,action:"adopt"},OWNER)).toMatchObject({state:"adopted"});const[adopted]=await db().select().from(objects);expect(adopted?.sourceReadCallerId).not.toBe(verified.sourceReadCallerId);expect(adopted?.targetVerifyCallerId).not.toBe(verified.targetVerifyCallerId);for(const before of oldCalls)expect((await db().select().from(calls).where(eq(calls.id,before.id)))[0]).toEqual(before);
  const[proof]=await db().execute<{source:boolean;target:boolean}>(sql`select freeholder_media_transfer_exact_read_nonce(${adopted!.sourceReadCallerId}::uuid) as source,freeholder_media_transfer_exact_read_nonce(${adopted!.targetVerifyCallerId}::uuid) as target`);expect(proof).toEqual({source:true,target:true});expect(await advanceStorageTransfer.call({id:claimed.id,action:"retire"},OWNER)).toMatchObject({state:"complete"});expect(provider.calls.filter(row=>row.method==="PUT")).toHaveLength(2);expect(provider.calls.filter(row=>row.method==="DELETE")).toHaveLength(1);expect(provider.objects.has(`/source/${key}`)).toBe(false);expect(provider.objects.get(`/target/${verified.targetKey}`)?.body).toEqual(body);
  const original=(await db().select().from(mediaObjectWrites)).find(row=>row.operation==="put"&&row.namespace===(beforeNamespace(oldCalls)));expect(original?.deletedAt).toBeNull();
 },60000);
});
function beforeNamespace(captured:readonly{kind:string;namespace:string}[]){return captured.find(row=>row.kind==="source_read")?.namespace;}
