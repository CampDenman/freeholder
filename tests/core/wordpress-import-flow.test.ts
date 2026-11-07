// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// A WordPress export through the whole import studio (C3.22, C3.23):
// preview → commit (media fetched) → reconcile → publish → rollback.
// The export is a fictional site and every download is a local fixture.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { and, eq } from "drizzle-orm";
import { db } from "@/core/db";
import { resetStorageForTests } from "@/adapters/storage";
import { assets } from "@/core/media/schema";
import { redirects } from "@/core/seo/schema";
import { pages, sections } from "@/modules/cms/schema";
import { ensureDefaults } from "@/modules/cms/service";
import { listBlogPosts } from "@/modules/cms/blog";
import {
  commitImport,
  previewFromSource,
  publishImport,
  reconcileImport,
  rollbackImport,
  startImport,
  reviewImportConflicts,
  wordpressVerificationPlan,
} from "@/core/import/service";
import { saveAuthor, setPostMeta, postMetaAt, resolveBlogArchive } from "@/modules/cms/blog-service";
import { listReaderComments } from "@/modules/cms/blog-comments";
import { resolveRedirect } from "@/core/seo/service";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const getPinnedBytes = vi.hoisted(() => vi.fn());
vi.mock("@/core/http/pinned-download", () => ({
  getPinnedBytes,
  PinnedDownloadError: class PinnedDownloadError extends Error {
    constructor(
      public readonly code: "timeout" | "too_large" | "network",
      message: string,
    ) {
      super(message);
    }
  },
}));

const FIXTURE = readFileSync(
  fileURLToPath(new URL("../fixtures/wordpress/sample-export.xml", import.meta.url)),
  "utf8",
);

