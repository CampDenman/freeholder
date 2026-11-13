// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C1.08/C3.47/C11.14: opt-in actual published79 ->81 uploaded erasure recovery.
// The standalone fixture creates a NEW DB and runs the unchanged old f1 first.
// This file NEVER truncates, fabricates a completed request, or drops a guard.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db, closeDb } from "@/core/db";
import { ready } from "@/core/runtime";
import { getJob, stopJobs, type JobExecutionContext } from "@/core/jobs";
import { eraseImportSourceObjects } from "@/core/jobs/core-jobs";
import { createSession } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { dataRequestArtifacts, dataRequests } from "@/core/privacy/schema";
import { erasureArtifactIsIntact } from "@/core/privacy/service";
import { importRuns, importSourceEntries, importSourceGraphs, importSourceMedia } from "@/core/plugins/schema";
import { importSourceErasureScopes, importSourceErasureMembers, importSourceErasureObjects } from "@/core/import/source-erasure-schema";
import { reconcileOriginalSourceErasure } from "@/core/import/source-erasure-history";
import { startImport } from "@/core/import/service";
import { beginSourceUpload, previewFromUpload, uploadSourceChunk } from "@/core/import/source-upload";
import { storage } from "@/adapters/storage";

const configured = process.env.FREEHOLDER_UPLOADED_HISTORY_UPGRADE;
const optedIn = Boolean(configured && process.env.DATABASE_URL && new URL(process.env.DATABASE_URL).pathname === `/${configured}`);
const proof = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function preserved(id: string, graphId: string) {
  return { run: await db().select().from(importRuns).where(eq(importRuns.id,id)), graph: await db().select().from(importSourceGraphs).where(eq(importSourceGraphs.id,graphId)),
    entries: await db().select().from(importSourceEntries).where(eq(importSourceEntries.graphId,graphId)), media: await db().select().from(importSourceMedia).where(eq(importSourceMedia.graphId,graphId)) };
}
function worker(id: string): JobExecutionContext { return { id, name: eraseImportSourceObjects.name, attempt: 1, signal: new AbortController().signal, leaseSeconds: 120, heartbeat: async () => true, isCancelled: async () => false, throwIfCancelled: async () => {} }; }

