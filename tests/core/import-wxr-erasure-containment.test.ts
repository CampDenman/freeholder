// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C1.08/C3.47/C11.14: real published-main WXR originals and unaccepted graph copies.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/core/db";
import { users, totpFactors } from "@/core/auth/schema";
import { createSession } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { resolveContact } from "@/core/contacts/service";
import { mediaObjectWrites } from "@/core/media/write-schema";
import { dataRequestArtifacts, dataRequests } from "@/core/privacy/schema";
import { createDataRequest, verifyDataRequest, fulfillDataRequest } from "@/core/privacy/service";
import { importRuns, importSourceGraphs, importSourceEntries, importSourceMedia, importSourceBatches } from "@/core/plugins/schema";
import { startImport } from "@/core/import/service";
import { beginSourceUpload, uploadSourceChunk, previewFromUpload } from "@/core/import/source-upload";
import { IMPORT_SOURCE_ERASURE_SCOPE } from "@/core/import/source-erasure";
import { eraseImportSourceObjects } from "@/core/jobs/core-jobs";
import { getJob, stopJobs, type JobExecutionContext } from "@/core/jobs";
import { ready } from "@/core/runtime";
import { resetStorageForTests, storage } from "@/adapters/storage";
import { OWNER, closeDb, hasDatabase, truncateSpine } from "../helpers/spine";

const ORIGIN = "https://fictional-wxr-private-index.example";
const marker = "private-wxr-index-reader@example.test";
const outcomes = z.object({ outcomes: z.array(z.object({ scope: z.string(), outcome: z.string(), pendingJobs: z.array(z.uuid()).optional() }).passthrough()) }).passthrough();
function context(id: string): JobExecutionContext { return { id, name: eraseImportSourceObjects.name, attempt: 1, signal: new AbortController().signal,
  leaseSeconds: 120, heartbeat: async () => true, isCancelled: async () => false, throwIfCancelled: async () => {} }; }

