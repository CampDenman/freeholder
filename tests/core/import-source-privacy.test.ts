// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C2.29/C3.22/C11.10: a completed erasure must cover staged import copies too.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { violates } from "@/core/db/errors";
import { resetStorageForTests, storage } from "@/adapters/storage";
import { contacts } from "@/core/contacts/schema";
import { mergeContacts, resolveContact, undoContactMerge, updateContact } from "@/core/contacts/service";
import { importRuns } from "@/core/plugins/schema";
import { addRetentionException, contactPrivacySources, createDataRequest, fulfillDataRequest, registerContactPrivacySource, verifyDataRequest } from "@/core/privacy/service";
import { commitImport, previewFromSource, publishImport, reconcileImport, reviewImportConflicts, rollbackImport, startImport } from "@/core/import/service";
import { beginSourceUpload, previewFromUpload, uploadSourceChunk } from "@/core/import/source-upload";
import { createPage, ensureDefaults, publishPage } from "@/modules/cms/service";
import { setPostMeta } from "@/modules/cms/blog-service";
import { blogReaderComments } from "@/modules/cms/blog-comments-schema";
import { OWNER, closeDb, hasDatabase, truncateSpine } from "../helpers/spine";

const EMAIL = "cached-reader@example.test";
const COMMENT = "Erase this reader comment and its cached copy.";
let erasureBarrier: { point: "before" | "after"; entered: () => void; wait: Promise<void> } | undefined;
for (const [point, order] of [["before", 9], ["after", 11]] as const) {
  registerContactPrivacySource({ scope: `test.importReaderBarrier.${point}`, tables: [], eraseOrder: order,
    exportData: async () => [], erase: async () => {
      if (erasureBarrier?.point === point) { erasureBarrier.entered(); await erasureBarrier.wait; }
      return { affected: 0 };
    },
  });
}
const SOURCE = `<rss xmlns:wp="http://wordpress.org/export/1.2/" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>Fixture source</title><link>https://source.example</link><item><title>Erasure source</title><link>https://source.example/erasure-source</link><wp:post_id>10</wp:post_id><wp:post_name>erasure-source</wp:post_name><wp:post_type>post</wp:post_type><wp:status>publish</wp:status><content:encoded><![CDATA[<p>Ordinary source article.</p>]]></content:encoded><wp:comment><wp:comment_id>20</wp:comment_id><wp:comment_author><![CDATA[Cached reader]]></wp:comment_author><wp:comment_author_email>${EMAIL}</wp:comment_author_email><wp:comment_content><![CDATA[${COMMENT}]]></wp:comment_content><wp:comment_approved>1</wp:comment_approved></wp:comment></item></channel></rss>`;

async function erase(contactId: string) {
  const request = await createDataRequest.call({ contactId, request: { kind: "erasure" } }, OWNER);
  await verifyDataRequest.call({ id: request.id, method: "Fictional fixture identity verified" }, OWNER);
  const result = await fulfillDataRequest.call({ id: request.id, confirmation: "ERASE" }, OWNER);
  expect(result.request.status).toBe("completed");
}

async function stage() {
  const run = await startImport.call({ origin: "https://source.example", kind: "wordpress-wxr" }, OWNER);
  await previewFromSource.call({ id: run.id, payload: SOURCE }, OWNER);
  return run;
}

async function savedRun(id: string) { return (await db().select().from(importRuns).where(eq(importRuns.id, id)))[0]!; }
async function applyReaderUpgrade() {
  const migration = readFileSync("db/migrations/0069_import_reader_privacy.sql", "utf8");
  await db().transaction(async tx => {
    for (const statement of migration.split("--> statement-breakpoint")) await tx.execute(sql.raw(statement));
  });
}

async function replacement() {
  const reader = await resolveContact.call({ name: "Cached reader", email: EMAIL, source: "privacy-fixture" }, OWNER);
  const page = await createPage.call({ slug: "erasure-source", title: "Existing article", blocks: [{ id: "heading", type: "heading", props: { text: "Existing article", level: 1 } }] }, OWNER);
  await setPostMeta.call({ pageId: page.id, isPost: true }, OWNER); await publishPage.call({ id: page.id, published: true }, OWNER);
  const run = await stage();
  await reviewImportConflicts.call({ id: run.id, conflicts: [{ slug: "erasure-source", resolution: "replace" }] }, OWNER);
  await commitImport.call({ id: run.id }, OWNER);
  return { run, reader: reader.contact };
}

