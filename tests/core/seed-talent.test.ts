// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { FORMS, IMAGES, PAGES, TRANSLATIONS, BUSINESS } from "../../seed/talent/content";
import type { BlockNode } from "@/modules/cms/blocks/types";

const hops = (slug: string) => (slug === "" ? 0 : slug.split("/").length);

function walk(nodes: BlockNode[], visit: (node: BlockNode) => void): void {
  for (const node of nodes) {
    visit(node);
    if (node.children) walk(node.children, visit);
  }
}

const forbidden = [
  "marlowe kensington",
  "the glass veil",
  "ambyr childers",
  "new vibe city",
  "quiet strength. bright fire",
  "symbolic adornment",
  "rise society",
  "inner circle membership",
  "duskfall",
  "nvc_mode",
];

describe("the talent seed content", () => {
  const ids = Object.fromEntries(
    Object.keys(IMAGES).map((k) => [k, "00000000-0000-4000-8000-000000000001"]),
  ) as Record<keyof typeof IMAGES, string>;
  const seedText = JSON.stringify({
    BUSINESS,
    PAGES: PAGES.map((p) => ({
      slug: p.slug,
      title: p.title,
      seo: p.seo,
      blocks: p.blocks(ids),
    })),
    FORMS,
  }).toLowerCase();

  it("keeps every page within three hops of the root", () => {
    for (const page of PAGES) {
      expect(hops(page.slug)).toBeLessThanOrEqual(3);
    }
  });

  it("gives every page a unique slug, title and description", () => {
    const slugs = PAGES.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    const titles = PAGES.map((p) => p.seo.title ?? p.title);
    expect(new Set(titles).size).toBe(titles.length);
    for (const page of PAGES) {
      expect(page.seo.description ?? "").not.toBe("");
      expect((page.seo.title ?? page.title).length).toBeLessThanOrEqual(60);
      expect((page.seo.description ?? "").length).toBeLessThanOrEqual(155);
    }
  });

  it("puts exactly one H1 on each page", () => {
    for (const page of PAGES) {
      let h1 = 0;
      walk(page.blocks(ids), (node) => {
        if (node.type === "heading" && (node.props as { level?: number }).level === 1) h1 += 1;
      });
      expect({ slug: page.slug, h1 }).toEqual({ slug: page.slug, h1: 1 });
    }
  });

  it("describes every image", () => {
    for (const image of Object.values(IMAGES)) {
      expect(image.alt.length).toBeGreaterThan(20);
      expect(image.alt.toLowerCase()).not.toContain(".jpg");
    }
  });

  it("links only to pages that exist", () => {
    const known = new Set(PAGES.map((p) => `/${p.slug}`.replace(/\/$/, "") || "/"));
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

  it("ships inquiry that does not book or take payment", () => {
    const inquire = FORMS.find((form) => form.slug === "inquire");
    expect(inquire).toBeTruthy();
    expect(inquire?.successMessage.toLowerCase()).toContain("does not book");
  });

  it("contains no Actor or New Vibe City fiction", () => {
    for (const phrase of forbidden) {
      expect(seedText).not.toContain(phrase);
    }
    expect(BUSINESS.name).toBe("Your name");
    expect(BUSINESS.schemaType).toBe("Person");
    expect(TRANSLATIONS).toEqual([]);
  });

  it("covers the edition surfaces WeVibeSites certified", () => {
    const slugs = new Set(PAGES.map((page) => page.slug));
    for (const slug of ["", "about", "work", "press", "inquire", "shop", "podcast", "membership", "book", "twin", "contact"]) {
      expect(slugs.has(slug)).toBe(true);
    }
  });
});
