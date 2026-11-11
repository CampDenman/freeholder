// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.47: shared media and final menu targets cross actual source batches.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { and, eq, sql } from "drizzle-orm";
import { db, closeDb } from "@/core/db";
import { resetStorageForTests } from "@/adapters/storage";
import { uploadAsset } from "@/core/media/service";
import { assets } from "@/core/media/schema";
import { outboxEvents } from "@/core/events/schema";
import { importRuns, importSourceBatches, importSourceGraphs, importSourceMedia } from "@/core/plugins/schema";
import { apiKeys } from "@/core/apikeys/schema";
import { mintApiKey } from "@/core/apikeys/tokens";
import { actorFromRequest } from "@/core/http/actor";
import { pages, sections } from "@/modules/cms/schema";
import { ensureDefaults } from "@/modules/cms/service";
import { commitImport, publishImport, reconcileImport, rollbackImport, startImport } from "@/core/import/service";
import { beginSourceUpload, previewFromUpload, uploadSourceChunk } from "@/core/import/source-upload";
import { failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const getPinnedBytes = vi.hoisted(() => vi.fn());
vi.mock("@/core/http/pinned-download", () => ({ getPinnedBytes, PinnedDownloadError: class extends Error { readonly code = "network"; } }));
const ORIGIN = "https://fictional-large-media.example", IMAGE = `${ORIGIN}/uploads/late.jpg`;
const meta = (key: string, value: string) => `<wp:postmeta><wp:meta_key>${key}</wp:meta_key><wp:meta_value>${value}</wp:meta_value></wp:postmeta>`;
const menu = (id: number, target: number, parent: number) => `<item><title>Fictional menu ${id}</title><wp:post_id>${id}</wp:post_id><wp:post_type>nav_menu_item</wp:post_type><wp:status>publish</wp:status><wp:menu_order>${id}</wp:menu_order><category domain="nav_menu" nicename="primary-menu">Primary menu</category>${meta("_menu_item_type", "post_type")}${meta("_menu_item_object", "page")}${meta("_menu_item_object_id", String(target))}${meta("_menu_item_menu_item_parent", String(parent))}</item>`;
function source() {
  return new TextEncoder().encode(`<rss xmlns:wp="urn:wordpress" xmlns:content="urn:content"><channel><title>Fictional media source</title><link>${ORIGIN}</link><wp:term><wp:term_id>6</wp:term_id><wp:term_taxonomy>nav_menu</wp:term_taxonomy><wp:term_slug>primary-menu</wp:term_slug><wp:term_name>Primary menu</wp:term_name></wp:term>${Array.from({ length: 501 }, (_, i) => `<item><title>Fictional source ${i}</title><link>${ORIGIN}/shared/page-${i}</link><wp:post_id>${i + 1}</wp:post_id><wp:post_name>page-${i}</wp:post_name><wp:post_type>page</wp:post_type><wp:status>publish</wp:status><content:encoded><![CDATA[<p>Fictional original page ${i}.</p>${i === 0 || i === 500 ? `<img class="wp-image-9001" src="${IMAGE}" alt="Fictional source image" />` : ""}]]></content:encoded></item>`).join("")}<item><title>Fictional shared image</title><link>${ORIGIN}/attachment/late</link><wp:post_id>9001</wp:post_id><wp:post_type>attachment</wp:post_type><wp:post_parent>501</wp:post_parent><wp:attachment_url>${IMAGE}</wp:attachment_url></item>${menu(9100, 1, 0)}${menu(9101, 501, 9100)}</channel></rss>`);
}
function manyAttachments(count: number) {
  const attachments = Array.from({ length: count }, (_, i) => `<item><title>Fictional bounded file ${i}</title><wp:post_id>${9001 + i}</wp:post_id><wp:post_type>attachment</wp:post_type><wp:attachment_url>${ORIGIN}/uploads/file-${i}.jpg</wp:attachment_url></item>`).join("");
  return new TextEncoder().encode(new TextDecoder().decode(source()).replace(/<item><title>Fictional shared image[\s\S]*?<\/item>/, attachments));
}

describe.runIf(hasDatabase)("durable cross-batch media and navigation (C3.47)", { timeout: 180_000 }, () => {
  beforeEach(async () => {
    vi.restoreAllMocks(); getPinnedBytes.mockReset();
    await truncateSpine(); resetStorageForTests(); await ensureDefaults.call({}, OWNER);
    const bytes = new Uint8Array(await sharp({ create: { width: 16, height: 16, channels: 3, background: { r: 30, g: 70, b: 120 } } }).jpeg().toBuffer());
    getPinnedBytes.mockResolvedValue({ status: 200, bytes });
  });
  afterAll(() => { vi.restoreAllMocks(); return closeDb(); });

  it("refuses a complete graph above 500 files before any download or CMS draft", async () => {
    const run = await startImport.call({ origin: ORIGIN, kind: "wordpress-wxr" }, OWNER), bytes = manyAttachments(501);
    const upload = await beginSourceUpload.call({ id: run.id, filename: "fictional-file-budget.xml", bytes: bytes.byteLength }, OWNER);
    await uploadSourceChunk.call({ id: run.id, uploadId: upload.uploadId, index: 0, bytes }, OWNER);
    let staged = await previewFromUpload.call({ id: run.id, uploadId: upload.uploadId }, OWNER);
    for (let phase = 0; phase < 5 && staged.status === "discover"; phase++) staged = await previewFromUpload.call({ id: run.id, uploadId: upload.uploadId }, OWNER);
    expect(staged).toMatchObject({ status: "previewed", counts: { pages: 501, media: 501 } });
    expect(await failure(commitImport.call({ id: run.id, graph: staged.graph }, OWNER))).toMatchObject({ code: "validation" });
    expect(getPinnedBytes).not.toHaveBeenCalled();
    expect(await db().select().from(importSourceMedia)).toEqual([]);
    expect((await db().select().from(importSourceGraphs))[0]!.planDigest).toBeNull();
    expect(await db().select().from(assets)).toEqual([]);
  });

  it("counts original unknown byte reservations against the total graph media budget before starting another upload", async () => {
    const run = await startImport.call({ origin: ORIGIN, kind: "wordpress-wxr" }, OWNER), bytes = manyAttachments(41);
    const upload = await beginSourceUpload.call({ id: run.id, filename: "fictional-media-byte-budget.xml", bytes: bytes.byteLength }, OWNER);
    await uploadSourceChunk.call({ id: run.id, uploadId: upload.uploadId, index: 0, bytes }, OWNER);
    let staged = await previewFromUpload.call({ id: run.id, uploadId: upload.uploadId }, OWNER);
    for (let phase = 0; phase < 5 && staged.status === "discover"; phase++) staged = await previewFromUpload.call({ id: run.id, uploadId: upload.uploadId }, OWNER);
    getPinnedBytes.mockImplementationOnce(async (url: string) => {
      const mappings = await db().select().from(importSourceMedia);
      expect(mappings).toHaveLength(41);
      // Forty original bound files model unresolved physical attempts. They
      // reserve 1,000 MiB and cannot disappear merely to admit another file.
      await db().update(importSourceMedia).set({ digest: "a".repeat(64), bytes: 25 * 1024 * 1024 }).where(sql`${importSourceMedia.planned}->>'sourceUrl' <> ${url}`);
      return { status: 200, bytes: new Uint8Array(25 * 1024 * 1024).fill(1) };
    });
    const put = vi.spyOn(uploadAsset, "call");
    expect(await commitImport.call({ id: run.id, graph: staged.graph }, OWNER)).toMatchObject({ status: "previewed", counts: { media: 0, mediaFailed: 1, pages: 0 } });
    expect(put).not.toHaveBeenCalled(); put.mockRestore();
    const mappings = await db().select().from(importSourceMedia);
    expect(mappings.filter(row => row.bytes !== null)).toHaveLength(40);
    expect(mappings.find(row => row.error)?.error).toContain("one-gigabyte");
    const bound = mappings.find(row => row.bytes !== null)!;
    await expect(db().update(importSourceMedia).set({ digest: null, bytes: null }).where(eq(importSourceMedia.id, bound.id))).rejects.toMatchObject({ cause: { code: "23514" } });
    expect(await db().select().from(assets)).toEqual([]);
  });

  it("keeps the ordinary media read permission separate from import and CMS grants", async () => {
    const credential = mintApiKey(), scopes = ["imports.beginSourceUpload", "imports.uploadSourceChunk", "imports.previewFromUpload", "imports.commit", "imports.rollback", "cms.*", "seo.*"];
    const [key] = await db().insert(apiKeys).values({ name: "Fictional bounded media importer", prefix: credential.prefix, tokenHash: credential.tokenHash, scopes }).returning();
    const request = () => new Request("https://instance.example/api/mcp", { headers: { authorization: `Bearer ${credential.token}` } });
    const actor = await actorFromRequest(request());
    await expect.poll(async () => (await db().select({ seen: apiKeys.lastUsedAt }).from(apiKeys).where(eq(apiKeys.id, key!.id)))[0]!.seen).not.toBeNull();
    const run = await startImport.call({ origin: ORIGIN, kind: "wordpress-wxr" }, OWNER), bytes = source();
    const upload = await beginSourceUpload.call({ id: run.id, filename: "fictional-exact-grants.xml", bytes: bytes.byteLength }, actor);
    await uploadSourceChunk.call({ id: run.id, uploadId: upload.uploadId, index: 0, bytes }, actor);
    let staged = await previewFromUpload.call({ id: run.id, uploadId: upload.uploadId }, actor);
    for (let phase = 0; phase < 5 && staged.status === "discover"; phase++) staged = await previewFromUpload.call({ id: run.id, uploadId: upload.uploadId }, actor);
    expect(await commitImport.call({ id: run.id, graph: staged.graph }, actor)).toMatchObject({ status: "previewed", counts: { media: 1, pages: 0 } });
    expect(await failure(commitImport.call({ id: run.id, graph: staged.graph }, actor))).toMatchObject({ code: "permission" });
    expect(await db().select().from(pages).where(sql`${pages.slug} like 'shared/page-%'`)).toEqual([]);
    expect(await db().select().from(assets)).toHaveLength(1);
    await db().update(apiKeys).set({ scopes: [...scopes, "media.get"] }).where(eq(apiKeys.id, key!.id));
    await db().update(importSourceGraphs).set({ leaseUntil: new Date(0) });
    const current = await actorFromRequest(request());
    expect(await commitImport.call({ id: run.id, graph: staged.graph }, current)).toMatchObject({ status: "previewed", counts: { media: 1, pages: 500 } });
    expect(getPinnedBytes).toHaveBeenCalledTimes(1);
    let reversed = await rollbackImport.call({ id: run.id, graph: staged.graph }, OWNER);
    for (let phase = 0; phase < 5 && reversed.status !== "rolled_back"; phase++) reversed = await rollbackImport.call({ id: run.id, graph: staged.graph }, OWNER);
    expect(reversed.status).toBe("rolled_back");
    expect((await db().select().from(assets))[0]!.status).toBe("trashed");
  });

  it("recovers a lost Asset reply, shares one media receipt across 501 pages and activates the nested final menu only at publication", async () => {
    const run = await startImport.call({ origin: ORIGIN, kind: "wordpress-wxr" }, OWNER), bytes = source();
    const upload = await beginSourceUpload.call({ id: run.id, filename: "fictional-shared-media.xml", bytes: bytes.byteLength }, OWNER);
    await uploadSourceChunk.call({ id: run.id, uploadId: upload.uploadId, index: 0, bytes }, OWNER);
    let staged = await previewFromUpload.call({ id: run.id, uploadId: upload.uploadId }, OWNER);
    for (let phase = 0; phase < 5 && staged.status === "discover"; phase++) staged = await previewFromUpload.call({ id: run.id, uploadId: upload.uploadId }, OWNER);
    expect(staged).toMatchObject({ status: "previewed", counts: { pages: 501, media: 1, menus: 1 } });
    const original = uploadAsset.call.bind(uploadAsset);
    const spy = vi.spyOn(uploadAsset, "call").mockImplementationOnce(async (input, actor) => { await original(input, actor); throw new Error("Fictional accepted Asset reply lost"); });
    await expect(commitImport.call({ id: run.id, graph: staged.graph }, OWNER)).rejects.toThrow("Fictional accepted Asset reply lost");
    spy.mockRestore();
    const [accepted] = await db().select().from(assets), [mapping] = await db().select().from(importSourceMedia);
    expect(mapping).toMatchObject({ assetId: accepted!.id, error: null, bytes: accepted!.bytes, digest: accepted!.checksumSha256 });
    expect(await db().select().from(pages).where(sql`${pages.slug} like 'shared/page-%'`)).toEqual([]);
    // A crashed process's lease expires; the accepted private receipt remains.
    await db().update(importSourceGraphs).set({ leaseUntil: new Date(0) });
    await closeDb(); resetStorageForTests();
    let committed = await commitImport.call({ id: run.id, graph: staged.graph }, OWNER);
    for (let phase = 0; phase < 8 && committed.status === "previewed"; phase++) committed = await commitImport.call({ id: run.id, graph: staged.graph }, OWNER);
    expect(committed).toMatchObject({ status: "committed", counts: { pages: 501, media: 1, mediaFailed: 0 } });
    expect(await db().select().from(assets)).toHaveLength(1);
    expect(getPinnedBytes.mock.calls.map(call => String(call[0]))).toEqual([IMAGE]);
    const imported = await db().select().from(pages).where(sql`${pages.slug} like 'shared/page-%'`);
    expect(imported).toHaveLength(501);
    for (const slug of ["shared/page-0", "shared/page-500"]) expect(JSON.stringify(imported.find(page => page.slug === slug)!.blocks)).toContain(accepted!.id);
    const [navBefore] = await db().select().from(sections).where(and(eq(sections.key, "nav"), eq(sections.locale, "en")));
    expect(JSON.stringify(navBefore!.blocks)).not.toContain("Fictional menu");
    const batches = await db().select().from(importSourceBatches);
    expect(batches.map(batch => batch.kind)).toEqual(["media", "content", "content", "navigation"]);
    const children = await db().select().from(importRuns).where(sql`${importRuns.checkpoint} ? 'sourceGraphBatch'`);
    expect(children.filter(child => (child.checkpoint as { media?: unknown[] }).media?.length)).toHaveLength(1);
    expect(JSON.stringify(children.map(child => child.preview))).not.toContain("Fictional original page");
    let reconciled = await reconcileImport.call({ id: run.id, graph: staged.graph }, OWNER);
    for (let phase = 0; phase < 6 && reconciled.status === "committed"; phase++) reconciled = await reconcileImport.call({ id: run.id, graph: staged.graph }, OWNER);
    expect(reconciled).toMatchObject({ status: "reconciled", checkpoint: { reconciliation: { matches: true, found: { pages: 501, media: 1 } } } });
    let published = await publishImport.call({ id: run.id, graph: staged.graph }, OWNER);
    for (let phase = 0; phase < 6 && published.status === "reconciled"; phase++) published = await publishImport.call({ id: run.id, graph: staged.graph }, OWNER);
    expect(published.status).toBe("published");
    const [navAfter] = await db().select().from(sections).where(eq(sections.id, navBefore!.id));
    expect(JSON.stringify(navAfter!.blocks)).toContain("/shared/page-0");
    expect(JSON.stringify(navAfter!.blocks)).toContain("/shared/page-500");
    expect(JSON.stringify(navAfter!.blocks)).toContain('"depth":1');
    let reversed = await rollbackImport.call({ id: run.id, graph: staged.graph }, OWNER);
    for (let phase = 0; phase < 6 && reversed.status !== "rolled_back"; phase++) reversed = await rollbackImport.call({ id: run.id, graph: staged.graph }, OWNER);
    expect(reversed.status).toBe("rolled_back");
    expect(await db().select().from(pages).where(sql`${pages.slug} like 'shared/page-%'`)).toEqual([]);
    expect((await db().select().from(assets))[0]).toMatchObject({ id: accepted!.id, status: "trashed" });
    expect((await db().select().from(sections).where(eq(sections.id, navBefore!.id)))[0]!.blocks).toEqual(navBefore!.blocks);
    for (const eventName of ["import.committed", "import.published", "import.rolledBack"]) {
      const events = await db().select().from(outboxEvents).where(eq(outboxEvents.eventName, eventName));
      expect(events.map(event => event.payload)).toEqual([{ id: run.id }]);
    }
  });
});
