// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.47: real static ZIP files resume without invented WordPress identities.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import sharp from "sharp";
import { db } from "@/core/db";
import { stopJobs } from "@/core/jobs";
import { resetStorageForTests, storage } from "@/adapters/storage";
import { importRuns, importSourceEntries } from "@/core/plugins/schema";
import { assets } from "@/core/media/schema";
import { beginSourceUpload, previewFromUpload, uploadSourceChunk } from "@/core/import/source-upload";
import { commitImport, publishImport, reconcileImport, reviewImportConflicts, rollbackImport, startImport } from "@/core/import/service";
import { importGraphVersionSchema } from "@/core/import/graph-version";
import { ensureDefaults } from "@/modules/cms/service";
import { pages } from "@/modules/cms/schema";
import { blogAuthors, blogPosts, blogTerms } from "@/modules/cms/blog-schema";
import { runImportResumptionProcess } from "../helpers/import-resumption-process";
import { originalStaticZip } from "../helpers/original-static-zip";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const ORIGIN = "https://fictional-static-resumption.example/legacy/";
async function uploadOriginal() {
  const image = await sharp({ create: { width: 16, height: 16, channels: 3, background: { r: 20, g: 80, b: 120 } } }).png().toBuffer();
  const files: Array<{ path: string; body: string | Uint8Array }> = Array.from({ length: 501 }, (_, index) => ({
    path: index ? `site/zip/page-${index}.html` : "site/index.html",
    body: `<html><head><title>Fictional original ${index}</title></head><body><h1>Original static article ${index}</h1>${index === 0 ? '<p><a href="zip/page-500.html">Last original article</a></p><img class="wp-image-99" src="image.png" alt="Actual source image">' : index === 500 ? '<img src="../image.png" alt="Same actual source image">' : ""}</body></html>`,
  }));
  files.push({ path: "site/image.png", body: image });
  const bytes = originalStaticZip(files), run = await startImport.call({ origin: ORIGIN, kind: "archive" }, OWNER);
  const upload = await beginSourceUpload.call({ id: run.id, filename: "fictional-original-site.zip", bytes: bytes.byteLength }, OWNER);
  for (let index = 0; index < upload.chunkCount; index++) await uploadSourceChunk.call({ id: run.id, uploadId: upload.uploadId, index, bytes: bytes.slice(index * upload.chunkBytes, (index + 1) * upload.chunkBytes) }, OWNER);
  return { run, upload, firstKey: `imports/${run.id}/${upload.uploadId}/00000.part` };
}

describe.runIf(hasDatabase)("actual durable static ZIP source (C3.47)", { timeout: 180_000 }, () => {
  beforeEach(async () => { await truncateSpine(); resetStorageForTests(); await ensureDefaults.call({}, OWNER); });
  afterAll(async () => { await stopJobs(); await closeDb(); });

  it("starts bounded ZIP continuation while preserving the immutable original", async () => {
    const { run, upload, firstKey } = await uploadOriginal();
    const staged = await previewFromUpload.call({ id: run.id, uploadId: upload.uploadId }, OWNER);
    expect(staged).toMatchObject({ status: "discover", error: null });
    expect(staged.error).toBeNull();
    expect(staged.graph).toBeDefined();
    expect(await storage().get(firstKey)).toBeDefined();
  });

  it("indexes actual ZIP files in separate processes, then publishes and reverses all 501 pages and shared media", async () => {
    const { run, upload, firstKey } = await uploadOriginal();
    const staged = await previewFromUpload.call({ id: run.id, uploadId: upload.uploadId }, OWNER);
    expect(staged).toMatchObject({ status: "discover", error: null });
    await closeDb(); resetStorageForTests();
    const first = await runImportResumptionProcess(run.id, upload.uploadId);
    expect(first.result).toMatchObject({ status: "discover", counts: { indexed: 500 } });
    const second = await runImportResumptionProcess(run.id, upload.uploadId);
    expect(first.pid).not.toBe(second.pid);
    expect(second.result).toMatchObject({ status: "previewed", counts: { indexed: 502, pages: 501, media: 1 } });
    expect(await storage().get(firstKey)).toBeDefined();
    const entries = await db().select().from(importSourceEntries);
    expect(entries).toHaveLength(502);
    expect(entries.every(entry => (entry.metadata as { format: string }).format === "archive-zip" && !Object.hasOwn(entry.metadata as object, "wpId") && !Object.hasOwn(entry.metadata as object, "body"))).toBe(true);
    const reviewed = await reviewImportConflicts.call({ id: run.id, graph: staged.graph, conflicts: [{ slug: "", resolution: "rename", renamedSlug: "zip/home" }] }, OWNER);
    const graph = importGraphVersionSchema.parse(reviewed.preview);
    let committed = await commitImport.call({ id: run.id, graph }, OWNER);
    for (let phase = 0; phase < 6 && committed.status === "previewed"; phase++) committed = await commitImport.call({ id: run.id, graph }, OWNER);
    expect(committed.status).toBe("committed");
    expect(await db().select().from(assets)).toHaveLength(1);
    expect(await db().select().from(blogPosts)).toHaveLength(0);
    expect(await db().select().from(blogAuthors)).toHaveLength(0);
    expect(await db().select().from(blogTerms)).toHaveLength(0);
    const [home] = await db().select().from(pages).where(eq(pages.slug, "zip/home"));
    expect(JSON.stringify(home!.blocks)).toContain('"href":"/zip/page-500"');
    expect(JSON.stringify(home!.blocks)).toContain('"assetId"');
    let reconciled = await reconcileImport.call({ id: run.id, graph }, OWNER);
    for (let phase = 0; phase < 6 && reconciled.status === "committed"; phase++) reconciled = await reconcileImport.call({ id: run.id, graph }, OWNER);
    expect(reconciled.status).toBe("reconciled");
    let published = await publishImport.call({ id: run.id, graph }, OWNER);
    for (let phase = 0; phase < 6 && published.status === "reconciled"; phase++) published = await publishImport.call({ id: run.id, graph }, OWNER);
    expect(published.status).toBe("published");
    expect((await db().select().from(pages).where(sql`${pages.slug} like 'zip/%'`)).filter(page => page.status === "published")).toHaveLength(501);
    let reversed = await rollbackImport.call({ id: run.id, graph }, OWNER);
    for (let phase = 0; phase < 6 && reversed.status !== "rolled_back"; phase++) reversed = await rollbackImport.call({ id: run.id, graph }, OWNER);
    expect(reversed.status).toBe("rolled_back");
    expect(await db().select().from(pages).where(sql`${pages.slug} like 'zip/%'`)).toHaveLength(0);
    expect(await db().select().from(assets)).toHaveLength(0);
    expect((await db().select().from(importRuns).where(eq(importRuns.id, run.id)))[0]?.createdBy).toBe(`user:${OWNER.userId}`);
  });
});
