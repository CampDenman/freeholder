// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Qualified on the migration-0092 runtime. Actual shared privacy/upload +
// guarded metadata transactions and fictional private TCP; no ingress/account
// acceptance claim.
//
// This file used to assert the pre-0092 "empty_metadata" authority, whose
// premise was that freeholder_media_transfer_request_capability_v1 is ABSENT.
// Migration 0092 installs it, so lockOriginalMediaScopeCapture now always takes
// the complete-protocol branch and that premise is structurally impossible
// here. The current-runtime successors for the sealed empty headers, the
// transaction-scoped protocol authority, the forged-capture refusal and the
// later-reservation invariance all live in
// media-empty-first-scope-current.test.ts.
//
// What is re-aimed and kept below is the part that moved rather than
// disappeared: the request/scope/contact binding. In the old runtime the DB
// writer function refused a foreign subject inside the LOCK. In the current
// runtime the lock grants complete protocol to any caller and the binding is
// enforced by captureFirstOriginalMediaScope, which is where it is asserted
// now. Nothing else in tests/ covers it.
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from "vitest";
import {sql} from "drizzle-orm";
import {db} from "@/core/db";
import {users} from "@/core/auth/schema";
import {createContact} from "@/core/contacts/service";
import {createDataRequest,verifyDataRequest} from "@/core/privacy/service";
import {ready} from "@/core/runtime";
import {stopJobs} from "@/core/jobs";
import {resetEnvForTests} from "@/core/env";
import {resetStorageForTests} from "@/adapters/storage";
import {mediaOriginalErasureScopes} from "@/core/media/erasure-schema";
import {mediaStorageTransferCalls} from "@/core/media/transfer-schema";
import {mediaStorageTransferRequests} from "@/core/media/transfer-request-schema";
import {captureFirstOriginalMediaScope,type OriginalMediaScope} from "@/core/media/original-erasure-scope";
import {lockOriginalMediaScopeCapture} from "@/core/media/empty-scope-authority";
import {ordinaryMediaRecoveryProvider} from "../helpers/media-original-provider-recovery";
import {closeDb,failure,hasDatabase,OWNER,truncateSpine} from "../helpers/spine";
const scopes:OriginalMediaScope[]=["media.storageOperations","media.multipartOperations"];
describe.runIf(hasDatabase)("C1.12/C11.08 empty first media capture binds its owning erasure request",()=>{
 let provider:Awaited<ReturnType<typeof ordinaryMediaRecoveryProvider>>;
 beforeAll(async()=>{await ready();await stopJobs();const[capability]=await db().execute<{present:boolean}>(sql`select to_regprocedure('freeholder_media_transfer_request_capability_v1()') is not null as present`);if(capability?.present!==true)throw Error("Prepared empty first-scope binding controls require the complete actual request capability; no fixture flag or provider authority is substituted.");},60000);
 beforeEach(async()=>{await truncateSpine();await db().insert(users).values({id:OWNER.userId,email:"empty-scope-owner@example.test",role:"owner"});provider=await ordinaryMediaRecoveryProvider();for(const[name,value]of Object.entries({NODE_ENV:"test",FREEHOLDER_STORAGE:"s3",S3_ENDPOINT:provider.endpoint,S3_REGION:"fixture",S3_BUCKET:"source",S3_ACCESS_KEY_ID:"synthetic",S3_SECRET_ACCESS_KEY:"synthetic",FREEHOLDER_STORAGE_QUOTA_BYTES:"100",FREEHOLDER_STORAGE_QUOTA_INITIALIZE_EMPTY:"false"}))vi.stubEnv(name,value);resetEnvForTests();resetStorageForTests();});
 afterEach(async()=>{await provider?.close();vi.unstubAllEnvs();resetEnvForTests();resetStorageForTests();});afterAll(closeDb);
 async function request(){const contact=await createContact.call({name:"Empty original scope subject",email:"empty-scope-subject@example.test"},OWNER),original=await createDataRequest.call({contactId:contact.id,request:{kind:"erasure"}},OWNER);await verifyDataRequest.call({id:original.id,method:"Fictional actual subject verification"},OWNER);return{contact,original};}
 async function noProviderIO(){expect(await db().select().from(mediaStorageTransferCalls)).toEqual([]);expect(await db().select().from(mediaStorageTransferRequests)).toEqual([]);expect(provider.calls).toEqual([]);}
 it("refuses a foreign subject for every original scope without minting any capture, while the shared lock alone confers no binding",async()=>{
  const{contact,original}=await request(),other=await createContact.call({name:"Other original subject",email:"other-empty-scope@example.test"},OWNER);
  for(const scope of scopes){const wrong=await failure(db().transaction(tx=>captureFirstOriginalMediaScope(tx,original.id,other.id,scope)));expect(wrong.message).toContain("The original media capture needs its actual owning erasure request.");}
  expect(await db().select().from(mediaOriginalErasureScopes)).toEqual([]);
  // The lock itself is deliberately NOT the binding in this runtime: it grants
  // the complete protocol to any caller and sets the full provider caller tag,
  // so a module that locks without re-checking its owning request would accept
  // a foreign subject. Pin that, so the caller-side check cannot be dropped
  // silently.
  await db().transaction(async tx=>{expect(await lockOriginalMediaScopeCapture(tx,{requestId:original.id,contactId:other.id,scope:"media.storageOperations"})).toBe("complete_protocol");const[flags]=await tx.execute<{io:string|null}>(sql`select current_setting('freeholder.media_transfer_v1',true) as io`);expect(flags?.io).toBe("1");});
  expect(await db().select().from(mediaOriginalErasureScopes)).toEqual([]);
  // The owning subject still captures its genuinely empty first membership.
  const owned=await db().transaction(tx=>captureFirstOriginalMediaScope(tx,original.id,contact.id,"media.storageOperations"));
  expect(owned.header).toMatchObject({requestId:original.id,scope:"media.storageOperations",complete:true,membership:{legacyScopes:[],receipts:[],resources:[],uploads:[],reservations:[],legacyReservations:[]}});
  await noProviderIO();
 },60000);
 it("keeps the first empty capture immutable: the owner re-reads it and a foreign subject still cannot replace it",async()=>{
  const{contact,original}=await request(),other=await createContact.call({name:"Later original subject",email:"later-empty-scope@example.test"},OWNER);
  const first=await db().transaction(tx=>captureFirstOriginalMediaScope(tx,original.id,contact.id,"media.storageOperations")),headers=await db().select().from(mediaOriginalErasureScopes);
  expect(headers).toHaveLength(1);
  const again=await db().transaction(tx=>captureFirstOriginalMediaScope(tx,original.id,contact.id,"media.storageOperations"));
  expect(again.header.captureDigest).toBe(first.header.captureDigest);expect(again.header).toEqual(first.header);
  expect((await failure(db().transaction(tx=>captureFirstOriginalMediaScope(tx,original.id,other.id,"media.storageOperations")))).message).toContain("The original media capture needs its actual owning erasure request.");
  expect(await db().select().from(mediaOriginalErasureScopes)).toEqual(headers);
  await noProviderIO();
 },60000);
});
