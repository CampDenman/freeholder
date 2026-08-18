// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The SEO layer (MASTER.md §5).
//
// §5 says CI should fail on violations "where checkable", and the full crawl
// gate (§15.2) needs a seeded demo site that does not exist yet. These are the
// pieces that are checkable now: the structured data a page emits, the sitemap
// assembled from module manifests, and the promise that a renamed page does
// not break every link to it.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "../../proxy";
import {
  breadcrumbJsonLd,
  humanizeSegment,
  organizationJsonLd,
  websiteJsonLd,
} from "@/core/seo/jsonld";
import {
  chunkSitemapEntries,
  collectSitemapEntries,
  localeSitemapHrefs,
  renderRobots,
  renderSitemap,
  renderSitemapIndex,
} from "@/core/seo/sitemap";
import { listRedirects, resolveRedirect } from "@/core/seo/service";
import { createPage, publishPage, updatePage } from "@/modules/cms/service";
import {
  ANONYMOUS,
  closeDb,
  hasDatabase,
  STAFF,
  truncateSpine,
} from "../helpers/spine";

const BUSINESS = {
  name: "Aurora Coast Photography",
  tagline: "Coastal light, honestly made",
  schemaType: "Photographer",
  baseCurrency: "CAD",
};

describe("structured data", () => {
  it("describes the site and the business on the home page", () => {
    const site = websiteJsonLd("https://example.test", BUSINESS);
    expect(site).toMatchObject({
      "@type": "WebSite",
      name: BUSINESS.name,
      url: "https://example.test/",
    });

    // §13 calls the owner's schema.org choice "identity, not decoration" — a
    // Photographer and a HairSalon must emit genuinely different types.
    const org = organizationJsonLd("https://example.test", BUSINESS);
    expect(org["@type"]).toBe("Photographer");
    expect(
      organizationJsonLd("https://example.test", {
        ...BUSINESS,
        schemaType: "HairSalon",
      })["@type"],
    ).toBe("HairSalon");
  });

  it("emits no breadcrumb on the home page", () => {
    expect(breadcrumbJsonLd("https://example.test", "", () => "x")).toBeUndefined();
  });

  it("builds a trail that matches the URL", () => {
    // Under RIBA the path *is* the hierarchy, so a breadcrumb that disagreed
    // with the URL would describe a different site than the one people walk.
    const crumb = breadcrumbJsonLd(
      "https://example.test",
      "services/weddings",
      (segment) => (segment === "" ? "Home" : humanizeSegment(segment.split("/").pop()!)),
    )!;
    expect(crumb["@type"]).toBe("BreadcrumbList");
    expect(crumb.itemListElement).toEqual([
      { "@type": "ListItem", position: 1, name: "Home", item: "https://example.test/" },
      {
        "@type": "ListItem",
        position: 2,
        name: "Services",
        item: "https://example.test/services",
      },
      {
        "@type": "ListItem",
        position: 3,
        name: "Weddings",
        item: "https://example.test/services/weddings",
      },
    ]);
  });
});

describe("robots and sitemaps", () => {
  it("keeps crawlers out of the owner's private surfaces", () => {
    const robots = renderRobots("https://example.test");
    for (const path of [
      "/admin",
      "/login",
      "/preview",
      "/portal",
      "/api/",
      "/checkout",
      "/cart",
    ]) {
      expect(robots).toContain(`Disallow: ${path}`);
    }
    expect(robots).toContain("Disallow: /*?*filter=");
    expect(robots).toContain("Sitemap: https://example.test/sitemap.xml");
  });

  it("renders the home page as a bare origin, not a doubled slash", () => {
    const xml = renderSitemap("https://example.test", [
      { slug: "", updatedAt: new Date("2026-08-02T10:00:00Z"), priority: 1 },
      { slug: "about", priority: 0.5 },
    ]);
    expect(xml).toContain("<loc>https://example.test/</loc>");
    expect(xml).toContain("<loc>https://example.test/about</loc>");
    expect(xml).toContain("<lastmod>2026-08-02</lastmod>");
    expect(xml).toContain("<priority>1.0</priority>");
    expect(xml).toContain("<priority>0.5</priority>");
    expect(xml).not.toContain("//about");
  });

  it("escapes characters that would break the XML", () => {
    const xml = renderSitemap("https://example.test", [{ slug: "a&b" }]);
    expect(xml).toContain("a&amp;b");
  });

  it("indexes one sitemap per locale", () => {
    const xml = renderSitemapIndex("https://example.test", ["en", "fr"]);
    expect(xml).toContain("https://example.test/sitemap-en.xml");
    expect(xml).toContain("https://example.test/sitemap-fr.xml");
  });

  it("splits a locale map at 50,000 URLs and keeps a small site on one file", () => {
    const one = localeSitemapHrefs("https://example.test", "en", 12);
    expect(one).toEqual(["https://example.test/sitemap-en.xml"]);

    const many = localeSitemapHrefs("https://example.test", "en", 50_001);
    expect(many).toEqual([
      "https://example.test/sitemap-en-1.xml",
      "https://example.test/sitemap-en-2.xml",
    ]);

    const chunks = chunkSitemapEntries(
      [{ slug: "a" }, { slug: "b" }, { slug: "c" }],
      2,
    );
    expect(chunks).toEqual([[{ slug: "a" }, { slug: "b" }], [{ slug: "c" }]]);
  });
});

