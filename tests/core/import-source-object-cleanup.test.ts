// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.22/C2.29/C11.10: source bytes need a recoverable deletion path.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetStorageForTests, storage } from "@/adapters/storage";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { resolveContact, getContact } from "@/core/contacts/service";
import { createDataRequest, verifyDataRequest, fulfillDataRequest } from "@/core/privacy/service";
import { auditLog } from "@/core/events/schema";
import { db } from "@/core/db";
import { importRuns } from "@/core/plugins/schema";
import { mediaObjects } from "@/core/media/schema";
import { deleteCaptureObjects } from "@/core/media/capture";
import { listJobHistory } from "@/core/jobs";
import { makeRetainedImportSource, readRetainedSourceChunk } from "@/core/import/retained-source";
import { cleanupOrphanedMedia } from "@/core/media/service";
import { startImport } from "@/core/import/service";
import { beginSourceUpload, previewFromUpload, uploadSourceChunk } from "@/core/import/source-upload";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const EMAIL = "raw-reader@example.test";
const source = new TextEncoder().encode(`<rss xmlns:wp="http://wordpress.org/export/1.2/" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>Raw source fixture</title><link>https://source.example</link><item><title>Fixture article</title><link>https://source.example/article</link><wp:post_id>10</wp:post_id><wp:post_name>article</wp:post_name><wp:post_type>post</wp:post_type><wp:status>publish</wp:status><content:encoded>Ordinary article</content:encoded><wp:comment><wp:comment_id>20</wp:comment_id><wp:comment_author>Fixture reader</wp:comment_author><wp:comment_author_email>${EMAIL}</wp:comment_author_email><wp:comment_content>Private source reader data.</wp:comment_content><wp:comment_approved>1</wp:comment_approved></wp:comment></item></channel></rss>`);

async function uploaded() {
  const run = await startImport.call({ origin: "https://source.example", kind: "wordpress-wxr" }, OWNER);
  const upload = await beginSourceUpload.call({ id: run.id, filename: "source.xml", bytes: source.byteLength }, OWNER);
  await uploadSourceChunk.call({ id: run.id, uploadId: upload.uploadId, index: 0, bytes: source }, OWNER);
  const [saved] = await db().select().from(importRuns).where(eq(importRuns.id, run.id));
  const checkpoint = z.object({ sourceUpload: z.object({ uploadId: z.string(), filename: z.string(), bytes: z.number(), chunkBytes: z.number(), digests: z.record(z.string(), z.string()), expiresAt: z.string() }) }).parse(saved!.checkpoint);
  return { run, upload, descriptor: makeRetainedImportSource(run.id, checkpoint.sourceUpload), checkpoint: saved!.checkpoint as Record<string, unknown>, key: `imports/${run.id}/${upload.uploadId}/00000.part` };
}

