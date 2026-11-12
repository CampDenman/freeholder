// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.47: actual REST source ranges survive independent indexing and reversal.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/core/db";
import { resetStorageForTests } from "@/adapters/storage";
import { importSourceEntries } from "@/core/plugins/schema";
import { beginSourceUpload, previewFromUpload, uploadSourceChunk } from "@/core/import/source-upload";
import { commitImport, publishImport, reconcileImport, rollbackImport, startImport } from "@/core/import/service";
import { ensureDefaults } from "@/modules/cms/service";
import { pages } from "@/modules/cms/schema";
import { blogAuthors, blogPosts, blogTerms } from "@/modules/cms/blog-schema";
import { runImportResumptionProcess } from "../helpers/import-resumption-process";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const ORIGIN = "https://fictional-rest-resumption.example";
describe.runIf(hasDatabase)("actual durable REST source (C3.47)", { timeout: 180_000 }, () => {
  beforeEach(async () => { await truncateSpine(); resetStorageForTests(); await ensureDefaults.call({}, OWNER); });
  afterAll(closeDb);
  it("indexes 500+1 original records in separate processes, then publishes and reverses shared post metadata", async () => {
    const records = Array.from({ length: 501 }, (_, index) => ({ id: index + 1, type: "post", status: "publish", link: `${ORIGIN}/rest/page-${index}`, title: { rendered: `Fictional REST post ${index}` }, content: { rendered: `<p>Original REST body ${index} العربية.</p>${index === 0 ? `<p><a href="${ORIGIN}/rest/page-500">Last source post</a></p>` : ""}` }, _embedded: { author: [{ slug: "fictional-rest-writer", name: "Fictional REST writer" }], "wp:term": [[{ taxonomy: "category", slug: "fictional-rest-notes", name: "Fictional REST notes" }]] } }));
    const bytes = new TextEncoder().encode(JSON.stringify(records));
    const run = await startImport.call({ origin: ORIGIN, kind: "wordpress-rest" }, OWNER);
    const upload = await beginSourceUpload.call({ id: run.id, filename: "fictional-original-rest.json", bytes: bytes.byteLength }, OWNER);
    for (let index = 0; index < upload.chunkCount; index++) await uploadSourceChunk.call({ id: run.id, uploadId: upload.uploadId, index, bytes: bytes.slice(index * upload.chunkBytes, (index + 1) * upload.chunkBytes) }, OWNER);
    const staged = await previewFromUpload.call({ id: run.id, uploadId: upload.uploadId }, OWNER);
    expect(staged.status).toBe("discover");
    await closeDb(); resetStorageForTests();
    const first = await runImportResumptionProcess(run.id, upload.uploadId);
    expect(first.result).toMatchObject({ status: "discover", counts: { indexed: 500 } });
    const second = await runImportResumptionProcess(run.id, upload.uploadId);
    expect(first.pid).not.toBe(second.pid);
    expect(second.result).toMatchObject({ status: "previewed", counts: { indexed: 501, posts: 501 } });
    expect(await db().select().from(importSourceEntries)).toHaveLength(501);
    let committed = await commitImport.call({ id: run.id, graph: staged.graph }, OWNER);
    for (let phase = 0; phase < 5 && committed.status === "previewed"; phase++) committed = await commitImport.call({ id: run.id, graph: staged.graph }, OWNER);
    expect(committed.status).toBe("committed");
    expect(await db().select().from(blogPosts)).toHaveLength(501);
    expect(await db().select().from(blogAuthors)).toHaveLength(1);
    expect(await db().select().from(blogTerms)).toHaveLength(1);
    let reconciled = await reconcileImport.call({ id: run.id, graph: staged.graph }, OWNER);
    for (let phase = 0; phase < 5 && reconciled.status === "committed"; phase++) reconciled = await reconcileImport.call({ id: run.id, graph: staged.graph }, OWNER);
    expect(reconciled.status).toBe("reconciled");
    let published = await publishImport.call({ id: run.id, graph: staged.graph }, OWNER);
    for (let phase = 0; phase < 5 && published.status === "reconciled"; phase++) published = await publishImport.call({ id: run.id, graph: staged.graph }, OWNER);
    expect(published.status).toBe("published");
    expect((await db().select().from(pages).where(sql`${pages.slug} like 'rest/page-%'`)).filter(page => page.status === "published")).toHaveLength(501);
    let reversed = await rollbackImport.call({ id: run.id, graph: staged.graph }, OWNER);
    for (let phase = 0; phase < 5 && reversed.status !== "rolled_back"; phase++) reversed = await rollbackImport.call({ id: run.id, graph: staged.graph }, OWNER);
    expect(reversed.status).toBe("rolled_back");
    expect(await db().select().from(pages).where(sql`${pages.slug} like 'rest/page-%'`)).toHaveLength(0);
    expect(await db().select().from(blogPosts)).toHaveLength(0);
    expect(await db().select().from(blogAuthors)).toHaveLength(0);
    expect(await db().select().from(blogTerms)).toHaveLength(0);
  });
});
