// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import type { BlockNode } from "@/modules/cms/blocks/types";
import * as dental from "../../seed/dental/content";
import * as hvac from "../../seed/hvac/content";
import * as plumber from "../../seed/plumber/content";
import * as electrical from "../../seed/electrical/content";
import * as restaurant from "../../seed/restaurant/content";
import * as florist from "../../seed/florist/content";
import * as hotel from "../../seed/hotel/content";
import * as roofing from "../../seed/roofing/content";
import * as mortgage from "../../seed/mortgage/content";
import * as wealth from "../../seed/wealth-management/content";
import * as grocery from "../../seed/grocery-market/content";
import * as news from "../../seed/news-media/content";
import * as newspaper from "../../seed/newspaper/content";
import * as vc from "../../seed/venture-capital/content";
import * as realty from "../../seed/real-estate/content";
import * as general from "../../seed/general-business/content";

type Pack = typeof dental;

const hops = (slug: string) => (slug === "" ? 0 : slug.split("/").length);

function walk(nodes: BlockNode[], visit: (node: BlockNode) => void): void {
  for (const node of nodes) {
    visit(node);
    if (node.children) walk(node.children, visit);
  }
}

function assertPack(
  pack: Pack,
  expected: {
    name: string;
    schemaType: string;
    slugs: string[];
    forbidden: string[];
  },
) {
  const ids = Object.fromEntries(
    Object.keys(pack.IMAGES).map((k) => [k, "00000000-0000-4000-8000-000000000001"]),
  ) as Record<keyof typeof pack.IMAGES, string>;
  const seedText = JSON.stringify({
    BUSINESS: pack.BUSINESS,
    PAGES: pack.PAGES.map((p) => ({
      slug: p.slug,
      title: p.title,
      seo: p.seo,
      blocks: p.blocks(ids),
    })),
    FORMS: pack.FORMS,
  }).toLowerCase();

  it(`${expected.name} stays within three hops`, () => {
    for (const page of pack.PAGES) {
      expect(hops(page.slug)).toBeLessThanOrEqual(3);
    }
  });

  it(`${expected.name} has unique slugs, titles, and descriptions`, () => {
    const slugs = pack.PAGES.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    const titles = pack.PAGES.map((p) => p.seo.title ?? p.title);
    expect(new Set(titles).size).toBe(titles.length);
    for (const page of pack.PAGES) {
      expect(page.seo.description ?? "").not.toBe("");
      expect((page.seo.title ?? page.title).length).toBeLessThanOrEqual(60);
      expect((page.seo.description ?? "").length).toBeLessThanOrEqual(155);
    }
  });

  it(`${expected.name} has one H1 per page and described images`, () => {
    for (const page of pack.PAGES) {
      let h1 = 0;
      walk(page.blocks(ids), (node) => {
        if (node.type === "heading" && (node.props as { level?: number }).level === 1) h1 += 1;
      });
      expect({ slug: page.slug, h1 }).toEqual({ slug: page.slug, h1: 1 });
    }
    for (const image of Object.values(pack.IMAGES)) {
      expect(image.alt.length).toBeGreaterThan(20);
      expect(image.alt.toLowerCase()).not.toContain(".jpg");
    }
  });

  it(`${expected.name} links only to pages that exist`, () => {
    const known = new Set(pack.PAGES.map((p) => `/${p.slug}`.replace(/\/$/, "") || "/"));
    for (const page of pack.PAGES) {
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

  it(`${expected.name} is placeholder identity without NVC fiction`, () => {
    for (const phrase of expected.forbidden) {
      expect(seedText).not.toContain(phrase);
    }
    expect(pack.BUSINESS.name).toBe(expected.name);
    expect(pack.BUSINESS.schemaType).toBe(expected.schemaType);
    expect(pack.TRANSLATIONS).toEqual([]);
    const slugs = new Set(pack.PAGES.map((page) => page.slug));
    for (const slug of expected.slugs) {
      expect(slugs.has(slug)).toBe(true);
    }
  });
}

describe("remaining WeVibeSites catalog seeds", () => {
  assertPack(dental, {
    name: "Your Dental Practice",
    schemaType: "Dentist",
    slugs: ["", "services", "providers", "gallery", "book", "emergency", "insurance", "twin", "contact"],
    forbidden: ["new vibe city", "crestline dental", "marcus webb", "nvc_mode"],
  });
  assertPack(hvac, {
    name: "Your HVAC Company",
    schemaType: "HVACBusiness",
    slugs: ["", "services", "estimate", "emergency", "plans", "areas", "twin", "contact"],
    forbidden: ["new vibe city", "polaris heating", "nvc_mode"],
  });
  assertPack(plumber, {
    name: "Your Plumbing Company",
    schemaType: "Plumber",
    slugs: ["", "services", "estimate", "emergency", "areas", "twin", "contact"],
    forbidden: ["new vibe city", "vitale plumbing", "nvc_mode"],
  });
  assertPack(electrical, {
    name: "Your Electrical Company",
    schemaType: "ElectricalContractor",
    slugs: ["", "services", "estimate", "emergency", "areas", "twin", "contact"],
    forbidden: ["new vibe city", "arcwell electric", "volt & lumen", "nvc_mode"],
  });
  assertPack(restaurant, {
    name: "Your Restaurant",
    schemaType: "Restaurant",
    slugs: ["", "menu", "reservations", "order", "events", "twin", "contact"],
    forbidden: ["new vibe city", "ember & salt", "ember and salt", "nvc_mode"],
  });
  assertPack(florist, {
    name: "Your Flower Shop",
    schemaType: "Florist",
    slugs: ["", "shop", "weddings", "delivery", "gallery", "twin", "contact"],
    forbidden: ["new vibe city", "lily & bloom", "lily and bloom", "nvc_mode"],
  });
  assertPack(hotel, {
    name: "Your Inn",
    schemaType: "Hotel",
    slugs: ["", "rooms", "reserve", "packages", "events", "twin", "contact"],
    forbidden: ["new vibe city", "the wren house", "nvc_mode"],
  });
  assertPack(roofing, {
    name: "Your Roofing Company",
    schemaType: "RoofingContractor",
    slugs: ["", "services", "estimate", "storm", "projects", "twin", "contact"],
    forbidden: ["new vibe city", "summit roofing", "nvc_mode"],
  });
  assertPack(mortgage, {
    name: "Your Mortgage Team",
    schemaType: "FinancialService",
    slugs: ["", "programs", "rates", "calculator", "apply", "twin", "contact"],
    forbidden: ["new vibe city", "apex home lending", "bobby lim", "nvc_mode"],
  });
  assertPack(wealth, {
    name: "Your Wealth Practice",
    schemaType: "FinancialService",
    slugs: ["", "services", "advisors", "fit", "discovery", "twin", "contact"],
    forbidden: ["new vibe city", "meridian wealth", "charlotte westbrook", "nvc_mode"],
  });
  assertPack(grocery, {
    name: "Your Market",
    schemaType: "GroceryStore",
    slugs: ["", "departments", "specials", "pickup", "twin", "contact"],
    forbidden: ["new vibe city", "nvc market", "nvc_mode"],
  });
  assertPack(news, {
    name: "Your Newsroom",
    schemaType: "NewsMediaOrganization",
    slugs: ["", "sections", "staff", "tips", "corrections", "twin", "contact"],
    forbidden: ["new vibe city", "nvc news", "nvc gazette", "nvc_mode"],
  });
  assertPack(newspaper, {
    name: "Your Gazette",
    schemaType: "NewsMediaOrganization",
    slugs: ["", "today", "archive", "obituaries", "subscribe", "twin", "contact"],
    forbidden: ["new vibe city", "nvc gazette", "the new vibe city gazette", "nvc_mode"],
  });
  assertPack(vc, {
    name: "Your Fund",
    schemaType: "InvestmentFund",
    slugs: ["", "thesis", "portfolio", "team", "submit", "twin", "contact"],
    forbidden: ["new vibe city", "nvc ventures", "nvc_mode"],
  });
  assertPack(realty, {
    name: "Your Real Estate Team",
    schemaType: "RealEstateAgent",
    slugs: ["", "buy", "sell", "agents", "valuation", "twin", "contact"],
    forbidden: ["new vibe city", "calloway group", "tanya okafor", "nvc_mode"],
  });
  assertPack(general, {
    name: "Your Company",
    schemaType: "ProfessionalService",
    slugs: ["", "capabilities", "team", "work", "contact", "twin"],
    forbidden: ["new vibe city", "hargrove & associates", "nvc_mode"],
  });
});
