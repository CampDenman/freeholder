// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.47/C11.10: a documented pending hold must preserve its actual opaque upload.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetStorageForTests, storage } from "@/adapters/storage";
import { db } from "@/core/db";
import { eq } from "drizzle-orm";
import { users, totpFactors } from "@/core/auth/schema";
import { createSession } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { resolveContact } from "@/core/contacts/service";
import { createDataRequest, addRetentionException } from "@/core/privacy/service";
import { privacyRetentionExceptions } from "@/core/privacy/schema";
import { startImport, rollbackImport } from "@/core/import/service";
import { beginSourceUpload, uploadSourceChunk } from "@/core/import/source-upload";
import { deleteCaptureObjects } from "@/core/media/capture";
import { stopJobs } from "@/core/jobs";
import { OWNER, closeDb, hasDatabase, truncateSpine } from "../helpers/spine";

const readerEmail = "fictional-pending-upload-reader@example.test";
const bytes = new TextEncoder().encode(`<rss xmlns:wp="http://wordpress.org/export/1.2/" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>Original held-source fixture</title><link>https://fictional-upload-source.example/</link><item><title>Actual source article</title><link>https://fictional-upload-source.example/article</link><wp:post_id>10</wp:post_id><wp:post_type>post</wp:post_type><wp:status>publish</wp:status><content:encoded>Original article text.</content:encoded><wp:comment><wp:comment_id>20</wp:comment_id><wp:comment_author_email>${readerEmail}</wp:comment_author_email><wp:comment_content>PRIVATE_ORIGINAL_UPLOADED_READER_BODY</wp:comment_content><wp:comment_approved>1</wp:comment_approved></wp:comment></item></channel></rss>`);
async function actualOwner() {
  await db().insert(users).values({ id: OWNER.userId, email: "fictional-upload-operator@example.test", role: "owner" });
  await db().insert(totpFactors).values({ userId: OWNER.userId, encryptedSecret: "fictional-upload-factor" });
  const session = await db().transaction(tx => createSession(tx, OWNER.userId, { twoFactorVerified: true }));
  const actor = await actorFromToken(session.token);
  if (actor.kind !== "user" || !actor.sessionId) throw new Error("The actual owner session was not resolved.");
  return actor;
}

describe.runIf(hasDatabase)("original uploaded source pending retention (C3.47/C11.10)", () => {
  beforeEach(async () => { await truncateSpine(); resetStorageForTests(); });
  afterAll(async () => { await stopJobs(); await closeDb(); });
  it("preserves the real original WXR bytes through rollback and shared cleanup before request verification", async () => {
    const owner = await actualOwner(), reader = (await resolveContact.call({ email: readerEmail, name: "Actual pending upload request fixture" }, owner)).contact;
    const run = await startImport.call({ origin: "https://fictional-upload-source.example", kind: "wordpress-wxr" }, owner);
    const upload = await beginSourceUpload.call({ id: run.id, filename: "original-reader.xml", bytes: bytes.byteLength }, owner);
    await uploadSourceChunk.call({ id: run.id, uploadId: upload.uploadId, index: 0, bytes }, owner);
    const key = `imports/${run.id}/${upload.uploadId}/00000.part`;
    expect(await storage().get(key)).toEqual(bytes);
    const request = await createDataRequest.call({ contactId: reader.id, request: { kind: "erasure" } }, owner);
    expect(request.status).toBe("submitted");
    const hold = await addRetentionException.call({ dataRequestId: request.id, scope: "cms.readerComments", reason: "legal_claim", legalBasis: "Synthetic original upload preservation before verification" }, owner);
    expect(await db().select().from(privacyRetentionExceptions).where(eq(privacyRetentionExceptions.id, hold.id))).toMatchObject([{ dataRequestId: request.id, scope: "cms.readerComments" }]);
    await rollbackImport.call({ id: run.id }, owner);
    const removed = await deleteCaptureObjects([key]);
    expect(await storage().get(key)).toEqual(bytes);
    expect(removed).toEqual({ deleted: 0 });
  });
});
