// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.22: real generic media/CMS transactions and fresh source policy.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type * as PinnedDownload from "@/core/http/pinned-download";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { resetStorageForTests } from "@/adapters/storage";
import { assets } from "@/core/media/schema";
import { redirects } from "@/core/seo/schema";
import { pages } from "@/modules/cms/schema";
import { createPage, ensureDefaults, publishPage } from "@/modules/cms/service";
import { getPostMeta } from "@/modules/cms/blog-service";
import { listBlogPosts } from "@/modules/cms/blog";
import { updateBusiness } from "@/core/settings/service";
import { commitImport, previewFromSource, publishImport, reconcileImport, reviewImportConflicts, rollbackImport, startImport } from "@/core/import/service";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const getPinnedBytes = vi.hoisted(() => vi.fn<typeof PinnedDownload.getPinnedBytes>());
vi.mock("@/core/http/pinned-download", async importActual => ({ ...await importActual<typeof PinnedDownload>(), getPinnedBytes }));
const HTML = `<html><head><title>Fictional team</title><meta name="description" content="Source copy">
<meta name="robots" content="noindex,nofollow"><link rel="canonical" href="/legacy/team.html"></head>
<body><main><h1>Our people</h1><p>Full source content.</p><img src="../images/team.png" alt="Fictional team"></main></body></html>`;

