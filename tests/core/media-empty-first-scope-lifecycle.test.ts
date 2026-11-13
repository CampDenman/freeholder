// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// SOURCE PREPARED / UNRUN. Actual shared privacy/upload + guarded metadata
// transactions and fictional private TCP; no ingress/account acceptance claim.
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from "vitest";
import {eq,sql} from "drizzle-orm";
import {z} from "zod";
import {db} from "@/core/db";
import {users} from "@/core/auth/schema";
import {createContact} from "@/core/contacts/service";
import {createDataRequest,verifyDataRequest,fulfillDataRequest} from "@/core/privacy/service";
import {dataRequestArtifacts} from "@/core/privacy/schema";
import {ready} from "@/core/runtime";
import {stopJobs} from "@/core/jobs";
import {resetEnvForTests} from "@/core/env";
import {resetStorageForTests} from "@/adapters/storage";
import {beginUpload} from "@/core/media/service";
import {mediaObjects,mediaUploads} from "@/core/media/schema";
import {mediaOriginalErasureScopes} from "@/core/media/erasure-schema";
import {mediaStorageTransferErasureScopes,mediaStorageTransferCalls} from "@/core/media/transfer-schema";
import {mediaStorageTransferRequests} from "@/core/media/transfer-request-schema";
import {lockOriginalMediaScopeCapture} from "@/core/media/empty-scope-authority";
import {requireTransferCapability} from "@/core/media/transfer-authority";
import {ordinaryMediaRecoveryProvider} from "../helpers/media-original-provider-recovery";
import {closeDb,failure,hasDatabase,OWNER,truncateSpine} from "../helpers/spine";
const scopes=["media.storageTransfers","media.storageOperations","media.multipartOperations"];
describe.runIf(hasDatabase)("C1.12/C11.08 genuinely empty first media capture without provider privilege",()=>{
 let provider:Awaited<ReturnType<typeof ordinaryMediaRecoveryProvider>>;
 beforeAll(async()=>{await ready();await stopJobs();},60000);
 beforeEach(async()=>{await truncateSpine();await db().insert(users).values({id:OWNER.userId,email:"empty-scope-owner@example.test",role:"owner"});provider=await ordinaryMediaRecoveryProvider();for(const[name,value]of Object.entries({NODE_ENV:"test",FREEHOLDER_STORAGE:"s3",S3_ENDPOINT:provider.endpoint,S3_REGION:"fixture",S3_BUCKET:"source",S3_ACCESS_KEY_ID:"synthetic",S3_SECRET_ACCESS_KEY:"synthetic",FREEHOLDER_STORAGE_QUOTA_BYTES:"100",FREEHOLDER_STORAGE_QUOTA_INITIALIZE_EMPTY:"false"}))vi.stubEnv(name,value);resetEnvForTests();resetStorageForTests();});
 afterEach(async()=>{await provider?.close();vi.unstubAllEnvs();resetEnvForTests();resetStorageForTests();});afterAll(closeDb);
 async function request(){const contact=await createContact.call({name:"Empty original scope subject",email:"empty-scope-subject@example.test"},OWNER),original=await createDataRequest.call({contactId:contact.id,request:{kind:"erasure"}},OWNER);await verifyDataRequest.call({id:original.id,method:"Fictional actual subject verification"},OWNER);return{contact,original};}
 async function noProviderPrivilege(){const[capability]=await db().execute<{request:string|null}>(sql`select to_regprocedure('freeholder_media_transfer_request_capability_v1()')::text as request`);expect(capability?.request).toBeNull();expect(await db().select().from(mediaStorageTransferCalls)).toEqual([]);expect(await db().select().from(mediaStorageTransferRequests)).toEqual([]);expect(provider.calls).toEqual([]);}
 it("seals actual empty first headers and an intact actual erasure artifact without publishing or exercising provider capability",async()=>{
  const{original}=await request(),result=await fulfillDataRequest.call({id:original.id,confirmation:"ERASE"},OWNER),body=z.object({outcomes:z.array(z.object({scope:z.string(),outcome:z.string(),affected:z.number().optional(),pendingJobs:z.array(z.uuid()).optional()}))}).parse(result.artifact.body);
  for(const scope of scopes){const outcome=body.outcomes.find(row=>row.scope===scope);expect(outcome).toMatchObject({outcome:"erased",affected:0});expect(outcome?.pendingJobs??[]).toEqual([]);}
  const first=await db().select().from(mediaOriginalErasureScopes).where(eq(mediaOriginalErasureScopes.requestId,original.id));expect(first).toHaveLength(2);for(const header of first)expect(header).toMatchObject({complete:true,membership:{legacyScopes:[],receipts:[],resources:[],uploads:[],reservations:[],legacyReservations:[]}});
  expect((await db().select().from(mediaStorageTransferErasureScopes).where(eq(mediaStorageTransferErasureScopes.requestId,original.id)))[0]).toMatchObject({complete:true,objectCount:0});await noProviderPrivilege();
 },60000);
 it("binds metadata authority to the actual request/scope/contact and retains the full I/O refusal",async()=>{
  const{contact,original}=await request(),other=await createContact.call({name:"Other original subject",email:"other-empty-scope@example.test"},OWNER);
  const wrong=await failure(db().transaction(tx=>lockOriginalMediaScopeCapture(tx,{requestId:original.id,contactId:other.id,scope:"media.storageOperations"})));expect(wrong.message).toContain("complete guarded migration");
  await db().transaction(async tx=>{expect(await lockOriginalMediaScopeCapture(tx,{requestId:original.id,contactId:contact.id,scope:"media.storageOperations"})).toBe("empty_metadata");const[flags]=await tx.execute<{request:string;scope:string;contact:string;io:string|null}>(sql`select current_setting('freeholder.media_empty_scope_request_v1',true) as request,current_setting('freeholder.media_empty_scope_name_v1',true) as scope,current_setting('freeholder.media_empty_scope_contact_v1',true) as contact,current_setting('freeholder.media_transfer_v1',true) as io`);expect(flags).toMatchObject({request:original.id,scope:"media.storageOperations",contact:contact.id});expect(flags?.io).not.toBe("1");expect((await failure(requireTransferCapability(tx))).message).toContain("complete guarded migration");});
  const refused=await failure(db().transaction(async tx=>{await lockOriginalMediaScopeCapture(tx,{requestId:original.id,contactId:contact.id,scope:"media.storageOperations"});return tx.insert(mediaOriginalErasureScopes).values({requestId:original.id,scope:"media.multipartOperations",membership:{format:"freeholder.original-media-erasure/v1",legacyScopes:[],receipts:[],resources:[],uploads:[],reservations:[],legacyReservations:[]},captureDigest:"0".repeat(64)});}));expect(refused).toMatchObject({cause:{code:"23514"}});expect(await db().select().from(mediaOriginalErasureScopes)).toEqual([]);await noProviderPrivilege();
 },60000);
 it("refuses a warm writer missing the original first-scope runtime ABI without minting any capture",async()=>{
  const{contact,original}=await request(),refused=await failure(db().transaction(async tx=>{await tx.execute(sql`select set_config('freeholder.media_original_scope_runtime_v1','',true)`);return lockOriginalMediaScopeCapture(tx,{requestId:original.id,contactId:contact.id,scope:"media.storageOperations"});}));expect(refused).toMatchObject({cause:{code:"23514"}});expect(await db().select().from(mediaOriginalErasureScopes)).toEqual([]);await noProviderPrivilege();
 },60000);
 it("refuses an actual later upload reservation without changing the original empty capture or its erasure artifact",async()=>{
  const{contact,original}=await request(),result=await fulfillDataRequest.call({id:original.id,confirmation:"ERASE"},OWNER),first=await db().select().from(mediaOriginalErasureScopes),transferFirst=await db().select().from(mediaStorageTransferErasureScopes);
  const[artifact]=await db().select().from(dataRequestArtifacts).where(eq(dataRequestArtifacts.id,result.artifact.id));
  const upload=await beginUpload.call({filename:"actual-later.png",contentType:"image/png",bytes:1},OWNER);expect(upload.strategy).toBe("proxy");const births=await db().select().from(mediaObjects),uploads=await db().select().from(mediaUploads);expect(births).toHaveLength(1);expect(births[0]?.reservationId).toBeTruthy();
  expect((await failure(db().transaction(tx=>lockOriginalMediaScopeCapture(tx,{requestId:original.id,contactId:contact.id,scope:"media.storageOperations"})))).message).toContain("complete guarded migration");expect(await db().select().from(mediaOriginalErasureScopes)).toEqual(first);expect(await db().select().from(mediaStorageTransferErasureScopes)).toEqual(transferFirst);expect(await db().select().from(mediaObjects)).toEqual(births);expect(await db().select().from(mediaUploads)).toEqual(uploads);expect((await db().select().from(dataRequestArtifacts).where(eq(dataRequestArtifacts.id,result.artifact.id)))[0]).toEqual(artifact);await noProviderPrivilege();
 },60000);
});