describe.runIf(optedIn)("actual old79 uploaded false-completion recovery (C1.08/C3.47/C11.14)", { timeout: 60_000 }, () => {
  beforeAll(ready,60_000);
  afterAll(async()=>{vi.restoreAllMocks();await stopJobs();await closeDb();});
  it("reopens its retained verified task without adopting a later graph or fabricating missing initial membership", async () => {
    const fixture = JSON.parse(readFileSync(process.env.FREEHOLDER_UPLOADED_HISTORY_EVIDENCE!,"utf8")) as { database: string; requestId: string; originalJobId: string; runId: string; graphId: string; ownerId: string; originalTaskDigest: string; marker: string };
    expect(fixture.database).toBe(configured);
    const [request] = await db().select().from(dataRequests).where(eq(dataRequests.id,fixture.requestId));
    const [artifact] = await db().select().from(dataRequestArtifacts).where(eq(dataRequestArtifacts.dataRequestId,fixture.requestId));
    expect(request?.status).toBe("completed"); expect(request?.verifiedAt).toBeInstanceOf(Date); expect(erasureArtifactIsIntact(artifact)).toBe(true);
    const original = await getJob(eraseImportSourceObjects.name,fixture.originalJobId);
    if(!original)throw new Error("The actual old79 original task was not retained.");
    expect(proof(original.data)).toBe(fixture.originalTaskDigest);
    const oldBefore = await preserved(fixture.runId,fixture.graphId);
    expect(oldBefore.entries).toHaveLength(501); expect(JSON.stringify(oldBefore.entries)).toContain(fixture.marker);
    expect(oldBefore.media[0]?.sourceKeyDigest).toBeNull();
    for(const table of [importSourceErasureScopes,importSourceErasureMembers,importSourceErasureObjects]) expect(await db().select().from(table)).toHaveLength(0);

    // A real later reviewed upload exists before reconciliation. It cannot be
    // adopted as original membership merely because it is currently present.
    const session = await db().transaction(tx=>createSession(tx,fixture.ownerId,{twoFactorVerified:true}));
    const owner = await actorFromToken(session.token);
    const later = await startImport.call({kind:"wordpress-wxr",origin:"https://fictional-later-history.example"},owner);
    const bytes = new TextEncoder().encode('<rss xmlns:wp="urn:wordpress" xmlns:content="urn:content"><channel><link>https://fictional-later-history.example</link><item><title>later-history-reader@example.test</title><link>https://fictional-later-history.example/article</link><wp:post_id>1</wp:post_id><wp:post_type>post</wp:post_type><wp:status>publish</wp:status><content:encoded><![CDATA[<p>Actual later private input.</p>]]></content:encoded></item></channel></rss>');
    const upload = await beginSourceUpload.call({id:later.id,filename:"later-reviewed.xml",bytes:bytes.byteLength},owner);
    await uploadSourceChunk.call({id:later.id,uploadId:upload.uploadId,index:0,bytes},owner);
    let laterPreview=await previewFromUpload.call({id:later.id,uploadId:upload.uploadId},owner);
    for(let phase=0;phase<4&&laterPreview.status==="discover";phase++)laterPreview=await previewFromUpload.call({id:later.id,uploadId:upload.uploadId},owner);
    expect(laterPreview.status).toBe("previewed");
    const [laterGraph] = await db().select().from(importSourceGraphs).where(eq(importSourceGraphs.runId,later.id));
    if(!laterGraph)throw new Error("The actual later reviewed graph is missing.");
    const laterBefore = await preserved(later.id,laterGraph.id), laterKey=`imports/${later.id}/${upload.uploadId}/00000.part`;
    const laterBytes = await storage().get(laterKey); expect(laterBytes).toBeDefined();
    const physicalBefore = await db().execute(sql`select id,operation_kind,state,deleted_at from media_object_writes order by id`);
    const deletion = vi.spyOn(storage(),"delete");
    // This is the actual old task replay that previously returned ready:false
    // while leaving an erased/completed historical receipt untouched.
    expect(await eraseImportSourceObjects.handler(original.data,worker(original.id))).toEqual({erased:0});
    const [pending] = await db().select().from(dataRequestArtifacts).where(eq(dataRequestArtifacts.dataRequestId,fixture.requestId));
    expect(erasureArtifactIsIntact(pending)).toBe(true);
    const outcome = (pending!.body as {outcomes:Array<{scope:string;outcome:string;pendingJobs?:string[]}>}).outcomes.find(value=>value.scope==="imports.readerSources");
    expect(outcome?.outcome).toBe("pending"); expect(outcome?.pendingJobs).toHaveLength(1);
    expect((await db().select().from(dataRequests).where(eq(dataRequests.id,fixture.requestId)))[0]).toMatchObject({status:"in_progress",fulfilledAt:null,verifiedAt:request!.verifiedAt});
    const retry = await getJob(eraseImportSourceObjects.name,outcome!.pendingJobs![0]!);
    if(!retry)throw new Error("The shared reopen did not retain its actual recovery task.");
    expect(retry.data).toEqual({requestId:fixture.requestId,originalJobId:retry.id,keys:original.data.keys});
    expect(await reconcileOriginalSourceErasure.call({originalJobId:original.id},{kind:"system"})).toMatchObject({reopened:0,recoveryRequired:1,changed:false});
    expect(proof((await db().select().from(dataRequestArtifacts).where(eq(dataRequestArtifacts.dataRequestId,fixture.requestId)))[0])).toBe(proof(pending));
    await expect(eraseImportSourceObjects.handler(retry.data,worker(retry.id))).rejects.toThrow(/complete original uploaded-source erasure scope/);
    expect(deletion).not.toHaveBeenCalled();
    expect(await db().execute(sql`select id,operation_kind,state,deleted_at from media_object_writes order by id`)).toEqual(physicalBefore);
    expect(await preserved(fixture.runId,fixture.graphId)).toEqual(oldBefore);
    expect(await preserved(later.id,laterGraph.id)).toEqual(laterBefore); expect(await storage().get(laterKey)).toEqual(laterBytes);
    expect(proof((await getJob(eraseImportSourceObjects.name,original.id))!.data)).toBe(fixture.originalTaskDigest);
    for(const table of [importSourceErasureScopes,importSourceErasureMembers,importSourceErasureObjects]) expect(await db().select().from(table)).toHaveLength(0);
  });
});
