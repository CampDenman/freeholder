// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// PREPARED / UNRUN: real shared services and fictional owned loopback provider.
// Requires the genuine complete request capability; no fixture ABI or context.
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from "vitest";
import {eq,sql} from "drizzle-orm";
import {db} from "@/core/db";
import {users} from "@/core/auth/schema";
import {ready} from "@/core/runtime";
import {stopJobs} from "@/core/jobs";
import {resetEnvForTests} from "@/core/env";
import {resetStorageForTests} from "@/adapters/storage";
import {beginUpload} from "@/core/media/service";
import {createOriginalMultipart} from "@/core/media/multipart-operations";
import {mediaMultipartOperations as operations,mediaMultipartResources as resources} from "@/core/media/multipart-schema";
import {mediaObjectWrites} from "@/core/media/write-schema";
import {mediaStorageTransferCalls as calls} from "@/core/media/transfer-schema";
import {mediaStorageTransferRequests as requests} from "@/core/media/transfer-request-schema";
import {lockTransferInventory} from "@/core/media/transfer-authority";
import {multipartBirthProvider} from "../helpers/media-multipart-birth-provider";
import {closeDb,failure,hasDatabase,OWNER,truncateSpine} from "../helpers/spine";
describe.runIf(hasDatabase)("genuine original multipart CREATE first baseline (full request capability dependent)",()=>{
 let provider:Awaited<ReturnType<typeof multipartBirthProvider>>;
 beforeAll(async()=>{await ready();await stopJobs();const[capability]=await db().execute<{present:boolean}>(sql`select to_regprocedure('freeholder_media_transfer_request_capability_v1()') is not null as present`);if(capability?.present!==true)throw Error("Prepared multipart birth controls require the full genuine request capability; it must never be installed by a fixture.");},60000);
 beforeEach(async()=>{await truncateSpine();await db().insert(users).values({id:OWNER.userId,email:"multipart-birth-owner@example.test",role:"owner"});provider=await multipartBirthProvider();for(const[name,value]of Object.entries({NODE_ENV:"test",FREEHOLDER_STORAGE:"s3",S3_ENDPOINT:provider.endpoint,S3_REGION:"fictional",S3_BUCKET:"source",S3_ACCESS_KEY_ID:"fictional-owned",S3_SECRET_ACCESS_KEY:"fictional-owned",S3_PUBLIC:"false",FREEHOLDER_STORAGE_QUOTA_BYTES:"",FREEHOLDER_STORAGE_QUOTA_INITIALIZE_EMPTY:"false"}))vi.stubEnv(name,value);resetEnvForTests();resetStorageForTests();});
 afterEach(async()=>{await provider?.close();vi.unstubAllEnvs();resetEnvForTests();resetStorageForTests();});afterAll(closeDb);
 const begin=()=>beginUpload.call({filename:"original.pdf",contentType:"application/pdf",bytes:6},OWNER);
 it("captures both complete actual pre-dispatch passes and binds exactly one physical CREATE and returned session to its original caller",async()=>{
  const upload=await begin(),[resource]=await db().select().from(resources).where(eq(resources.uploadId,upload.id)),[operation]=await db().select().from(operations),[caller]=await db().select().from(calls);
  expect(upload.strategy).toBe("direct_multipart");expect(resource).toMatchObject({state:"open",providerUploadId:"actual-fictional-session-1",originalReservationId:expect.any(String)});expect(operation?.createBaseline).toMatchObject({state:"complete",callId:caller?.id,namespace:resource?.namespace,keyDigest:resource?.keyDigest});expect(operation?.createBaseline?.pages).toHaveLength(8);expect(operation?.writerFinishedAt).toBeTruthy();expect(caller).toMatchObject({kind:"multipart_create",state:"returned",multipartOperationId:operation?.id});
  const physical=await db().select().from(requests);expect(physical).toHaveLength(9);expect(physical.every(row=>row.state==="returned"&&row.returnedAt)).toBe(true);const post=provider.calls.filter(row=>row.method==="POST");expect(post).toHaveLength(1);expect(post[0]?.requestId).toBe(physical.find(row=>row.descriptor.kind==="multipart.create")?.id);expect(provider.sessions.size).toBe(1);expect(await db().select().from(mediaObjectWrites)).toEqual([]);
 },60000);
 it("refuses current-key404 with retained exact-key version bytes before CREATE without adopting or deleting that original resource",async()=>{
  const gate=provider.pauseNextInventory(),running=begin();let settled=false;const outcome=running.then(value=>({value}),error=>({error}));try{await gate.started;const[resource]=await db().select().from(resources);if(!resource)throw Error("The actual original reservation must commit before inventory");const body=new TextEncoder().encode("retained-original-bytes");provider.versions.set("retained-exact-version",{key:`/source/${resource.key}`,body});expect((await fetch(`${provider.endpoint}/source/${resource.key}`,{method:"HEAD"})).status).toBe(404);gate.release();const result=await outcome;settled=true;expect(result).toHaveProperty("error");expect(provider.calls.filter(row=>row.method==="POST"||row.method==="DELETE")).toEqual([]);expect(provider.versions.get("retained-exact-version")?.body).toEqual(body);expect((await db().select().from(resources))[0]).toMatchObject({id:resource.id,originalReservationId:resource.originalReservationId,providerUploadId:null,objectReceiptId:null,retiredAt:null});expect(await db().select().from(mediaObjectWrites)).toEqual([]);}finally{gate.release();if(!settled)await outcome;}
 },60000);
 it("retains a genuinely lost CREATE and its first baseline without assigning the current singleton session or replaying CREATE",async()=>{
  provider.loseNextCreateResponse();await failure(begin());const[resource]=await db().select().from(resources),[operation]=await db().select().from(operations),[caller]=await db().select().from(calls),physical=await db().select().from(requests);expect(provider.sessions.size).toBe(1);expect(resource).toMatchObject({state:"unknown",providerUploadId:null,objectReceiptId:null,retiredAt:null});expect(operation?.createBaseline?.state).toBe("complete");expect(operation?.writerFinishedAt).toBeTruthy();expect(caller).toMatchObject({state:"unknown",observedAcceptedAt:null});expect(caller?.returnedAt).toBeTruthy();expect(physical.filter(row=>row.descriptor.kind==="multipart.create")).toHaveLength(1);expect(physical.find(row=>row.descriptor.kind==="multipart.create")?.state).toBe("unknown");if(!resource||!operation)throw Error("Actual original CREATE evidence missing");expect((await failure(createOriginalMultipart(resource.uploadId,operation.id))).message).toContain("cannot be restarted");expect(provider.calls.filter(row=>row.method==="POST")).toHaveLength(1);expect(await db().select().from(operations)).toEqual([operation]);expect(await db().select().from(calls)).toEqual([caller]);expect(await db().select().from(mediaObjectWrites)).toEqual([]);
 },60000);
 it("keeps the actual paused CREATE caller FIN NULL despite both empty passes, then retains only its actual late session and finish",async()=>{
  const gate=provider.pauseNextCreate(),running=begin(),outcome=running.then(value=>({value}),error=>({error}));try{await gate.started;const[operation]=await db().select().from(operations),[caller]=await db().select().from(calls);expect(operation?.createBaseline?.state).toBe("complete");expect(operation?.writerFinishedAt).toBeNull();expect(caller?.returnedAt).toBeNull();expect(provider.sessions.size).toBe(0);expect((await db().select().from(resources))[0]?.providerUploadId).toBeNull();gate.release();expect(await outcome).toHaveProperty("value");expect((await db().select().from(operations))[0]?.writerFinishedAt).toBeTruthy();expect((await db().select().from(calls))[0]?.returnedAt).toBeTruthy();expect(provider.sessions.size).toBe(1);expect(provider.calls.filter(row=>row.method==="POST")).toHaveLength(1);}finally{gate.release();await outcome;}
 },60000);
 it("refuses direct rewriting of a sealed first baseline while preserving the original caller, session and header",async()=>{
  await begin();const[original]=await db().select().from(operations),beforeCalls=await db().select().from(calls),beforeResource=await db().select().from(resources);if(!original?.createBaseline)throw Error("Actual first baseline missing");await failure(db().transaction(async tx=>{await lockTransferInventory(tx);await tx.update(operations).set({createBaseline:{...original.createBaseline!,pages:[]}}).where(eq(operations.id,original.id));}));expect(await db().select().from(operations)).toEqual([original]);expect(await db().select().from(calls)).toEqual(beforeCalls);expect(await db().select().from(resources)).toEqual(beforeResource);expect(provider.calls.filter(row=>row.method==="POST")).toHaveLength(1);
 },60000);
});
