// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C2.29/C11.10: the ordinary orphan sweep must honor an explicit raw-source hold.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { storage, resetStorageForTests } from "@/adapters/storage";
import { resolveContact } from "@/core/contacts/service";
import { createDataRequest, verifyDataRequest, addRetentionException, removeRetentionException, fulfillDataRequest } from "@/core/privacy/service";
import { startImport, rollbackImport } from "@/core/import/service";
import { beginSourceUpload, uploadSourceChunk } from "@/core/import/source-upload";
import { cleanupOrphanedMedia } from "@/core/media/service";
import { OWNER, closeDb, hasDatabase, truncateSpine } from "../helpers/spine";
const email = "held-source-reader@example.test";
const bytes = new TextEncoder().encode(`<rss xmlns:wp="http://wordpress.org/export/1.2/"><channel><item><title>Fixture</title><wp:post_type>post</wp:post_type><wp:comment><wp:comment_author_email>${email}</wp:comment_author_email></wp:comment></item></channel></rss>`);
async function held() {
  const reader = await resolveContact.call({ email }, OWNER);
  const run = await startImport.call({ origin: "https://source.example", kind: "wordpress-wxr" }, OWNER);
  const upload = await beginSourceUpload.call({ id: run.id, filename: "source.xml", bytes: bytes.byteLength }, OWNER);
  await uploadSourceChunk.call({ id: run.id, uploadId: upload.uploadId, index: 0, bytes }, OWNER);
  const request = await createDataRequest.call({ contactId: reader.contact.id, request: { kind: "erasure" } }, OWNER);
  await verifyDataRequest.call({ id: request.id, method: "Synthetic held-source verification" }, OWNER);
  const hold = await addRetentionException.call({ dataRequestId: request.id, scope: "cms.readerComments", reason: "legal_claim", legalBasis: "Synthetic raw-source preservation", expiresAt: new Date(Date.now() + 3 * 86_400_000).toISOString() }, OWNER);
  const result = await fulfillDataRequest.call({ id: request.id, confirmation: "ERASE" }, OWNER);
  expect(result.request.status).toBe("partially_completed");
  return { run, upload, hold, key: `imports/${run.id}/${upload.uploadId}/00000.part` };
}
describe.runIf(hasDatabase)("held original import bytes", () => {
  beforeEach(async () => { await truncateSpine(); resetStorageForTests(); });
  afterAll(closeDb);
  it("preserves an explicit reader-source hold after the ordinary upload expires", async () => {
    const { key } = await held();
    await cleanupOrphanedMedia(new Date(Date.now() + 25 * 3_600_000));
    expect(await storage().get(key)).toEqual(bytes);
  });
  it("allows cleanup after the actual hold is removed", async () => {
    const { key, hold } = await held();
    await removeRetentionException.call({ id: hold.id }, OWNER);
    await cleanupOrphanedMedia(new Date(Date.now() + 25 * 3_600_000));
    expect(await storage().get(key)).toBeUndefined();
  });
  it("does not extend an old held nonce to a later replacement upload", async () => {
    const { run, key } = await held();
    const next = await beginSourceUpload.call({ id: run.id, filename: "replacement.xml", bytes: bytes.byteLength }, OWNER);
    await uploadSourceChunk.call({ id: run.id, uploadId: next.uploadId, index: 0, bytes }, OWNER);
    await cleanupOrphanedMedia(new Date(Date.now() + 25 * 3_600_000));
    expect(await storage().get(key)).toEqual(bytes);
    expect(await storage().get(`imports/${run.id}/${next.uploadId}/00000.part`)).toBeUndefined();
  });
  it("keeps the held original after rollback without holding ordinary future imports", async () => {
    const { run, key } = await held();
    await rollbackImport.call({ id: run.id }, OWNER);
    await cleanupOrphanedMedia(new Date(Date.now() + 25 * 3_600_000));
    expect(await storage().get(key)).toEqual(bytes);
  });
});
