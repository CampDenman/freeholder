// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// PREPARED / UNRUN. Genuine shared metadata services with a fictional private
// provider. Final two controls require the real complete request ABI; neither
// a fixture flag nor synthetic ServiceContext can enable it.
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from "vitest";
import {eq} from "drizzle-orm";
import {db} from "@/core/db";
import {users} from "@/core/auth/schema";
import {contacts} from "@/core/contacts/schema";
import {createContact} from "@/core/contacts/service";
import {createDataRequest,verifyDataRequest,fulfillDataRequest} from "@/core/privacy/service";
import {ready} from "@/core/runtime";
import {stopJobs} from "@/core/jobs";
import {resetEnvForTests} from "@/core/env";
import {resetStorageForTests} from "@/adapters/storage";
import {beginUpload,abortUpload} from "@/core/media/service";
import {mediaUploads,mediaObjects} from "@/core/media/schema";
import {mediaOriginalErasureScopes} from "@/core/media/erasure-schema";
import {reduceTerminalUploadMetadata} from "@/core/media/original-upload-retention";
import {requireTransferCapability} from "@/core/media/transfer-authority";
import {objectKeyDigest} from "@/core/media/write-ledger";
import {ordinaryMediaRecoveryProvider} from "../helpers/media-original-provider-recovery";
import {closeDb,hasDatabase,OWNER,CUSTOMER,truncateSpine} from "../helpers/spine";
describe.runIf(hasDatabase)("genuine ordinary upload original reservation and metadata custody",()=>{
 let provider:Awaited<ReturnType<typeof ordinaryMediaRecoveryProvider>>;
 beforeAll(async()=>{await ready();await stopJobs();},60000);
 beforeEach(async()=>{await truncateSpine();await db().insert(users).values([{id:OWNER.userId,email:"binding-owner@example.test",role:"owner"},{id:CUSTOMER.userId,email:"binding-customer@example.test",role:"customer"}]);provider=await ordinaryMediaRecoveryProvider();for(const[name,value]of Object.entries({NODE_ENV:"test",FREEHOLDER_STORAGE:"s3",S3_ENDPOINT:provider.endpoint,S3_REGION:"fictional",S3_BUCKET:"source",S3_ACCESS_KEY_ID:"fictional",S3_SECRET_ACCESS_KEY:"fictional",FREEHOLDER_STORAGE_QUOTA_BYTES:"100",FREEHOLDER_STORAGE_QUOTA_INITIALIZE_EMPTY:"false"}))vi.stubEnv(name,value);resetEnvForTests();resetStorageForTests();});
 afterEach(async()=>{await provider?.close();vi.unstubAllEnvs();resetEnvForTests();resetStorageForTests();});afterAll(closeDb);
 async function reservation(){const contact=await createContact.call({name:"Original upload subject",email:"binding-customer@example.test"},OWNER);await db().update(contacts).set({userId:CUSTOMER.userId}).where(eq(contacts.id,contact.id));const input=await beginUpload.call({filename:"original.pdf",contentType:"application/pdf",bytes:4},CUSTOMER),[upload]=await db().select().from(mediaUploads).where(eq(mediaUploads.id,input.id)),[pointer]=await db().select().from(mediaObjects).where(eq(mediaObjects.uploadId,input.id));if(!upload||!pointer||!upload.originalReservationId)throw Error("Actual committed upload and original pointer required");return{contact,input,upload,pointer};}
 async function erase(contactId:string){const request=await createDataRequest.call({contactId,request:{kind:"erasure"}},OWNER);await verifyDataRequest.call({id:request.id,method:"Fictional independently verified original subject"},OWNER);const result=await fulfillDataRequest.call({id:request.id,confirmation:"ERASE"},OWNER);return{request,result};}
 it("commits both real metadata births with the same immutable UUID and original owner, without provider I/O",async()=>{const before=await reservation();expect(before.input.strategy).toBe("proxy");expect(before.pointer).toMatchObject({reservationId:before.upload.originalReservationId,uploadId:before.upload.id,key:before.upload.storageKey,ownerContactId:before.contact.id,state:"pending",role:"staged"});expect(before.pointer.createdAt).toEqual(before.upload.createdAt);expect(provider.calls).toEqual([]);},60000);
 it("keeps the original UUID through an actual customer abort without inventing a provider return",async()=>{const before=await reservation();expect(await abortUpload.call({id:before.input.id},CUSTOMER)).toEqual({ok:true});const[after]=await db().select().from(mediaUploads).where(eq(mediaUploads.id,before.input.id));expect(after).toMatchObject({id:before.upload.id,originalReservationId:before.upload.originalReservationId,state:"aborted",ownerContactId:before.contact.id});expect(provider.calls).toEqual([]);},60000);
 it("a future cleanup scan cannot manufacture thirty-day age or custody and preserves the actual upload evidence",async()=>{const before=await reservation();await abortUpload.call({id:before.input.id},CUSTOMER);const original=await db().select().from(mediaUploads);expect(await db().transaction(tx=>reduceTerminalUploadMetadata(tx,new Date(Date.now()+366*24*60*60*1000)))).toBe(0);expect(await db().select().from(mediaUploads)).toEqual(original);expect(provider.calls).toEqual([]);},60000);
 it("complete-request-ABI dependent: verified unwritten erasure retains the exact original UUID and first digest without a DELETE",async()=>{await db().transaction(requireTransferCapability);const before=await reservation();await abortUpload.call({id:before.input.id},CUSTOMER);const{request}=await erase(before.contact.id),[after]=await db().select().from(mediaUploads).where(eq(mediaUploads.id,before.input.id)),[first]=await db().select().from(mediaOriginalErasureScopes).where(eq(mediaOriginalErasureScopes.requestId,request.id));expect(after).toMatchObject({originalReservationId:before.upload.originalReservationId,storageKey:`retained:${objectKeyDigest(before.upload.storageKey)}`,ownerContactId:null,uploadedBy:"erased",filename:"[erased]"});expect(first?.membership.uploads).toContainEqual({id:before.upload.id,reservationId:before.upload.originalReservationId,keyDigest:objectKeyDigest(before.upload.storageKey),witness:expect.stringMatching(/^[a-f0-9]{64}$/)});expect(await db().select().from(mediaObjects)).toEqual([]);expect(provider.calls).toEqual([]);},60000);
 it("complete-request-ABI dependent: a new verified same-subject request reuses only the intact prior first identity and never rewrites the old scope",async()=>{await db().transaction(requireTransferCapability);const before=await reservation();await abortUpload.call({id:before.input.id},CUSTOMER);const initial=await erase(before.contact.id),old=await db().select().from(mediaOriginalErasureScopes).where(eq(mediaOriginalErasureScopes.requestId,initial.request.id));await erase(before.contact.id);expect(await db().select().from(mediaOriginalErasureScopes).where(eq(mediaOriginalErasureScopes.requestId,initial.request.id))).toEqual(old);const rows=await db().select().from(mediaOriginalErasureScopes),scopes=rows.filter(row=>row.scope==="media.multipartOperations");expect(scopes).toHaveLength(2);for(const scope of scopes)expect(scope.membership.uploads[0]).toMatchObject({id:before.upload.id,reservationId:before.upload.originalReservationId,keyDigest:objectKeyDigest(before.upload.storageKey)});expect(provider.calls).toEqual([]);},60000);
});
