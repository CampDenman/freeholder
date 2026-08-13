// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The demo business (MASTER.md §3, §15.2, §25).
//
// Two different things are under test here, and the second is the reason this
// file matters more than a seeding script usually would.
//
// The first is that installing works and is safe to leave switched on.
//
// The second is that the *content itself* obeys §5. §15.2's SEO gate will
// crawl this site to prove the doctrine holds; a demo that quietly fails the
// doctrine would turn that gate into a green tick that checks nothing. So the
// checkable half of §5 is asserted against the seed directly — one H1 per
// page, a title and description everywhere, every image described, nothing
// more than three hops from the root — and it is asserted here, where a
// failure names the page, rather than in a crawler where it names a URL.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/core/db";
import { resetEnvForTests } from "@/core/env";
import { assets } from "@/core/media/schema";
import { pages } from "@/modules/cms/schema";
import {
  demoSeedMode,
  seedDemoIfRequested,
} from "@/modules/seed/boot";
import { installDemo } from "@/modules/seed/service";
import { resolvePage, getSection, publishedPaths } from "@/modules/cms/service";
import {
  getBusiness,
  setupState,
  updateBusiness,
} from "@/core/settings/service";
import { FOOTER_KEY, HEADER_KEY } from "@/modules/cms/defaults";
import { PAGES, IMAGES, BUSINESS, LOCATION } from "../../seed/demo/content";
import type { BlockNode } from "@/modules/cms/blocks/types";
import {
  ANONYMOUS,
  closeDb,
  failure,
  hasDatabase,
  OWNER,
  STAFF,
  truncateSpine,
} from "../helpers/spine";

/** Depth in the browse hierarchy: "" is 0, "services/weddings" is 2. */
const hops = (slug: string) => (slug === "" ? 0 : slug.split("/").length);

function walk(nodes: BlockNode[], visit: (node: BlockNode) => void): void {
  for (const node of nodes) {
    visit(node);
    if (node.children) walk(node.children, visit);
  }
}

async function withEnvironment<T>(
  overrides: Record<string, string | undefined>,
  body: () => Promise<T>,
): Promise<T> {
  const previous = Object.fromEntries(
    Object.keys(overrides).map((key) => [key, process.env[key]]),
  );
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetEnvForTests();
  try {
    return await body();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetEnvForTests();
  }
}

describe("the demo boot policy", () => {
  it("defaults on only in development and obeys both explicit overrides", () => {
    expect(
      demoSeedMode({ NODE_ENV: "development", FREEHOLDER_SEED_DEMO: undefined }),
    ).toBe("development");
    expect(
      demoSeedMode({ NODE_ENV: "test", FREEHOLDER_SEED_DEMO: undefined }),
    ).toBe("disabled");
    expect(
      demoSeedMode({ NODE_ENV: "production", FREEHOLDER_SEED_DEMO: undefined }),
    ).toBe("disabled");
    expect(
      demoSeedMode({ NODE_ENV: "development", FREEHOLDER_SEED_DEMO: "0" }),
    ).toBe("disabled");
    expect(
      demoSeedMode({ NODE_ENV: "production", FREEHOLDER_SEED_DEMO: "1" }),
    ).toBe("requested");
  });
});

