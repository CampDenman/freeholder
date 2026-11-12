// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C2.29/C3.46: the same original reader cannot become a different CRM person.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { users, totpFactors, sessions } from "@/core/auth/schema";
import { createSession } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { db } from "@/core/db";
import { importRuns } from "@/core/plugins/schema";
import { createContact, mergeContacts, resolveContact, undoContactMerge, updateContact } from "@/core/contacts/service";
import { contactMergeOperations, contacts } from "@/core/contacts/schema";
import { commitImport, previewFromSource, publishImport, reconcileImport, rollbackImport, stageImportSource, startImport } from "@/core/import/service";
import { readerOwnershipReview, resolveReaderOwnership } from "@/core/import/reader-ownership-review";
import { readerOwnershipKeys, readerOwnershipReceipts } from "@/core/import/reader-ownership-schema";
import { rotateCredentials } from "@/core/connections/service";
import { resetEnvForTests } from "@/core/env";
import { addRetentionException, contactPrivacySources, createDataRequest, fulfillDataRequest, verifyDataRequest } from "@/core/privacy/service";
import { ensureDefaults } from "@/modules/cms/service";
import { blogReaderComments } from "@/modules/cms/blog-comments-schema";
import { listReaderComments } from "@/modules/cms/blog-comments";
import { ANONYMOUS, OWNER, closeDb, hasDatabase, truncateSpine } from "../helpers/spine";

const EMAIL = "original-reader@example.test";
const SOURCE = `<rss xmlns:wp="urn:wordpress" xmlns:content="urn:content"><channel><link>https://fictional-reader-source.example</link><item><title>Original source article</title><link>https://fictional-reader-source.example/original-article</link><wp:post_id>10</wp:post_id><wp:post_type>post</wp:post_type><wp:status>publish</wp:status><content:encoded><![CDATA[<p>Ordinary article text.</p>]]></content:encoded><wp:comment><wp:comment_id>20</wp:comment_id><wp:comment_author>Original reader</wp:comment_author><wp:comment_author_email>${EMAIL}</wp:comment_author_email><wp:comment_content>Original reader's unchanged comment.</wp:comment_content><wp:comment_approved>1</wp:comment_approved></wp:comment></item></channel></rss>`;

async function stage(payload = SOURCE) {
  const run = await startImport.call({ origin: "https://fictional-reader-source.example", kind: "wordpress-wxr" }, OWNER);
  await previewFromSource.call({ id: run.id, payload }, OWNER);
  return run.id;
}
async function boundReader(id: string) {
  const [run] = await db().select().from(importRuns).where(eq(importRuns.id, id));
  const preview = z.object({ pages: z.array(z.object({ readerComments: z.array(z.object({ contactId: z.uuid().optional() })) })) }).parse(run?.preview);
  return preview.pages[0]?.readerComments[0]?.contactId;
}
async function verifiedOwner() {
  await db().insert(users).values({ id: OWNER.userId, email: "fixture-source-owner@example.test", role: "owner" }).onConflictDoNothing();
  await db().insert(totpFactors).values({ userId: OWNER.userId, encryptedSecret: "fixture-only-source-owner-factor" }).onConflictDoNothing();
  const session = await db().transaction(tx => createSession(tx, OWNER.userId, { twoFactorVerified: true }));
  const actor = await actorFromToken(session.token);
  if (actor.kind !== "user" || !actor.sessionId) throw new Error("The actual fixture owner session was not resolved.");
  return actor;
}
async function stageReviewed(contactId: string, payload = SOURCE, reviewer?: Awaited<ReturnType<typeof verifiedOwner>>) {
  const id = await stage(payload), owner = reviewer ?? await verifiedOwner();
  const review = await readerOwnershipReview.call({ id }, owner);
  expect(review.rows).toHaveLength(1);
  const reader = review.rows[0]!;
  await resolveReaderOwnership.call({ id, receiptId: reader.receiptId, postId: reader.postId, commentId: reader.commentId, contactId, confirmation: "ASSIGN ORIGINAL READER" }, owner);
  return id;
}
async function ambiguousSource() {
  const original = (await resolveContact.call({ name: "Original reader", email: EMAIL }, OWNER)).contact;
  await updateContact.call({ id: original.id, email: "changed-reader@example.test" }, OWNER);
  const later = (await resolveContact.call({ name: "Later email holder", email: EMAIL }, OWNER)).contact;
  const id = await stage();
  return { original, later, id };
}
async function publishedReader(held: boolean) {
  const reader = (await resolveContact.call({ name: "Original reader", email: EMAIL }, OWNER)).contact;
  const id = await stageReviewed(reader.id);
  await commitImport.call({ id }, OWNER); await reconcileImport.call({ id }, OWNER); await publishImport.call({ id }, OWNER);
  const [comment] = await db().select().from(blogReaderComments);
  if (!comment) throw new Error("The actual original comment was not published.");
  if (held) {
    const request = await createDataRequest.call({ contactId: reader.id, request: { kind: "erasure" } }, OWNER);
    await verifyDataRequest.call({ id: request.id, method: "Fictional published reader verified" }, OWNER);
    await addRetentionException.call({ dataRequestId: request.id, scope: "cms.readerComments", reason: "legal_claim", legalBasis: "Fictional published reader evidence" }, OWNER);
    expect((await fulfillDataRequest.call({ id: request.id, confirmation: "ERASE" }, OWNER)).request.status).toBe("partially_completed");
  }
  return { id, comment };
}

