// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C2.29/C3.46: the same original reader cannot become a different CRM person.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/core/db";
import { importRuns } from "@/core/plugins/schema";
import { mergeContacts, resolveContact, undoContactMerge, updateContact } from "@/core/contacts/service";
import { contactMergeOperations, contacts } from "@/core/contacts/schema";
import { previewFromSource, startImport } from "@/core/import/service";
import { readerOwnershipReceipts } from "@/core/import/reader-ownership-schema";
import { addRetentionException, contactPrivacySources, createDataRequest, fulfillDataRequest, verifyDataRequest } from "@/core/privacy/service";
import { ensureDefaults } from "@/modules/cms/service";
import { OWNER, closeDb, hasDatabase, truncateSpine } from "../helpers/spine";

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

describe.runIf(hasDatabase)("historical imported reader provenance (C2.29/C3.46)", () => {
  beforeAll(async () => {
    // This isolated source proof deliberately applies reserved 78 after the
    // branch's journalled schema. It proves this increment's behavior, not
    // the still-required contiguous 73–78 upgrade or deployment acceptance.
    const [current] = await db().execute<{ present: boolean }>(sql`select to_regclass('public.import_reader_ownership_receipts') is not null as present`);
    if (!current?.present) await db().transaction(async tx => {
      for (const statement of readFileSync("db/migrations/0078_import_reader_ownership.sql", "utf8").split("--> statement-breakpoint")) if (statement.trim()) await tx.execute(sql.raw(statement));
    });
  });
  beforeEach(async () => { await truncateSpine(); await ensureDefaults.call({}, OWNER); });
  afterAll(closeDb);

  it("keeps the already-recorded original reader when identical source is staged after an address change", async () => {
    const reader = (await resolveContact.call({ name: "Original reader", email: EMAIL }, OWNER)).contact;
    const first = await stage();
    expect(await boundReader(first)).toBe(reader.id);
    await updateContact.call({ id: reader.id, email: "changed-reader@example.test" }, OWNER);
    const repeated = await stage();
    expect(await boundReader(repeated)).toBe(reader.id);
  });

  it("does not assign the same original comment to the new holder of its old email", async () => {
    const reader = (await resolveContact.call({ name: "Original reader", email: EMAIL }, OWNER)).contact;
    const first = await stage();
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
    const first = await stage();
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
    await stage();
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
    const first = await stage();
    const request = await createDataRequest.call({ contactId: reader.id, request: { kind: "erasure" } }, OWNER);
    await verifyDataRequest.call({ id: request.id, method: "Fictional source reader identity verified" }, OWNER);
    await addRetentionException.call({ dataRequestId: request.id, scope: "cms.readerComments", reason: "legal_claim", legalBasis: "Fictional retained original reader dispute" }, OWNER);
    expect((await fulfillDataRequest.call({ id: request.id, confirmation: "ERASE" }, OWNER)).request.status).toBe("partially_completed");
    expect(JSON.stringify((await db().select().from(importRuns).where(eq(importRuns.id, first)))[0]?.preview)).toContain("Original reader's unchanged comment.");
    expect((await db().select().from(readerOwnershipReceipts))[0]?.state).toBe("erased");
    await expect(stage()).rejects.toMatchObject({ code: "conflict" });
  });

  it("uses a normalized merge witness for 1001 readers and restores every exact original owner", async () => {
    const original = (await resolveContact.call({ name: "Original reader", email: EMAIL }, OWNER)).contact;
    const separate = (await resolveContact.call({ name: "Separate reader", email: "separate-reader@example.test" }, OWNER)).contact;
    const comments = Array.from({ length: 1001 }, (_, index) => `<wp:comment><wp:comment_id>${index + 1}</wp:comment_id><wp:comment_author>Original reader</wp:comment_author><wp:comment_author_email>${EMAIL}</wp:comment_author_email><wp:comment_content>Fictional original reader ${index}.</wp:comment_content><wp:comment_approved>1</wp:comment_approved></wp:comment>`).join("");
    await stage(SOURCE.replace(/<wp:comment>[\s\S]*?<\/wp:comment>/, comments));
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
    const runA = await stage(sourceA), runB = await stage(sourceB);
    expect(await boundReader(runA)).toBe(first.id);
    expect(await boundReader(runB)).toBe(second.id);
  });
});
