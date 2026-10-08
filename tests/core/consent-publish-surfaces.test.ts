// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C8.16: consent-gated progress and comparison media, proven at the render
// layer rather than at the button that got us here.
//
// The publish gate (`projects.publish`) and the withdrawal action
// (`projects.revokeConsent`) keep publication state honest in normal
// operation. These tests prove the second line that `src/modules/projects/
// consent-gate.ts` draws: every public surface that can render a before/after
// pair or a progress series reads the consent ledger itself, so withdrawal
// unpublishes from the page, the portfolio, the service page, the gallery,
// the sitemap, the feeds and the structured data in one action — and keeps
// them unpublished even if a publication flag is flipped back by hand.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { assets } from "@/core/media/schema";
import { getService } from "@/core/service";
import { updateBusiness } from "@/core/settings/service";
import { createTaxCategory } from "@/modules/invoicing/tax-service";
import { activateProduct, createProduct } from "@/modules/catalog/service";
import {
  attachFile,
  createProject,
  updateProject,
} from "@/modules/projects/service";
import {
  publicProjectsForService,
  publishCaseStudy,
  recordProjectConsent,
  revokeProjectConsent,
} from "@/modules/projects/publishing-service";
import {
  portfolioBrowse,
  resolvePublicProject,
} from "@/modules/projects/portfolio-service";
import {
  mediaConsentHistory,
  mediaConsentState,
} from "@/core/privacy/media-consent";
import { pages } from "@/modules/cms/schema";
import { projects } from "@/modules/projects/schema";
import { FEED_KINDS, renderEntityFeed } from "@/core/seo/feeds";
import { collectPublicEntities } from "@/core/seo/entities";
import {
  addGalleryItem,
  buildGalleryArchive,
  createGallery,
  downloadGalleryArchive,
  downloadGalleryItem,
  requestGalleryArchive,
  unlockGallery,
  viewGalleryItem,
} from "@/modules/galleries/service";
import {
  ANONYMOUS,
  closeDb,
  failure,
  hasDatabase,
  OWNER,
  truncateSpine,
} from "../helpers/spine";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ResolvedImage } from "@/core/media/service";
import { projectCaseStudy } from "@/modules/projects/blocks";
import type { BlockRenderContext } from "@/modules/cms/blocks/types";

const ORIGIN = "https://studio.example.test";