describe("the demo content, before anything installs it", () => {
  // These hold whether or not a database is present: the content is data, and
  // a contributor editing copy should get told off by a fast unit test rather
  // than by CI ten minutes later.

  it("keeps every page within three hops of the root (§5 RIBA)", () => {
    for (const page of PAGES) {
      expect({ slug: page.slug, hops: hops(page.slug) }).toEqual({
        slug: page.slug,
        hops: expect.any(Number) as number,
      });
      expect(hops(page.slug)).toBeLessThanOrEqual(3);
    }
  });

  it("gives every page a unique slug, title and description", () => {
    const slugs = PAGES.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);

    const titles = PAGES.map((p) => p.seo.title ?? p.title);
    expect(new Set(titles).size).toBe(titles.length);

    for (const page of PAGES) {
      // §5 wants a unique title and description on every page. The lengths are
      // the ones search results actually truncate at.
      expect(page.seo.description ?? "").not.toBe("");
      expect((page.seo.title ?? page.title).length).toBeLessThanOrEqual(60);
      expect((page.seo.description ?? "").length).toBeLessThanOrEqual(155);
    }
  });

  it("puts exactly one H1 on each page", () => {
    const ids = Object.fromEntries(
      Object.keys(IMAGES).map((k) => [k, "00000000-0000-4000-8000-000000000000"]),
    ) as Record<keyof typeof IMAGES, string>;

    for (const page of PAGES) {
      let h1 = 0;
      walk(page.blocks(ids), (node) => {
        if (node.type === "heading" && (node.props as { level?: number }).level === 1) h1 += 1;
      });
      expect({ slug: page.slug, h1 }).toEqual({ slug: page.slug, h1: 1 });
    }
  });

  it("describes every image, in words that describe it", () => {
    for (const [slot, image] of Object.entries(IMAGES)) {
      expect(image.alt.length).toBeGreaterThan(20);
      // "photo", "image1.jpg" and the filename itself are alt text that passes
      // a gate and helps nobody.
      expect(image.alt.toLowerCase()).not.toContain(".jpg");
      expect({ slot, alt: image.alt }).toEqual({ slot, alt: expect.any(String) as string });
    }
  });

  it("links only to pages that exist", () => {
    const known = new Set(PAGES.map((p) => `/${p.slug}`.replace(/\/$/, "") || "/"));
    const ids = Object.fromEntries(
      Object.keys(IMAGES).map((k) => [k, "00000000-0000-4000-8000-000000000000"]),
    ) as Record<keyof typeof IMAGES, string>;

    for (const page of PAGES) {
      walk(page.blocks(ids), (node) => {
        if (node.type !== "button") return;
        const href = (node.props as { href: string }).href;
        if (href.startsWith("http") || href.startsWith("mailto:")) return;
        expect({ from: page.slug, href, exists: known.has(href) }).toEqual({
          from: page.slug,
          href,
          exists: true,
        });
      });
    }
  });
});