describe("the address a crawler asks for", () => {
  // The route behind this is `/sitemaps/[locale]`, because Next matches a
  // dynamic segment and never a dynamic part of one. The build was perfectly
  // happy with a `sitemap-[locale].xml` folder and the URL still 404'd, which
  // is why the published address is asserted here rather than the route.
  const rewriteOf = (path: string): string | null => {
    const response = proxy(
      new NextRequest(new URL(`https://example.test${path}`)),
    );
    const destination = response.headers.get("x-middleware-rewrite");
    if (!destination) return null;
    const url = new URL(destination);
    return `${url.pathname}${url.search}`;
  };

  it("routes the name in robots.txt to the route that answers it", () => {
    expect(rewriteOf("/sitemap-en.xml")).toBe("/sitemaps/en");
    expect(rewriteOf("/sitemap-fr-CA.xml")).toBe("/sitemaps/fr-CA");
  });

  it("splits a locale sitemap that has crossed 50,000 URLs", () => {
    expect(rewriteOf("/sitemap-en-2.xml")).toBe("/sitemaps/en?chunk=2");
    expect(rewriteOf("/sitemap-fr-CA-2.xml")).toBe("/sitemaps/fr-CA?chunk=2");
  });

  it("rewrites the IndexNow key file and entity feeds to their routes", () => {
    expect(rewriteOf("/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.txt")).toBe("/indexnow-key");
    expect(rewriteOf("/feeds/products.xml")).toBe("/feeds/products");
    expect(rewriteOf("/feeds/locations.xml")).toBe("/feeds/locations");
  });

  it("leaves everything else alone", () => {
    expect(rewriteOf("/sitemap.xml")).toBeNull();
    expect(rewriteOf("/about")).toBeNull();
    expect(rewriteOf("/llms.txt")).toBeNull();
    expect(rewriteOf("/sitemap-en.xml/../admin")).toBeNull();
  });
});

describe.runIf(hasDatabase)("the sitemap, assembled from the modules", () => {
  beforeEach(async () => {
    await truncateSpine();
  });

  it("collects what every module declared, and only what is published", async () => {
    const live = await createPage.call(
      {
        slug: "about",
        title: "About",
        blocks: [{ id: "h", type: "heading", props: { text: "About", level: 1 } }],
      },
      STAFF,
    );
    await publishPage.call({ id: live.id, published: true }, STAFF);
    await createPage.call({ slug: "draft", title: "Draft" }, STAFF);

    // cms named `cms.publishedPaths` in its manifest; nothing here knows what
    // a page is.
    const entries = await collectSitemapEntries("en");
    expect(entries.map((entry) => entry.slug)).toEqual(["about"]);
  });
});

describe.runIf(hasDatabase)("renaming a page", () => {
  beforeEach(async () => {
    await truncateSpine();
  });

  afterAll(async () => {
    await closeDb();
  });

  it("leaves a redirect behind, without being asked", async () => {
    // §5: "slugs never silently break". An owner renaming a page has not asked
    // for a redirect and should not have to.
    const page = await createPage.call(
      { slug: "old-name", title: "A page" },
      STAFF,
    );
    await updatePage.call({ id: page.id, slug: "new-name" }, STAFF);

    const moved = await resolveRedirect.call({ path: "old-name" }, ANONYMOUS);
    expect(moved).toMatchObject({ toPath: "new-name", status: "301" });

    const all = await listRedirects.call({}, STAFF);
    expect(all).toHaveLength(1);
    expect(all[0]!.source).toBe("slug-change");
  });

  it("follows a chain when a page is renamed twice", async () => {
    const page = await createPage.call({ slug: "one", title: "P" }, STAFF);
    await updatePage.call({ id: page.id, slug: "two" }, STAFF);
    await updatePage.call({ id: page.id, slug: "three" }, STAFF);

    // Someone holding the very first link still arrives at the page.
    expect(
      await resolveRedirect.call({ path: "one" }, ANONYMOUS),
    ).toMatchObject({ toPath: "three" });
  });

  it("does not shadow a page that has taken the old name back", async () => {
    // Rename A→B, then a new page claims A. The live page must win, or the
    // redirect would send visitors away from a page that exists.
    const page = await createPage.call({ slug: "home-old", title: "P" }, STAFF);
    await updatePage.call({ id: page.id, slug: "home-new" }, STAFF);
    await updatePage.call({ id: page.id, slug: "home-old" }, STAFF);

    expect(
      await resolveRedirect.call({ path: "home-old" }, ANONYMOUS),
    ).toBeNull();
  });

  it("writes nothing when the slug did not change", async () => {
    const page = await createPage.call({ slug: "stable", title: "P" }, STAFF);
    await updatePage.call({ id: page.id, title: "Renamed title only" }, STAFF);
    expect(await listRedirects.call({}, STAFF)).toEqual([]);
  });
});
