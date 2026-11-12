// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C2.29/C11.10: raw provider copies cannot outlive a completed erasure receipt.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { importRuns } from "@/core/plugins/schema";
import { dataRequests } from "@/core/privacy/schema";
import { addRetentionException, registerContactPrivacySource } from "@/core/privacy/service";
import { getJob, stopJobs, type JobExecutionContext } from "@/core/jobs";
import { eraseImportSourceObjects } from "@/core/jobs/core-jobs";
import { storage, resetStorageForTests } from "@/adapters/storage";
import { resetEnvForTests } from "@/core/env";
import { putWithReceipt } from "@/core/media/write-ledger";
import { resolveContact } from "@/core/contacts/service";
import { createDataRequest, verifyDataRequest, fulfillDataRequest } from "@/core/privacy/service";
import { auditLog } from "@/core/events/schema";
import { createPage, ensureDefaults } from "@/modules/cms/service";
import { importReaderComment } from "@/modules/cms/blog-comments";
import { previewFromSource } from "@/core/import/service";
import { startImport } from "@/core/import/service";
import { beginSourceUpload, uploadSourceChunk, previewFromUpload } from "@/core/import/source-upload";
import { OWNER, closeDb, hasDatabase, truncateSpine } from "../helpers/spine";
import { confirmStoppedUnappliedDelete } from "../helpers/stopped-storage-delete";

