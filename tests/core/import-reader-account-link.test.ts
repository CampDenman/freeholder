// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C2.29/C11.10: current mailbox proof is not historical source ownership.
import { randomBytes } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { stopJobs } from "@/core/jobs";
import { contacts, customerMagicLinks } from "@/core/contacts/schema";
import { createContact, resolveContact } from "@/core/contacts/service";
import { consumeCustomerMagicLink } from "@/core/auth/magic-links/service";
import { hashCustomerMagicLinkToken } from "@/core/auth/two-factor-crypto";
import { actorFromToken } from "@/core/http/actor";
import { startImport, previewFromSource, commitImport } from "@/core/import/service";
import { createDataRequest, createMyDataRequest, verifyDataRequest, fulfillDataRequest, downloadMyDataRequestArtifact } from "@/core/privacy/service";
import { blogReaderComments } from "@/modules/cms/blog-comments-schema";
import { ensureDefaults } from "@/modules/cms/service";
import { ANONYMOUS, OWNER, closeDb, hasDatabase, truncateSpine } from "../helpers/spine";
import { freshlyVerifiedImportOwner, reviewOriginalImportedReader } from "../helpers/import-reader-review";

const email = "fictional-historical-address@example.test";
const privateBody = "Fictional original reader's private pending moderation body.";
const source = `<rss xmlns:wp="urn:wordpress" xmlns:content="urn:content"><channel><link>https://fictional-historical-source.example/</link><item><title>Fictional historical article</title><link>https://fictional-historical-source.example/article/</link><wp:post_id>10</wp:post_id><wp:post_type>post</wp:post_type><wp:status>publish</wp:status><content:encoded><![CDATA[<p>Ordinary fictional article.</p>]]></content:encoded><wp:comment><wp:comment_id>20</wp:comment_id><wp:comment_author>Fictional historical reader</wp:comment_author><wp:comment_author_email>${email}</wp:comment_author_email><wp:comment_content>${privateBody}</wp:comment_content><wp:comment_approved>0</wp:comment_approved></wp:comment></item></channel></rss>`;

describe.runIf(hasDatabase)("unreviewed source contact and later mailbox identity", () => {
  beforeEach(async () => { await truncateSpine(); await ensureDefaults.call({}, OWNER); });
  afterAll(async () => { await stopJobs(); await closeDb(); });
  it("does not export an unreviewed historical private comment after only current mailbox proof", async () => {
    const owner = await freshlyVerifiedImportOwner();
    const run = await startImport.call({ kind: "wordpress-wxr", origin: "https://fictional-historical-source.example/" }, owner);
    await previewFromSource.call({ id: run.id, payload: source }, owner);
    await expect(commitImport.call({ id: run.id }, owner)).rejects.toThrow(/review/);
    expect(await db().select().from(contacts).where(eq(contacts.email, email))).toHaveLength(0);
    const currentPerson = (await resolveContact.call({ name: "Fictional current mailbox holder", email }, owner)).contact;
    // The fixture models fresh proof of the *current* mailbox. It does not
    // attest who held that address when the historical comment was written.
    const token = randomBytes(32).toString("base64url");
    await db().insert(customerMagicLinks).values({ contactId: currentPerson.id, email, tokenHash: hashCustomerMagicLinkToken(token), expiresAt: new Date(Date.now() + 60_000) });
    const session = await consumeCustomerMagicLink.call({ token }, ANONYMOUS);
    const currentHolder = await actorFromToken(session.token);
    expect(currentHolder.kind).toBe("user");
    const request = await createMyDataRequest.call({ request: { kind: "export" } }, currentHolder);
    const result = await fulfillDataRequest.call({ id: request.id }, owner);
    const artifact = await downloadMyDataRequestArtifact.call({ id: result.artifact.id }, currentHolder);
    expect(artifact.content).not.toContain(privateBody);
    // A real fresh owner supplies the missing identity decision. Historical
    // source metadata never assigns its old email to this deliberately created person.
    const original = await createContact.call({ name: "Fictional original reader, explicitly reviewed" }, owner);
    await reviewOriginalImportedReader({ id: run.id, postId: "10", commentId: "20", contactId: original.id });
    await commitImport.call({ id: run.id }, owner);
    expect((await db().select().from(blogReaderComments))[0]).toMatchObject({ status: "pending", contactId: original.id, body: privateBody });
    const laterRequest = await createMyDataRequest.call({ request: { kind: "export" } }, currentHolder);
    const later = await fulfillDataRequest.call({ id: laterRequest.id }, owner);
    expect((await downloadMyDataRequestArtifact.call({ id: later.artifact.id }, currentHolder)).content).not.toContain(privateBody);
    const originalRequest = await createDataRequest.call({ contactId: original.id, request: { kind: "export" } }, owner);
    await verifyDataRequest.call({ id: originalRequest.id, method: "Fictional original reader verified by the actual owner" }, owner);
    const originalExport = await fulfillDataRequest.call({ id: originalRequest.id }, owner);
    expect(JSON.stringify(originalExport.artifact.body)).toContain(privateBody);
    await expect(downloadMyDataRequestArtifact.call({ id: originalExport.artifact.id }, currentHolder)).rejects.toMatchObject({ code: "not_found" });
  });
});
