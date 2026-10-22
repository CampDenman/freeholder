// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.29: the gallery page builder groups like the branch index, stays inside
// the page budgets (C2.22) and produces stable node ids so re-runs converge.
import { describe, expect, it } from "vitest";
import {
  buildPages,
  type GalleryPage,
  type GalleryShot,
} from "../../scripts/screenshots-gallery.mjs";

const VARIANTS = ["desktop--light", "desktop--dark", "mobile--light", "mobile--dark"];

function shot(slug: string, role: GalleryShot["role"], title: string = slug): GalleryShot {
  return {
    route: `/${slug}`,
    url: `/${slug}`,
    role,
    title,
    slug,
    files: VARIANTS.map((variant) => `${slug}--${variant}.webp`),
  };
}

const assetFor = (file: string) => `asset-${file}`;

function galleryItems(page: GalleryPage) {
  const galleries = page.blocks.filter((block) => block.type === "gallery");
  return {
    count: galleries.length,
    items: galleries.flatMap(
      (block) => block.props.items as { assetId: string; caption: string }[],
    ),
  };
}

describe("screenshots gallery page builder (C3.29)", () => {
  it("groups shots the way the branch index does", () => {
    const shots = [
      shot("journey-book", "customer"),
      shot("pricing", "public"),
      shot("portal-invoices", "customer"),
      shot("admin-media", "owner"),
    ];
    const pages = buildPages(shots, assetFor, { capturedAt: "2026-10-16", commit: "abc" });
    const slugs = pages.map((page) => page.slug);
    expect(slugs).toEqual([
      "screenshots",
      "screenshots/journey",
      "screenshots/public",
      "screenshots/portal",
      "screenshots/admin",
    ]);
    expect(pages[0]?.title).toBe("Screenshots");
  });

  it("lays one shot out as heading, route and a four-variant gallery", () => {
    const page = buildPages([shot("pricing", "public", "Pricing")], assetFor, {})
      .find((candidate) => candidate.slug === "screenshots/public");
    const [h1, heading, text] = page?.blocks ?? [];
    expect(h1).toMatchObject({ id: "h1", type: "heading", props: { text: "Public site screenshots", level: 1 } });
    expect(heading).toMatchObject({ id: "h-pricing", type: "heading", props: { text: "Pricing", level: 2 } });
    expect(text).toMatchObject({ type: "text", props: { body: "/pricing" } });
    const { count, items } = galleryItems(page!);
    expect(count).toBe(1);
    expect(items).toHaveLength(4);
    expect(items[0]).toEqual({
      assetId: "asset-pricing--desktop--light.webp",
      caption: "Desktop, light",
    });
    expect(items[3]?.caption).toBe("Mobile, dark");
  });

  it("chunks groups past the page image budget into numbered pages", () => {
    const shots = Array.from({ length: 25 }, (_, i) => shot(`admin-page-${i}`, "owner"));
    const pages = buildPages(shots, assetFor, {});
    const admin = pages.filter((page) => page.slug.startsWith("screenshots/admin"));
    expect(admin.map((page) => page.slug)).toEqual(["screenshots/admin", "screenshots/admin-2"]);
    expect(galleryItems(admin[0]!).count).toBe(24);
    expect(galleryItems(admin[1]!).count).toBe(1);
    expect(admin[1]?.title).toBe("Admin screenshots (2 of 2)");
  });

  it("keeps seo fields inside their budgets and node ids stable", () => {
    const shots = [shot("a-very-long-public-page-title-that-keeps-going-and-going", "public")];
    const pages = buildPages(shots, assetFor, { commit: "deadbeefcafe" });
    for (const page of pages) {
      expect(page.seo.title.length).toBeLessThanOrEqual(60);
      expect(page.seo.description.length).toBeLessThanOrEqual(155);
      const ids = page.blocks.map((block) => block.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
    expect(buildPages(shots, assetFor, { commit: "deadbeefcafe" })).toEqual(pages);
  });
});
