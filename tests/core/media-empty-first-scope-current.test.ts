// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
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

describe.runIf(hasDatabase)("C1.12/C11.08/C11.14 current-runtime empty first media capture",()=>{
 let provider:Awaited<ReturnType<typeof ordinaryMediaRecoveryProvider>>;
 beforeAll(async()=>{await ready();await stopJobs();},60000);
 beforeEach(async()=>{await truncateSpine();await db().insert(users).values({id:OWNER.userId,email:"empty-current-owner@example.test",role:"owner"});provider=await ordinaryMediaRecoveryProvider();for(const[name,value]of Object.entries({NODE_ENV:"test",FREEHOLDER_STORAGE:"s3",S3_ENDPOINT:provider.endpoint,S3_REGION:"fixture",S3_BUCKET:"source",S3_ACCESS_KEY_ID:"synthetic",S3_SECRET_ACCESS_KEY:"synthetic",FREEHOLDER_STORAGE_QUOTA_BYTES:"100",FREEHOLDER_STORAGE_QUOTA_INITIALIZE_EMPTY:"false"}))vi.stubEnv(name,value);resetEnvForTests();resetStorageForTests();});
 afterEach(async()=>{await provider?.close();vi.unstubAllEnvs();resetEnvForTests();resetStorageForTests();});afterAll(closeDb);
 async function request(){const contact=await createContact.call({name:"Empty current scope subject",email:"empty-current-subject@example.test"},OWNER),original=await createDataRequest.call({contactId:contact.id,request:{kind:"erasure"}},OWNER);await verifyDataRequest.call({id:original.id,method:"Fictional actual current subject verification"},OWNER);return{contact,original};}
 async function noProviderIO(){const[capability]=await db().execute<{request:string|null}>(sql`select to_regprocedure('freeholder_media_transfer_request_capability_v1()')::text as request`);expect(capability?.request).not.toBeNull();expect(await db().select().from(mediaStorageTransferCalls)).toEqual([]);expect(await db().select().from(mediaStorageTransferRequests)).toEqual([]);expect(provider.calls).toEqual([]);}
 it("seals actual empty first headers and an intact erasure artifact with current capability installed but unused",async()=>{
  const{original}=await request(),result=await fulfillDataRequest.call({id:original.id,confirmation:"ERASE"},OWNER),body=z.object({outcomes:z.array(z.object({scope:z.string(),outcome:z.string(),affected:z.number().optional(),pendingJobs:z.array(z.uuid()).optional()}))}).parse(result.artifact.body);
  for(const scope of ["media.storageTransfers","media.storageOperations","media.multipartOperations"]){const outcome=body.outcomes.find(row=>row.scope===scope);expect(outcome).toMatchObject({outcome:"erased",affected:0});expect(outcome?.pendingJobs??[]).toEqual([]);}
  const first=await db().select().from(mediaOriginalErasureScopes).where(eq(mediaOriginalErasureScopes.requestId,original.id));expect(first).toHaveLength(2);for(const header of first)expect(header).toMatchObject({complete:true,membership:{legacyScopes:[],receipts:[],resources:[],uploads:[],reservations:[],legacyReservations:[]}});
  expect((await db().select().from(mediaStorageTransferErasureScopes).where(eq(mediaStorageTransferErasureScopes.requestId,original.id)))[0]).toMatchObject({complete:true,objectCount:0});await noProviderIO();
 },60000);
 it("uses transaction-scoped complete protocol authority without provider IO and refuses a forged capture",async()=>{
  const{contact,original}=await request();
  await db().transaction(async tx=>{expect(await lockOriginalMediaScopeCapture(tx,{requestId:original.id,contactId:contact.id,scope:"media.storageOperations"})).toBe("complete_protocol");const[flags]=await tx.execute<{io:string|null}>(sql`select current_setting('freeholder.media_transfer_v1',true) as io`);expect(flags?.io).toBe("1");await requireTransferCapability(tx);});
  const refused=await failure(db().transaction(async tx=>{await lockOriginalMediaScopeCapture(tx,{requestId:original.id,contactId:contact.id,scope:"media.storageOperations"});return tx.insert(mediaOriginalErasureScopes).values({requestId:original.id,scope:"media.multipartOperations",membership:{format:"freeholder.original-media-erasure/v1",legacyScopes:[],receipts:[],resources:[],uploads:[],reservations:[],legacyReservations:[]},captureDigest:"0".repeat(64)});}));expect(refused).toMatchObject({cause:{code:"23514"}});expect(await db().select().from(mediaOriginalErasureScopes)).toEqual([]);await noProviderIO();
 },60000);
 it("does not rewrite an actual empty capture or artifact when a later upload is reserved",async()=>{
  const{contact,original}=await request(),result=await fulfillDataRequest.call({id:original.id,confirmation:"ERASE"},OWNER),first=await db().select().from(mediaOriginalErasureScopes),transferFirst=await db().select().from(mediaStorageTransferErasureScopes);
  const[artifact]=await db().select().from(dataRequestArtifacts).where(eq(dataRequestArtifacts.id,result.artifact.id));
  const upload=await beginUpload.call({filename:"actual-current-later.png",contentType:"image/png",bytes:1},OWNER);expect(upload.strategy).toBe("proxy");const births=await db().select().from(mediaObjects),uploads=await db().select().from(mediaUploads);expect(births).toHaveLength(1);expect(births[0]?.reservationId).toBeTruthy();
  await db().transaction(async tx=>{expect(await lockOriginalMediaScopeCapture(tx,{requestId:original.id,contactId:contact.id,scope:"media.storageOperations"})).toBe("complete_protocol");});expect(await db().select().from(mediaOriginalErasureScopes)).toEqual(first);expect(await db().select().from(mediaStorageTransferErasureScopes)).toEqual(transferFirst);expect(await db().select().from(mediaObjects)).toEqual(births);expect(await db().select().from(mediaUploads)).toEqual(uploads);expect((await db().select().from(dataRequestArtifacts).where(eq(dataRequestArtifacts.id,result.artifact.id)))[0]).toEqual(artifact);await noProviderIO();
 },60000);
});