describe.runIf(hasDatabase)("typed generic import lifecycle (C3.22)", { timeout: 60_000 }, () => {
  beforeEach(async () => {
    await truncateSpine(); resetStorageForTests(); await ensureDefaults.call({}, OWNER);
    const png = new Uint8Array(await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 30, g: 90, b: 140 } } }).png().toBuffer());
    getPinnedBytes.mockReset();
    getPinnedBytes.mockImplementation(async (url: string) => url.endsWith("/robots.txt") ? { status: 200, contentType: "text/plain", bytes: new TextEncoder().encode("User-agent: *\nAllow: /\n") } : { status: 200, contentType: "image/png", bytes: png });
  });
  afterAll(closeDb);
  async function stage() {
    const run = await startImport.call({ kind: "html", origin: "https://source.example/legacy/team.html" }, OWNER);
    return previewFromSource.call({ id: run.id, payload: HTML }, OWNER);
  }
  it("preserves source paths, local media and SEO through drafts, publication, replay and rollback", async () => {
    await updateBusiness.call({ name: "Fictional generic site", country: "CA", baseCurrency: "CAD", timezone: "America/Vancouver", defaultLocale: "fr", enabledLocales: ["en", "es", "fr", "ar"] }, OWNER);
    const run = await stage();
    expect(run.counts).toMatchObject({ pages: 1, media: 1, redirects: 1 });
    const restricted = { kind: "agent" as const, keyName: "exact-generic-commit", scopes: ["imports.commit", "cms.*", "seo.*"] };
    expect((await failure(commitImport.call({ id: run.id }, restricted))).code).toBe("permission");
    expect(await db().select().from(assets)).toHaveLength(1);
    expect(await db().select().from(pages).where(eq(pages.slug, "legacy/team"))).toHaveLength(0);
    const actor = { ...restricted, scopes: [...restricted.scopes, "media.get"] };
    const committed = await commitImport.call({ id: run.id }, actor);
    expect(committed).toMatchObject({ status: "committed", counts: { pages: 1, media: 1, redirects: 1 } });
    const [page] = await db().select().from(pages).where(eq(pages.slug, "legacy/team"));
    expect(page?.status).toBe("draft");
    expect(page?.seo).toMatchObject({ title: "Fictional team", description: "Source copy", noindex: true, nofollow: true, canonical: "/legacy/team" });
    expect(JSON.stringify(page?.blocks)).toContain('"type":"image"');
    expect(JSON.stringify(page?.blocks)).not.toContain('"type":"html"');
    expect(await db().select().from(redirects)).toMatchObject([{ fromPath: "legacy/team.html", toPath: "legacy/team", locale: "fr" }]);
    expect(await db().select().from(assets)).toHaveLength(1);
    expect((await commitImport.call({ id: run.id }, actor)).status).toBe("committed");
    expect(await db().select().from(assets)).toHaveLength(1);
    await reconcileImport.call({ id: run.id }, OWNER); await publishImport.call({ id: run.id }, OWNER);
    expect((await db().select().from(pages).where(eq(pages.id, page!.id)))[0]?.status).toBe("published");
    await rollbackImport.call({ id: run.id }, OWNER);
    expect(await db().select().from(pages).where(eq(pages.id, page!.id))).toHaveLength(0);
    expect(await db().select().from(redirects)).toHaveLength(0);
    expect((await db().select().from(assets))[0]?.status).toBe("trashed");
  });
  it("refuses media newly blocked by robots without accepting an asset, then resumes when allowed", async () => {
    const run = await stage(), ordinary = getPinnedBytes.getMockImplementation()!;
    getPinnedBytes.mockImplementation(async (url, options) => url.endsWith("/robots.txt") ? { status: 200, contentType: "text/plain", bytes: new TextEncoder().encode("User-agent: *\nDisallow: /images/\n") } : ordinary(url, options));
    expect((await failure(commitImport.call({ id: run.id }, OWNER))).code).toBe("conflict");
    expect(getPinnedBytes.mock.calls.every(([url]) => String(url).endsWith("/robots.txt"))).toBe(true);
    expect(await db().select().from(assets)).toHaveLength(0);
    expect(await db().select().from(pages).where(eq(pages.slug, "legacy/team"))).toHaveLength(0);
    getPinnedBytes.mockImplementation(ordinary);
    expect((await commitImport.call({ id: run.id }, OWNER)).counts).toMatchObject({ pages: 1, media: 1 });
    expect(await db().select().from(assets)).toHaveLength(1);
  });
  it("creates a real RSS post with its date and local enclosure through the shared CMS", async () => {
    const run = await startImport.call({ kind: "rss", origin: "https://source.example/feed.xml" }, OWNER);
    const rss = '<rss><channel><item><title>Actual source story</title><link>https://source.example/news/story.html</link><pubDate>Tue, 02 Apr 2024 09:00:00 GMT</pubDate><description><![CDATA[<p>Actual source story body.</p>]]></description><enclosure url="https://source.example/images/story.png" type="image/png"/></item></channel></rss>';
    await previewFromSource.call({ id: run.id, payload: rss }, OWNER);
    expect((await commitImport.call({ id: run.id }, OWNER)).counts).toMatchObject({ posts: 1, media: 1, redirects: 1 });
    const [page] = await db().select().from(pages).where(eq(pages.slug, "news/story"));
    expect(await getPostMeta.call({ pageId: page!.id }, OWNER)).toMatchObject({ isPost: true, authorId: null });
    expect(JSON.stringify(page!.blocks)).toContain('"type":"image"');
    await reconcileImport.call({ id: run.id }, OWNER); await publishImport.call({ id: run.id }, OWNER);
    expect((await db().select().from(pages).where(eq(pages.id, page!.id)))[0]?.publishedAt?.toISOString()).toBe("2024-04-02T09:00:00.000Z");
    expect(await listBlogPosts.call({ locale: "en" }, OWNER)).toMatchObject({ total: 1 });
    await rollbackImport.call({ id: run.id }, OWNER);
    expect(await db().select().from(pages).where(eq(pages.id, page!.id))).toHaveLength(0);
  });
  it("keeps different media query identities separate through actual asset acceptance", async () => {
    const run = await startImport.call({ kind: "html", origin: "https://source.example/variants.html" }, OWNER);
    await previewFromSource.call({ id: run.id, payload: '<title>Source variants</title><main><img src="/image?size=1" alt="First"><img src="/image?size=2" alt="Second"></main>' }, OWNER);
    expect((await commitImport.call({ id: run.id }, OWNER)).counts).toMatchObject({ pages: 1, media: 2 });
    const saved = await db().select().from(assets);
    expect(saved).toHaveLength(2);
    expect(new Set(saved.map(asset => asset.id)).size).toBe(2);
    const [page] = await db().select().from(pages).where(eq(pages.slug, "variants"));
    for (const asset of saved) expect(JSON.stringify(page!.blocks)).toContain(asset.id);
  });
  it("refuses to write empty CMS pages from a pasted discovery-only sitemap", async () => {
    const run = await startImport.call({ kind: "sitemap", origin: "https://source.example/sitemap.xml" }, OWNER);
    await previewFromSource.call({ id: run.id, payload: '<urlset><url><loc>https://source.example/team.html</loc></url></urlset>' }, OWNER);
    expect((await failure(commitImport.call({ id: run.id }, OWNER))).code).toBe("validation");
    expect(await db().select().from(pages).where(eq(pages.slug, "team"))).toHaveLength(0);
    expect(getPinnedBytes).not.toHaveBeenCalled();
  });
  it("keeps a future feed entry from changing a live page or its public metadata", async () => {
    const existing = await createPage.call({ slug: "live", title: "Existing live page", blocks: [{ id: "existing-heading", type: "heading", props: { text: "Existing live page", level: 1 } }] }, OWNER);
    await publishPage.call({ id: existing.id, published: true }, OWNER);
    const run = await startImport.call({ kind: "atom", origin: "https://source.example/feed.xml" }, OWNER);
    await previewFromSource.call({ id: run.id, payload: '<feed><entry><title>Future source story</title><link href="https://source.example/live.html"/><published>2050-01-02T09:00:00Z</published><content>Future private draft body</content></entry></feed>' }, OWNER);
    await reviewImportConflicts.call({ id: run.id, conflicts: [{ slug: "live", resolution: "replace" }] }, OWNER);
    expect((await failure(commitImport.call({ id: run.id }, OWNER))).code).toBe("conflict");
    const [page] = await db().select().from(pages).where(eq(pages.id, existing.id));
    expect(page).toMatchObject({ title: "Existing live page", status: "published", workingBlocks: null });
    expect(JSON.stringify(page)).not.toContain("Future private draft body");
    expect(await getPostMeta.call({ pageId: existing.id }, OWNER)).toMatchObject({ isPost: false });
  });
});
