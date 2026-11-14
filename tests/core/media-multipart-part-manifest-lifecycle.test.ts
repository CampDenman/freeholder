// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// PREPARED / UNRUN. Genuine shared metadata services plus owned fictional TCP
// CREATE. No part signer, provider consumption, transport auth or ABI claim.
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from "vitest";
import {createHash,randomUUID} from "node:crypto";
import {sql} from "drizzle-orm";
import {db} from "@/core/db";
import {users} from "@/core/auth/schema";
import {ready} from "@/core/runtime";
import {stopJobs} from "@/core/jobs";
import {resetEnvForTests} from "@/core/env";
import {resetStorageForTests} from "@/adapters/storage";
import {beginUpload,declareUploadParts} from "@/core/media/service";
import {mediaMultipartOperations} from "@/core/media/multipart-schema";
import {mediaStorageTransferCalls} from "@/core/media/transfer-schema";
import {createContact} from "@/core/contacts/service";
import {addRetentionException,createDataRequest,verifyDataRequest} from "@/core/privacy/service";
import {multipartBirthProvider} from "../helpers/media-multipart-birth-provider";
import {closeDb,failure,hasDatabase,OWNER,truncateSpine} from "../helpers/spine";
const body=new TextEncoder().encode("actual"),parts=[{partNumber:1,bytes:body.byteLength,sha256:createHash("sha256").update(body).digest("hex")}];
describe.runIf(hasDatabase)("real original multipart body declaration (complete request capability dependent)",()=>{
 let provider:Awaited<ReturnType<typeof multipartBirthProvider>>;
 beforeAll(async()=>{await ready();await stopJobs();const[capability]=await db().execute<{present:boolean}>(sql`select to_regprocedure('freeholder_media_transfer_request_capability_v1()') is not null as present`);if(capability?.present!==true)throw Error("Prepared declaration controls require the genuine complete request ABI; no fixture flag/context may provide it.");},60000);
 beforeEach(async()=>{await truncateSpine();await db().insert(users).values({id:OWNER.userId,email:"part-manifest-owner@example.test",role:"owner"});provider=await multipartBirthProvider();for(const[name,value]of Object.entries({NODE_ENV:"test",FREEHOLDER_STORAGE:"s3",S3_ENDPOINT:provider.endpoint,S3_REGION:"fictional",S3_BUCKET:"source",S3_ACCESS_KEY_ID:"fictional-owned",S3_SECRET_ACCESS_KEY:"fictional-owned",S3_PUBLIC:"false",FREEHOLDER_STORAGE_QUOTA_BYTES:"",FREEHOLDER_STORAGE_QUOTA_INITIALIZE_EMPTY:"false"}))vi.stubEnv(name,value);resetEnvForTests();resetStorageForTests();});
 afterEach(async()=>{await provider?.close();vi.unstubAllEnvs();resetEnvForTests();resetStorageForTests();});afterAll(closeDb);
 const begin=()=>beginUpload.call({filename:"original.pdf",contentType:"application/pdf",bytes:body.byteLength},OWNER);
 it("binds the complete declared body to the actual original CREATE and is idempotent without a signer or more provider calls",async()=>{const upload=await begin(),beforeCalls=[...provider.calls],beforeCallers=await db().select().from(mediaStorageTransferCalls),manifest=await declareUploadParts.call({id:upload.id,parts},OWNER);expect(manifest.partCount).toBe(1);expect(manifest.digest).toMatch(/^[a-f0-9]{64}$/);expect(await declareUploadParts.call({id:upload.id,parts},OWNER)).toEqual(manifest);const[operation]=await db().select().from(mediaMultipartOperations);expect(operation?.partBodies?.id).toBe(manifest.declarationId);expect(operation?.partBodies?.parts).toEqual(parts);expect(operation?.partBodies?.originalCreateCallId).toBe(beforeCallers[0]?.id);expect(provider.calls).toEqual(beforeCalls);expect(await db().select().from(mediaStorageTransferCalls)).toEqual(beforeCallers);},60000);
 it("refuses a same-size different file on resume and preserves the first manifest/session/caller",async()=>{const upload=await begin();await declareUploadParts.call({id:upload.id,parts},OWNER);const before=await db().select().from(mediaMultipartOperations),beforeCalls=[...provider.calls],beforeCallers=await db().select().from(mediaStorageTransferCalls);await failure(declareUploadParts.call({id:upload.id,parts:[{...parts[0]!,sha256:"f".repeat(64)}]},OWNER));expect(await db().select().from(mediaMultipartOperations)).toEqual(before);expect(await db().select().from(mediaStorageTransferCalls)).toEqual(beforeCallers);expect(provider.calls).toEqual(beforeCalls);},60000);
 it("refuses wrong exact part size before changing the original operation or issuing provider authority",async()=>{const upload=await begin(),before=await db().select().from(mediaMultipartOperations),beforeCalls=[...provider.calls];await failure(declareUploadParts.call({id:upload.id,parts:[{...parts[0]!,bytes:body.byteLength-1}]},OWNER));expect(await db().select().from(mediaMultipartOperations)).toEqual(before);expect(provider.calls).toEqual(beforeCalls);},60000);
 it("refuses another real customer's upload ID without changing the manifest or reaching the provider",async()=>{const upload=await begin(),userId=randomUUID();await db().insert(users).values({id:userId,email:"other-part-customer@example.test",role:"customer"});const before=await db().select().from(mediaMultipartOperations),beforeCalls=[...provider.calls];await failure(declareUploadParts.call({id:upload.id,parts},{kind:"user",userId,role:"customer"}));expect(await db().select().from(mediaMultipartOperations)).toEqual(before);expect(provider.calls).toEqual(beforeCalls);},60000);
 it("keeps an unknown-owner resource under an actual named hold without declaring bodies or issuing a URL",async()=>{const upload=await begin(),subject=await createContact.call({name:"Held original subject",email:"part-held@example.test"},OWNER),request=await createDataRequest.call({contactId:subject.id,request:{kind:"erasure"}},OWNER);await verifyDataRequest.call({id:request.id,method:"Fictional independently verified original subject"},OWNER);await addRetentionException.call({dataRequestId:request.id,scope:"media.multipartOperations",reason:"legal_claim",legalBasis:"Fictional named original preservation control"},OWNER);const before=await db().select().from(mediaMultipartOperations),beforeCalls=[...provider.calls];await failure(declareUploadParts.call({id:upload.id,parts},OWNER));expect(await db().select().from(mediaMultipartOperations)).toEqual(before);expect(provider.calls).toEqual(beforeCalls);},60000);
});