const EMAIL = "raw-erasure-reader@example.test";
const bytes = new TextEncoder().encode(`<rss xmlns:wp="http://wordpress.org/export/1.2/"><channel><title>Fixture</title><item><title>Fixture page</title><wp:post_id>10</wp:post_id><wp:post_type>post</wp:post_type><wp:comment><wp:comment_id>20</wp:comment_id><wp:comment_author>Private reader</wp:comment_author><wp:comment_author_email>${EMAIL}</wp:comment_author_email><wp:comment_content>Private source copy.</wp:comment_content></wp:comment></item></channel></rss>`);
let erasureGate: { entered: () => void; release: Promise<void> } | undefined;
let commentGate: { entered: () => void; release: Promise<void> } | undefined;
registerContactPrivacySource({ scope: "tests.rawSourceAfterCommentErase", tables: [], eraseOrder: 21,
  exportData: async () => [], erase: async () => {
    if (commentGate) { commentGate.entered(); await commentGate.release; }
    return { affected: 0 };
  },
});
registerContactPrivacySource({ scope: "tests.rawSourceAfterSnapshot", tables: [], eraseOrder: 11,
  exportData: async () => [], erase: async () => {
    if (erasureGate) { erasureGate.entered(); await erasureGate.release; }
    return { affected: 0 };
  },
});
describe.runIf(hasDatabase)("raw source erasure receipt", () => {
  beforeEach(async () => { await truncateSpine(); resetStorageForTests(); });
  afterAll(async () => { await stopJobs(); await closeDb(); });
  afterEach(() => vi.restoreAllMocks());
  async function pending() {
    const reader = await resolveContact.call({ email: EMAIL }, OWNER);
    const run = await startImport.call({ origin: "https://source.example", kind: "wordpress-wxr" }, OWNER);
    const upload = await beginSourceUpload.call({ id: run.id, filename: "source.xml", bytes: bytes.byteLength }, OWNER);
    await uploadSourceChunk.call({ id: run.id, uploadId: upload.uploadId, index: 0, bytes }, OWNER);
    const request = await createDataRequest.call({ contactId: reader.contact.id, request: { kind: "erasure" } }, OWNER);
    await verifyDataRequest.call({ id: request.id, method: "Synthetic fixture verification" }, OWNER);
    return { run, upload, request, key: `imports/${run.id}/${upload.uploadId}/00000.part` };
  }
  function context(id: string): JobExecutionContext { return { id, name: eraseImportSourceObjects.name, attempt: 1, signal: new AbortController().signal, leaseSeconds: 300, heartbeat: async () => true, isCancelled: async () => false, throwIfCancelled: async () => {} }; }
  async function jobFor(result: Awaited<ReturnType<typeof fulfillDataRequest.call>>) {
    const receipt = result.artifact.body as { outcomes: Array<{ scope: string; pendingJobs?: string[] }> };
    const id = receipt.outcomes.find(item => item.scope === "imports.readerSources")!.pendingJobs![0]!;
    return (await getJob(eraseImportSourceObjects.name, id))!;
  }
  async function expire(id: string) {
    const [run] = await db().select().from(importRuns).where(eq(importRuns.id, id));
    const checkpoint = run!.checkpoint as Record<string, unknown>;
    checkpoint.sourceUpload = { ...checkpoint.sourceUpload as Record<string, unknown>, expiresAt: new Date(Date.now() - 1_000).toISOString() };
    await db().update(importRuns).set({ checkpoint }).where(eq(importRuns.id, id));
  }
  async function status(id: string) { return (await db().select().from(dataRequests).where(eq(dataRequests.id, id)))[0]!.status; }

  it("does not acknowledge completed erasure while an opaque original still contains the reader", async () => {
    const { request, key } = await pending();
    const result = await fulfillDataRequest.call({ id: request.id, confirmation: "ERASE" }, OWNER);
    expect(new TextDecoder().decode(await storage().get(key))).toContain(EMAIL);
    expect(result.request.status).toBe("in_progress");
    const job = await jobFor(result);
    await expect(eraseImportSourceObjects.handler(job.data, context(job.id))).rejects.toThrow(/ownership|unresolved/);
    expect(await status(request.id)).toBe("in_progress");
    expect(JSON.stringify(job.data)).not.toContain(EMAIL);
  });

  it("waits through a provider outage, then completes only after actual byte removal", async () => {
    const { request, run, key } = await pending();
    const result = await fulfillDataRequest.call({ id: request.id, confirmation: "ERASE" }, OWNER);
    const job = await jobFor(result);
    await expire(run.id);
    const failure = vi.spyOn(storage(), "delete").mockRejectedValueOnce(new Error("Synthetic provider outage"));
    await expect(eraseImportSourceObjects.handler(job.data, context(job.id))).rejects.toThrow(/provider outage/);
    expect(await status(request.id)).toBe("in_progress");
    failure.mockRestore();
    await expect(eraseImportSourceObjects.handler(job.data, context(job.id))).rejects.toThrow(/unresolved physical/);
    await confirmStoppedUnappliedDelete(key);
    await eraseImportSourceObjects.handler(job.data, context(job.id));
    expect(await storage().get(key)).toBeUndefined();
    expect(await status(request.id)).toBe("completed");
    await eraseImportSourceObjects.handler(job.data, context(job.id));
    expect(await status(request.id)).toBe("completed");
  });

  it("refuses a delete acknowledgement while provider bytes remain", async () => {
    const { request, run, key } = await pending();
    const result = await fulfillDataRequest.call({ id: request.id, confirmation: "ERASE" }, OWNER);
    const job = await jobFor(result);
    await expire(run.id);
    vi.spyOn(storage(), "delete").mockResolvedValueOnce(undefined);
    await expect(eraseImportSourceObjects.handler(job.data, context(job.id))).rejects.toThrow(/not confirmed|still present/);
    expect(await storage().get(key)).toBeDefined();
    expect(await status(request.id)).toBe("in_progress");
  });

  it("retains the raw source under the same explicit reader-comment hold", async () => {
    const { request, key } = await pending();
    await addRetentionException.call({ dataRequestId: request.id, scope: "cms.readerComments", reason: "legal_claim", legalBasis: "Synthetic source preservation fixture" }, OWNER);
    const result = await fulfillDataRequest.call({ id: request.id, confirmation: "ERASE" }, OWNER);
    expect(result.request.status).toBe("partially_completed");
    const receipt = result.artifact.body as { outcomes: Array<{ scope: string; outcome: string }> };
    expect(receipt.outcomes.find(item => item.scope === "imports.readerSources")?.outcome).toBe("retained");
    expect(await storage().get(key)).toBeDefined();
  });

  it("keeps erasure pending across a store switch and deletes only the actual original private source", async () => {
    const rootA = await mkdtemp(join(tmpdir(), "freeholder-raw-source-store-a-"));
    const rootB = await mkdtemp(join(tmpdir(), "freeholder-raw-source-store-b-"));
    const select = (root: string) => { vi.stubEnv("FREEHOLDER_STORAGE", "local"); vi.stubEnv("LOCAL_STORAGE_ROOT", root); resetEnvForTests(); resetStorageForTests(); };
    try {
      select(rootA);
      const { request, run, key } = await pending(), original = storage();
      expect(await original.get(key)).toEqual(bytes);
      const result = await fulfillDataRequest.call({ id: request.id, confirmation: "ERASE" }, OWNER), job = await jobFor(result);
      await expire(run.id);
      select(rootB);
      const replacement = storage(), other = new TextEncoder().encode("Fictional independent object in the replacement store.");
      await replacement.put(key, other, "application/octet-stream");
      const refused = await eraseImportSourceObjects.handler(job.data, context(job.id)).then(() => false, () => true);
      expect({ refused, originalPresent: Boolean(await original.get(key)), replacementUnchanged: Buffer.from(await replacement.get(key) ?? []).equals(Buffer.from(other)), requestStatus: await status(request.id) }).toEqual({ refused: true, originalPresent: true, replacementUnchanged: true, requestStatus: "in_progress" });
      select(rootA);
      await eraseImportSourceObjects.handler(job.data, context(job.id));
      expect(await original.get(key)).toBeUndefined();
      expect(await replacement.get(key)).toEqual(other);
      expect(await status(request.id)).toBe("completed");
      select(rootB);
      const currentReplacement = storage(), deletes = vi.spyOn(currentReplacement, "delete"), puts = vi.spyOn(currentReplacement, "put");
      await expect(eraseImportSourceObjects.handler(job.data, context(job.id))).rejects.toThrow(/original|resource|pending/);
      await expect(putWithReceipt({ key, body: bytes, contentType: "application/octet-stream", role: "staged" }, OWNER)).rejects.toThrow(/original storage resource/);
      expect(deletes).not.toHaveBeenCalled();
      expect(puts).not.toHaveBeenCalled();
      expect(await replacement.get(key)).toEqual(other);
    } finally {
      vi.unstubAllEnvs(); resetEnvForTests(); resetStorageForTests();
      await rm(rootA, { recursive: true, force: true }); await rm(rootB, { recursive: true, force: true });
    }
  });
  it("keeps a reserved source upload and its reads bound to the original private resource", async () => {
    const rootA = await mkdtemp(join(tmpdir(), "freeholder-source-upload-a-"));
    const rootB = await mkdtemp(join(tmpdir(), "freeholder-source-upload-b-"));
    const select = (root: string) => { vi.stubEnv("FREEHOLDER_STORAGE", "local"); vi.stubEnv("LOCAL_STORAGE_ROOT", root); resetEnvForTests(); resetStorageForTests(); };
    try {
      select(rootA);
      const run = await startImport.call({ origin: "https://source.example", kind: "wordpress-wxr" }, OWNER);
      const upload = await beginSourceUpload.call({ id: run.id, filename: "source.xml", bytes: bytes.byteLength }, OWNER);
      const key = `imports/${run.id}/${upload.uploadId}/00000.part`, original = storage();
      select(rootB);
      const replacement = storage();
      await expect(uploadSourceChunk.call({ id: run.id, uploadId: upload.uploadId, index: 0, bytes }, OWNER)).rejects.toThrow(/original private storage/);
      expect(await replacement.get(key)).toBeUndefined();
      select(rootA);
      await uploadSourceChunk.call({ id: run.id, uploadId: upload.uploadId, index: 0, bytes }, OWNER);
      expect(await original.get(key)).toEqual(bytes);
      select(rootB);
      await replacement.put(key, bytes, "application/octet-stream");
      await expect(previewFromUpload.call({ id: run.id, uploadId: upload.uploadId }, OWNER)).rejects.toThrow(/original storage resource/);
      expect(await replacement.get(key)).toEqual(bytes);
    } finally {
      vi.unstubAllEnvs(); resetEnvForTests(); resetStorageForTests();
      await rm(rootA, { recursive: true, force: true }); await rm(rootB, { recursive: true, force: true });
    }
  });

  it("does not retain erased reader details in the import source audit", async () => {
    const reader = await resolveContact.call({ email: EMAIL }, OWNER);
    const run = await startImport.call({ origin: "https://source.example", kind: "wordpress-wxr" }, OWNER);
    await previewFromSource.call({ id: run.id, payload: new TextDecoder().decode(bytes) }, OWNER);
    await db().insert(auditLog).values({ actor: `user:${OWNER.userId}`, action: "imports.previewFromSource", subjectType: "import_run", subjectId: run.id, diff: { id: run.id, payload: new TextDecoder().decode(bytes) } });
    const request = await createDataRequest.call({ contactId: reader.contact.id, request: { kind: "erasure" } }, OWNER);
    await verifyDataRequest.call({ id: request.id, method: "Synthetic audit erasure verification" }, OWNER);
    await fulfillDataRequest.call({ id: request.id, confirmation: "ERASE" }, OWNER);
    const rows = await db().select().from(auditLog).where(eq(auditLog.subjectId, run.id));
    expect(rows.some(row => row.action === "imports.previewFromSource")).toBe(true);
    expect(JSON.stringify(rows)).not.toContain(EMAIL);
  });

  it("does not retain erased imported reader details in the CMS comment audit", async () => {
    await ensureDefaults.call({}, OWNER);
    const reader = await resolveContact.call({ email: EMAIL }, OWNER);
    const page = await createPage.call({ title: "Fixture", slug: "raw-audit-fixture" }, OWNER);
    const run = await startImport.call({ origin: "https://source.example", kind: "wordpress-wxr" }, OWNER);
    await previewFromSource.call({ id: run.id, payload: new TextDecoder().decode(bytes) }, OWNER);
    const comment = await importReaderComment.call({ runId: run.id, externalId: "10:20", pageId: page.id, name: "Private reader", email: EMAIL, body: "Private source copy.", status: "approved" }, OWNER);
    await db().insert(auditLog).values({ actor: `user:${OWNER.userId}`, action: "cms.importReaderComment", subjectType: "blog_comment", subjectId: comment.id, diff: { runId: run.id, name: "Private reader", email: EMAIL, body: "Private source copy." } });
    const request = await createDataRequest.call({ contactId: reader.contact.id, request: { kind: "erasure" } }, OWNER);
    await verifyDataRequest.call({ id: request.id, method: "Synthetic comment audit verification" }, OWNER);
    await fulfillDataRequest.call({ id: request.id, confirmation: "ERASE" }, OWNER);
    const rows = await db().select().from(auditLog).where(eq(auditLog.subjectId, comment.id));
    expect(rows.some(row => row.action === "cms.importReaderComment")).toBe(true);
    expect(JSON.stringify(rows)).not.toContain(EMAIL);
    expect(JSON.stringify(rows)).not.toContain("Private source copy.");
  });

  it("refuses a new opaque upload while erasure has already captured its source snapshot", async () => {
    const reader = await resolveContact.call({ email: EMAIL }, OWNER);
    const request = await createDataRequest.call({ contactId: reader.contact.id, request: { kind: "erasure" } }, OWNER);
    await verifyDataRequest.call({ id: request.id, method: "Synthetic snapshot-race verification" }, OWNER);
    let entered!: () => void, release!: () => void;
    const reached = new Promise<void>(resolve => { entered = resolve; });
    erasureGate = { entered, release: new Promise<void>(resolve => { release = resolve; }) };
    const erasing = fulfillDataRequest.call({ id: request.id, confirmation: "ERASE" }, OWNER);
    try {
      await reached;
      const run = await startImport.call({ origin: "https://source.example", kind: "wordpress-wxr" }, OWNER);
      const admitted = await beginSourceUpload.call({ id: run.id, filename: "source.xml", bytes: bytes.byteLength }, OWNER).then(upload => ({ upload, refused: false }), () => ({ upload: null, refused: true }));
      if (admitted.upload) {
        await uploadSourceChunk.call({ id: run.id, uploadId: admitted.upload.uploadId, index: 0, bytes }, OWNER);
        expect(new TextDecoder().decode(await storage().get(`imports/${run.id}/${admitted.upload.uploadId}/00000.part`))).toContain(EMAIL);
      }
      expect(admitted.refused).toBe(true);
    } finally { release(); await erasing; erasureGate = undefined; }
  });

  it("refuses a direct comment import after erasure already passed its comment scope", async () => {
    await ensureDefaults.call({}, OWNER);
    const reader = await resolveContact.call({ email: EMAIL }, OWNER);
    const page = await createPage.call({ title: "Fixture", slug: "comment-erasure-race" }, OWNER);
    const run = await startImport.call({ origin: "https://source.example", kind: "wordpress-wxr" }, OWNER);
    await previewFromSource.call({ id: run.id, payload: new TextDecoder().decode(bytes) }, OWNER);
    const request = await createDataRequest.call({ contactId: reader.contact.id, request: { kind: "erasure" } }, OWNER);
    await verifyDataRequest.call({ id: request.id, method: "Synthetic direct comment race" }, OWNER);
    let entered!: () => void, release!: () => void;
    const reached = new Promise<void>(resolve => { entered = resolve; });
    commentGate = { entered, release: new Promise<void>(resolve => { release = resolve; }) };
    const erasing = fulfillDataRequest.call({ id: request.id, confirmation: "ERASE" }, OWNER);
    try {
      await reached;
      await expect(importReaderComment.call({ runId: run.id, externalId: "10:20", pageId: page.id, name: "Private reader", email: EMAIL, sourceContactId: reader.contact.id, body: "Private source copy.", status: "approved" }, OWNER)).rejects.toThrow(/privacy|merge|erased/i);
    } finally { release(); await erasing; commentGate = undefined; }
  });

  it("keeps erasure pending until an actual late source writer settles after expiry", async () => {
    const reader = await resolveContact.call({ email: EMAIL }, OWNER);
    const run = await startImport.call({ origin: "https://source.example", kind: "wordpress-wxr" }, OWNER);
    const upload = await beginSourceUpload.call({ id: run.id, filename: "source.xml", bytes: bytes.byteLength }, OWNER);
    const store = storage(), put = store.put.bind(store);
    let entered!: () => void, release!: () => void;
    const reached = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(store, "put").mockImplementationOnce(async (...args) => { entered(); await gate; return put(...args); });
    const writing = uploadSourceChunk.call({ id: run.id, uploadId: upload.uploadId, index: 0, bytes }, OWNER).then(() => "accepted", () => "refused");
    try {
      await reached;
      const request = await createDataRequest.call({ contactId: reader.contact.id, request: { kind: "erasure" } }, OWNER);
      await verifyDataRequest.call({ id: request.id, method: "Synthetic delayed-provider identity" }, OWNER);
      const result = await fulfillDataRequest.call({ id: request.id, confirmation: "ERASE" }, OWNER);
      const job = await jobFor(result);
      await expire(run.id);
      await expect(eraseImportSourceObjects.handler(job.data, context(job.id))).rejects.toThrow(/unresolved/);
      expect(await status(request.id)).toBe("in_progress");
      release();
      expect(await writing).toBe("refused");
      await eraseImportSourceObjects.handler(job.data, context(job.id));
      expect(await store.get(`imports/${run.id}/${upload.uploadId}/00000.part`)).toBeUndefined();
      expect(await status(request.id)).toBe("completed");
    } finally { release(); await writing; }
  });

  it("includes reserved chunks not yet written when the erasure snapshot is taken", async () => {
    const reader = await resolveContact.call({ email: EMAIL }, OWNER);
    const run = await startImport.call({ origin: "https://source.example", kind: "wordpress-wxr" }, OWNER);
    const upload = await beginSourceUpload.call({ id: run.id, filename: "source.xml", bytes: bytes.byteLength }, OWNER);
    const request = await createDataRequest.call({ contactId: reader.contact.id, request: { kind: "erasure" } }, OWNER);
    await verifyDataRequest.call({ id: request.id, method: "Synthetic reserved-source identity" }, OWNER);
    const result = await fulfillDataRequest.call({ id: request.id, confirmation: "ERASE" }, OWNER);
    expect(result.request.status).toBe("in_progress");
    const job = await jobFor(result);
    expect(job.data.keys).toEqual([`imports/${run.id}/${upload.uploadId}/00000.part`]);
    await expire(run.id);
    await eraseImportSourceObjects.handler(job.data, context(job.id));
    expect(await status(request.id)).toBe("completed");
  });

  it("refuses a pasted source while erasure has already captured its source snapshot", async () => {
    const reader = await resolveContact.call({ email: EMAIL }, OWNER);
    const request = await createDataRequest.call({ contactId: reader.contact.id, request: { kind: "erasure" } }, OWNER);
    await verifyDataRequest.call({ id: request.id, method: "Synthetic snapshot-race verification" }, OWNER);
    let entered!: () => void, release!: () => void;
    const reached = new Promise<void>(resolve => { entered = resolve; });
    erasureGate = { entered, release: new Promise<void>(resolve => { release = resolve; }) };
    const erasing = fulfillDataRequest.call({ id: request.id, confirmation: "ERASE" }, OWNER);
    try {
      await reached;
      const run = await startImport.call({ origin: "https://source.example", kind: "wordpress-wxr" }, OWNER);
      const admitted = await previewFromSource.call({ id: run.id, payload: new TextDecoder().decode(bytes) }, OWNER).then(() => true, () => false);
      if (admitted) {
        const [saved] = await db().select().from(importRuns).where(eq(importRuns.id, run.id));
        expect(JSON.stringify(saved!.preview)).toContain(EMAIL);
      }
      expect(admitted).toBe(false);
    } finally { release(); await erasing; erasureGate = undefined; }
  });

  it("keeps a request created before upload pending when actual erasure starts afterward", async () => {
    const reader = await resolveContact.call({ email: EMAIL }, OWNER);
    const request = await createDataRequest.call({ contactId: reader.contact.id, request: { kind: "erasure" } }, OWNER);
    await verifyDataRequest.call({ id: request.id, method: "Synthetic earlier request verification" }, OWNER);
    const run = await startImport.call({ origin: "https://source.example", kind: "wordpress-wxr" }, OWNER);
    const upload = await beginSourceUpload.call({ id: run.id, filename: "source.xml", bytes: bytes.byteLength }, OWNER);
    await uploadSourceChunk.call({ id: run.id, uploadId: upload.uploadId, index: 0, bytes }, OWNER);
    const result = await fulfillDataRequest.call({ id: request.id, confirmation: "ERASE" }, OWNER);
    expect(result.request.status).toBe("in_progress");
    await expect(previewFromUpload.call({ id: run.id, uploadId: upload.uploadId }, OWNER)).rejects.toThrow(/erasure.*source|source.*erasure/i);
  });

  it("keeps opaque generic-source bytes pending even when the parser ignores their reader metadata", async () => {
    const reader = await resolveContact.call({ email: EMAIL }, OWNER);
    const run = await startImport.call({ origin: "https://source.example", kind: "html" }, OWNER);
    const html = new TextEncoder().encode(`<!doctype html><html><body><p>Ordinary article.</p><!-- Ignored reader ${EMAIL} --></body></html>`);
    const upload = await beginSourceUpload.call({ id: run.id, filename: "source.html", bytes: html.byteLength }, OWNER);
    await uploadSourceChunk.call({ id: run.id, uploadId: upload.uploadId, index: 0, bytes: html }, OWNER);
    const request = await createDataRequest.call({ contactId: reader.contact.id, request: { kind: "erasure" } }, OWNER);
    await verifyDataRequest.call({ id: request.id, method: "Synthetic ignored metadata verification" }, OWNER);
    const result = await fulfillDataRequest.call({ id: request.id, confirmation: "ERASE" }, OWNER);
    expect(new TextDecoder().decode(await storage().get(`imports/${run.id}/${upload.uploadId}/00000.part`))).toContain(EMAIL);
    expect(result.request.status).toBe("in_progress");
  });

});
