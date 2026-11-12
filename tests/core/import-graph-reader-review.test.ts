// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C2.29/C3.47: an owner reviews the exact reader cached by a private graph child.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/core/db";
import { stopJobs } from "@/core/jobs";
import { resetStorageForTests } from "@/adapters/storage";
import { users, totpFactors } from "@/core/auth/schema";
import { createSession } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { resolveContact } from "@/core/contacts/service";
import { importRuns, importSourceBatches, importSourceGraphs } from "@/core/plugins/schema";
import { startImport, commitImport } from "@/core/import/service";
import { beginSourceUpload, previewFromUpload, uploadSourceChunk } from "@/core/import/source-upload";
import { readerOwnershipReview, resolveReaderOwnership } from "@/core/import/reader-ownership-review";
import { readerOwnershipReceipts } from "@/core/import/reader-ownership-schema";
import { ensureDefaults } from "@/modules/cms/service";
import { blogReaderComments } from "@/modules/cms/blog-comments-schema";
import { OWNER, closeDb, hasDatabase, truncateSpine } from "../helpers/spine";

const ORIGIN = "https://fictional-graph-owner-review.example";
const source = () => new TextEncoder().encode(`<rss xmlns:wp="urn:wordpress" xmlns:content="urn:content"><channel><title>Original reader graph</title><link>${ORIGIN}</link>${Array.from({ length: 501 }, (_, index) => `<item><title>Original article ${index}</title><link>${ORIGIN}/review/page-${index}</link><wp:post_id>${index + 1}</wp:post_id><wp:post_type>${index === 0 ? "post" : "page"}</wp:post_type><wp:status>publish</wp:status><content:encoded><![CDATA[<p>Original article body ${index}.</p>]]></content:encoded>${index === 0 ? '<wp:comment><wp:comment_id>9001</wp:comment_id><wp:comment_author>Original graph reader</wp:comment_author><wp:comment_author_email>fictional-graph-owner-reader@example.test</wp:comment_author_email><wp:comment_content>Original private graph comment.</wp:comment_content><wp:comment_approved>1</wp:comment_approved></wp:comment>' : ""}</item>`).join("")}</channel></rss>`);
async function verifiedOwner() {
  await db().insert(users).values({ id: OWNER.userId, email: "fictional-graph-review-owner@example.test", role: "owner" });
  await db().insert(totpFactors).values({ userId: OWNER.userId, encryptedSecret: "fictional-graph-review-factor" });
  const session = await db().transaction(tx => createSession(tx, OWNER.userId, { twoFactorVerified: true }));
  const actor = await actorFromToken(session.token);
  if (actor.kind !== "user" || !actor.sessionId) throw new Error("The actual owner fixture session was not resolved.");
  return actor;
}

describe.runIf(hasDatabase)("private graph original-reader review (C2.29/C3.47)", { timeout: 60_000 }, () => {
  beforeEach(async () => { await truncateSpine(); resetStorageForTests(); await ensureDefaults.call({}, OWNER); });
  afterAll(async () => { await stopJobs(); await closeDb(); });
  it("projects a fresh explicit original-reader choice into the guarded private source child", async () => {
    const owner = await verifiedOwner(), person = (await resolveContact.call({ name: "Chosen original person", email: "chosen-graph-person@example.test" }, OWNER)).contact;
    const run = await startImport.call({ origin: ORIGIN, kind: "wordpress-wxr" }, OWNER), bytes = source();
    const upload = await beginSourceUpload.call({ id: run.id, filename: "fictional-original-reader-graph.xml", bytes: bytes.byteLength }, OWNER);
    expect(upload.chunkCount).toBe(1);
    await uploadSourceChunk.call({ id: run.id, uploadId: upload.uploadId, index: 0, bytes }, OWNER);
    let staged = await previewFromUpload.call({ id: run.id, uploadId: upload.uploadId }, OWNER);
    for (let phase = 0; phase < 3 && staged.status === "discover"; phase++) staged = await previewFromUpload.call({ id: run.id, uploadId: upload.uploadId }, OWNER);
    expect(staged.status).toBe("previewed");
    await expect(commitImport.call({ id: run.id, graph: staged.graph }, OWNER)).rejects.toThrow(/review.*original reader|review this original reader/i);
    const review = await readerOwnershipReview.call({ id: run.id }, owner);
    expect(review.rows).toHaveLength(1);
    const reader = review.rows[0]!;
    expect(reader).toMatchObject({ postId: "1", commentId: "9001", email: "fictional-graph-owner-reader@example.test" });
    const [original] = await db().select().from(readerOwnershipReceipts);
    expect(original).toMatchObject({ firstRunId: run.id, contactId: null, state: "review" });
    expect(await db().select().from(blogReaderComments)).toHaveLength(0);
    const [graph] = await db().select().from(importSourceGraphs).where(eq(importSourceGraphs.runId, run.id));
    const children = await db().select({ child: importRuns }).from(importSourceBatches).innerJoin(importRuns, eq(importSourceBatches.childRunId, importRuns.id)).where(eq(importSourceBatches.graphId, graph!.id));
    expect(children).toHaveLength(1);
    const child = children[0]!.child;
    await expect(readerOwnershipReview.call({ id: child.id }, owner)).rejects.toMatchObject({ code: "not_found" });
    expect(await resolveReaderOwnership.call({ id: run.id, receiptId: reader.receiptId, postId: reader.postId, commentId: reader.commentId, contactId: person.id, confirmation: "ASSIGN ORIGINAL READER" }, owner)).toMatchObject({ state: "bound" });
    const [receipt] = await db().select().from(readerOwnershipReceipts);
    expect(receipt).toMatchObject({ id: original!.id, firstRunId: run.id, createdBy: original!.createdBy, contactId: person.id, state: "bound" });
    const [projected] = await db().select().from(importRuns).where(eq(importRuns.id, child.id));
    const preview = z.object({ pages: z.array(z.object({ wpId: z.string(), readerComments: z.array(z.object({ id: z.string(), contactId: z.uuid().optional(), body: z.string() })).optional() })) }).parse(projected!.preview);
    expect(preview.pages.find(page => page.wpId === "1")?.readerComments).toMatchObject([{ id: "9001", contactId: person.id, body: "Original private graph comment." }]);
    expect(projected!.checkpoint).toEqual(child.checkpoint);
    expect(await db().select().from(blogReaderComments)).toHaveLength(0);
  });
});
