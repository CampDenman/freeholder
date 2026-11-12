// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C2.29/C11.10: actual prior-runtime committed data must not become mailbox proof.
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { stopJobs } from "@/core/jobs";
import { createContact } from "@/core/contacts/service";
import { customerMagicLinks } from "@/core/contacts/schema";
import { consumeCustomerMagicLink } from "@/core/auth/magic-links/service";
import { hashCustomerMagicLinkToken } from "@/core/auth/two-factor-crypto";
import { actorFromToken } from "@/core/http/actor";
import { addRetentionException, createDataRequest, verifyDataRequest, createMyDataRequest, fulfillDataRequest, downloadMyDataRequestArtifact } from "@/core/privacy/service";
import { importRuns } from "@/core/plugins/schema";
import { readerOwnershipReview, resolveReaderOwnership } from "@/core/import/reader-ownership-review";
import { readerOwnershipReceipts } from "@/core/import/reader-ownership-schema";
import { blogReaderComments } from "@/modules/cms/blog-comments-schema";
import { ANONYMOUS, closeDb } from "../helpers/spine";
import { freshlyVerifiedImportOwner } from "../helpers/import-reader-review";
import { READER_UPGRADE_EMAIL, READER_UPGRADE_BODY } from "./import-reader-data";

afterAll(async () => { await stopJobs(); await closeDb(); });
it("does not disclose actual pre78 private imported history through only current mailbox proof", async () => {
  const fixture = JSON.parse(readFileSync(process.env.FREEHOLDER_READER_UPGRADE_EVIDENCE!, "utf8")) as { id: string; originalId: string; createdBy: string };
  expect(await db().select().from(readerOwnershipReceipts)).toHaveLength(0);
  const [before] = await db().select().from(blogReaderComments).where(eq(blogReaderComments.contactId, fixture.originalId));
  expect(before).toMatchObject({ body: READER_UPGRADE_BODY, status: "pending" });
  const owner = await freshlyVerifiedImportOwner();
  const token = randomBytes(32).toString("base64url");
  await db().insert(customerMagicLinks).values({ contactId: fixture.originalId, email: READER_UPGRADE_EMAIL, tokenHash: hashCustomerMagicLinkToken(token), expiresAt: new Date(Date.now() + 60_000) });
  const session = await consumeCustomerMagicLink.call({ token }, ANONYMOUS);
  const holder = await actorFromToken(session.token);
  const request = await createMyDataRequest.call({ request: { kind: "export" } }, holder);
  const result = await fulfillDataRequest.call({ id: request.id }, owner);
  expect((await downloadMyDataRequestArtifact.call({ id: result.artifact.id }, holder)).content).not.toContain(READER_UPGRADE_BODY);
  const reviewed = await readerOwnershipReview.call({ id: fixture.id }, owner);
  expect(reviewed.rows).toHaveLength(1);
  const row = reviewed.rows[0]!;
  expect(row).toMatchObject({ receiptId: null, postId: "10", commentId: "20", email: null });
  const original = await createContact.call({ name: "Actual original reader chosen by the owner" }, owner);
  if (process.env.FREEHOLDER_READER_UPGRADE_HOLD_BEFORE_REVIEW === "1") {
    const erasure = await createDataRequest.call({ contactId: fixture.originalId, request: { kind: "erasure" } }, owner);
    await addRetentionException.call({ dataRequestId: erasure.id, scope: "cms.readerComments", reason: "legal_claim", legalBasis: "Fictional original committed reader evidence held before verification" }, owner);
    await expect(resolveReaderOwnership.call({ id: fixture.id, receiptId: row.receiptId, postId: row.postId, commentId: row.commentId, contactId: original.id, confirmation: "ASSIGN ORIGINAL READER" }, owner)).rejects.toMatchObject({ code: "conflict" });
    expect(await db().select().from(readerOwnershipReceipts)).toHaveLength(0);
    expect((await db().select().from(blogReaderComments))[0]).toEqual(before);
    return;
  }
  await resolveReaderOwnership.call({ id: fixture.id, receiptId: row.receiptId, postId: row.postId, commentId: row.commentId, contactId: original.id, confirmation: "ASSIGN ORIGINAL READER" }, owner);
  const [after] = await db().select().from(blogReaderComments);
  expect(after).toMatchObject({ id: before!.id, source: before!.source, externalId: before!.externalId, body: READER_UPGRADE_BODY, status: "pending", authorName: before!.authorName, createdAt: before!.createdAt, contactId: original.id });
  expect((await db().select().from(importRuns).where(eq(importRuns.id, fixture.id)))[0]?.createdBy).toBe(fixture.createdBy);
  const laterRequest = await createMyDataRequest.call({ request: { kind: "export" } }, holder);
  const later = await fulfillDataRequest.call({ id: laterRequest.id }, owner);
  expect((await downloadMyDataRequestArtifact.call({ id: later.artifact.id }, holder)).content).not.toContain(READER_UPGRADE_BODY);
  const originalRequest = await createDataRequest.call({ contactId: original.id, request: { kind: "export" } }, owner);
  await verifyDataRequest.call({ id: originalRequest.id, method: "Actual owner checked the original fictional reader" }, owner);
  const originalExport = await fulfillDataRequest.call({ id: originalRequest.id }, owner);
  expect(JSON.stringify(originalExport.artifact.body)).toContain(READER_UPGRADE_BODY);
  await expect(downloadMyDataRequestArtifact.call({ id: originalExport.artifact.id }, holder)).rejects.toMatchObject({ code: "not_found" });
});
