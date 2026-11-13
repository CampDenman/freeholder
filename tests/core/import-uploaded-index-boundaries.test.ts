// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C1.08/C3.47: held, accepted and later uploaded generations keep their identity.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { users, totpFactors } from "@/core/auth/schema";
import { createSession } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { resolveContact } from "@/core/contacts/service";
import { mediaObjectWrites } from "@/core/media/write-schema";
import { dataRequestArtifacts, dataRequests } from "@/core/privacy/schema";
import { privacyRetentionSourceMembers, privacyRetentionSourceSnapshots } from "@/core/privacy/retention-schema";
import { addRetentionException, createDataRequest, verifyDataRequest, fulfillDataRequest } from "@/core/privacy/service";
import { importRuns, importSourceGraphs, importSourceEntries, importSourceMedia, importSourceBatches } from "@/core/plugins/schema";
import { importSourceErasureMembers } from "@/core/import/source-erasure-schema";
import { startImport, commitImport } from "@/core/import/service";
import { beginSourceUpload, uploadSourceChunk, previewFromUpload } from "@/core/import/source-upload";
import { IMPORT_SOURCE_ERASURE_SCOPE } from "@/core/import/source-erasure";
import { eraseImportSourceObjects } from "@/core/jobs/core-jobs";
import { getJob, stopJobs, type JobExecutionContext } from "@/core/jobs";
import { ready } from "@/core/runtime";
import { resetStorageForTests, storage } from "@/adapters/storage";
import { pages } from "@/modules/cms/schema";
import { OWNER, closeDb, hasDatabase, truncateSpine } from "../helpers/spine";

const ORIGIN="https://fictional-uploaded-index.example";
async function ownerSession() {
  await db().insert(users).values({id:OWNER.userId,email:"fictional-upload-index-owner@example.test",role:"owner"});
  await db().insert(totpFactors).values({userId:OWNER.userId,encryptedSecret:"fictional-upload-index-factor"});
  const session=await db().transaction(tx=>createSession(tx,OWNER.userId,{twoFactorVerified:true}));
  const actor=await actorFromToken(session.token);
  if(actor.kind!=="user"||!actor.sessionId)throw new Error("A real owner session is required.");
  return actor;
}
async function original(owner:Awaited<ReturnType<typeof ownerSession>>,marker:string,media=true) {
  const xml=`<rss xmlns:wp="urn:wordpress" xmlns:content="urn:content"><channel><title>Actual uploaded boundary</title><link>${ORIGIN}</link>${Array.from({length:501},(_,index)=>`<item><title>${index===0?marker:`Actual article ${index}`}</title><link>${ORIGIN}/original-${index}</link><wp:post_id>${index+1}</wp:post_id><wp:post_type>post</wp:post_type><wp:status>publish</wp:status><content:encoded><![CDATA[<p>Original body ${index}</p>${index===0&&media?`<img src="${ORIGIN}/${marker}.png">`:""}]]></content:encoded></item>`).join("")}</channel></rss>`;
  const bytes=new TextEncoder().encode(xml),run=await startImport.call({origin:ORIGIN,kind:"wordpress-wxr"},owner);
  const upload=await beginSourceUpload.call({id:run.id,filename:"fictional-original.xml",bytes:bytes.byteLength},owner);
  for(let index=0;index<upload.chunkCount;index++)await uploadSourceChunk.call({id:run.id,uploadId:upload.uploadId,index,bytes:bytes.slice(index*upload.chunkBytes,(index+1)*upload.chunkBytes)},owner);
  let preview=await previewFromUpload.call({id:run.id,uploadId:upload.uploadId},owner);
  for(let phase=0;phase<4&&preview.status==="discover";phase++)preview=await previewFromUpload.call({id:run.id,uploadId:upload.uploadId},owner);
  expect(preview.status).toBe("previewed");
  const [graph]=await db().select().from(importSourceGraphs).where(eq(importSourceGraphs.runId,run.id));
  if(!graph)throw new Error("The original uploaded graph is missing.");
  const [saved]=await db().select().from(importRuns).where(eq(importRuns.id,run.id));
  const checkpoint=saved!.checkpoint as {retainedSource:{expiresAt:string}};
  const keys=Array.from({length:upload.chunkCount},(_,index)=>`imports/${run.id}/${upload.uploadId}/${String(index).padStart(5,"0")}.part`);
  return {run,upload,graph,keys,expiresAt:Date.parse(checkpoint.retainedSource.expiresAt)};
}
async function snapshot(id:string,graphId:string) {
  return {run:(await db().select().from(importRuns).where(eq(importRuns.id,id)))[0],graph:(await db().select().from(importSourceGraphs).where(eq(importSourceGraphs.id,graphId)))[0],entries:await db().select().from(importSourceEntries).where(eq(importSourceEntries.graphId,graphId)),media:await db().select().from(importSourceMedia).where(eq(importSourceMedia.graphId,graphId))};
}
async function requestFor(owner:Awaited<ReturnType<typeof ownerSession>>,email:string) {
  const contact=(await resolveContact.call({email},owner)).contact;
  return createDataRequest.call({contactId:contact.id,request:{kind:"erasure"}},owner);
}
async function task(requestId:string) {
  const [artifact]=await db().select().from(dataRequestArtifacts).where(eq(dataRequestArtifacts.dataRequestId,requestId));
  const scope=(artifact!.body as {outcomes:Array<{scope:string;pendingJobs?:string[]}>}).outcomes.find(item=>item.scope===IMPORT_SOURCE_ERASURE_SCOPE);
  expect(scope?.pendingJobs).toHaveLength(1);
  const job=await getJob(eraseImportSourceObjects.name,scope!.pendingJobs![0]!);
  if(!job)throw new Error("The actual original uploaded-source task is missing.");
  const context:JobExecutionContext={id:job.id,name:eraseImportSourceObjects.name,attempt:1,signal:new AbortController().signal,leaseSeconds:120,heartbeat:async()=>true,isCancelled:async()=>false,throwIfCancelled:async()=>{}};
  return {job,context};
}

