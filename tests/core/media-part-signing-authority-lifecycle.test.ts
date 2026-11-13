// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// PREPARED / UNRUN. Actual shared service and configured S3 signer, fictional
// private TCP provider. No mocked authorization/context or fixture capability.
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from "vitest";
import {createServer} from "node:http";
import {randomUUID} from "node:crypto";
import {eq,sql} from "drizzle-orm";
import {db} from "@/core/db";
import {users} from "@/core/auth/schema";
import {ready} from "@/core/runtime";
import {stopJobs} from "@/core/jobs";
import {resetEnvForTests} from "@/core/env";
import {resetStorageForTests} from "@/adapters/storage";
import {beginUpload,signUploadParts} from "@/core/media/service";
import {mediaObjects,mediaUploads} from "@/core/media/schema";
import {mediaMultipartOperations,mediaMultipartResources} from "@/core/media/multipart-schema";
import {originalMultipart} from "@/core/media/multipart-operations";
import {allowMediaReceiptWrites} from "@/core/media/write-ledger";
import {closeDb,failure,hasDatabase,OWNER,truncateSpine} from "../helpers/spine";
async function actualOpenSessionProvider(){
 const sessions=new Map<string,string>(),calls:Array<{method:string;pathname:string}>=[];
 const server=createServer((req,res)=>{void(async()=>{
  for await(const chunk of req){if(!(typeof chunk==="string"||chunk instanceof Uint8Array))throw Error("Synthetic provider received non-byte request data.");}
  const url=new URL(req.url??"/","http://fixture.invalid");calls.push({method:req.method??"GET",pathname:url.pathname});
  if(req.method==="POST"&&url.searchParams.has("uploads")){const id=randomUUID();sessions.set(id,url.pathname);res.writeHead(200,{"content-type":"application/xml"}).end(`<InitiateMultipartUploadResult><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`);return;}
  res.writeHead(405).end();
 })().catch((error:unknown)=>res.destroy(error instanceof Error?error:new Error("Synthetic provider failed.")));});
 await new Promise<void>((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve);});const address=server.address();if(!address||typeof address==="string")throw Error("Synthetic provider did not bind TCP.");
 return{endpoint:`http://127.0.0.1:${address.port}`,sessions,calls,close:()=>new Promise<void>((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeAllConnections();})};
}
describe.runIf(hasDatabase)("C1.12/C11.08 shared part-signing durable-authority containment",()=>{
 let provider:Awaited<ReturnType<typeof actualOpenSessionProvider>>;
 beforeAll(async()=>{await ready();await stopJobs();},60000);
 beforeEach(async()=>{await truncateSpine();await db().insert(users).values({id:OWNER.userId,email:"part-authority-owner@example.test",role:"owner"});provider=await actualOpenSessionProvider();for(const[name,value]of Object.entries({NODE_ENV:"test",FREEHOLDER_STORAGE:"s3",S3_ENDPOINT:provider.endpoint,S3_REGION:"fixture",S3_BUCKET:"media",S3_ACCESS_KEY_ID:"fictional-key",S3_SECRET_ACCESS_KEY:"fictional-secret",S3_PUBLIC:"false",FREEHOLDER_STORAGE_QUOTA_BYTES:"",FREEHOLDER_STORAGE_QUOTA_INITIALIZE_EMPTY:"false",MALWARE_SCANNER:"none"}))vi.stubEnv(name,value);resetEnvForTests();resetStorageForTests();});
 afterEach(async()=>{vi.restoreAllMocks();await provider?.close();vi.unstubAllEnvs();resetEnvForTests();resetStorageForTests();});afterAll(closeDb);
 for(const state of ["created","uploading"]as const)it(`refuses actual signer issuance for an intact ${state} open provider session when durable per-part authority is unavailable`,async()=>{
  const[capability]=await db().execute<{part:string|null}>(sql`select to_regprocedure('freeholder_media_original_part_capability_v1()')::text as part`);expect(capability?.part).toBeNull();
  const upload=await beginUpload.call({filename:"original.pdf",contentType:"application/pdf",bytes:9},OWNER);expect(upload.strategy).toBe("direct_multipart");const captured=await originalMultipart(upload.id);expect(captured.resource.state).toBe("open");expect(captured.resource.providerUploadId).toBeTruthy();expect(provider.sessions.get(captured.resource.providerUploadId!)).toContain(captured.resource.key);
  // Only metadata selects the already-uploading legacy branch. The actual
  // CREATE/session/receipt above is genuine; no physical part or finish is
  // invented and no capability/authorizer is enabled by this fixture.
  if(state==="uploading")await db().transaction(async tx=>{await allowMediaReceiptWrites(tx);await tx.update(mediaUploads).set({state:"uploading"}).where(eq(mediaUploads.id,upload.id));});
  const multipart=captured.store.directMultipart;if(!multipart)throw Error("Actual configured private S3 signer is missing.");const signer=vi.spyOn(multipart,"signPart");expect((await originalMultipart(upload.id)).store.directMultipart).toBe(multipart);
  const before={uploads:await db().select().from(mediaUploads),objects:await db().select().from(mediaObjects),resources:await db().select().from(mediaMultipartResources),operations:await db().select().from(mediaMultipartOperations)},callsBefore=structuredClone(provider.calls),sessionsBefore=[...provider.sessions];
  const denied=await failure(signUploadParts.call({id:upload.id,partNumbers:[1]},OWNER));expect(denied.code).toBe("conflict");expect(denied.message).toContain("upload recovery is fully supported");expect(signer).not.toHaveBeenCalled();expect(await db().select().from(mediaUploads)).toEqual(before.uploads);expect(await db().select().from(mediaObjects)).toEqual(before.objects);expect(await db().select().from(mediaMultipartResources)).toEqual(before.resources);expect(await db().select().from(mediaMultipartOperations)).toEqual(before.operations);expect(provider.calls).toEqual(callsBefore);expect([...provider.sessions]).toEqual(sessionsBefore);expect((await db().select().from(mediaMultipartResources))[0]?.retiredAt).toBeNull();
 },60000);
});
