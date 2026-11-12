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
import { updateBusiness } from "@/core/settings/service";
import { ensureDefaults, updateSection } from "@/modules/cms/service";
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
import { blogReaderComments } from "@/modules/cms/blog-comments-schema";
import { registerPublishVeto } from "@/core/privacy/publish-veto";
import { resolveRedirect } from "@/core/seo/service";
import { resolveContact } from "@/core/contacts/service";
import { reviewOriginalImportedReader } from "../helpers/import-reader-review";
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

    const originalReader = await resolveContact.call({ email: "reader@example.net" }, OWNER);
    await reviewOriginalImportedReader({ id: started.id, postId: "20", commentId: "1", contactId: originalReader.contact.id });
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
    const navLinks = (nav!.blocks as Array<{ props: { links: Array<{ id: string; label: string; href: string; depth?: number }> } }>)[0]!.props.links;
    expect(navLinks.map(link => [link.label, link.href, link.depth ?? 0])).toEqual([
      ["About", "/about", 0],
      ["Team", "/about/team", 1],
      ["Journal", "/2025/03/first-wood-firing", 0],
    ]);
    expect(navLinks.every(link => link.id.startsWith(`import-${started.id}-`))).toBe(true);

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


  it("merges children below the matching owner parent and reverses only new identities", async () => {
    const existing = [{ label: "Owner About", href: "/about" }, { label: "Our story", href: "/our-story", depth: 1 }, { label: "Work", href: "/work" }];
    await updateSection.call({ key: "nav", locale: "en", blocks: [{ id: "nav", type: "nav", props: { links: existing } }] }, OWNER);
    const run = await startImport.call({ origin: "https://old.example.org", kind: "wordpress-wxr" }, OWNER);
    await previewFromSource.call({ id: run.id, payload: FIXTURE }, OWNER);
    const originalReader = await resolveContact.call({ email: "reader@example.net" }, OWNER);
    await reviewOriginalImportedReader({ id: run.id, postId: "20", commentId: "1", contactId: originalReader.contact.id });
    await commitImport.call({ id: run.id }, OWNER); await reconcileImport.call({ id: run.id }, OWNER); await publishImport.call({ id: run.id }, OWNER);
    const [section] = await db().select().from(sections).where(and(eq(sections.key, "nav"), eq(sections.locale, "en")));
    const links = (section!.blocks as Array<{ props: { links: Array<{ label: string; href: string; depth?: number }> } }>)[0]!.props.links;
    expect(links.map(link => [link.label, link.depth ?? 0])).toEqual([["Owner About", 0], ["Our story", 1], ["Team", 1], ["Work", 0], ["Journal", 0]]);
    await rollbackImport.call({ id: run.id }, OWNER);
    const [after] = await db().select().from(sections).where(and(eq(sections.key, "nav"), eq(sections.locale, "en")));
    expect((after!.blocks as Array<{ props: { links: unknown } }>)[0]!.props.links).toEqual(existing);
  });


  it("preserves a later owner-duplicated nav block during import rollback", async () => {
    const run = await startImport.call({ origin: "https://old.example.org", kind: "wordpress-wxr" }, OWNER);
    await previewFromSource.call({ id: run.id, payload: FIXTURE }, OWNER);
    const originalReader = await resolveContact.call({ email: "reader@example.net" }, OWNER);
    await reviewOriginalImportedReader({ id: run.id, postId: "20", commentId: "1", contactId: originalReader.contact.id });
    await commitImport.call({ id: run.id }, OWNER); await reconcileImport.call({ id: run.id }, OWNER); await publishImport.call({ id: run.id }, OWNER);
    const [section] = await db().select().from(sections).where(and(eq(sections.key, "nav"), eq(sections.locale, "en")));
    const blocks = section!.blocks as Array<{ id: string; type: string; props: Record<string, unknown> }>;
    const copy = { ...structuredClone(blocks[0]!), id: "owner-menu-copy" };
    await updateSection.call({ key: "nav", locale: "en", blocks: [...blocks, copy] }, OWNER);
    await rollbackImport.call({ id: run.id }, OWNER);
    const [after] = await db().select().from(sections).where(and(eq(sections.key, "nav"), eq(sections.locale, "en")));
    const ownerCopy = (after!.blocks as typeof blocks).find(block => block.id === "owner-menu-copy");
    expect(ownerCopy).toEqual(copy);
  });

  it("does not publish an imported draft's navigation label", async () => {
    // The source menu points to a future/private post but advertises a label.
    const source = FIXTURE.replace('<![CDATA[_menu_item_object_id]]></wp:meta_key><wp:meta_value><![CDATA[30]]>', '<![CDATA[_menu_item_object_id]]></wp:meta_key><wp:meta_value><![CDATA[22]]>').replace('<title><![CDATA[About]]></title>\n\t\t<link>https://old.example.org/?p=50</link>', '<title><![CDATA[Private future title]]></title>\n\t\t<link>https://old.example.org/?p=50</link>');
    expect(source).toContain("Private future title");
    const run = await startImport.call({ origin: "https://old.example.org", kind: "wordpress-wxr" }, OWNER);
    await previewFromSource.call({ id: run.id, payload: source }, OWNER);
    const originalReader = await resolveContact.call({ email: "reader@example.net" }, OWNER);
    await reviewOriginalImportedReader({ id: run.id, postId: "20", commentId: "1", contactId: originalReader.contact.id });
    await commitImport.call({ id: run.id }, OWNER); await reconcileImport.call({ id: run.id }, OWNER);
    const published = await publishImport.call({ id: run.id }, OWNER);
    expect(published.checkpoint).toMatchObject({ skippedMenuLinks: [{ href: "/blog/upcoming-sale", reason: "imported destination is not public" }] });
    const [section] = await db().select().from(sections).where(and(eq(sections.key, "nav"), eq(sections.locale, "en")));
    expect(JSON.stringify(section!.blocks)).not.toContain("/blog/upcoming-sale");
    expect(JSON.stringify(section!.blocks)).not.toContain("Private future title");
  });


  it("refuses vetoed labels at cutover and makes publish/rollback retries stable", async () => {
    const run = await startImport.call({ origin: "https://old.example.org", kind: "wordpress-wxr" }, OWNER);
    await previewFromSource.call({ id: run.id, payload: FIXTURE }, OWNER);
    const originalReader = await resolveContact.call({ email: "reader@example.net" }, OWNER);
    await reviewOriginalImportedReader({ id: run.id, postId: "20", commentId: "1", contactId: originalReader.contact.id });
    await commitImport.call({ id: run.id }, OWNER); await reconcileImport.call({ id: run.id }, OWNER);
    const about = (await pageAt("about"))!;
    registerPublishVeto({ id: `test.import-nav-${run.id}`, appliesTo: page => page.id === about.id, blocks: async () => true });
    const published = await publishImport.call({ id: run.id }, OWNER);
    expect(published.checkpoint).toMatchObject({ skippedMenuLinks: [{ href: "/about", reason: "imported destination is not public" }] });
    const [section] = await db().select().from(sections).where(and(eq(sections.key, "nav"), eq(sections.locale, "en")));
    const links = (section!.blocks as Array<{ props: { links: Array<{ href: string; depth?: number }> } }>)[0]!.props.links;
    expect(links[0]).toMatchObject({ href: "/about/team" });
    expect(links[0]?.depth ?? 0).toBe(0);
    expect(await publishImport.call({ id: run.id }, OWNER)).toEqual(published);
    const rolled = await rollbackImport.call({ id: run.id }, OWNER);
    expect(await rollbackImport.call({ id: run.id }, OWNER)).toEqual(rolled);
  });


  it.each(["es", "fr", "ar"])("publishes into the site's %s source chrome and reverses that same locale", async locale => {
    await updateBusiness.call({ name: "Localized source menu", country: "CA", baseCurrency: "CAD", timezone: "America/Vancouver", defaultLocale: locale, enabledLocales: ["en", locale] }, OWNER);
    await ensureDefaults.call({ locale }, OWNER);
    const run = await startImport.call({ origin: "https://old.example.org", kind: "wordpress-wxr" }, OWNER);
    await previewFromSource.call({ id: run.id, payload: FIXTURE }, OWNER);
    const originalReader = await resolveContact.call({ email: "reader@example.net" }, OWNER);
    await reviewOriginalImportedReader({ id: run.id, postId: "20", commentId: "1", contactId: originalReader.contact.id });
    await commitImport.call({ id: run.id }, OWNER); await reconcileImport.call({ id: run.id }, OWNER);
    const published = await publishImport.call({ id: run.id }, OWNER);
    expect(published.checkpoint).toMatchObject({ navApplied: { locale } });
    const [english] = await db().select().from(sections).where(and(eq(sections.key, "nav"), eq(sections.locale, "en")));
    expect(JSON.stringify(english!.blocks)).not.toContain("/about/team");
    const [localized] = await db().select().from(sections).where(and(eq(sections.key, "nav"), eq(sections.locale, locale)));
    expect(JSON.stringify(localized!.blocks)).toContain("/about/team");
    await rollbackImport.call({ id: run.id }, OWNER);
    const [reversed] = await db().select().from(sections).where(eq(sections.id, localized!.id));
    expect(JSON.stringify(reversed!.blocks)).not.toContain("/about/team");
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
    const originalReader = await resolveContact.call({ email: "reader@example.net" }, OWNER);
    await reviewOriginalImportedReader({ id: started.id, postId: "20", commentId: "1", contactId: originalReader.contact.id });
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
    const originalReader = await resolveContact.call({ email: "reader@example.net" }, OWNER);
    await reviewOriginalImportedReader({ id: started.id, postId: "20", commentId: "1", contactId: originalReader.contact.id });
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
    const originalReader = await resolveContact.call({ email: "reader@example.net" }, OWNER);
    await reviewOriginalImportedReader({ id: started.id, postId: "20", commentId: "1", contactId: originalReader.contact.id });
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

  it("hides an old blog thread when an ordinary page replaces it, and restores the same history on rollback", async () => {
    const { createPage, publishPage } = await import("@/modules/cms/service");
    const page = await createPage.call({ slug: "about", title: "An old blog post", blocks: [{ id: "old-h", type: "heading", props: { text: "An old blog post", level: 1 } }] }, OWNER);
    await setPostMeta.call({ pageId: page.id, isPost: true }, OWNER);
    await publishPage.call({ id: page.id, published: true }, OWNER);
    const [comment] = await db().insert(blogReaderComments).values({ pageId: page.id, authorName: "Original Reader", body: "Original approved history", status: "approved" }).returning();
    const started = await startImport.call({ origin: "https://old.example.org", kind: "wordpress-wxr" }, OWNER);
    await previewFromSource.call({ id: started.id, payload: FIXTURE }, OWNER);
    const originalReader = await resolveContact.call({ email: "reader@example.net" }, OWNER);
    await reviewOriginalImportedReader({ id: started.id, postId: "20", commentId: "1", contactId: originalReader.contact.id });
    await reviewImportConflicts.call({ id: started.id, conflicts: [{ slug: "about", resolution: "replace" }] }, OWNER);
    await commitImport.call({ id: started.id }, OWNER);
    expect(await listReaderComments.call({ pageId: page.id }, { kind: "anonymous" })).toHaveLength(1);
    await reconcileImport.call({ id: started.id }, OWNER);
    await publishImport.call({ id: started.id }, OWNER);
    expect(await postMetaAt.call({ slug: page.slug }, { kind: "anonymous" })).toBeNull();
    expect(await listReaderComments.call({ pageId: page.id }, { kind: "anonymous" })).toEqual([]);
    expect((await db().select().from(blogReaderComments).where(eq(blogReaderComments.id, comment!.id)))[0]?.body).toBe("Original approved history");
    await rollbackImport.call({ id: started.id }, OWNER);
    expect((await postMetaAt.call({ slug: page.slug }, { kind: "anonymous" }))?.pageId).toBe(page.id);
    expect((await listReaderComments.call({ pageId: page.id }, { kind: "anonymous" }))[0]?.id).toBe(comment!.id);
  });
});
