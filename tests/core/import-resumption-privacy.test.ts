// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.47: an unparsed old reader cannot cross erasure or lose a named raw hold.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, closeDb } from "@/core/db";
import { users, totpFactors } from "@/core/auth/schema";
import { createSession } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import type { Actor } from "@/core/service";
import { importSourceErasureMembers } from "@/core/import/source-erasure-schema";
import { mediaObjectWrites } from "@/core/media/write-schema";
import { storage, resetStorageForTests } from "@/adapters/storage";
import { resolveContact } from "@/core/contacts/service";
import { contacts } from "@/core/contacts/schema";
import { createDataRequest, verifyDataRequest, fulfillDataRequest, addRetentionException, removeRetentionException } from "@/core/privacy/service";
import { dataRequests } from "@/core/privacy/schema";
import { deleteUnownedPendingObjects } from "@/core/media/object-ledger";
import { importSourceEntries, importSourceGraphs } from "@/core/plugins/schema";
import { getJob, stopJobs, type JobExecutionContext } from "@/core/jobs";
import { eraseImportSourceObjects } from "@/core/jobs/core-jobs";
import { ensureDefaults } from "@/modules/cms/service";
import { blogReaderComments } from "@/modules/cms/blog-comments-schema";
import { commitImport, listImports, rollbackImport, startImport } from "@/core/import/service";
import { beginSourceUpload, previewFromUpload, uploadSourceChunk } from "@/core/import/source-upload";
import { originalStaticZip } from "../helpers/original-static-zip";
import { failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const ORIGIN = "https://fictional-graph-reader.example", EMAIL = "fictional-graph-reader@example.test";
const receipt = z.object({ outcomes: z.array(z.object({ scope: z.string(), outcome: z.string(), pendingJobs: z.array(z.uuid()).optional() })) });
const context = (id: string): JobExecutionContext => ({ id, name: eraseImportSourceObjects.name, attempt: 1, signal: new AbortController().signal, leaseSeconds: 300, heartbeat: async () => true, isCancelled: async () => false, throwIfCancelled: async () => {} });
type SourceKind = "wordpress-wxr" | "archive";
function source(kind: SourceKind) {
  if (kind === "archive") return originalStaticZip(Array.from({ length: 501 }, (_, index) => ({
    path: `site/reader/page-${index}.html`,
    body: `<html><head><title>${index === 0 ? EMAIL : `Fictional page ${index}`}</title></head><body><p>Article ${index}.</p>${index === 500 ? `<!-- Original private reader metadata ${EMAIL}. -->` : ""}</body></html>`,
  })));
  return new TextEncoder().encode(`<rss xmlns:wp="urn:wordpress" xmlns:content="urn:content"><channel><title>Fictional reader source</title><link>${ORIGIN}</link>${Array.from({ length: 501 }, (_, i) => `<item><title>${i === 0 ? EMAIL : `Fictional reader page ${i}`}</title><link>${ORIGIN}/reader/page-${i}</link><wp:post_id>${i + 1}</wp:post_id><wp:post_type>${i === 500 ? "post" : "page"}</wp:post_type><wp:status>publish</wp:status><content:encoded><![CDATA[<p>Fictional article ${i}.</p>]]></content:encoded>${i === 500 ? `<wp:comment><wp:comment_id>7001</wp:comment_id><wp:comment_author>Fictional reader</wp:comment_author><wp:comment_author_email>${EMAIL}</wp:comment_author_email><wp:comment_content>Fictional private original comment.</wp:comment_content><wp:comment_approved>1</wp:comment_approved></wp:comment>` : ""}</item>`).join("")}</channel></rss>`);
}
let owner: Actor;
async function staged(kind: SourceKind) {
  const reader = await resolveContact.call({ email: EMAIL }, owner), run = await startImport.call({ origin: ORIGIN, kind }, owner), bytes = source(kind);
  const upload = await beginSourceUpload.call({ id: run.id, filename: kind === "archive" ? "fictional-reader-graph.zip" : "fictional-reader-graph.xml", bytes: bytes.byteLength }, owner);
  await uploadSourceChunk.call({ id: run.id, uploadId: upload.uploadId, index: 0, bytes }, owner);
  const initial = await previewFromUpload.call({ id: run.id, uploadId: upload.uploadId }, owner);
  expect(await previewFromUpload.call({ id: run.id, uploadId: upload.uploadId }, owner)).toMatchObject({ status: "discover", counts: { indexed: 500 } });
  const request = await createDataRequest.call({ contactId: reader.contact.id, request: { kind: "erasure" } }, owner);
  await verifyDataRequest.call({ id: request.id, method: "Fictional reader source erasure verification" }, owner);
  return { reader, run, upload, initial, request, key: `imports/${run.id}/${upload.uploadId}/00000.part` };
}

for (const kind of ["wordpress-wxr", "archive"] as const) describe.runIf(hasDatabase)(`durable ${kind} source privacy boundaries (C3.47)`, { timeout: 60_000 }, () => {
  beforeEach(async () => {
    await truncateSpine(); resetStorageForTests();
    await db().insert(users).values({ id: OWNER.userId, email: "fictional-resumption-privacy-owner@example.test", role: "owner" });
    await db().insert(totpFactors).values({ userId: OWNER.userId, encryptedSecret: "fictional-resumption-privacy-factor" });
    const session = await db().transaction(tx => createSession(tx, OWNER.userId, { twoFactorVerified: true }));
    owner = await actorFromToken(session.token);
    if (owner.kind !== "user" || !owner.sessionId) throw new Error("The actual privacy owner session is unavailable.");
    await ensureDefaults.call({}, owner);
  });
  afterAll(async () => { vi.restoreAllMocks(); await stopJobs(); await closeDb(); });
  it("invalidates an unparsed original on real erasure and refuses its late reader-bearing result", async () => {
    const original = await staged(kind), store = storage(), get = store.get.bind(store);
    const originalEntries = await db().select().from(importSourceEntries);
    const [originalGraph] = await db().select().from(importSourceGraphs);
    expect(originalEntries).toHaveLength(500); expect(JSON.stringify(originalEntries)).toContain(EMAIL);
    let entered!: () => void, release!: () => void;
    const reached = new Promise<void>(resolve => { entered = resolve; }), pending = new Promise<void>(resolve => { release = resolve; });
    const spy = vi.spyOn(store, "get").mockImplementationOnce(async key => { const bytes = await get(key); entered(); await pending; return bytes; });
    const indexing = failure(previewFromUpload.call({ id: original.run.id, uploadId: original.upload.uploadId }, owner));
    let result: Awaited<ReturnType<typeof fulfillDataRequest.call>>;
    try { await reached; result = await fulfillDataRequest.call({ id: original.request.id, confirmation: "ERASE" }, owner); }
    finally { release(); spy.mockRestore(); }
    expect(await indexing).toMatchObject({ code: "conflict" });
    expect((await db().select().from(importSourceGraphs))[0]).toMatchObject({ state: "invalidated", leaseToken: null });
    expect(await db().select().from(importSourceEntries)).toHaveLength(500);
    expect(await failure(commitImport.call({ id: original.run.id, graph: original.initial.graph }, owner))).toMatchObject({ code: "conflict" });
    expect(await db().select().from(blogReaderComments)).toEqual([]);
    expect((await db().select().from(contacts).where(eq(contacts.id, original.reader.contact.id)))[0]!.email).toBeNull();
    expect(result!.request.status).toBe("in_progress");
    expect(await db().select().from(importSourceErasureMembers).where(eq(importSourceErasureMembers.requestId, original.request.id))).toMatchObject([{ runId: original.run.id, uploadId: original.upload.uploadId, graphId: originalGraph!.id, graphGeneration: originalGraph!.generation, sourceRevision: originalGraph!.sourceRevision }]);
    const source = receipt.parse(result!.artifact.body).outcomes.find(item => item.scope === "imports.readerSources")!;
    const job = await getJob(eraseImportSourceObjects.name, source.pendingJobs![0]!);
    await expect(eraseImportSourceObjects.handler(job!.data, context(job!.id))).rejects.toThrow(/ownership|unresolved/);
    expect(await rollbackImport.call({ id: original.run.id, graph: original.initial.graph }, owner)).toMatchObject({ status: "rolled_back" });
    // Rollback releases the mutable descriptor. The actual initial captured
    // graph/revision/chunk membership remains the completion authority.
    expect(JSON.stringify(await db().select().from(importSourceEntries))).toContain(EMAIL);
    await eraseImportSourceObjects.handler(job!.data, context(job!.id));
    expect(await storage().get(original.key)).toBeUndefined();
    const minimized = await db().select().from(importSourceEntries);
    expect(minimized).toHaveLength(500); expect(JSON.stringify(minimized)).not.toContain(EMAIL);
    expect(minimized.every(entry => JSON.stringify(entry.metadata) === JSON.stringify({ format: "uploaded-originals", redacted: true }) && entry.targetSlug === null)).toBe(true);
    const identity = (entry: typeof originalEntries[number]) => ({ id: entry.id, graphId: entry.graphId, ordinal: entry.ordinal, sourceIdentity: entry.sourceIdentity, digest: entry.digest, start: entry.startByte, end: entry.endByte, bodyBytes: entry.bodyBytes });
    expect(minimized.map(identity).sort((a,b)=>a.ordinal-b.ordinal)).toEqual(originalEntries.map(identity).sort((a,b)=>a.ordinal-b.ordinal));
    const physical = await db().select().from(mediaObjectWrites).where(eq(mediaObjectWrites.key, original.key));
    expect(physical.some(write => write.operation === "put" && write.state === "accepted" && write.deletedAt !== null)).toBe(true);
    expect(physical.some(write => write.operation === "delete" && write.state === "accepted")).toBe(true);
    expect((await db().select().from(dataRequests).where(eq(dataRequests.id, original.request.id)))[0]!.status).toBe("completed");
    expect(await db().select().from(blogReaderComments)).toEqual([]);
  });
  it("keeps the exact held original after graph rollback and releases it only after the named hold is removed", async () => {
    const original = await staged(kind);
    const hold = await addRetentionException.call({ dataRequestId: original.request.id, scope: "cms.readerComments", reason: "legal_claim", legalBasis: "Fictional retained original source evidence" }, owner);
    const result = await fulfillDataRequest.call({ id: original.request.id, confirmation: "ERASE" }, owner);
    expect(result.request.status).toBe("partially_completed");
    expect(receipt.parse(result.artifact.body).outcomes.find(item => item.scope === "imports.readerSources")).toMatchObject({ outcome: "retained" });
    expect(await rollbackImport.call({ id: original.run.id, graph: original.initial.graph }, owner)).toMatchObject({ status: "rolled_back" });
    expect(JSON.stringify(await listImports.call({}, owner))).not.toContain(hold.id);
    expect(await deleteUnownedPendingObjects([original.key])).toEqual({ deleted: 0 });
    expect(new TextDecoder().decode(await storage().get(original.key))).toContain(EMAIL);
    await removeRetentionException.call({ id: hold.id }, owner);
    expect(await deleteUnownedPendingObjects([original.key])).toEqual({ deleted: 1 });
    expect(await storage().get(original.key)).toBeUndefined();
  });
});