describe.runIf(hasDatabase)("consent-gated publish surfaces (C8.16)", { timeout: 90_000 }, () => {
  beforeEach(async () => {
    await ready();
    await truncateSpine();
    await updateBusiness.call(
      {
        name: "Hearth & Pine",
        country: "CA",
        baseCurrency: "CAD",
        timezone: "America/Vancouver",
      },
      OWNER,
    );
  }, 60_000);
  afterAll(closeDb);

  async function clientContact(email = "client@example.test") {
    const resolved = (await getService("contacts.resolve").call(
      { email, name: "Rae Lane", source: "test" },
      { kind: "system" },
    )) as { contact: { id: string } };
    return resolved.contact.id;
  }

  async function activeService() {
    const tax = await createTaxCategory.call(
      { code: `standard_${crypto.randomUUID().slice(0, 6)}`, name: "Standard" },
      OWNER,
    );
    const draft = await createProduct.call(
      {
        name: "Kitchen renovation",
        slug: `kitchen-${crypto.randomUUID().slice(0, 8)}`,
        kind: "service",
        taxCategoryId: tax.id,
      },
      OWNER,
    );
    return activateProduct.call({ id: draft.id, expectedVersion: draft.version }, OWNER);
  }

  async function image(filename: string, provenance: Record<string, unknown> = {}) {
    const [created] = await db()
      .insert(assets)
      .values({
        kind: "image",
        storageKey: `test/${crypto.randomUUID()}.jpg`,
        filename,
        mime: "image/jpeg",
        legacyBytes: 1024,
        bytes: 1024,
        altText: filename.replace(/\.jpg$/, ""),
        provenance,
      })
      .returning();
    return created!;
  }

  /**
   * A consented, published case study with a before/after pair and a progress
   * series — the media this item is about.
   */
  async function publishedCaseStudy() {
    const clientId = await clientContact();
    const offering = await activeService();
    const slug = `aligner-${crypto.randomUUID().slice(0, 8)}`;
    const created = await createProject.call(
      {
        title: "Aligner course",
        slug,
        contactId: clientId,
        clientDisplayName: "A client",
        serviceProductIds: [offering.id],
      },
      OWNER,
    );
    const project = await updateProject.call(
      { id: created.id, status: "complete", summary: "Sixteen weeks, tracked." },
      OWNER,
    );
    await recordProjectConsent.call(
      { id: project.id, method: "written", note: "Signed release on file." },
      OWNER,
    );
    const before = await image("Week 0.jpg", {
      captureSessionId: "capture-session-1",
      source: "camera",
    });
    const after = await image("Week 16.jpg");
    const week8 = await image("Week 8.jpg");
    await attachFile.call(
      { projectId: project.id, assetId: before.id, role: "before", pairKey: "smile" },
      OWNER,
    );
    await attachFile.call(
      { projectId: project.id, assetId: after.id, role: "after", pairKey: "smile" },
      OWNER,
    );
    await attachFile.call(
      {
        projectId: project.id,
        assetId: week8.id,
        role: "series",
        seriesKey: "progress",
        capturedAt: new Date("2026-07-01T00:00:00.000Z"),
      },
      OWNER,
    );
    const published = await publishCaseStudy.call({ id: project.id }, OWNER);
    return {
      project,
      clientId,
      offering,
      slug,
      before,
      after,
      week8,
      href: published.href,
      pageId: published.pageId,
    };
  }

  /** Every public surface, read the way its renderer reads it. */
  async function readSurfaces(slug: string, productId: string) {
    const publishedPaths = (await getService("cms.publishedPaths").call(
      { locale: "en" },
      { kind: "system" },
    )) as Array<{ slug: string }>;
    const entities = await collectPublicEntities("en");
    const feeds = FEED_KINDS.map((kind) =>
      renderEntityFeed({ origin: ORIGIN, kind, title: "feed", entities }),
    );
    const structured = await resolvePublicProject.call({ slug }, ANONYMOUS);
    const browse = await portfolioBrowse.call({}, ANONYMOUS);
    const proving = await publicProjectsForService.call({ productId }, ANONYMOUS);
    return {
      inSitemap: publishedPaths.some((entry) => entry.slug === `portfolio/${slug}`),
      inFeeds: feeds.some((feed) => feed.includes(`portfolio/${slug}`)),
      structured,
      inBrowse: browse.projects.some((project) => project.slug === slug),
      inServiceProofs: proving.some((project) => project.slug === slug),
    };
  }

  it("renders a consented pair and series on every surface, and one withdrawal removes them from all", async () => {
    const made = await publishedCaseStudy();

    // With consent and public assets, the sitemap, structured-data query,
    // portfolio and service page all expose the published work.
    const before = await readSurfaces(made.slug, made.offering.id);
    expect(before.inSitemap).toBe(true);
    expect(before.inFeeds).toBe(false);
    expect(before.inBrowse).toBe(true);
    expect(before.inServiceProofs).toBe(true);
    expect(before.structured?.project.slug).toBe(made.slug);
    expect(before.structured?.images.map((entry) => entry.role).sort()).toEqual([
      "after",
      "before",
      "series",
    ]);

    const gallery = await createGallery.call(
      {
        contactId: made.clientId,
        title: "Progress",
        access: "pin",
        secret: "2468",
        downloadPolicy: "full_res",
      },
      OWNER,
    );
    await addGalleryItem.call(
      { galleryId: gallery.id, assetId: made.before.id },
      OWNER,
    );
    await addGalleryItem.call({ galleryId: gallery.id, assetId: made.after.id }, OWNER);

    // Adding shared assets to a client gallery makes them private across
    // public views, even with consent and an already-published case study.
    const privateGallery = await readSurfaces(made.slug, made.offering.id);
    expect(privateGallery.inSitemap).toBe(true);
    expect(privateGallery.inBrowse).toBe(true);
    expect(privateGallery.inServiceProofs).toBe(true);
    expect(privateGallery.structured?.images.map((entry) => entry.role)).toEqual(["series"]);

    const openedBefore = await unlockGallery.call(
      { slug: gallery.slug, secret: "2468" },
      ANONYMOUS,
    );
    expect(openedBefore.ok).toBe(true);
    if (!openedBefore.ok) throw new Error("expected the gallery to open");
    expect(openedBefore.items.map((item) => item.assetId).sort()).toEqual(
      [made.before.id, made.after.id].sort(),
    );
    for (const item of openedBefore.items) {
      expect(await viewGalleryItem.call(
        { sessionToken: openedBefore.sessionToken, itemId: item.id },
        ANONYMOUS,
      )).toMatchObject({ assetId: item.assetId });
      expect(await downloadGalleryItem.call(
        { sessionToken: openedBefore.sessionToken, itemId: item.id },
        ANONYMOUS,
      )).toMatchObject({ assetId: item.assetId });
    }

    // The single act of withdrawal. No per-surface cleanup exists because the
    // surfaces all read the ledger.
    await revokeProjectConsent.call({ id: made.project.id }, OWNER);

    const after = await readSurfaces(made.slug, made.offering.id);
    expect(after.inSitemap).toBe(false);
    expect(after.inFeeds).toBe(false);
    expect(after.inBrowse).toBe(false);
    expect(after.inServiceProofs).toBe(false);
    // Structured data is derived through resolvePublicProject — the exact
    // query the public page builds its CreativeWork JSON-LD from — and it now
    // resolves to nothing, so no JSON-LD renders.
    expect(after.structured).toBeNull();
    const [page] = await db().select().from(pages).where(eq(pages.id, made.pageId));
    expect(page?.status).toBe("draft");

    // The gallery hides the frames from a fresh session and refuses direct
    // view and download by item id.
    const openedAfter = await unlockGallery.call(
      { slug: gallery.slug, secret: "2468" },
      ANONYMOUS,
    );
    expect(openedAfter.ok).toBe(true);
    if (!openedAfter.ok) throw new Error("expected the gallery to open");
    expect(openedAfter.items).toEqual([]);
    expect(
      await viewGalleryItem.call(
        { sessionToken: openedAfter.sessionToken, itemId: openedBefore.items[0]!.id },
        ANONYMOUS,
      ),
    ).toBeNull();
    const download = await failure(
      downloadGalleryItem.call(
        {
          sessionToken: openedAfter.sessionToken,
          itemId: openedBefore.items[0]!.id,
        },
        ANONYMOUS,
      ),
    );
    expect(download.code).toBe("not_found");

    // What withdrawal must not destroy: the grant stays on the record, and
    // capture provenance stays on the media.
    const state = await mediaConsentState.call(
      { subjectKind: "project", subjectId: made.project.id },
      OWNER,
    );
    expect(state.live).toBe(false);
    expect(state.reason).toBe("withdrawn");
    const history = await mediaConsentHistory.call(
      { subjectKind: "project", subjectId: made.project.id },
      OWNER,
    );
    expect(history).toHaveLength(2);
    expect(history.find((entry) => entry.state === "granted")?.method).toBe("written");
    const [kept] = await db().select().from(assets).where(eq(assets.id, made.before.id));
    expect(kept?.provenance).toEqual({
      captureSessionId: "capture-session-1",
      source: "camera",
    });
  });

  it("refuses to render even when publication flags are flipped back by hand", async () => {
    const made = await publishedCaseStudy();
    await revokeProjectConsent.call({ id: made.project.id }, OWNER);

    // Simulate the failure this gate exists for: something (a retry, a stale
    // worker, a direct write) puts the publication flags back while the
    // ledger says the permission is gone. Publication state is a cache of
    // consent state; the render paths must not trust the cache.
    await db()
      .update(projects)
      .set({ publicationStatus: "published", publishedAt: new Date("2026-09-01T00:00:00.000Z") })
      .where(eq(projects.id, made.project.id));
    await db()
      .update(pages)
      .set({ status: "published" })
      .where(eq(pages.id, made.pageId));

    const surfaces = await readSurfaces(made.slug, made.offering.id);
    expect(surfaces.inSitemap).toBe(false);
    expect(surfaces.structured).toBeNull();
    expect(surfaces.inBrowse).toBe(false);
    expect(surfaces.inServiceProofs).toBe(false);
    // The page render path itself refuses: the public route resolves through
    // `cms.resolvePage`, and the veto hides the page even with the flag back.
    const page = await getService("cms.resolvePage").call(
      { slug: `portfolio/${made.slug}`, locale: "en" },
      ANONYMOUS,
    );
    expect(page).toBeNull();

    const gallery = await createGallery.call(
      {
        contactId: made.clientId,
        title: "Progress",
        access: "pin",
        secret: "2468",
      },
      OWNER,
    );
    await addGalleryItem.call({ galleryId: gallery.id, assetId: made.after.id }, OWNER);
    const opened = await unlockGallery.call(
      { slug: gallery.slug, secret: "2468" },
      ANONYMOUS,
    );
    expect(opened.ok).toBe(true);
    if (!opened.ok) throw new Error("expected the gallery to open");
    expect(opened.items).toEqual([]);
  });

  it("keeps a packaged gallery offline while any of its items are unpublished", async () => {
    const made = await publishedCaseStudy();
    const standalone = await image("Standalone.jpg");
    const { storage } = await import("@/adapters/storage");
    await storage().put(made.before.storageKey, new TextEncoder().encode("BEFORE"), "image/jpeg");
    await storage().put(standalone.storageKey, new TextEncoder().encode("SOLO"), "image/jpeg");

    const gallery = await createGallery.call(
      {
        contactId: made.clientId,
        title: "Delivery",
        access: "pin",
        secret: "2468",
        downloadPolicy: "full_res",
      },
      OWNER,
    );
    await addGalleryItem.call({ galleryId: gallery.id, assetId: made.before.id }, OWNER);
    await addGalleryItem.call({ galleryId: gallery.id, assetId: standalone.id }, OWNER);

    const opened = await unlockGallery.call({ slug: gallery.slug, secret: "2468" }, ANONYMOUS);
    if (!opened.ok) throw new Error("expected the gallery to open");
    await requestGalleryArchive.call({ sessionToken: opened.sessionToken }, ANONYMOUS);
    const packaged = await buildGalleryArchive.call({ galleryId: gallery.id }, { kind: "system" });
    expect(packaged.state).toBe("ready");
    expect(packaged.fileCount).toBe(2);
    expect(
      await downloadGalleryArchive.call({ sessionToken: opened.sessionToken }, ANONYMOUS),
    ).not.toBeNull();

    await revokeProjectConsent.call({ id: made.project.id }, OWNER);

    // A bundle that may predate the withdrawal does not download, and
    // repackaging ships only what may still be shown.
    expect(
      await downloadGalleryArchive.call({ sessionToken: opened.sessionToken }, ANONYMOUS),
    ).toBeNull();
    const rebuilt = await buildGalleryArchive.call({ galleryId: gallery.id }, { kind: "system" });
    expect(rebuilt.state).toBe("ready");
    expect(rebuilt.fileCount).toBe(1);
  });
});