describe.runIf(hasDatabase)("historical imported reader provenance (C2.29/C3.46)", () => {
  beforeEach(async () => { await truncateSpine(); await ensureDefaults.call({}, OWNER); });
  afterEach(() => { vi.unstubAllEnvs(); resetEnvForTests(); });
  afterAll(closeDb);

  it("does not guess the original reader from a current email holder on the first historical source", async () => {
    const candidate = (await resolveContact.call({ name: "Current address holder, original reader unknown", email: EMAIL }, OWNER)).contact;
    const id = await stage();
    const [receipt] = await db().select().from(readerOwnershipReceipts);
    expect({ bound: await boundReader(id), owner: receipt?.contactId, state: receipt?.state }).toEqual({ bound: undefined, owner: null, state: "review" });
    const source = contactPrivacySources().find(item => item.scope === "imports.readerSources")!;
    const exported = await db().transaction(tx => source.exportData(tx, candidate.id));
    expect(JSON.stringify(exported)).not.toContain("Original reader's unchanged comment.");
    await expect(commitImport.call({ id }, OWNER)).rejects.toThrow(/review/);
  });

  it("keeps the already-recorded original reader when identical source is staged after an address change", async () => {
    const reader = (await resolveContact.call({ name: "Original reader", email: EMAIL }, OWNER)).contact;
    const first = await stageReviewed(reader.id);
    expect(await boundReader(first)).toBe(reader.id);
    await updateContact.call({ id: reader.id, email: "changed-reader@example.test" }, OWNER);
    const repeated = await stage();
    expect(await boundReader(repeated)).toBe(reader.id);
  });

  it("does not assign the same original comment to the new holder of its old email", async () => {
    const reader = (await resolveContact.call({ name: "Original reader", email: EMAIL }, OWNER)).contact;
    const first = await stageReviewed(reader.id);
    expect(await boundReader(first)).toBe(reader.id);
    await updateContact.call({ id: reader.id, email: "changed-reader@example.test" }, OWNER);
    const later = (await resolveContact.call({ name: "Different reader", email: EMAIL }, OWNER)).contact;
    expect(later.id).not.toBe(reader.id);
    const repeated = await stage();
    expect(await boundReader(repeated)).toBe(reader.id);
  });

  it("retains separate original provenance after merge undo and subsequent email reassignment", async () => {
    const original = (await resolveContact.call({ name: "Original reader", email: EMAIL }, OWNER)).contact;
    const separate = (await resolveContact.call({ name: "Separate reader", email: "separate-reader@example.test" }, OWNER)).contact;
    const first = await stageReviewed(original.id);
    const merged = await mergeContacts.call({ survivingId: separate.id, duplicateId: original.id }, OWNER);
    expect(await boundReader(first)).toBe(separate.id);
    await undoContactMerge.call({ operationId: merged.mergeOperationId }, OWNER);
    expect(await boundReader(first)).toBe(original.id);
    await updateContact.call({ id: original.id, email: "changed-reader@example.test" }, OWNER);
    await updateContact.call({ id: separate.id, email: EMAIL }, OWNER);
    const repeated = await stage();
    expect(await boundReader(repeated)).toBe(original.id);
  });

  it("keeps an opaque erasure fence after removing reader data and refuses the same original source", async () => {
    const reader = (await resolveContact.call({ name: "Original reader", email: EMAIL }, OWNER)).contact;
    await stageReviewed(reader.id);
    const adapter = contactPrivacySources().find(value => value.scope === "imports.readerOwnership")!;
    const exported = await db().transaction(tx => adapter.exportData(tx, reader.id));
    expect(exported).toHaveLength(1);
    expect(JSON.stringify(exported)).not.toContain(EMAIL);
    expect(JSON.stringify(exported)).not.toContain("encryptedKey");
    const request = await createDataRequest.call({ contactId: reader.id, request: { kind: "erasure" } }, OWNER);
    await verifyDataRequest.call({ id: request.id, method: "Fictional source reader identity verified" }, OWNER);
    expect((await fulfillDataRequest.call({ id: request.id, confirmation: "ERASE" }, OWNER)).request.status).toBe("completed");
    expect((await db().select().from(readerOwnershipReceipts))[0]?.state).toBe("erased");
    await expect(stage()).rejects.toMatchObject({ code: "conflict" });
    expect(await db().select().from(contacts).where(eq(contacts.email, EMAIL))).toHaveLength(0);
  });

  it("preserves the named reader hold while preventing a held witness from authorizing another import", async () => {
    const reader = (await resolveContact.call({ name: "Original reader", email: EMAIL }, OWNER)).contact;
    const first = await stageReviewed(reader.id);
    const request = await createDataRequest.call({ contactId: reader.id, request: { kind: "erasure" } }, OWNER);
    await verifyDataRequest.call({ id: request.id, method: "Fictional source reader identity verified" }, OWNER);
    await addRetentionException.call({ dataRequestId: request.id, scope: "cms.readerComments", reason: "legal_claim", legalBasis: "Fictional retained original reader dispute" }, OWNER);
    expect((await fulfillDataRequest.call({ id: request.id, confirmation: "ERASE" }, OWNER)).request.status).toBe("partially_completed");
    expect(JSON.stringify((await db().select().from(importRuns).where(eq(importRuns.id, first)))[0]?.preview)).toContain("Original reader's unchanged comment.");
    expect((await db().select().from(readerOwnershipReceipts))[0]?.state).toBe("erased");
    await expect(stage()).rejects.toMatchObject({ code: "conflict" });
  });

  it("uses a normalized merge witness for 1001 readers and restores every exact original owner", async () => {
    const separate = (await resolveContact.call({ name: "Separate reader", email: "separate-reader@example.test" }, OWNER)).contact;
    const comments = Array.from({ length: 1001 }, (_, index) => `<wp:comment><wp:comment_id>${index + 1}</wp:comment_id><wp:comment_author>Original reader</wp:comment_author><wp:comment_author_email>${EMAIL}</wp:comment_author_email><wp:comment_content>Fictional original reader ${index}.</wp:comment_content><wp:comment_approved>1</wp:comment_approved></wp:comment>`).join("");
    const id = await stage(SOURCE.replace(/<wp:comment>[\s\S]*?<\/wp:comment>/, comments));
    await commitImport.call({ id }, OWNER);
    const original = (await resolveContact.call({ name: "Original reader", email: EMAIL }, OWNER)).contact;
    const merged = await mergeContacts.call({ survivingId: separate.id, duplicateId: original.id }, OWNER);
    const [operation] = await db().select().from(contactMergeOperations).where(eq(contactMergeOperations.id, merged.mergeOperationId));
    const references = z.array(z.object({ table: z.string(), before: z.unknown(), after: z.unknown() })).parse(operation?.referenceState);
    const witness = references.find(reference => reference.table === "import_reader_ownership_receipts");
    expect(JSON.stringify(witness).length).toBeLessThan(300);
    expect(await db().select().from(readerOwnershipReceipts).where(eq(readerOwnershipReceipts.contactId, separate.id))).toHaveLength(1001);
    await undoContactMerge.call({ operationId: merged.mergeOperationId }, OWNER);
    expect(await db().select().from(readerOwnershipReceipts).where(eq(readerOwnershipReceipts.contactId, original.id))).toHaveLength(1001);
  });

  it("keeps different WordPress instances on one host separate when their post and comment IDs overlap", async () => {
    const first = (await resolveContact.call({ name: "First site reader", email: EMAIL }, OWNER)).contact;
    const secondEmail = "second-site-reader@example.test";
    const second = (await resolveContact.call({ name: "Second site reader", email: secondEmail }, OWNER)).contact;
    const sourceA = SOURCE.replace("<link>https://fictional-reader-source.example</link>", "<link>https://fictional-reader-source.example/site-a/</link>");
    const sourceB = SOURCE.replace("<link>https://fictional-reader-source.example</link>", "<link>https://fictional-reader-source.example/site-b/</link>").replace(EMAIL, secondEmail);
    const runA = await stageReviewed(first.id, sourceA), runB = await stageReviewed(second.id, sourceB);
    expect(await boundReader(runA)).toBe(first.id);
    expect(await boundReader(runB)).toBe(second.id);
  });

  it("requires a verified human decision for unseen historical ambiguity, then commits the chosen original person", async () => {
    const owner = await verifiedOwner();
    const { original, later, id } = await ambiguousSource();
    expect(await boundReader(id)).toBeUndefined();
    expect((await db().select().from(readerOwnershipReceipts))[0]?.state).toBe("review");
    const review = await readerOwnershipReview.call({ id }, owner);
    expect(review.rows).toHaveLength(1);
    expect(JSON.stringify(review)).not.toContain(original.id);
    expect(JSON.stringify(review)).not.toContain(later.id);
    await expect(commitImport.call({ id }, OWNER)).rejects.toMatchObject({ code: "conflict" });
    const reader = review.rows[0]!;
    await resolveReaderOwnership.call({ id, receiptId: reader.receiptId, postId: reader.postId, commentId: reader.commentId, contactId: original.id, confirmation: "ASSIGN ORIGINAL READER" }, owner);
    expect((await readerOwnershipReview.call({ id }, owner)).rows).toHaveLength(0);
    expect((await commitImport.call({ id }, OWNER)).status).toBe("committed");
    expect((await db().select().from(blogReaderComments)).map(comment => comment.contactId)).toEqual([original.id]);
  });

  it("refuses agents, personal keys and stale verification without binding an ambiguous reader", async () => {
    const owner = await verifiedOwner();
    const { original, id } = await ambiguousSource();
    const reader = (await readerOwnershipReview.call({ id }, owner)).rows[0]!;
    const input = { id, receiptId: reader.receiptId, postId: reader.postId, commentId: reader.commentId, contactId: original.id, confirmation: "ASSIGN ORIGINAL READER" as const };
    const agent = { kind: "agent" as const, keyName: "fixture-source-review-agent", scopes: ["imports.*", "contacts.get"] };
    await expect(readerOwnershipReview.call({ id }, agent)).rejects.toMatchObject({ code: "permission" });
    await expect(resolveReaderOwnership.call(input, agent)).rejects.toMatchObject({ code: "permission" });
    await expect(resolveReaderOwnership.call(input, { ...owner, keyScopes: ["imports.resolveReaderOwnership"], sessionId: undefined })).rejects.toMatchObject({ code: "permission" });
    await db().update(sessions).set({ stepUpAt: new Date("2020-01-01T00:00:00Z") }).where(eq(sessions.id, owner.sessionId!));
    await expect(resolveReaderOwnership.call(input, owner)).rejects.toMatchObject({ code: "step_up_required" });
    expect((await db().select().from(readerOwnershipReceipts))[0]?.state).toBe("review");
  });

  it("does not reveal CRM ownership or private review flags in an exact source-only preview", async () => {
    const original = (await resolveContact.call({ email: EMAIL }, OWNER)).contact;
    await updateContact.call({ id: original.id, email: "changed-reader@example.test" }, OWNER);
    const later = (await resolveContact.call({ email: EMAIL }, OWNER)).contact;
    const run = await startImport.call({ origin: "https://fictional-reader-source.example", kind: "wordpress-wxr" }, OWNER);
    const visible = await previewFromSource.call({ id: run.id, payload: SOURCE }, { kind: "agent", keyName: "source-only-preview", scopes: ["imports.previewFromSource"] });
    expect(JSON.stringify(visible)).not.toContain(original.id);
    expect(JSON.stringify(visible)).not.toContain(later.id);
    expect(JSON.stringify(visible)).not.toContain("readerOwnershipReviewRequired");
    expect((await db().select().from(readerOwnershipReceipts))[0]?.state).toBe("review");
  });

  it("keeps a reviewed original reader when the different current email holder is erased before commit", async () => {
    const owner = await verifiedOwner();
    const { original, later, id } = await ambiguousSource();
    const reader = (await readerOwnershipReview.call({ id }, owner)).rows[0]!;
    await resolveReaderOwnership.call({ id, receiptId: reader.receiptId, postId: reader.postId, commentId: reader.commentId, contactId: original.id, confirmation: "ASSIGN ORIGINAL READER" }, owner);
    const request = await createDataRequest.call({ contactId: later.id, request: { kind: "erasure" } }, OWNER);
    await verifyDataRequest.call({ id: request.id, method: "Fictional different email holder verified" }, OWNER);
    expect((await fulfillDataRequest.call({ id: request.id, confirmation: "ERASE" }, OWNER)).request.status).toBe("completed");
    expect((await commitImport.call({ id }, OWNER)).status).toBe("committed");
    expect((await db().select().from(blogReaderComments)).map(comment => comment.contactId)).toEqual([original.id]);
  });

  it("keeps a held published reader private after acknowledged erasure", async () => {
    const { comment } = await publishedReader(true);
    expect(await db().select().from(blogReaderComments).where(eq(blogReaderComments.id, comment.id))).toHaveLength(1);
    expect(await listReaderComments.call({ pageId: comment.pageId }, ANONYMOUS)).toEqual([]);
  });

  it("keeps actual held comment evidence when its import is rolled back", async () => {
    const { id, comment } = await publishedReader(true);
    const rollback = await rollbackImport.call({ id }, OWNER);
    expect(rollback.status).toBe("rolled_back");
    expect(z.object({ rolledBack: z.object({ keptPages: z.array(z.uuid()) }) }).parse(rollback.checkpoint).rolledBack.keptPages).toEqual([comment.pageId]);
    expect(await db().select().from(blogReaderComments).where(eq(blogReaderComments.id, comment.id))).toHaveLength(1);
    expect(await listReaderComments.call({ pageId: comment.pageId }, ANONYMOUS)).toEqual([]);
  });

  it("still removes an unheld imported comment during ordinary rollback", async () => {
    const { id, comment } = await publishedReader(false);
    expect((await listReaderComments.call({ pageId: comment.pageId }, ANONYMOUS)).length).toBe(1);
    expect((await rollbackImport.call({ id }, OWNER)).status).toBe("rolled_back");
    expect(await db().select().from(blogReaderComments).where(eq(blogReaderComments.id, comment.id))).toHaveLength(0);
  });

  it("lets the verified owner recover a persisted pre-receipt reader without guessing from its reused address", async () => {
    const owner = await verifiedOwner();
    const original = (await resolveContact.call({ name: "Original reader", email: EMAIL }, OWNER)).contact;
    const staged = stageImportSource("wordpress-wxr", SOURCE, "https://fictional-reader-source.example");
    // The persisted pre-78 cache shape has the original contact pointer and
    // source executor, but no receipt, key or review flags. This is an upgrade
    // fixture, not deletion/corruption of a receipt created by current code.
    const cached = z.object({ pages: z.array(z.object({ readerComments: z.array(z.record(z.string(), z.unknown())) }).passthrough()) }).passthrough().parse(staged.preview);
    cached.pages[0]!.readerComments[0]!.contactId = original.id;
    const [legacy] = await db().insert(importRuns).values({ source: "wordpress-wxr:https://fictional-reader-source.example", kind: "wordpress-wxr", origin: "https://fictional-reader-source.example", status: "previewed", preview: cached, checkpoint: { origin: "https://fictional-reader-source.example", kind: "wordpress-wxr" }, counts: staged.counts, createdBy: "agent:original-legacy-source-executor" }).returning();
    await updateContact.call({ id: original.id, email: "changed-reader@example.test" }, OWNER);
    const later = (await resolveContact.call({ name: "Later email holder", email: EMAIL }, OWNER)).contact;
    await expect(commitImport.call({ id: legacy!.id }, OWNER)).rejects.toMatchObject({ code: "conflict" });
    const review = await readerOwnershipReview.call({ id: legacy!.id }, owner);
    expect(review.rows).toHaveLength(1);
    const reader = review.rows[0]!;
    await resolveReaderOwnership.call({ id: legacy!.id, receiptId: reader.receiptId, postId: reader.postId, commentId: reader.commentId, contactId: original.id, confirmation: "ASSIGN ORIGINAL READER" }, owner);
    expect((await commitImport.call({ id: legacy!.id }, OWNER)).status).toBe("committed");
    const [receipt] = await db().select().from(readerOwnershipReceipts);
    expect(receipt).toMatchObject({ firstRunId: legacy!.id, createdBy: `user:${OWNER.userId}`, contactId: original.id, state: "bound" });
    expect((await db().select().from(importRuns).where(eq(importRuns.id, legacy!.id)))[0]?.createdBy).toBe("agent:original-legacy-source-executor");
    expect(receipt?.contactId).not.toBe(later.id);
    expect((await db().select().from(blogReaderComments)).map(comment => comment.contactId)).toEqual([original.id]);
  });

  it("rotates the sealed reader key without changing original source ownership and no longer needs the previous key", async () => {
    const owner = await verifiedOwner(), oldKey = Buffer.alloc(32, 3).toString("hex"), newKey = Buffer.alloc(32, 4).toString("hex");
    vi.stubEnv("CREDENTIAL_KEY", oldKey); vi.stubEnv("CREDENTIAL_KEY_PREVIOUS", ""); resetEnvForTests();
    const original = (await resolveContact.call({ email: EMAIL }, OWNER)).contact;
    await stageReviewed(original.id, SOURCE, owner);
    const [before] = await db().select().from(readerOwnershipKeys), receipts = await db().select().from(readerOwnershipReceipts);
    vi.stubEnv("CREDENTIAL_KEY", newKey); vi.stubEnv("CREDENTIAL_KEY_PREVIOUS", oldKey); resetEnvForTests();
    expect(await rotateCredentials.call({}, owner)).toEqual({ examined: 1, rotated: 1, failed: 0 });
    expect((await db().select().from(readerOwnershipKeys))[0]?.encryptedKey).not.toBe(before?.encryptedKey);
    vi.stubEnv("CREDENTIAL_KEY_PREVIOUS", ""); resetEnvForTests();
    expect(await boundReader(await stage())).toBe(original.id);
    expect(await db().select().from(readerOwnershipReceipts)).toEqual(receipts);
  });

  it("refuses an unreadable reader seal and preserves its ciphertext and original receipts for recovery", async () => {
    const owner = await verifiedOwner();
    await resolveContact.call({ email: EMAIL }, OWNER); await stage();
    const receipts = await db().select().from(readerOwnershipReceipts), ciphertext = "fictional-unreadable-reader-envelope";
    await db().update(readerOwnershipKeys).set({ encryptedKey: ciphertext });
    await expect(stage()).rejects.toMatchObject({ code: "conflict" });
    expect(await rotateCredentials.call({}, owner)).toEqual({ examined: 1, rotated: 0, failed: 1 });
    expect((await db().select().from(readerOwnershipKeys))[0]?.encryptedKey).toBe(ciphertext);
    expect(await db().select().from(readerOwnershipReceipts)).toEqual(receipts);
  });

  it("retires an originally unbound source when its verified reader is erased before comment commit", async () => {
    const first = await stage();
    expect((await db().select().from(readerOwnershipReceipts))[0]).toMatchObject({ contactId: null, state: "unbound" });
    const reader = (await resolveContact.call({ email: EMAIL }, OWNER)).contact;
    const request = await createDataRequest.call({ contactId: reader.id, request: { kind: "erasure" } }, OWNER);
    await verifyDataRequest.call({ id: request.id, method: "Fictional originally unbound reader verified" }, OWNER);
    expect((await fulfillDataRequest.call({ id: request.id, confirmation: "ERASE" }, OWNER)).request.status).toBe("completed");
    await expect(stage()).rejects.toMatchObject({ code: "conflict" });
    expect((await db().select().from(readerOwnershipReceipts))[0]).toMatchObject({ firstRunId: first, contactId: null, state: "erased", retirementRequestId: request.id, createdBy: `user:${OWNER.userId}` });
    expect(await db().select().from(contacts).where(eq(contacts.email, EMAIL))).toHaveLength(0);
  });

  it("does not export an originally unbound historical reader to a later address-holder", async () => {
    const owner = await verifiedOwner();
    await stage();
    const later = (await resolveContact.call({ name: "Later email holder", email: EMAIL }, OWNER)).contact;
    const request = await createDataRequest.call({ contactId: later.id, request: { kind: "export" } }, owner);
    await verifyDataRequest.call({ id: request.id, method: "Fictional later address-holder verified" }, owner);
    const result = await fulfillDataRequest.call({ id: request.id }, owner);
    expect(result.request.status).toBe("completed");
    const artifact = z.object({ sources: z.record(z.string(), z.unknown()) }).parse(result.artifact.body);
    expect(artifact.sources["imports.readerSources"]).toEqual([]);
    expect(JSON.stringify(artifact)).not.toContain("Original reader's unchanged comment.");
  });

  for (const restage of [false, true]) it(`requires original-reader review when a previously unknown address now belongs to a CRM person (restage=${restage})`, async () => {
    const owner = await verifiedOwner(), first = await stage();
    const later = (await resolveContact.call({ name: "Later email holder", email: EMAIL }, OWNER)).contact;
    const id = restage ? await stage() : first;
    await expect(commitImport.call({ id }, OWNER)).rejects.toMatchObject({ code: "conflict" });
    expect(await db().select().from(blogReaderComments)).toHaveLength(0);
    const review = await readerOwnershipReview.call({ id }, owner);
    expect(review.rows).toHaveLength(1);
    const reader = review.rows[0]!;
    await resolveReaderOwnership.call({ id, receiptId: reader.receiptId, postId: reader.postId, commentId: reader.commentId, contactId: later.id, confirmation: "ASSIGN ORIGINAL READER" }, owner);
    expect((await commitImport.call({ id }, OWNER)).status).toBe("committed");
    expect((await db().select().from(blogReaderComments)).map(comment => comment.contactId)).toEqual([later.id]);
  });

  it("binds two originally unknown readers only after an actual owner creates and chooses their person", async () => {
    const owner = await verifiedOwner();
    const second = `<wp:comment><wp:comment_id>21</wp:comment_id><wp:comment_author>Original reader</wp:comment_author><wp:comment_author_email>${EMAIL}</wp:comment_author_email><wp:comment_content>Second original comment.</wp:comment_content><wp:comment_approved>1</wp:comment_approved></wp:comment>`;
    const id = await stage(SOURCE.replace("</item>", `${second}</item>`));
    await expect(commitImport.call({ id }, OWNER)).rejects.toThrow(/review/);
    expect(await db().select().from(contacts).where(eq(contacts.email, EMAIL))).toHaveLength(0);
    const original = await createContact.call({ name: "Explicitly reviewed original reader" }, owner);
    const review = await readerOwnershipReview.call({ id }, owner);
    expect(review.rows).toHaveLength(2);
    for (const reader of review.rows) await resolveReaderOwnership.call({ id, receiptId: reader.receiptId, postId: reader.postId, commentId: reader.commentId, contactId: original.id, confirmation: "ASSIGN ORIGINAL READER" }, owner);
    expect((await commitImport.call({ id }, OWNER)).status).toBe("committed");
    expect(await db().select().from(contacts).where(eq(contacts.email, EMAIL))).toHaveLength(0);
    expect((await db().select().from(blogReaderComments)).map(comment => comment.contactId)).toEqual([original.id, original.id]);
    const receipts = await db().select().from(readerOwnershipReceipts);
    expect(receipts).toHaveLength(2);
    expect(receipts.every(receipt => receipt.state === "bound" && receipt.contactId === original.id)).toBe(true);
  });

  it("requires owner review for a new original identity sharing an unbound erased address without inventing its former owner", async () => {
    const owner = await verifiedOwner();
    const first = await stage(), prior = (await resolveContact.call({ email: EMAIL }, OWNER)).contact;
    const request = await createDataRequest.call({ contactId: prior.id, request: { kind: "erasure" } }, OWNER);
    await verifyDataRequest.call({ id: request.id, method: "Fictional unknown original verified" }, OWNER);
    expect((await fulfillDataRequest.call({ id: request.id, confirmation: "ERASE" }, OWNER)).request.status).toBe("completed");
    const id = await stage(SOURCE.replace("<wp:comment_id>20</wp:comment_id>", "<wp:comment_id>21</wp:comment_id>").replace("Original reader's unchanged comment.", "A new independently reviewed comment."));
    await expect(commitImport.call({ id }, OWNER)).rejects.toMatchObject({ code: "conflict" });
    const reader = (await readerOwnershipReview.call({ id }, owner)).rows[0];
    expect(reader).toBeDefined();
    const next = await createContact.call({ name: "Explicitly reviewed new reader", email: EMAIL }, owner);
    await resolveReaderOwnership.call({ id, receiptId: reader!.receiptId, postId: reader!.postId, commentId: reader!.commentId, contactId: next.id, confirmation: "ASSIGN ORIGINAL READER" }, owner);
    expect((await commitImport.call({ id }, OWNER)).status).toBe("committed");
    expect((await db().select().from(readerOwnershipReceipts)).find(receipt => receipt.firstRunId === first)).toMatchObject({ contactId: null, state: "erased", retirementRequestId: request.id });
    expect((await db().select().from(blogReaderComments)).map(comment => comment.contactId)).toEqual([next.id]);
  });
});
