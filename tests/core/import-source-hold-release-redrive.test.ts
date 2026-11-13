// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C1.08/C3.47/C11.14: a new verified request finishes a released original hold.
import { createHash } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, closeDb } from "@/core/db";
import { users, totpFactors } from "@/core/auth/schema";
import { createSession } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import type { Actor } from "@/core/service";
import { contacts } from "@/core/contacts/schema";
import { resolveContact } from "@/core/contacts/service";
import { dataRequestArtifacts, dataRequests } from "@/core/privacy/schema";
import { addRetentionException, createDataRequest, fulfillDataRequest, removeRetentionException, verifyDataRequest, erasureArtifactIsIntact } from "@/core/privacy/service";
import { importRuns, importSourceEntries, importSourceGraphs, importSourceMedia } from "@/core/plugins/schema";
import { importSourceErasureMembers, importSourceErasureObjects, importSourceErasureScopes } from "@/core/import/source-erasure-schema";
import { rollbackImport, startImport } from "@/core/import/service";
import { beginSourceUpload, previewFromUpload, uploadSourceChunk } from "@/core/import/source-upload";
import { resetStorageForTests, storage } from "@/adapters/storage";
import { mediaObjectWrites } from "@/core/media/write-schema";
import { deleteUnownedPendingObjects } from "@/core/media/object-ledger";
import { eraseImportSourceObjects } from "@/core/jobs/core-jobs";
import { getJob, stopJobs, type JobExecutionContext } from "@/core/jobs";
import { ensureDefaults } from "@/modules/cms/service";
import { originalStaticZip } from "../helpers/original-static-zip";
import { hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const ORIGIN = "https://fictional-hold-redrive.example";
const EMAIL = "fictional-released-reader@example.test";
const LATER = "fictional-later-release@example.test";
const receipt = z.object({ format: z.literal("freeholder.erasure-receipt"), outcomes: z.array(z.object({ scope: z.string(), outcome: z.string(), pendingJobs: z.array(z.uuid()).optional() })) });
type SourceKind = "wordpress-wxr" | "archive";
let owner: Actor;

function originalBytes(kind: SourceKind, marker: string) {
  if (kind === "archive") return originalStaticZip(Array.from({ length: 501 }, (_, index) => ({
    path: `site/redrive/page-${index}.html`,
    body: `<html><head><title>${index === 0 ? marker : `Fictional page ${index}`}</title></head><body><p>Article ${index}.</p>${index === 500 ? `<!-- Original private reader metadata ${marker}. -->` : ""}</body></html>`,
  })));
  return new TextEncoder().encode(`<rss xmlns:wp="urn:wordpress" xmlns:content="urn:content"><channel><title>Fictional released original</title><link>${ORIGIN}</link>${Array.from({ length: 501 }, (_, index) => `<item><title>${index === 0 ? marker : `Fictional page ${index}`}</title><link>${ORIGIN}/redrive/page-${index}</link><wp:post_id>${index + 1}</wp:post_id><wp:post_type>page</wp:post_type><wp:status>publish</wp:status><content:encoded><![CDATA[<p>Article ${index}.</p>${index === 500 ? `<!-- Original private reader metadata ${marker}. -->` : ""}]]></content:encoded></item>`).join("")}</channel></rss>`);
}

async function stage(kind: SourceKind, marker: string) {
  const run = await startImport.call({ origin: ORIGIN, kind }, owner), bytes = originalBytes(kind, marker);
  const upload = await beginSourceUpload.call({ id: run.id, filename: kind === "archive" ? "fictional-released.zip" : "fictional-released.xml", bytes: bytes.byteLength }, owner);
  expect(upload.chunkCount).toBe(1);
  await uploadSourceChunk.call({ id: run.id, uploadId: upload.uploadId, index: 0, bytes }, owner);
  const initial = await previewFromUpload.call({ id: run.id, uploadId: upload.uploadId }, owner);
  expect(await previewFromUpload.call({ id: run.id, uploadId: upload.uploadId }, owner)).toMatchObject({ status: "discover", counts: { indexed: 500 } });
  const [graph] = await db().select().from(importSourceGraphs).where(eq(importSourceGraphs.runId, run.id));
  if (!graph) throw new Error("The actual original graph is unavailable.");
  return { run, upload, initial, graph, key: `imports/${run.id}/${upload.uploadId}/00000.part` };
}

async function captured(requestId: string) {
  return {
    header: await db().select().from(importSourceErasureScopes).where(eq(importSourceErasureScopes.requestId, requestId)),
    members: await db().select().from(importSourceErasureMembers).where(eq(importSourceErasureMembers.requestId, requestId)),
    objects: await db().select().from(importSourceErasureObjects).where(eq(importSourceErasureObjects.requestId, requestId)),
  };
}
async function snapshot(runId: string, graphId: string) {
  return {
    run: (await db().select().from(importRuns).where(eq(importRuns.id, runId)))[0],
    graph: (await db().select().from(importSourceGraphs).where(eq(importSourceGraphs.id, graphId)))[0],
    entries: await db().select().from(importSourceEntries).where(eq(importSourceEntries.graphId, graphId)),
    media: await db().select().from(importSourceMedia).where(eq(importSourceMedia.graphId, graphId)),
  };
}

for (const kind of ["wordpress-wxr", "archive"] as const) describe.runIf(hasDatabase)(`released ${kind} original redrive (C1.08/C3.47/C11.14)`, { timeout: 60_000 }, () => {
  beforeEach(async () => {
    await truncateSpine(); resetStorageForTests();
    await db().insert(users).values({ id: OWNER.userId, email: "fictional-release-owner@example.test", role: "owner" });
    await db().insert(totpFactors).values({ userId: OWNER.userId, encryptedSecret: "fictional-release-owner-factor" });
    const session = await db().transaction(tx => createSession(tx, OWNER.userId, { twoFactorVerified: true }));
    owner = await actorFromToken(session.token);
    if (owner.kind !== "user" || !owner.sessionId) throw new Error("The actual redrive owner session is unavailable.");
    await ensureDefaults.call({}, owner);
  });
  afterAll(async () => { vi.restoreAllMocks(); await stopJobs(); await closeDb(); });

  it("finishes the released original through a new verified request while preserving its retained receipt and a later graph", async () => {
    const contact = (await resolveContact.call({ email: EMAIL }, owner)).contact, original = await stage(kind, EMAIL);
    const first = await createDataRequest.call({ contactId: contact.id, request: { kind: "erasure" } }, owner);
    const hold = await addRetentionException.call({ dataRequestId: first.id, scope: "cms.readerComments", reason: "legal_claim", legalBasis: "Fictional original input retained until claim resolution" }, owner);
    await verifyDataRequest.call({ id: first.id, method: "Actual original reader identity verified for hold" }, owner);
    const retained = await fulfillDataRequest.call({ id: first.id, confirmation: "ERASE" }, owner);
    expect(retained.request.status).toBe("partially_completed");
    expect(receipt.parse(retained.artifact.body).outcomes.find(item => item.scope === "imports.readerSources")).toMatchObject({ outcome: "retained" });
    const firstCapture = await captured(first.id);
    expect(firstCapture.header).toMatchObject([{ captureVersion: 1, sourceCount: 1, objectCount: 1 }]);
    expect(firstCapture.members).toMatchObject([{ runId: original.run.id, uploadId: original.upload.uploadId, graphId: original.graph.id, graphGeneration: original.graph.generation, sourceRevision: original.graph.sourceRevision, chunkCount: 1 }]);
    expect(firstCapture.objects).toMatchObject([{ chunkIndex: 0, keyDigest: createHash("sha256").update(original.key).digest("hex") }]);
    const originalEntries = await db().select().from(importSourceEntries).where(eq(importSourceEntries.graphId, original.graph.id));
    expect(originalEntries).toHaveLength(500); expect(JSON.stringify(originalEntries)).toContain(EMAIL);
    expect(await rollbackImport.call({ id: original.run.id, graph: original.initial.graph }, owner)).toMatchObject({ status: "rolled_back" });
    expect(await deleteUnownedPendingObjects([original.key])).toEqual({ deleted: 0 });
    expect(new TextDecoder().decode(await storage().get(original.key))).toContain(EMAIL);
    await removeRetentionException.call({ id: hold.id }, owner);
    expect(await deleteUnownedPendingObjects([original.key])).toEqual({ deleted: 1 });
    expect(await storage().get(original.key)).toBeUndefined();
    expect((await db().select().from(contacts).where(eq(contacts.id, contact.id)))[0]?.email).toBeNull();
    expect(await captured(first.id)).toEqual(firstCapture);
    expect(JSON.stringify(await db().select().from(importSourceEntries).where(eq(importSourceEntries.graphId, original.graph.id)))).toContain(EMAIL);
    const [retainedArtifact] = await db().select().from(dataRequestArtifacts).where(eq(dataRequestArtifacts.dataRequestId, first.id));
    expect(erasureArtifactIsIntact(retainedArtifact)).toBe(true);
    const originalWrites = await db().select().from(mediaObjectWrites).where(eq(mediaObjectWrites.key, original.key));
    expect(originalWrites.filter(write => write.operation === "put")).toHaveLength(1);
    expect(originalWrites.filter(write => write.operation === "delete")).toHaveLength(1);
    expect(originalWrites.every(write => write.state === "accepted" && write.deletedAt !== null)).toBe(true);
    expect(new Set(originalWrites.map(write => write.namespace)).size).toBe(1);
    expect(originalWrites.every(write => typeof write.namespace === "string" && /^[a-f0-9]{64}$/.test(write.namespace))).toBe(true);
    expect(originalWrites.every(write => write.keyDigest === createHash("sha256").update(`freeholder:media-object-key:v1\0${original.key}`).digest("hex"))).toBe(true);

    // The documented terminal partial receipt stays truthful. Staff use a NEW
    // request for the same retained contact, not re-verification of old work.
    const next = await createDataRequest.call({ contactId: contact.id, request: { kind: "erasure" } }, owner);
    expect(next.id).not.toBe(first.id);
    const verified = await verifyDataRequest.call({ id: next.id, method: "Actual same retained contact verified again after named hold release" }, owner);
    const resumed = await fulfillDataRequest.call({ id: next.id, confirmation: "ERASE" }, owner);
    expect(resumed.request.status).toBe("in_progress");
    const pending = receipt.parse(resumed.artifact.body).outcomes.find(item => item.scope === "imports.readerSources");
    expect(pending?.pendingJobs).toHaveLength(1);
    const job = await getJob(eraseImportSourceObjects.name, pending!.pendingJobs![0]!);
    if (!job) throw new Error("The actual released-original erasure task is unavailable.");
    expect(job.data).toEqual({ requestId: next.id, originalJobId: job.id, keys: [original.key] });
    const nextCapture = await captured(next.id);
    expect(nextCapture.header).toMatchObject([{ captureVersion: 1, sourceCount: 1, objectCount: 1 }]);
    expect(nextCapture.objects).toMatchObject([{ chunkIndex: 0, keyDigest: createHash("sha256").update(original.key).digest("hex") }]);
    expect(nextCapture.members).toMatchObject([{ runId: original.run.id, uploadId: original.upload.uploadId, graphId: original.graph.id, graphGeneration: original.graph.generation, sourceRevision: original.graph.sourceRevision }]);

    // This actual source appears AFTER the new initial capture. No current
    // graph, replacement namespace or later bytes can supply old authority.
    const later = await stage(kind, LATER);
    let laterPreview = await previewFromUpload.call({ id: later.run.id, uploadId: later.upload.uploadId }, owner);
    for (let phase = 0; phase < 4 && laterPreview.status === "discover"; phase++) laterPreview = await previewFromUpload.call({ id: later.run.id, uploadId: later.upload.uploadId }, owner);
    expect(laterPreview.status).toBe("previewed");
    const laterBefore = await snapshot(later.run.id, later.graph.id), laterBytes = await storage().get(later.key);
    expect(laterBefore.entries).toHaveLength(501); expect(JSON.stringify(laterBefore)).toContain(LATER); expect(laterBytes).toBeDefined();
    const context: JobExecutionContext = { id: job.id, name: eraseImportSourceObjects.name, attempt: 1, signal: new AbortController().signal, leaseSeconds: 300, heartbeat: async () => true, isCancelled: async () => false, throwIfCancelled: async () => {} };
    const deleteSpy = vi.spyOn(storage(), "delete");
    await eraseImportSourceObjects.handler(job.data, context);
    expect(deleteSpy).not.toHaveBeenCalled(); deleteSpy.mockRestore();
    const [finished] = await db().select().from(dataRequests).where(eq(dataRequests.id, next.id));
    expect(finished).toMatchObject({ status: "completed", verifiedAt: verified.verifiedAt });
    const [finishedArtifact] = await db().select().from(dataRequestArtifacts).where(eq(dataRequestArtifacts.dataRequestId, next.id));
    const outcome = receipt.parse(finishedArtifact!.body).outcomes.find(item => item.scope === "imports.readerSources");
    expect(outcome).toMatchObject({ outcome: "erased" });
    expect(outcome?.pendingJobs ?? []).toEqual([]);
    expect(erasureArtifactIsIntact(finishedArtifact)).toBe(true);
    const minimized = await db().select().from(importSourceEntries).where(eq(importSourceEntries.graphId, original.graph.id));
    expect(minimized).toHaveLength(500); expect(JSON.stringify(minimized)).not.toContain(EMAIL);
    expect(minimized.every(entry => JSON.stringify(entry.metadata) === JSON.stringify({ format: "uploaded-originals", redacted: true }) && entry.targetSlug === null)).toBe(true);
    const identity = (entry: typeof originalEntries[number]) => ({ id: entry.id, graphId: entry.graphId, ordinal: entry.ordinal, sourceIdentity: entry.sourceIdentity, digest: entry.digest, start: entry.startByte, end: entry.endByte, bodyBytes: entry.bodyBytes });
    expect(minimized.map(identity).sort((a, b) => a.ordinal - b.ordinal)).toEqual(originalEntries.map(identity).sort((a, b) => a.ordinal - b.ordinal));
    expect(JSON.stringify(await snapshot(original.run.id, original.graph.id))).not.toContain(EMAIL);
    expect(await captured(first.id)).toEqual(firstCapture); expect(await captured(next.id)).toEqual(nextCapture);
    expect((await db().select().from(dataRequests).where(eq(dataRequests.id, first.id)))[0]?.status).toBe("partially_completed");
    expect((await db().select().from(dataRequestArtifacts).where(eq(dataRequestArtifacts.dataRequestId, first.id)))[0]).toEqual(retainedArtifact);
    expect(await db().select().from(mediaObjectWrites).where(eq(mediaObjectWrites.key, original.key))).toEqual(originalWrites);
    expect(await snapshot(later.run.id, later.graph.id)).toEqual(laterBefore); expect(await storage().get(later.key)).toEqual(laterBytes);
    await eraseImportSourceObjects.handler(job.data, context);
    expect((await db().select().from(dataRequestArtifacts).where(eq(dataRequestArtifacts.dataRequestId, next.id)))[0]).toEqual(finishedArtifact);
    expect(await db().select().from(mediaObjectWrites).where(eq(mediaObjectWrites.key, original.key))).toEqual(originalWrites);
    expect(await snapshot(later.run.id, later.graph.id)).toEqual(laterBefore); expect(await storage().get(later.key)).toEqual(laterBytes);
  });
});