function t(key: string) {
  return key;
}

const ctx: BlockRenderContext = {
  locale: "en",
  t,
  business: null,
  path: "/portfolio/aligner-course",
};

const image: ResolvedImage = {
  src: "/media/week-0.webp",
  sources: [],
  width: 800,
  height: 600,
  altText: "Smile, week zero",
  focalX: 5000,
  focalY: 5000,
};

type MediaItem = {
  assetId: string;
  role: "hero" | "gallery" | "before" | "after" | "series" | "process" | "detail";
  pairKey: string | null;
  seriesKey: string | null;
  capturedAt: string | null;
  caption: string | null;
  position: number;
};

function frame(overrides: Partial<MediaItem>): { item: MediaItem; image: ResolvedImage } {
  return {
    item: {
      assetId: "11111111-1111-4111-8111-111111111111",
      role: "series",
      pairKey: null,
      seriesKey: "progress",
      capturedAt: "2026-07-01T00:00:00.000Z",
      caption: null,
      position: 0,
      ...overrides,
    },
    image: { ...image },
  };
}

function render(props: Record<string, unknown>, media: Array<ReturnType<typeof frame>>) {
  const parsed = projectCaseStudy.schema.parse({
    projectId: "22222222-2222-4222-8222-222222222222",
    summary: null,
    clientDisplayName: null,
    occurredOn: null,
    coverAssetId: null,
    featured: false,
    services: [],
    outcomes: [],
    media: [],
    testimonials: [],
    ...props,
  });
  return renderToStaticMarkup(
    createElement(projectCaseStudy.render, { props: parsed, resolved: { cover: null, media }, ctx }),
  );
}