describe.runIf(hasDatabase)("raw import-source byte cleanup", () => {
  beforeEach(async () => { await truncateSpine(); resetStorageForTests(); });
  afterEach(() => vi.restoreAllMocks());
  afterAll(closeDb);

  it("recovers a failed source-byte deletion after parsing instead of leaving an untracked private copy", async () => {
    const run = await startImport.call({ origin: "https://source.example", kind: "wordpress-wxr" }, OWNER);
    const upload = await beginSourceUpload.call({ id: run.id, filename: "source.xml", bytes: source.byteLength }, OWNER);
    await uploadSourceChunk.call({ id: run.id, uploadId: upload.uploadId, index: 0, bytes: source }, OWNER);
    const key = `imports/${run.id}/${upload.uploadId}/00000.part`;
    const store = storage();
    const unavailable = vi.spyOn(store, "delete").mockRejectedValueOnce(new Error("Synthetic temporary provider outage"));
    const staged = await previewFromUpload.call({ id: run.id, uploadId: upload.uploadId }, OWNER);
    expect(staged.status).toBe("previewed");
    const jobs = await listJobHistory({ name: "core.deleteCaptureObjects", limit: 100 });
    expect(jobs.items.filter(job => JSON.stringify(job.data.keys) === JSON.stringify([key])).length).toBeGreaterThanOrEqual(2);
    expect(new TextDecoder().decode(await store.get(key))).toContain(EMAIL);
    unavailable.mockRestore();
    await cleanupOrphanedMedia(new Date(Date.now() + 25 * 60 * 60 * 1000));
    expect(await store.get(key)).toBeUndefined();
  });

  it("refuses a public storage configuration before reserving or writing private source input", async () => {
    const run = await startImport.call({ origin: "https://source.example", kind: "wordpress-wxr" }, OWNER);
    const store = storage(), descriptor = Object.getOwnPropertyDescriptor(store, "isPublic")!;
    const put = vi.spyOn(store, "put");
    Object.defineProperty(store, "isPublic", { value: true, configurable: true });
    try {
      await expect(beginSourceUpload.call({ id: run.id, filename: "source.xml", bytes: source.byteLength }, OWNER)).rejects.toThrow(/private.*storage/i);
    } finally { Object.defineProperty(store, "isPublic", descriptor); }
    const upload = await beginSourceUpload.call({ id: run.id, filename: "source.xml", bytes: source.byteLength }, OWNER);
    Object.defineProperty(store, "isPublic", { value: true, configurable: true });
    try {
      await expect(uploadSourceChunk.call({ id: run.id, uploadId: upload.uploadId, index: 0, bytes: source }, OWNER)).rejects.toThrow(/private.*storage/i);
      expect(put).not.toHaveBeenCalled();
    } finally { Object.defineProperty(store, "isPublic", descriptor); }
  });

  it("recovers bytes from an ambiguous upload failure after the provider accepted them", async () => {
    const run = await startImport.call({ origin: "https://source.example", kind: "wordpress-wxr" }, OWNER);
    const upload = await beginSourceUpload.call({ id: run.id, filename: "source.xml", bytes: source.byteLength }, OWNER);
    const key = `imports/${run.id}/${upload.uploadId}/00000.part`;
    const store = storage(), original = store.put.bind(store);
    const lostAck = vi.spyOn(store, "put").mockImplementationOnce(async (...args) => { await original(...args); throw new Error("Synthetic lost provider acknowledgement"); });
    await expect(uploadSourceChunk.call({ id: run.id, uploadId: upload.uploadId, index: 0, bytes: source }, OWNER)).rejects.toThrow(/lost provider/);
    expect(await store.get(key)).toBeDefined();
    lostAck.mockRestore();
    await cleanupOrphanedMedia(new Date(Date.now() + 25 * 60 * 60 * 1000));
    expect(await store.get(key)).toBeUndefined();
  });

  it("freezes chunk bytes before storage and makes identical received retries read-only", async () => {
    const { run, upload, key } = await uploaded();
    const put = vi.spyOn(storage(), "put");
    await expect(uploadSourceChunk.call({ id: run.id, uploadId: upload.uploadId, index: 0, bytes: source }, OWNER)).resolves.toMatchObject({ complete: true });
    const changed = source.slice(); changed[changed.length - 10] = changed[changed.length - 10]! ^ 1;
    await expect(uploadSourceChunk.call({ id: run.id, uploadId: upload.uploadId, index: 0, bytes: changed }, OWNER)).rejects.toThrow(/different bytes/);
    expect(put).not.toHaveBeenCalled();
    expect(await storage().get(key)).toEqual(source);
  });

  it("rejects corrupted provider bytes before staging a source preview", async () => {
    const { run, upload, key } = await uploaded();
    const changed = source.slice(); changed[changed.length - 10] = changed[changed.length - 10]! ^ 1;
    await storage().put(key, changed, "application/octet-stream");
    await expect(previewFromUpload.call({ id: run.id, uploadId: upload.uploadId }, OWNER)).rejects.toThrow(/differs from its verified upload/);
    const [saved] = await db().select().from(importRuns).where(eq(importRuns.id, run.id));
    expect(saved?.status).not.toBe("previewed");
  });

  it("preserves explicitly retained source ownership through queued deletion and orphan sweep, then releases it", async () => {
    const { run, descriptor, checkpoint, key } = await uploaded();
    delete checkpoint.sourceUpload;
    checkpoint.retainedSource = descriptor;
    await db().update(importRuns).set({ status: "previewed", checkpoint }).where(eq(importRuns.id, run.id));
    await db().update(mediaObjects).set({ createdAt: new Date(Date.now() - 26 * 60 * 60 * 1000) }).where(eq(mediaObjects.key, key));
    expect(await readRetainedSourceChunk(descriptor, 0)).toEqual(source);
    expect(await deleteCaptureObjects([key])).toEqual({ deleted: 0 });
    await cleanupOrphanedMedia();
    expect(await storage().get(key)).toEqual(source);
    delete checkpoint.retainedSource;
    await db().update(importRuns).set({ checkpoint }).where(eq(importRuns.id, run.id));
    await expect(readRetainedSourceChunk(descriptor, 0)).rejects.toThrow(/no longer|replaced/);
    expect(await deleteCaptureObjects([key])).toEqual({ deleted: 1 });
    expect(await storage().get(key)).toBeUndefined();
  });

  it("refuses preview acceptance when the upload expires during its provider read", async () => {
    const { run, upload, checkpoint } = await uploaded();
    const store = storage(), get = store.get.bind(store);
    vi.spyOn(store, "get").mockImplementationOnce(async key => {
      const bytes = await get(key);
      const current = checkpoint.sourceUpload as Record<string, unknown>;
      current.expiresAt = new Date(Date.now() - 1_000).toISOString();
      await db().update(importRuns).set({ checkpoint }).where(eq(importRuns.id, run.id));
      return bytes;
    });
    await expect(previewFromUpload.call({ id: run.id, uploadId: upload.uploadId }, OWNER)).rejects.toThrow(/expired while/);
    const [saved] = await db().select().from(importRuns).where(eq(importRuns.id, run.id));
    expect(saved?.status).not.toBe("previewed");
  });
  it.each([false, true])("recovers a late provider PUT after expiry removed its ledger row (lost acknowledgement: %s)", async lostAcknowledgement => {
    const run = await startImport.call({ origin: "https://source.example", kind: "wordpress-wxr" }, OWNER);
    const upload = await beginSourceUpload.call({ id: run.id, filename: "source.xml", bytes: source.byteLength }, OWNER);
    const key = `imports/${run.id}/${upload.uploadId}/00000.part`, store = storage(), original = store.put.bind(store);
    let entered!: () => void, resume!: () => void;
    const reached = new Promise<void>(resolve => { entered = resolve; });
    const release = new Promise<void>(resolve => { resume = resolve; });
    const put = vi.spyOn(store, "put").mockImplementationOnce(async (...args) => { entered(); await release; const result = await original(...args); if (lostAcknowledgement) throw new Error("Synthetic late lost acknowledgement"); return result; });
    const pending = uploadSourceChunk.call({ id: run.id, uploadId: upload.uploadId, index: 0, bytes: source }, OWNER);
    try {
      await reached;
      const [saved] = await db().select().from(importRuns).where(eq(importRuns.id, run.id));
      const checkpoint = saved!.checkpoint as Record<string, unknown>;
      checkpoint.sourceUpload = { ...checkpoint.sourceUpload as Record<string, unknown>, expiresAt: new Date(Date.now() - 1_000).toISOString() };
      await db().update(importRuns).set({ checkpoint }).where(eq(importRuns.id, run.id));
      await db().update(mediaObjects).set({ createdAt: new Date(Date.now() - 26 * 60 * 60 * 1000) }).where(eq(mediaObjects.key, key));
      await cleanupOrphanedMedia();
      expect(await db().select().from(mediaObjects).where(eq(mediaObjects.key, key))).toHaveLength(1);
    } finally { resume(); }
    const [result] = await Promise.allSettled([pending]); put.mockRestore();
    expect(result?.status).toBe("rejected");
    expect(await db().select().from(mediaObjects).where(eq(mediaObjects.key, key))).toHaveLength(1);
    await cleanupOrphanedMedia(new Date(Date.now() + 25 * 60 * 60 * 1000));
    expect(await store.get(key)).toBeUndefined();
  });
  it("keeps each identical concurrent write unresolved until its own provider outcome", async () => {
    const run = await startImport.call({ origin: "https://source.example", kind: "wordpress-wxr" }, OWNER);
    const upload = await beginSourceUpload.call({ id: run.id, filename: "source.xml", bytes: source.byteLength }, OWNER);
    const key = `imports/${run.id}/${upload.uploadId}/00000.part`, store = storage(), put = store.put.bind(store);
    const resume: Array<() => void> = [];
    let reached!: () => void;
    const bothEntered = new Promise<void>(resolve => { reached = resolve; });
    vi.spyOn(store, "put").mockImplementation(async (...args) => {
      await new Promise<void>(resolve => { resume.push(resolve); if (resume.length === 2) reached(); });
      return put(...args);
    });
    const input = { id: run.id, uploadId: upload.uploadId, index: 0, bytes: source };
    const first = uploadSourceChunk.call(input, OWNER).then(() => "accepted", () => "refused");
    const second = uploadSourceChunk.call(input, OWNER).then(() => "accepted", () => "refused");
    try {
      await bothEntered;
      const [saved] = await db().select().from(importRuns).where(eq(importRuns.id, run.id));
      const checkpoint = saved!.checkpoint as Record<string, unknown>;
      expect(checkpoint.sourceWrites).toHaveLength(2);
      checkpoint.sourceUpload = { ...checkpoint.sourceUpload as Record<string, unknown>, expiresAt: new Date(Date.now() - 1_000).toISOString() };
      await db().update(importRuns).set({ checkpoint }).where(eq(importRuns.id, run.id));
      await db().update(mediaObjects).set({ createdAt: new Date(Date.now() - 26 * 60 * 60 * 1000) }).where(eq(mediaObjects.key, key));
      resume[0]!();
      expect(await Promise.race([first, second])).toBe("refused");
      const [between] = await db().select().from(importRuns).where(eq(importRuns.id, run.id));
      expect((between!.checkpoint as Record<string, unknown>).sourceWrites).toHaveLength(1);
      await cleanupOrphanedMedia();
      expect(await db().select().from(mediaObjects).where(eq(mediaObjects.key, key))).toHaveLength(1);
      resume[1]!();
      expect(await Promise.all([first, second])).toEqual(["refused", "refused"]);
      const [finished] = await db().select().from(importRuns).where(eq(importRuns.id, run.id));
      expect((finished!.checkpoint as Record<string, unknown>).sourceWrites).toHaveLength(0);
      await cleanupOrphanedMedia(new Date(Date.now() + 25 * 60 * 60 * 1000));
      expect(await store.get(key)).toBeUndefined();
    } finally { for (const release of resume) release(); await Promise.all([first, second]); }
  });

  it("does not retain the private source prefix in its original-actor chunk audit", async () => {
    const { run } = await uploaded();
    const audit = await db().select().from(auditLog).where(eq(auditLog.subjectId, run.id));
    const claim = audit.find(row => row.action === "imports.claimSourceChunk");
    expect(claim?.actor).toBe(`user:${OWNER.userId}`);
    expect(claim?.diff).toMatchObject({ id: run.id, prefixSecret: "[redacted]" });
    expect(JSON.stringify(audit)).not.toContain(EMAIL);
  });

  it("releases an erasure-refused file under its exact public preview key and original audit actor", async () => {
    const reader = await resolveContact.call({ email: EMAIL }, OWNER);
    const run = await startImport.call({ origin: "https://source.example", kind: "wordpress-wxr" }, OWNER);
    const actor = { kind: "agent" as const, keyName: "exact-private-source", scopes: ["imports.beginSourceUpload", "imports.uploadSourceChunk", "imports.previewFromUpload"] };
    await expect(getContact.call({ id: reader.contact.id }, actor)).rejects.toMatchObject({ code: "permission" });
    const upload = await beginSourceUpload.call({ id: run.id, filename: "source.xml", bytes: source.byteLength }, actor);
    await uploadSourceChunk.call({ id: run.id, uploadId: upload.uploadId, index: 0, bytes: source }, actor);
    const request = await createDataRequest.call({ contactId: reader.contact.id, request: { kind: "erasure" } }, OWNER);
    await verifyDataRequest.call({ id: request.id, method: "Synthetic exact-key reader verification" }, OWNER);
    await fulfillDataRequest.call({ id: request.id, confirmation: "ERASE" }, OWNER);
    await expect(previewFromUpload.call({ id: run.id, uploadId: upload.uploadId }, actor)).rejects.toThrow(/reader erasure/);
    expect(await storage().get(`imports/${run.id}/${upload.uploadId}/00000.part`)).toBeUndefined();
    const rows = await db().select().from(auditLog).where(eq(auditLog.subjectId, run.id));
    expect(rows.find(row => row.action === "imports.releaseErasedSourceUpload")).toMatchObject({ actor: `agent:${actor.keyName}`, diff: { id: run.id, uploadId: upload.uploadId } });
    expect(JSON.stringify(rows)).not.toContain(EMAIL);
  });

});
