// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.22: original private ZIP → preview → typed drafts → public → rollback.
import { readFileSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { resetStorageForTests, storage } from "@/adapters/storage";
import { assets } from "@/core/media/schema";
import { importRuns } from "@/core/plugins/schema";
import { redirects } from "@/core/seo/schema";
import { updateBusiness } from "@/core/settings/service";
import { ensureDefaults } from "@/modules/cms/service";
import { pages } from "@/modules/cms/schema";
import { commitImport, publishImport, reconcileImport, reviewImportConflicts, rollbackImport, startImport } from "@/core/import/service";
import { beginSourceUpload, previewFromUpload, uploadSourceChunk } from "@/core/import/source-upload";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const ZIP = new Uint8Array(readFileSync("tests/fixtures/static-archive/site.zip"));
async function stage(origin = "https://archive.example/") {
  const run = await startImport.call({ origin, kind: "archive" }, OWNER);
  const upload = await beginSourceUpload.call({ id: run.id, filename: "fictional-static-site.zip", bytes: ZIP.byteLength }, OWNER);
  for (let index = 0; index < upload.chunkCount; index++) await uploadSourceChunk.call({ id: run.id, uploadId: upload.uploadId, index, bytes: ZIP.subarray(index * upload.chunkBytes, (index + 1) * upload.chunkBytes) }, OWNER);
  expect(await previewFromUpload.call({ id: run.id, uploadId: upload.uploadId }, OWNER)).toMatchObject({ status: "previewed", counts: { pages: 2, media: 1 } });
  await reviewImportConflicts.call({ id: run.id, conflicts: [{ slug: "", resolution: "replace" }] }, OWNER);
  return { id: run.id, uploadId: upload.uploadId, key: `imports/${run.id}/${upload.uploadId}/00000.part` };
}

describe.runIf(hasDatabase)("static archive import studio (C3.22)", { timeout: 60_000 }, () => {
  beforeEach(async () => { await truncateSpine(); resetStorageForTests(); await ensureDefaults.call({}, OWNER); });
  afterAll(closeDb);

  it("imports original private ZIP bytes as typed media/content and locale-correct redirects, then recovers", async () => {
    await updateBusiness.call({ name: "Fictional archive", country: "CA", baseCurrency: "CAD", timezone: "America/Vancouver", defaultLocale: "fr", enabledLocales: ["en", "es", "fr", "ar"] }, OWNER);
    const source = await stage("https://archive.example/legacy/");
    expect(await storage().get(source.key)).toEqual(ZIP);
    const committed = await commitImport.call({ id: source.id }, OWNER);
    expect(committed).toMatchObject({ status: "committed", counts: { pages: 2, media: 1, redirects: 2 } });
    const [team] = await db().select().from(pages).where(eq(pages.slug, "about/team"));
    expect(team?.status).toBe("draft");
    expect(JSON.stringify(team?.blocks)).toContain('"type":"image"');
    expect(JSON.stringify(team?.blocks)).toContain("Synthetic blue square");
    expect(team?.seo).toMatchObject({ noindex: true });
    const imported = await db().select().from(assets);
    expect(imported.map(asset => [asset.source, asset.status])).toEqual([["import", "ready"]]);
    expect((await db().select().from(redirects)).map(row => [row.fromPath, row.toPath, row.locale]).sort()).toEqual([["legacy/about/team.html", "about/team", "fr"], ["legacy/index.html", "", "fr"]].sort());
    const replay = await commitImport.call({ id: source.id }, OWNER);
    expect(replay.checkpoint).toEqual(committed.checkpoint);
    expect(await db().select().from(assets)).toHaveLength(1);
    expect(await reconcileImport.call({ id: source.id }, OWNER)).toMatchObject({ status: "reconciled" });
    expect(await publishImport.call({ id: source.id }, OWNER)).toMatchObject({ status: "published" });
    expect((await db().select().from(pages).where(eq(pages.id, team!.id)))[0]?.status).toBe("published");
    expect(await rollbackImport.call({ id: source.id }, OWNER)).toMatchObject({ status: "rolled_back" });
    expect(await db().select().from(pages).where(eq(pages.id, team!.id))).toHaveLength(0);
    expect(await db().select().from(redirects)).toHaveLength(0);
    expect((await db().select().from(assets))[0]?.status).toBe("trashed");
  });

  it("refuses changed original ZIP chunks without writing CMS drafts or imported assets", async () => {
    const source = await stage();
    const changed = new Uint8Array(ZIP); changed[changed.length - 1] = (changed.at(-1) ?? 0) ^ 1;
    await storage().put(source.key, changed, "application/octet-stream");
    expect((await failure(commitImport.call({ id: source.id }, OWNER))).code).toBe("conflict");
    expect(await db().select().from(assets)).toHaveLength(0);
    expect(await db().select().from(pages).where(eq(pages.slug, "about/team"))).toHaveLength(0);
  });

  it("refuses a preview whose private content witness was changed", async () => {
    const source = await stage();
    const [run] = await db().select().from(importRuns).where(eq(importRuns.id, source.id));
    const preview = structuredClone(run!.preview) as { pages: Array<{ title: string }> };
    preview.pages[0]!.title = "Changed after source acceptance";
    await db().update(importRuns).set({ preview }).where(eq(importRuns.id, source.id));
    expect((await failure(commitImport.call({ id: source.id }, OWNER))).code).toBe("conflict");
    expect(await db().select().from(assets)).toHaveLength(0);
  });
});