describe("projectCaseStudy progress series rendering", () => {
  it("orders series frames by when they were taken, not how they were filed", () => {
    const html = render({}, [
      frame({ assetId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", caption: "Filed second, taken third", capturedAt: "2026-09-01T00:00:00.000Z" }),
      frame({ assetId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", caption: "Filed first, taken first", capturedAt: "2026-05-01T00:00:00.000Z" }),
      frame({ assetId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", caption: "Filed third, taken second", capturedAt: "2026-07-01T00:00:00.000Z" }),
    ]);
    expect(html).toContain("projects.public.progress");
    const order = [
      html.indexOf("taken first"),
      html.indexOf("taken second"),
      html.indexOf("taken third"),
    ];
    expect(order[0]).toBeGreaterThan(-1);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // Every frame carries its capture date in a machine-readable element.
    expect(html).toContain('<time dateTime="2026-05-01T00:00:00.000Z">2026-05-01</time>');
  });

  it("keeps pairs, series and loose media apart", () => {
    const html = render({}, [
      frame({
        assetId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        role: "before",
        pairKey: "smile",
        seriesKey: null,
        capturedAt: null,
        caption: "The before frame",
      }),
      frame({
        assetId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        role: "after",
        pairKey: "smile",
        seriesKey: null,
        capturedAt: null,
        caption: "The after frame",
      }),
      frame({ assetId: "ffffffff-ffff-4fff-8fff-ffffffffffff", caption: "A series frame" }),
      frame({
        assetId: "99999999-9999-4999-8999-999999999999",
        role: "detail",
        seriesKey: null,
        caption: "A loose detail",
      }),
    ]);
    // The pair lands in the comparison section with its role label.
    expect(html).toContain("projects.public.comparison");
    expect(html).toContain("projects.public.before");
    expect(html).toContain("projects.public.after");
    // The series frame is not filed as a loose image and the loose image is
    // not pulled into the series.
    const looseList = html.slice(html.indexOf('<ul class="grid list-none'));
    expect(looseList).toContain("A loose detail");
    expect(looseList).not.toContain("A series frame");
  });

  it("parses snapshots published before series existed", () => {
    // Snapshots already live in page rows from before the series role: media
    // entries without series metadata must still validate and render.
    const legacy = {
      assetId: "77777777-7777-4777-8777-777777777777",
      role: "gallery",
      pairKey: null,
      caption: "Legacy frame",
      position: 3,
    };
    const parsed = projectCaseStudy.schema.parse({
      projectId: "22222222-2222-4222-8222-222222222222",
      media: [legacy],
    });
    expect(parsed.media[0]).toMatchObject({ seriesKey: null, capturedAt: null });
    const [legacyFrame] = parsed.media;
    const html = render(
      {},
      legacyFrame ? [{ item: legacyFrame, image: { ...image } }] : [],
    );
    expect(html).toContain("Legacy frame");
  });
});