describe.runIf(hasDatabase)("installing the demo", () => {
  beforeEach(async () => {
    await truncateSpine();
  });

  afterAll(async () => {
    await closeDb();
  });

  it(
    "boots a complete demo on a pristine development database",
    async () => {
      const outcome = await withEnvironment(
        { NODE_ENV: "development", FREEHOLDER_SEED_DEMO: undefined },
        () => seedDemoIfRequested(),
      );

      expect(outcome.status).toBe("installed");
      expect(await resolvePage.call({ slug: "" }, ANONYMOUS)).toEqual(
        expect.objectContaining({ title: BUSINESS.name, status: "published" }),
      );
      expect(await getSection.call({ key: HEADER_KEY }, ANONYMOUS)).not.toBeNull();
      expect(await getSection.call({ key: FOOTER_KEY }, ANONYMOUS)).not.toBeNull();
      expect(await setupState.call({}, ANONYMOUS)).toEqual({
        hasOwner: false,
        hasBusiness: true,
        completed: true,
      });

      const restart = await withEnvironment(
        { NODE_ENV: "development", FREEHOLDER_SEED_DEMO: "1" },
        () => seedDemoIfRequested(),
      );
      expect(restart).toEqual({ status: "already-populated" });
    },
    30_000,
  );

  it("lets development opt out without writing any content", async () => {
    const outcome = await withEnvironment(
      { NODE_ENV: "development", FREEHOLDER_SEED_DEMO: "0" },
      () => seedDemoIfRequested(),
    );

    expect(outcome).toEqual({ status: "skipped", reason: "disabled" });
    expect(await resolvePage.call({ slug: "" }, ANONYMOUS)).toBeNull();
    expect(await getBusiness.call({}, ANONYMOUS)).toBeNull();
  });

  it("does not overwrite development setup work that has no page yet", async () => {
    await updateBusiness.call(
      { ...BUSINESS, name: "Work in progress" },
      OWNER,
    );

    const outcome = await withEnvironment(
      { NODE_ENV: "development", FREEHOLDER_SEED_DEMO: undefined },
      () => seedDemoIfRequested(),
    );

    expect(outcome).toEqual({
      status: "skipped",
      reason: "development-not-pristine",
    });
    expect((await getBusiness.call({}, ANONYMOUS))?.name).toBe("Work in progress");
    expect(await resolvePage.call({ slug: "" }, ANONYMOUS)).toBeNull();
  });

  it("produces a whole site an owner could have made by hand", async () => {
    const result = await installDemo.call({ publish: true }, OWNER);

    expect(result.business).toBe(BUSINESS.name);
    expect(result.pages).toContain("");
    expect(result.pages).toContain("services/weddings");

    // The business the demo describes, not the placeholder any instance gets.
    const business = await getBusiness.call({}, ANONYMOUS);
    expect(business?.schemaType).toBe("Photographer");
    expect(business?.timezone).toBe("America/Vancouver");
    expect(business?.setupCompletedAt).toBeTruthy();

    // Chrome, so the first page rendered has a nav rather than a bare column.
    expect(await getSection.call({ key: HEADER_KEY }, ANONYMOUS)).toBeTruthy();
    expect(await getSection.call({ key: FOOTER_KEY }, ANONYMOUS)).toBeTruthy();

    // Published, because a sitemap of drafts is not a demo of anything.
    // The demo's own pages, plus the two the location earned: §4.10 gives a
    // location a page and an index, and it gets them through the event bus
    // rather than through the seed writing them — so this assertion is also
    // the proof that path is wired up end to end.
    const paths = await publishedPaths.call({ locale: "en" }, STAFF);
    expect(paths.map((p: { slug: string }) => p.slug).sort()).toEqual(
      [...PAGES.map((p) => p.slug), "locations", `locations/${LOCATION.slug}`].sort(),
    );
  });

  it("builds real images with real renditions", async () => {
    // The images are generated rather than committed, so this is also the
    // check that generation produced something sharp could actually read.
    await installDemo.call({ publish: true }, OWNER);

    const rows = await db().select().from(assets);
    expect(rows).toHaveLength(Object.keys(IMAGES).length);
    for (const asset of rows) {
      expect(asset.width).toBe(1600);
      expect(asset.altText ?? "").not.toBe("");
      // AVIF and WebP at several widths — the §36 performance promise.
      expect(Object.keys(asset.variants as object).length).toBeGreaterThan(0);
    }
  });

  it("puts the images on the pages, resolved", async () => {
    await installDemo.call({ publish: true }, OWNER);
    const home = await resolvePage.call({ slug: "", locale: "en" }, ANONYMOUS);

    let imageBlocks = 0;
    walk(home!.blocks as BlockNode[], (node) => {
      if (node.type !== "image") return;
      imageBlocks += 1;
      // A page written with a dangling assetId renders a hole rather than
      // failing, which is exactly the kind of thing a demo hides.
      expect((node.props as { assetId?: string }).assetId).toMatch(/^[0-9a-f-]{36}$/);
    });
    expect(imageBlocks).toBeGreaterThan(0);
  });

  it("refuses to install over a site that already has pages", async () => {
    await installDemo.call({ publish: true }, OWNER);
    const error = await failure(installDemo.call({ publish: true }, OWNER));
    expect(error.code).toBe("conflict");
    expect(error.message).toContain("already has pages");

    // And it refused *before* writing anything: no duplicate pages, no second
    // set of images.
    const rows = await db().select().from(pages);
    expect(rows).toHaveLength(PAGES.length + 2); // + the location and its index
    expect(await db().select().from(assets)).toHaveLength(
      Object.keys(IMAGES).length,
    );
  });

  it("requires demo manage access", async () => {
    const error = await failure(
      installDemo.call(
        { publish: true },
        { ...STAFF, grants: [{ module: "demo", access: "view" }] },
      ),
    );
    expect(error.code).toBe("permission");
  });
});
