// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.22: original private ZIP → preview → typed drafts → public → rollback.
import { readFileSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { resetStorageForTests, storage } from "@/adapters/storage";
import { assets } from "@/core/media/schema";
import { importRuns } from "@/core/plugins/schema";
import { redirects } from "@/core/seo/schema";
import { updateBusiness } from "@/core/settings/service";
import { ensureDefaults } from "@/modules/cms/service";
import { uploadAsset } from "@/core/media/service";
import { resolveContact } from "@/core/contacts/service";
import { createDataRequest, verifyDataRequest, fulfillDataRequest } from "@/core/privacy/service";
import { dataRequests } from "@/core/privacy/schema";
import { getJob } from "@/core/jobs";
import { eraseImportSourceObjects } from "@/core/import/source-erasure";
import { deleteCaptureObjects } from "@/core/media/capture";
import { retainedImportSourceSchema } from "@/core/import/retained-source";
import { z } from "zod";
import { pages } from "@/modules/cms/schema";
import { commitImport, publishImport, reconcileImport, reviewImportConflicts, rollbackImport, startImport } from "@/core/import/service";
import { beginSourceUpload, previewFromUpload, uploadSourceChunk } from "@/core/import/source-upload";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const ZIP = new Uint8Array(readFileSync("tests/fixtures/static-archive/site.zip"));
async function stageBytes(bytes: Uint8Array, expected: { pages: number; media: number }, origin = "https://archive.example/") {
  const run = await startImport.call({ origin, kind: "archive" }, OWNER);
  const upload = await beginSourceUpload.call({ id: run.id, filename: "fictional-static-site.zip", bytes: bytes.byteLength }, OWNER);
  for (let index = 0; index < upload.chunkCount; index++) await uploadSourceChunk.call({ id: run.id, uploadId: upload.uploadId, index, bytes: bytes.subarray(index * upload.chunkBytes, (index + 1) * upload.chunkBytes) }, OWNER);
  expect(await previewFromUpload.call({ id: run.id, uploadId: upload.uploadId }, OWNER)).toMatchObject({ status: "previewed", counts: expected });
  await reviewImportConflicts.call({ id: run.id, conflicts: [{ slug: "", resolution: "replace" }] }, OWNER);
  return { id: run.id, uploadId: upload.uploadId, key: `imports/${run.id}/${upload.uploadId}/00000.part` };
}
const stage = (origin = "https://archive.example/") => stageBytes(ZIP, { pages: 2, media: 1 }, origin);

describe.runIf(hasDatabase)("static archive import studio (C3.22)", { timeout: 60_000 }, () => {
  beforeEach(async () => { vi.restoreAllMocks(); await truncateSpine(); resetStorageForTests(); await ensureDefaults.call({}, OWNER); });
  afterAll(closeDb);

  it("keeps erasure pending for reader metadata in an ignored original ZIP entry", async () => {
    const bytes = new Uint8Array(readFileSync("tests/fixtures/static-archive/ignored-reader.zip"));
    const email = "ignored-zip-reader@example.test";
    expect(new TextDecoder().decode(bytes)).toContain(email);
    const reader = await resolveContact.call({ email }, OWNER);
    const source = await stageBytes(bytes, { pages: 1, media: 0 });
    const [run] = await db().select().from(importRuns).where(eq(importRuns.id, source.id));
    expect(JSON.stringify(run!.preview)).not.toContain(email);
    const request = await createDataRequest.call({ contactId: reader.contact.id, request: { kind: "erasure" } }, OWNER);
    await verifyDataRequest.call({ id: request.id, method: "Synthetic ZIP-source verification" }, OWNER);
    const result = await fulfillDataRequest.call({ id: request.id, confirmation: "ERASE" }, OWNER);
    expect(result.request.status).toBe("in_progress");
    const receipt = result.artifact.body as { outcomes: Array<{ scope: string; pendingJobs?: string[] }> };
    const jobId = receipt.outcomes.find(item => item.scope === "imports.readerSources")!.pendingJobs![0]!;
    const job = await getJob("core.eraseImportSourceObjects", jobId);
    expect(job).toBeDefined();
    await expect(eraseImportSourceObjects(job!.data)).rejects.toThrow(/ownership|unresolved/);
    expect(await storage().get(source.key)).toEqual(bytes);
    await rollbackImport.call({ id: source.id }, OWNER);
    await eraseImportSourceObjects(job!.data);
    expect(await storage().get(source.key)).toBeUndefined();
    expect((await db().select().from(dataRequests).where(eq(dataRequests.id, request.id)))[0]?.status).toBe("completed");
  });

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

  it("rebinds an expired original ZIP without losing accepted media, and refuses a changed export", async () => {
    const bytes = new Uint8Array(readFileSync("tests/fixtures/static-archive/two-images.zip"));
    const source = await stageBytes(bytes, { pages: 1, media: 2 }), upload = uploadAsset.call.bind(uploadAsset);
    const lost = vi.spyOn(uploadAsset, "call").mockImplementationOnce(async (input, actor) => { await upload(input, actor); throw new Error("Synthetic archive reply loss"); });
    await expect(commitImport.call({ id: source.id }, OWNER)).rejects.toThrow("Synthetic archive reply loss"); lost.mockRestore();
    const accepted = await db().select().from(assets);
    expect(accepted).toHaveLength(1);
    const [run] = await db().select().from(importRuns).where(eq(importRuns.id, source.id));
    const checkpoint = run!.checkpoint as Record<string, unknown>;
    const binding = z.object({ source: retainedImportSourceSchema, previewDigest: z.string() }).parse(checkpoint.archiveSource);
    const expired = { ...binding.source, expiresAt: new Date(Date.now() - 1_000).toISOString() };
    checkpoint.retainedSource = expired; checkpoint.archiveSource = { ...binding, source: expired };
    await db().update(importRuns).set({ checkpoint }).where(eq(importRuns.id, source.id));
    await deleteCaptureObjects([source.key]);
    expect((await failure(commitImport.call({ id: source.id }, OWNER))).code).toBe("conflict");
    const changed = await beginSourceUpload.call({ id: source.id, filename: "changed.zip", bytes: ZIP.byteLength }, OWNER);
    await uploadSourceChunk.call({ id: source.id, uploadId: changed.uploadId, index: 0, bytes: ZIP }, OWNER);
    await expect(previewFromUpload.call({ id: source.id, uploadId: changed.uploadId }, OWNER)).rejects.toThrow("original ZIP");
    expect((await db().select().from(assets)).map(asset => asset.id)).toEqual(accepted.map(asset => asset.id));
    const same = await beginSourceUpload.call({ id: source.id, filename: "original-again.zip", bytes: bytes.byteLength }, OWNER);
    await uploadSourceChunk.call({ id: source.id, uploadId: same.uploadId, index: 0, bytes }, OWNER);
    expect(await previewFromUpload.call({ id: source.id, uploadId: same.uploadId }, OWNER)).toMatchObject({ status: "previewed" });
    expect(await commitImport.call({ id: source.id }, OWNER)).toMatchObject({ status: "committed", counts: { media: 2 } });
    expect(await db().select().from(assets)).toHaveLength(2);
    expect((await db().select().from(assets)).some(asset => asset.id === accepted[0]!.id)).toBe(true);
    const key = `imports/${source.id}/${same.uploadId}/00000.part`;
    expect(await deleteCaptureObjects([key])).toEqual({ deleted: 1 });
    expect(await storage().get(key)).toBeUndefined();
    expect(await commitImport.call({ id: source.id }, OWNER)).toMatchObject({ status: "committed", counts: { media: 2 } });
  });

  it("releases an unfinished uploaded ZIP on rollback and denies its stale preview", async () => {
    const run = await startImport.call({ origin: "https://archive.example", kind: "archive" }, OWNER);
    const upload = await beginSourceUpload.call({ id: run.id, filename: "cancelled.zip", bytes: ZIP.byteLength }, OWNER);
    await uploadSourceChunk.call({ id: run.id, uploadId: upload.uploadId, index: 0, bytes: ZIP }, OWNER);
    expect(await rollbackImport.call({ id: run.id }, OWNER)).toMatchObject({ status: "rolled_back" });
    const key = `imports/${run.id}/${upload.uploadId}/00000.part`;
    expect(await deleteCaptureObjects([key])).toEqual({ deleted: 1 });
    expect(await storage().get(key)).toBeUndefined();
    expect((await failure(previewFromUpload.call({ id: run.id, uploadId: upload.uploadId }, OWNER))).code).toBe("not_found");
  });
});