describe.runIf(hasDatabase)("import source erasure boundaries", () => {
  beforeEach(async () => { erasureBarrier = undefined; resetStorageForTests(); await truncateSpine(); await ensureDefaults.call({}, OWNER); });
  afterAll(closeDb);

  it("does not retain reader personal data in a completed import after acknowledged erasure", async () => {
    const run = await stage();
    await commitImport.call({ id: run.id }, OWNER); await reconcileImport.call({ id: run.id }, OWNER); await publishImport.call({ id: run.id }, OWNER);
    const [reader] = await db().select().from(contacts).where(eq(contacts.email, EMAIL));
    expect(reader).toBeDefined();
    await erase(reader!.id);
    expect(await db().select().from(blogReaderComments).where(eq(blogReaderComments.contactId, reader!.id))).toHaveLength(0);
    const [saved] = await db().select().from(importRuns).where(eq(importRuns.id, run.id));
    expect(JSON.stringify(saved)).not.toContain(EMAIL);
    expect(JSON.stringify(saved)).not.toContain(COMMENT);
  });

  it("cannot recreate erased contact/comment data from an already-staged replacement", async () => {
    const { run, reader } = await replacement();
    await erase(reader.id);
    await reconcileImport.call({ id: run.id }, OWNER); await publishImport.call({ id: run.id }, OWNER);
    expect(await db().select().from(contacts).where(eq(contacts.email, EMAIL))).toHaveLength(0);
    expect(await db().select().from(blogReaderComments).where(eq(blogReaderComments.body, COMMENT))).toHaveLength(0);
  });

  it("follows a staged reader's contact identity when their email changes before erasure", async () => {
    const { run, reader } = await replacement();
    await updateContact.call({ id: reader.id, email: "updated-reader@example.test" }, OWNER);
    await erase(reader.id);
    await reconcileImport.call({ id: run.id }, OWNER); await publishImport.call({ id: run.id }, OWNER);
    expect(JSON.stringify(await savedRun(run.id))).not.toContain(COMMENT);
    expect(await db().select().from(contacts).where(eq(contacts.email, EMAIL))).toHaveLength(0);
    expect(await db().select().from(blogReaderComments).where(eq(blogReaderComments.body, COMMENT))).toHaveLength(0);
  });

  it("publishes an existing reader against the same contact after an address change", async () => {
    const { run, reader } = await replacement();
    await updateContact.call({ id: reader.id, email: "updated-reader@example.test" }, OWNER);
    await reconcileImport.call({ id: run.id }, OWNER); await publishImport.call({ id: run.id }, OWNER);
    const [comment] = await db().select().from(blogReaderComments).where(eq(blogReaderComments.body, COMMENT));
    expect(comment?.contactId).toBe(reader.id);
    expect(await db().select().from(contacts).where(eq(contacts.email, EMAIL))).toHaveLength(0);
  });

  it("erases the existing reader's preview after an address change before any commit", async () => {
    const reader = await resolveContact.call({ email: EMAIL }, OWNER);
    const run = await stage();
    await updateContact.call({ id: reader.contact.id, email: "updated-reader@example.test" }, OWNER);
    await erase(reader.contact.id);
    expect(JSON.stringify(await savedRun(run.id))).not.toContain(COMMENT);
    await commitImport.call({ id: run.id }, OWNER);
    expect(await db().select().from(contacts).where(eq(contacts.email, EMAIL))).toHaveLength(0);
  });

  it("exports and erases only this reader's preview, retaining article text and the unrelated reader", async () => {
    const reader = await resolveContact.call({ email: EMAIL }, OWNER);
    const other = `<wp:comment><wp:comment_id>21</wp:comment_id><wp:comment_author>Other reader</wp:comment_author><wp:comment_author_email>other-reader@example.test</wp:comment_author_email><wp:comment_content>Unrelated comment remains.</wp:comment_content><wp:comment_approved>1</wp:comment_approved></wp:comment>`;
    const run = await startImport.call({ origin: "https://source.example", kind: "wordpress-wxr" }, OWNER);
    await previewFromSource.call({ id: run.id, payload: SOURCE.replace("</item>", `${other}</item>`) }, OWNER);
    const adapter = contactPrivacySources().find(source => source.scope === "imports.readerSources")!;
    const exported = await db().transaction(tx => adapter.exportData(tx, reader.contact.id));
    expect(JSON.stringify(exported)).toContain(COMMENT);
    expect(JSON.stringify(exported)).not.toContain("other-reader@example.test");
    await erase(reader.contact.id);
    const saved = JSON.stringify(await savedRun(run.id));
    expect(saved).not.toContain(EMAIL); expect(saved).not.toContain(COMMENT);
    expect(saved).toContain("Ordinary source article."); expect(saved).toContain("other-reader@example.test");
    await commitImport.call({ id: run.id }, OWNER); await reconcileImport.call({ id: run.id }, OWNER); await publishImport.call({ id: run.id }, OWNER);
    const comments = await db().select().from(blogReaderComments);
    expect(comments.map(comment => comment.body)).toEqual(["Unrelated comment remains."]);
  });

  it("covers an active merged reader's source address without requiring that address to remain primary", async () => {
    const duplicate = await resolveContact.call({ email: EMAIL }, OWNER);
    const survivor = await resolveContact.call({ email: "surviving-reader@example.test" }, OWNER);
    const run = await stage();
    await mergeContacts.call({ survivingId: survivor.contact.id, duplicateId: duplicate.contact.id }, OWNER);
    await erase(survivor.contact.id);
    expect(JSON.stringify(await savedRun(run.id))).not.toContain(COMMENT);
    await commitImport.call({ id: run.id }, OWNER);
    expect(await db().select().from(contacts).where(eq(contacts.email, EMAIL))).toHaveLength(0);
  });

  it("does not erase the separate reader after the owner undoes a contact merge", async () => {
    const duplicate = await resolveContact.call({ email: EMAIL }, OWNER);
    const survivor = await resolveContact.call({ email: "separate-reader@example.test" }, OWNER);
    const run = await stage();
    const merged = await mergeContacts.call({ survivingId: survivor.contact.id, duplicateId: duplicate.contact.id }, OWNER);
    await undoContactMerge.call({ operationId: merged.mergeOperationId }, OWNER);
    await erase(survivor.contact.id);
    expect(JSON.stringify(await savedRun(run.id))).toContain(COMMENT);
    await erase(duplicate.contact.id);
    expect(JSON.stringify(await savedRun(run.id))).not.toContain(COMMENT);
  });

  it("refuses an unsafe legacy pending publication after an already-completed erasure and preserves rollback", async () => {
    const { run, reader } = await replacement();
    const original = await savedRun(run.id);
    const checkpoint = structuredClone(original.checkpoint) as Record<string, unknown>;
    delete checkpoint.readerPrivacyVersion;
    await erase(reader.id);
    // Simulate a durable checkpoint written by an older installation, before
    // erasure knew about import caches; the erased address is no longer in CRM.
    await db().update(importRuns).set({ checkpoint }).where(eq(importRuns.id, run.id));
    await reconcileImport.call({ id: run.id }, OWNER);
    await expect(publishImport.call({ id: run.id }, OWNER)).rejects.toThrow(/older import.*Roll it back/);
    expect(JSON.stringify((await savedRun(run.id)).checkpoint)).toContain(COMMENT);
    const rolled = await rollbackImport.call({ id: run.id }, OWNER);
    expect(rolled.status).toBe("rolled_back");
    expect(JSON.stringify(rolled)).not.toContain(COMMENT);
    expect(await db().select().from(contacts).where(eq(contacts.email, EMAIL))).toHaveLength(0);
  });

  it("honors the reader-comment legal hold for cached source copies and reports partial completion", async () => {
    const { run, reader } = await replacement();
    const request = await createDataRequest.call({ contactId: reader.id, request: { kind: "erasure" } }, OWNER);
    await verifyDataRequest.call({ id: request.id, method: "Fixture verification" }, OWNER);
    await addRetentionException.call({ dataRequestId: request.id, scope: "cms.readerComments", reason: "legal_claim", legalBasis: "Fictional retained reader dispute" }, OWNER);
    const result = await fulfillDataRequest.call({ id: request.id, confirmation: "ERASE" }, OWNER);
    expect(result.request.status).toBe("partially_completed");
    expect(JSON.stringify(await savedRun(run.id))).toContain(COMMENT);
  });

  it.each(["before", "after"] as const)("serializes real publication against erasure when its import scrub runs %s publication", async point => {
    const { run, reader } = await replacement();
    await reconcileImport.call({ id: run.id }, OWNER);
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    erasureBarrier = { point, entered: enter, wait: new Promise<void>(resolve => { release = resolve; }) };
    const erasing = erase(reader.id);
    await entered;
    let publishing: ReturnType<typeof publishImport.call> | undefined;
    try {
      if (point === "before") {
        await publishImport.call({ id: run.id }, OWNER);
        expect(await db().select().from(blogReaderComments).where(eq(blogReaderComments.body, COMMENT))).toHaveLength(1);
      } else {
        publishing = publishImport.call({ id: run.id }, OWNER);
        const deadline = Date.now() + 5000;
        let blocked = false;
        while (Date.now() < deadline) {
          const rows = await db().execute(sql`select pid from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query like '%import_runs%'`);
          if (rows.length) { blocked = true; break; }
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        expect(blocked).toBe(true);
      }
    } finally { release(); }
    await erasing;
    if (publishing) await publishing;
    expect((await savedRun(run.id)).status).toBe("published");
    expect(JSON.stringify(await savedRun(run.id))).not.toContain(COMMENT);
    expect(await db().select().from(blogReaderComments).where(eq(blogReaderComments.body, COMMENT))).toHaveLength(0);
    expect(await db().select().from(contacts).where(eq(contacts.email, EMAIL))).toHaveLength(0);
  });

  it("refuses an older opaque source upload if erasure completed before its reader comments were parsed", async () => {
    const reader = await resolveContact.call({ email: EMAIL }, OWNER);
    const run = await startImport.call({ origin: "https://source.example", kind: "wordpress-wxr" }, OWNER);
    const bytes = new TextEncoder().encode(SOURCE);
    const upload = await beginSourceUpload.call({ id: run.id, filename: "reader-source.xml", bytes: bytes.byteLength }, OWNER);
    await uploadSourceChunk.call({ id: run.id, uploadId: upload.uploadId, index: 0, bytes }, OWNER);
    await erase(reader.contact.id);
    await expect(previewFromUpload.call({ id: run.id, uploadId: upload.uploadId }, OWNER)).rejects.toThrow(/erasure.*source|source.*erasure/i);
    expect(await storage().get(`imports/${run.id}/${upload.uploadId}/00000.part`)).toBeUndefined();
    expect(JSON.stringify(await savedRun(run.id))).not.toContain(COMMENT);
  });

  it("upgrades a legacy pending source after completed erasure without losing rollback ownership or silently publishing", async () => {
    const { run, reader } = await replacement();
    const original = await savedRun(run.id);
    const checkpoint = structuredClone(original.checkpoint) as Record<string, unknown>;
    delete checkpoint.readerPrivacyVersion;
    await erase(reader.id);
    await db().update(importRuns).set({ checkpoint }).where(eq(importRuns.id, run.id));
    await applyReaderUpgrade();
    const upgraded = await savedRun(run.id);
    expect(upgraded.checkpoint).toMatchObject({ readerPrivacyReviewRequired: true, pendingBlogPosts: [expect.objectContaining({ comments: [] })] });
    expect(JSON.stringify(upgraded)).not.toContain(COMMENT);
    expect(JSON.stringify(upgraded)).not.toContain(EMAIL);
    let previousImageRefused = false;
    try { await db().update(importRuns).set({ status: "published" }).where(eq(importRuns.id, run.id)); }
    catch (error) { previousImageRefused = violates(error, "import_reader_privacy_review"); }
    expect(previousImageRefused).toBe(true);
    const beforeReplay = JSON.stringify(upgraded);
    await applyReaderUpgrade();
    expect(JSON.stringify(await savedRun(run.id))).toBe(beforeReplay);
    // Exercise the actual shared services, not just a flag shown by the UI:
    // a queued commit and manual publication both refuse this source.
    await db().update(importRuns).set({ status: "previewed" }).where(eq(importRuns.id, run.id));
    await expect(commitImport.call({ id: run.id }, OWNER)).rejects.toThrow(/needs reader-erasure review/);
    await db().update(importRuns).set({ status: "reconciled" }).where(eq(importRuns.id, run.id));
    await expect(publishImport.call({ id: run.id }, OWNER)).rejects.toThrow(/needs reader-erasure review/);
    expect((await rollbackImport.call({ id: run.id }, OWNER)).status).toBe("rolled_back");
  });

  it("prunes redundant legacy terminal caches without changing imported page or recovery metadata", async () => {
    const run = await stage();
    const original = await savedRun(run.id);
    await db().update(importRuns).set({ status: "published", checkpoint: { pageIds: ["retained-page-pointer"], pendingBlogPosts: [{ comments: [{ body: COMMENT, email: EMAIL }] }], ownerReport: "Keep this report" } }).where(eq(importRuns.id, run.id));
    await applyReaderUpgrade();
    const upgraded = await savedRun(run.id);
    expect(upgraded.status).toBe("published");
    expect(upgraded.checkpoint).toMatchObject({ pageIds: ["retained-page-pointer"], pendingBlogPosts: [], ownerReport: "Keep this report" });
    expect(JSON.stringify(upgraded.preview)).toContain("Ordinary source article.");
    expect(JSON.stringify(upgraded)).not.toContain(COMMENT);
    expect(JSON.stringify(upgraded)).not.toContain(EMAIL);
    expect((upgraded.preview as { pages: unknown[] }).pages).toHaveLength((original.preview as { pages: unknown[] }).pages.length);
  });

  it("keeps a legacy preview with no overlapping completed erasure", async () => {
    const run = await stage();
    const original = await savedRun(run.id);
    const preview = structuredClone(original.preview) as Record<string, unknown>; delete preview.readerPrivacyVersion;
    await db().update(importRuns).set({ preview }).where(eq(importRuns.id, run.id));
    await applyReaderUpgrade();
    const upgraded = await savedRun(run.id);
    expect(JSON.stringify(upgraded)).toContain(COMMENT);
    expect(upgraded.error).toBeNull();
    expect(upgraded.checkpoint).not.toHaveProperty("readerPrivacyReviewRequired");
  });

  it("refuses a busy import during contact merge without deadlocking or partially merging identities", async () => {
    const duplicate = await resolveContact.call({ email: EMAIL }, OWNER);
    const survivor = await resolveContact.call({ email: "surviving-reader@example.test" }, OWNER);
    const run = await stage();
    let entered!: () => void, release!: () => void;
    const locked = new Promise<void>(resolve => { entered = resolve; });
    const wait = new Promise<void>(resolve => { release = resolve; });
    const writer = db().transaction(async tx => {
      await tx.select().from(importRuns).where(eq(importRuns.id, run.id)).for("update");
      entered(); await wait;
    });
    await locked;
    try {
      await expect(mergeContacts.call({ survivingId: survivor.contact.id, duplicateId: duplicate.contact.id }, OWNER)).rejects.toThrow(/import is changing its reader sources/);
      expect((await db().select().from(contacts)).map(contact => contact.id)).toEqual(expect.arrayContaining([survivor.contact.id, duplicate.contact.id]));
    } finally { release(); await writer; }
    await mergeContacts.call({ survivingId: survivor.contact.id, duplicateId: duplicate.contact.id }, OWNER);
    await erase(survivor.contact.id);
    expect(JSON.stringify(await savedRun(run.id))).not.toContain(COMMENT);
  });
});