describe.runIf(hasDatabase)("actual uploaded index ownership boundaries (C1.08/C3.47)",{timeout:60_000},()=>{
  beforeAll(ready,60_000);
  beforeEach(async()=>{await truncateSpine();resetStorageForTests();});
  afterEach(()=>vi.useRealTimers());
  afterAll(async()=>{await stopJobs();await closeDb();});

  it("preserves an actually held original graph and its exact canonical generation without rekeying private input",async()=>{
    const owner=await ownerSession(),marker="fictional-held-wxr@example.test",source=await original(owner,marker);
    const request=await requestFor(owner,marker);
    const hold=await addRetentionException.call({dataRequestId:request.id,scope:"cms.readerComments",reason:"legal_claim",legalBasis:"Synthetic actual uploaded graph retention boundary"},owner);
    const headers=await db().select().from(privacyRetentionSourceSnapshots).where(eq(privacyRetentionSourceSnapshots.exceptionId,hold.id));
    const members=await db().select().from(privacyRetentionSourceMembers).where(eq(privacyRetentionSourceMembers.exceptionId,hold.id));
    expect(members).toMatchObject([{sourceId:source.run.id,generation:source.upload.uploadId}]);
    const before=await snapshot(source.run.id,source.graph.id);
    expect(before.media[0]?.key).toContain(marker);
    await verifyDataRequest.call({id:request.id,method:"Synthetic verified actual held source"},owner);
    expect((await fulfillDataRequest.call({id:request.id,confirmation:"ERASE"},owner)).request.status).toBe("partially_completed");
    expect(await snapshot(source.run.id,source.graph.id)).toEqual(before);
    expect(await db().select().from(privacyRetentionSourceSnapshots).where(eq(privacyRetentionSourceSnapshots.exceptionId,hold.id))).toEqual(headers);
    expect(await db().select().from(privacyRetentionSourceMembers).where(eq(privacyRetentionSourceMembers.exceptionId,hold.id))).toEqual(members);
    for(const key of source.keys)expect(await storage().get(key)).toBeDefined();
    expect((await db().select().from(mediaObjectWrites)).some(row=>row.operation==="delete")).toBe(false);
  });

  it("refuses physical cleanup of a real accepted content batch while preserving its actual CMS ownership",async()=>{
    const owner=await ownerSession(),marker="fictional-accepted-wxr@example.test",source=await original(owner,marker,false);
    await commitImport.call({id:source.run.id,graph:{generation:source.graph.generation,sourceRevision:source.graph.sourceRevision,planRevision:source.graph.planRevision}},owner);
    const [admitted]=await db().select().from(importSourceGraphs).where(eq(importSourceGraphs.id,source.graph.id));
    expect(admitted?.planDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(await db().select().from(importSourceBatches).where(eq(importSourceBatches.graphId,source.graph.id))).toHaveLength(1);
    const ownedPages=await db().select().from(pages);expect(ownedPages.length).toBeGreaterThanOrEqual(500);
    const request=await requestFor(owner,marker);await verifyDataRequest.call({id:request.id,method:"Synthetic accepted original input review"},owner);
    await fulfillDataRequest.call({id:request.id,confirmation:"ERASE"},owner);
    const before=await snapshot(source.run.id,source.graph.id),{job,context}=await task(request.id);
    vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(source.expiresAt+1);
    await expect(eraseImportSourceObjects.handler(job.data,context)).rejects.toThrow(/accepted or unresolved business ownership/);
    expect(await snapshot(source.run.id,source.graph.id)).toEqual(before);
    expect(await db().select().from(pages)).toEqual(ownedPages);
    for(const key of source.keys)expect(await storage().get(key)).toBeDefined();
    expect((await db().select().from(mediaObjectWrites)).some(row=>row.operation==="delete")).toBe(false);
    expect((await db().select().from(dataRequests).where(eq(dataRequests.id,request.id)))[0]?.status).toBe("in_progress");
  });

  it("finishes only the captured original while leaving a later actually reviewed graph and its bytes unchanged",async()=>{
    const owner=await ownerSession(),first=await original(owner,"fictional-original-wxr@example.test");
    const request=await requestFor(owner,"fictional-original-wxr@example.test");await verifyDataRequest.call({id:request.id,method:"Synthetic original-only scope review"},owner);
    await fulfillDataRequest.call({id:request.id,confirmation:"ERASE"},owner);
    const later=await original(owner,"fictional-later-wxr@example.test"),laterBefore=await snapshot(later.run.id,later.graph.id);
    const laterBytes=await Promise.all(later.keys.map(key=>storage().get(key)));
    const captured=await db().select().from(importSourceErasureMembers).where(eq(importSourceErasureMembers.requestId,request.id));
    expect(captured).toMatchObject([{runId:first.run.id,uploadId:first.upload.uploadId,graphId:first.graph.id,graphGeneration:first.graph.generation,sourceRevision:first.graph.sourceRevision}]);
    const {job,context}=await task(request.id);
    vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(first.expiresAt+1);
    await eraseImportSourceObjects.handler(job.data,context);
    expect((await db().select().from(dataRequests).where(eq(dataRequests.id,request.id)))[0]?.status).toBe("completed");
    for(const key of first.keys)expect(await storage().get(key)).toBeUndefined();
    expect(await snapshot(later.run.id,later.graph.id)).toEqual(laterBefore);
    expect(await Promise.all(later.keys.map(key=>storage().get(key)))).toEqual(laterBytes);
    expect(await db().select().from(importSourceErasureMembers).where(eq(importSourceErasureMembers.requestId,request.id))).toEqual(captured);
  });
});