async function image(format: "jpeg" | "png"): Promise<Uint8Array<ArrayBuffer>> {
  const buffer = await sharp({
    create: { width: 640, height: 480, channels: 3, background: { r: 120, g: 80, b: 40 } },
  })
    [format]()
    .toBuffer();
  return new Uint8Array(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
}

async function pageAt(slug: string) {
  const [page] = await db().select().from(pages).where(eq(pages.slug, slug)).limit(1);
  return page;
}

describe.runIf(hasDatabase)("WordPress import studio", { timeout: 60_000 }, () => {
  beforeEach(async () => {
    await truncateSpine();
    resetStorageForTests();
    getPinnedBytes.mockReset();
    const jpeg = await image("jpeg");
    const png = await image("png");
    getPinnedBytes.mockImplementation((url: string) => {
      if (url.endsWith("/kiln.jpg")) return Promise.resolve({ status: 200, contentType: "image/jpeg", bytes: jpeg });
      if (url.endsWith("/glaze-scaled.png")) return Promise.resolve({ status: 200, contentType: "image/png", bytes: png });
      return Promise.resolve({ status: 404, contentType: "text/html", bytes: new Uint8Array() });
    });
    await ensureDefaults.call({}, OWNER);
  });
  afterAll(closeDb);

  it("imports posts, pages, media, SEO, redirects and the menu, then rolls it all back", async () => {
    const started = await startImport.call({ origin: "https://old.example.org", kind: "wordpress-wxr" }, OWNER);
    const previewed = await previewFromSource.call({ id: started.id, payload: FIXTURE }, OWNER);
    expect(previewed.status).toBe("previewed");
    expect(previewed.counts).toMatchObject({ pages: 5, posts: 3, media: 2, redirects: 0, menus: 1, commentsSkipped: 2 });
    // Nothing is written by a preview.
    expect(await pageAt("2025/03/first-wood-firing")).toBeUndefined();

    const committed = await commitImport.call({ id: started.id }, OWNER);
    expect(committed.status).toBe("committed");
    expect(committed.counts).toMatchObject({
      // A fresh site already has a published blog listing at /blog, so the
      // import adds five pages and leaves that listing alone.
      pages: 5,
      posts: 3,
      media: 2,
      mediaFailed: 0,
      redirects: 0,
      menus: 1,
      categories: 2,
      tags: 1,
      authors: 1,
      commentsImported: 2,
      commentsSkipped: 0,
      skippedPages: 0,
    });
    // The external image is never fetched; only the two attachments are.
    expect(getPinnedBytes.mock.calls.map((call: unknown[]) => String(call[0]))).toEqual([
      "https://old.example.org/wp-content/uploads/2025/03/kiln.jpg",
      "https://old.example.org/wp-content/uploads/2025/04/glaze-scaled.png",
    ]);

    const imported = await db().select().from(assets);
    expect(imported).toHaveLength(2);
    expect(imported.every((asset) => asset.source === "import" && asset.status === "ready")).toBe(true);
    const kiln = imported.find((asset) => asset.filename === "kiln.jpg")!;
    expect(kiln.altText).toBe("A brick kiln stacked with bowls");
    expect(Object.keys(kiln.variants as object)).toEqual(expect.arrayContaining(["avif", "webp"]));
    expect(kiln.provenance).toMatchObject({
      sourceUrl: "https://old.example.org/wp-content/uploads/2025/03/kiln.jpg",
    });

    const post = (await pageAt("2025/03/first-wood-firing"))!;
    expect(post.status).toBe("draft");
    expect(post.seo).toEqual({
      title: expect.stringMatching(/^Our First Wood Firing – Wood firing diary/) as unknown,
      description: "Three days of loading and two of stoking.",
      preserveTitle: true,
      preserveDescription: true,
    });
    const blocks = post.blocks as Array<{ type: string; props: Record<string, unknown> }>;
    expect(blocks.filter((block) => block.type === "image").map((block) => block.props.assetId)).toEqual([kiln.id]);
    expect(JSON.stringify(blocks)).toContain('"href":"/glaze-notes"');
    expect((await pageAt("about/team"))!.status).toBe("draft");
    expect(JSON.stringify((await pageAt("about"))!.blocks)).toContain('"href":"/2025/03/first-wood-firing"');
    expect((await pageAt("blog"))!.blocks).toEqual(expect.arrayContaining([expect.objectContaining({ type: "blogIndex" })]));

    const moved = await db().select().from(redirects);
    expect(moved).toEqual([]);

    const reconciled = await reconcileImport.call({ id: started.id }, OWNER);
    expect(reconciled.checkpoint).toMatchObject({
      reconciliation: { found: { pages: 5, media: 2, redirects: 0 }, matches: true },
    });

    const published = await publishImport.call({ id: started.id }, OWNER);
    expect(published.status).toBe("published");
    expect((await pageAt("2025/03/first-wood-firing"))!.publishedAt?.toISOString()).toBe("2025-03-14T18:00:00.000Z");
    expect((await pageAt("blog/upcoming-sale"))!.status).toBe("draft");
    const listing = await listBlogPosts.call({ locale: "en", prefix: "blog", page: 1, limit: 12 }, { kind: "anonymous" });
    expect(listing.posts.map((entry) => entry.slug)).toEqual(["glaze-notes", "2025/03/first-wood-firing"]);
    expect(await resolveRedirect.call({ path: "?p=20" }, { kind: "anonymous" })).toEqual({ toPath: post.slug, status: "301" });
    expect(await resolveRedirect.call({ path: "?attachment_id=10" }, { kind: "anonymous" })).toEqual({ toPath: post.slug, status: "301" });
    expect(await resolveBlogArchive.call({ path: "author/maple" }, { kind: "anonymous" })).toMatchObject({ name: "Maple Rivers", posts: 2 });
    expect(await resolveBlogArchive.call({ path: "2025/03" }, { kind: "anonymous" })).toMatchObject({ kind: "date", posts: 1 });
    expect(await resolveRedirect.call({ path: "author/maple/page/1" }, { kind: "anonymous" })).toEqual({ toPath: "author/maple", status: "301" });
    expect(await resolveRedirect.call({ path: "author/maple/page/9999" }, { kind: "anonymous" })).toBeNull();
    expect(await listReaderComments.call({ pageId: post.id }, { kind: "anonymous" })).toHaveLength(1);
    const verification = await wordpressVerificationPlan.call({ id: started.id }, OWNER);
    expect(verification.checks.some(check => check.requestPath === "/?p=20" && check.redirect)).toBe(true);
    expect(verification.checks.some(check => check.destinationPath.includes("upcoming-sale"))).toBe(false);
    const [nav] = await db()
      .select()
      .from(sections)
      .where(and(eq(sections.key, "nav"), eq(sections.locale, "en")));
    // Top-level items only: the nav block is flat, so "Team" stays on record.
    expect((nav!.blocks as Array<{ props: { links: unknown[] } }>)[0]!.props.links).toEqual([
      { label: "About", href: "/about" },
      { label: "Journal", href: "/2025/03/first-wood-firing" },
    ]);

    const rolled = await rollbackImport.call({ id: started.id }, OWNER);
    expect(rolled.status).toBe("rolled_back");
    expect(await pageAt("2025/03/first-wood-firing")).toBeUndefined();
    expect((await pageAt("blog"))!.status).toBe("published");
    expect(await db().select().from(redirects)).toHaveLength(0);
    expect((await db().select().from(assets)).every((asset) => asset.status === "trashed")).toBe(true);
    const [navAfter] = await db()
      .select()
      .from(sections)
      .where(and(eq(sections.key, "nav"), eq(sections.locale, "en")));
    expect(JSON.stringify(navAfter!.blocks)).not.toContain("/about");
  });

  it("records a failed download and still lands the page without it", async () => {
    getPinnedBytes.mockImplementation((url: string) =>
      url.endsWith("/kiln.jpg")
        ? Promise.reject(new Error("socket hang up"))
        : image("png").then((bytes) => ({ status: 200, contentType: "image/png", bytes })),
    );
    // Without a blog listing page, the import creates one for the posts.
    await db().delete(pages).where(eq(pages.slug, "blog"));
    const started = await startImport.call({ origin: "https://old.example.org", kind: "wordpress-wxr" }, OWNER);
    await previewFromSource.call({ id: started.id, payload: FIXTURE }, OWNER);
    const committed = await commitImport.call({ id: started.id }, OWNER);
    expect(committed.counts).toMatchObject({ pages: 6, media: 1, mediaFailed: 1 });
    expect((await pageAt("blog"))!.blocks).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "blogIndex" })]),
    );
    expect(committed.checkpoint).toMatchObject({
      report: {
        mediaFailures: [{ sourceUrl: "https://old.example.org/wp-content/uploads/2025/03/kiln.jpg", error: "The file could not be fetched." }],
        unresolvedImages: expect.arrayContaining([
          "https://old.example.org/wp-content/uploads/2025/03/kiln-1024x768.jpg",
        ]) as unknown,
      },
    });
    // The page still lands, without the picture it could not fetch.
    const post = (await pageAt("2025/03/first-wood-firing"))!;
    expect(JSON.stringify(post.blocks)).not.toContain('"type":"image"');

    await rollbackImport.call({ id: started.id }, OWNER);
    expect(await pageAt("2025/03/first-wood-firing")).toBeUndefined();
    expect(await pageAt("blog")).toBeUndefined();
  });

  it("refuses to commit over an existing page until the conflict is reviewed", async () => {
    const started = await startImport.call({ origin: "https://old.example.org", kind: "wordpress-wxr" }, OWNER);
    await previewFromSource.call({ id: started.id, payload: FIXTURE }, OWNER);
    const { createPage } = await import("@/modules/cms/service");
    await createPage.call(
      { slug: "about", title: "About", blocks: [{ id: "h", type: "heading", props: { text: "About", level: 1 } }] },
      OWNER,
    );
    await expect(commitImport.call({ id: started.id }, OWNER)).rejects.toThrow(/already lives at \/about/);
    // Media fetched before the refusal is kept on the run, not orphaned.
    const rolled = await rollbackImport.call({ id: started.id }, OWNER);
    expect(rolled.status).toBe("rolled_back");
    expect((await db().select().from(assets)).every((asset) => asset.status === "trashed")).toBe(true);
  });

  it("stages live replacement bylines and approved comments until cutover, then restores the original date and metadata on rollback", async () => {
    const { createPage, publishPage } = await import("@/modules/cms/service");
    const page = await createPage.call({ slug: "2025/03/first-wood-firing", title: "Original live title", blocks: [{ id: "original-h", type: "heading", props: { text: "Original live title", level: 1 } }] }, OWNER);
    const author = await saveAuthor.call({ name: "Original Author" }, OWNER);
    await setPostMeta.call({ pageId: page.id, isPost: true, authorId: author.id, commentsEnabled: false }, OWNER);
    const originalDate = "2024-01-02T12:00:00.000Z";
    await publishPage.call({ id: page.id, published: true, publishedAt: originalDate }, OWNER);
    const started = await startImport.call({ origin: "https://old.example.org", kind: "wordpress-wxr" }, OWNER);
    await previewFromSource.call({ id: started.id, payload: FIXTURE }, OWNER);
    await reviewImportConflicts.call({ id: started.id, conflicts: [{ slug: page.slug, resolution: "replace" }] }, OWNER);
    const committed = await commitImport.call({ id: started.id }, OWNER);
    expect(committed.counts).toMatchObject({ commentsImported: 0, commentsStaged: 2, commentsSkipped: 0 });
    expect((await postMetaAt.call({ slug: page.slug }, { kind: "anonymous" }))?.author?.name).toBe("Original Author");
    expect(await listReaderComments.call({ pageId: page.id }, { kind: "anonymous" })).toEqual([]);
    await reconcileImport.call({ id: started.id }, OWNER);
    await publishImport.call({ id: started.id }, OWNER);
    expect((await postMetaAt.call({ slug: page.slug }, { kind: "anonymous" }))?.author?.name).toBe("Maple Rivers");
    expect(await listReaderComments.call({ pageId: page.id }, { kind: "anonymous" })).toHaveLength(1);
    await rollbackImport.call({ id: started.id }, OWNER);
    const restored = await pageAt(page.slug);
    expect(restored?.title).toBe("Original live title");
    expect(restored?.publishedAt?.toISOString()).toBe(originalDate);
    expect((await postMetaAt.call({ slug: page.slug }, { kind: "anonymous" }))?.author?.name).toBe("Original Author");
    expect(await listReaderComments.call({ pageId: page.id }, { kind: "anonymous" })).toEqual([]);
  });
});