describe.runIf(hasDatabase)("WXR private index completion containment (C1.08/C3.47/C11.14)", { timeout: 60_000 }, () => {
  beforeAll(ready, 60_000);
  beforeEach(async () => { await truncateSpine(); resetStorageForTests(); });
  afterEach(() => { vi.useRealTimers(); });
  afterAll(async () => { await stopJobs(); await closeDb(); });
  it("keeps the original receipt pending after raw deletion while the private index needs recovery", async () => {
    await db().insert(users).values({ id: OWNER.userId, email: "fictional-wxr-index-owner@example.test", role: "owner" });
    await db().insert(totpFactors).values({ userId: OWNER.userId, encryptedSecret: "fictional-wxr-index-factor" });
    const session = await db().transaction(tx => createSession(tx, OWNER.userId, { twoFactorVerified: true }));
    const owner = await actorFromToken(session.token);
    if (owner.kind !== "user" || !owner.sessionId) throw new Error("The real owner session is unavailable.");
    const xml = `<rss xmlns:wp="urn:wordpress" xmlns:content="urn:content"><channel><title>Unaccepted original source</title><link>${ORIGIN}</link>${Array.from({ length: 501 }, (_, index) => `<item><title>${index === 0 ? marker : `Original article ${index}`}</title><link>${ORIGIN}/original-${index}</link><wp:post_id>${index + 1}</wp:post_id><wp:post_type>post</wp:post_type><wp:status>publish</wp:status><content:encoded><![CDATA[<p>Original article body ${index}</p>${index === 0 ? `<img src="${ORIGIN}/image.png?reader=${marker}" alt="Original private reference">` : ""}]]></content:encoded>${index === 0 ? `<wp:comment><wp:comment_id>9001</wp:comment_id><wp:comment_author>Original private reader</wp:comment_author><wp:comment_author_email>${marker}</wp:comment_author_email><wp:comment_content>Original private input</wp:comment_content><wp:comment_approved>1</wp:comment_approved></wp:comment>` : ""}</item>`).join("")}</channel></rss>`;
    const bytes = new TextEncoder().encode(xml), run = await startImport.call({ origin: ORIGIN, kind: "wordpress-wxr" }, owner);
    const upload = await beginSourceUpload.call({ id: run.id, filename: "fictional-private-original.xml", bytes: bytes.byteLength }, owner);
    for (let index = 0; index < upload.chunkCount; index++) await uploadSourceChunk.call({ id: run.id, uploadId: upload.uploadId, index,
      bytes: bytes.slice(index * upload.chunkBytes, (index + 1) * upload.chunkBytes) }, owner);
    let staged = await previewFromUpload.call({ id: run.id, uploadId: upload.uploadId }, owner);
    for (let phase = 0; phase < 4 && staged.status === "discover"; phase++) staged = await previewFromUpload.call({ id: run.id, uploadId: upload.uploadId }, owner);
    expect(staged.status).toBe("previewed");
    const [graph] = await db().select().from(importSourceGraphs).where(eq(importSourceGraphs.runId, run.id));
    if (!graph) throw new Error("The actual original WXR did not produce its normalized source graph.");
    expect(graph.planDigest).toBeNull();
    expect(await db().select().from(importSourceBatches).where(eq(importSourceBatches.graphId, graph.id))).toHaveLength(0);
    const initial = await db().select().from(importSourceEntries).where(eq(importSourceEntries.graphId, graph.id));
    expect(initial).toHaveLength(501); expect(JSON.stringify(initial).includes(marker)).toBe(true);
    const [originalRun] = await db().select().from(importRuns).where(eq(importRuns.id, run.id));
    const window = z.object({ sourceUpload: z.object({ expiresAt: z.iso.datetime() }).passthrough().optional(), retainedSource: z.object({ expiresAt: z.iso.datetime() }).passthrough().optional() }).passthrough().parse(originalRun?.checkpoint);
    const expiries = [window.sourceUpload?.expiresAt, window.retainedSource?.expiresAt].filter((value): value is string => value !== undefined).map(value => Date.parse(value));
    expect(expiries.length).toBeGreaterThan(0);
    const writes = await db().select().from(mediaObjectWrites);
    expect(writes).toHaveLength(upload.chunkCount);
    expect(writes.every(write => write.operation === "put" && write.state === "accepted")).toBe(true);
    const person = (await resolveContact.call({ email: marker, name: "Original private reader" }, owner)).contact;
    const request = await createDataRequest.call({ contactId: person.id, request: { kind: "erasure" } }, owner);
    await verifyDataRequest.call({ id: request.id, method: "Synthetic original WXR reader verified for actual unaccepted input cleanup" }, owner);
    await fulfillDataRequest.call({ id: request.id, confirmation: "ERASE" }, owner);
    // The existing published contract retains its ordinary private window.
    // Model only passage beyond the actual captured expiry; real timers and
    // physical I/O remain real, and every original PUT is already settled.
    // Time is not used as evidence that a provider caller finished.
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Math.max(...expiries) + 1);

    const [pendingArtifact] = await db().select().from(dataRequestArtifacts).where(eq(dataRequestArtifacts.dataRequestId, request.id));
    const pendingJobs = outcomes.parse(pendingArtifact?.body).outcomes.find(value => value.scope === IMPORT_SOURCE_ERASURE_SCOPE)?.pendingJobs;
    expect(pendingJobs).toHaveLength(1);
    const job = await getJob(eraseImportSourceObjects.name, pendingJobs![0]!);
    if (!job) throw new Error("The real original WXR privacy task is missing.");
    await expect(eraseImportSourceObjects.handler(job.data, context(job.id))).rejects.toThrow(/private normalized import index/);
    const [artifact] = await db().select().from(dataRequestArtifacts).where(eq(dataRequestArtifacts.dataRequestId, request.id));
    expect(outcomes.parse(artifact?.body).outcomes.find(value => value.scope === IMPORT_SOURCE_ERASURE_SCOPE)).toMatchObject({ outcome: "pending", pendingJobs });
    expect((await db().select().from(dataRequests).where(eq(dataRequests.id, request.id)))[0]?.status).toBe("in_progress");
    for (let index = 0; index < upload.chunkCount; index++) expect(await storage().get(`imports/${run.id}/${upload.uploadId}/${String(index).padStart(5, "0")}.part`)).toBeUndefined();
    const [pendingRequest] = await db().select().from(dataRequests).where(eq(dataRequests.id, request.id));
    expect(pendingRequest?.fulfilledAt).toBeNull();
    expect(pendingRequest?.resolution).toContain("private normalized import index");
    const [retired] = await db().select().from(importSourceGraphs).where(eq(importSourceGraphs.id, graph.id));
    expect(retired?.state).toBe("invalidated");
    const entries = await db().select().from(importSourceEntries).where(eq(importSourceEntries.graphId, graph.id));
    const media = await db().select().from(importSourceMedia).where(eq(importSourceMedia.graphId, graph.id));
    expect(JSON.stringify({ header: retired?.headerMetadata, catalog: retired?.planMetadata, entries, media }).includes(marker)).toBe(true);
  });
});
