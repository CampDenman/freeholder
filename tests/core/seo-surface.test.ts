// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Public-entity SEO surface (MASTER.md §5, BigDataSEO.com RIBA, C2.21).
import { describe, expect, it } from "vitest";
import {
  kindFromSlug,
  priorityFromSlug,
  toPublicEntity,
  entitiesOfKind,
} from "@/core/seo/entities";
import { isFeedKind, renderEntityFeed } from "@/core/seo/feeds";
import {
  INDEXNOW_BATCH,
  indexNowKey,
  indexNowPayload,
  isIndexablePublicHost,
  submitIndexNow,
} from "@/core/seo/indexnow";
import {
  articleJsonLd,
  collectionPageJsonLd,
  creativeWorkJsonLd,
  productJsonLd,
  serviceJsonLd,
} from "@/core/seo/jsonld";
import {
  TITLE_LIMIT,
  clipSeoText,
  composeDescription,
  composeDocumentTitle,
  isFilterQuery,
  ogImagePath,
} from "@/core/seo/meta";

describe("titles and filter URLs", () => {
  it("keeps composed titles inside the §5 budget without colliding home with inner pages", () => {
    expect(composeDocumentTitle("Aurora Coast Photography", "Aurora Coast Photography", true))
      .toBe("Aurora Coast Photography");
    expect(composeDocumentTitle("About", "Aurora Coast Photography", false))
      .toBe("About · Aurora Coast Photography");
    expect(
      composeDocumentTitle(
        "Wedding photography, Vancouver Island",
        "Aurora Coast Photography",
        false,
      ),
    ).toBe("Wedding photography, Vancouver Island");
    expect(composeDocumentTitle("A".repeat(80), undefined, false).length).toBe(TITLE_LIMIT);
    expect(clipSeoText("Short", 60)).toBe("Short");
    expect(composeDescription("x".repeat(200))?.length).toBe(155);
  });

  it("noindexes faceted query strings and leaves a clean path alone", () => {
    expect(isFilterQuery({})).toBe(false);
    expect(isFilterQuery({ utm_source: "newsletter" })).toBe(false);
    expect(isFilterQuery({ filter: "blue" })).toBe(true);
    expect(isFilterQuery({ "filter[color]": "blue" })).toBe(true);
    expect(isFilterQuery({ sort: "price" })).toBe(true);
    expect(ogImagePath("")).toBe("/og");
    expect(ogImagePath("services/weddings")).toBe("/og/services/weddings");
  });
});

describe("the public entity registry", () => {
  it("classifies RIBA paths and weights browse pages above leaves", () => {
    expect(kindFromSlug("")).toBe("page");
    expect(kindFromSlug("services")).toBe("section");
    expect(kindFromSlug("services/weddings")).toBe("service");
    expect(kindFromSlug("locations/courtenay")).toBe("location");
    expect(kindFromSlug("shop/print-set")).toBe("product");
    expect(kindFromSlug("blog/a-clear-day")).toBe("article");
    expect(kindFromSlug("portfolio")).toBe("section");
    expect(kindFromSlug("portfolio/courtyard-studio")).toBe("project");
    expect(kindFromSlug("portfolio/collections-hospitality")).toBe("collection");
    expect(priorityFromSlug("")).toBe(1);
    expect(priorityFromSlug("services")).toBe(0.8);
    expect(priorityFromSlug("services/weddings")).toBe(0.5);
  });

  it("lets a sitemap source name its kind and still fills in the rest", () => {
    const entity = toPublicEntity(
      { slug: "custom/thing", title: "Thing", kind: "event" },
      "en",
    );
    expect(entity).toMatchObject({
      kind: "event",
      title: "Thing",
      locale: "en",
      priority: 0.5,
    });
  });
});

describe("JSON-LD builders for products, services and articles", () => {
  it("emits Product + Offer with a decimal price it did not invent", () => {
    const json = productJsonLd({
      name: "Print set",
      url: "https://example.test/shop/print-set",
      price: "50.00",
      priceCurrency: "CAD",
      sku: "print-set",
      brand: "Aurora Coast",
    });
    expect(json).toMatchObject({
      "@type": "Product",
      name: "Print set",
      offers: {
        "@type": "Offer",
        price: "50.00",
        priceCurrency: "CAD",
        availability: "https://schema.org/InStock",
      },
    });
  });

  it("describes a service page and an article", () => {
    expect(
      serviceJsonLd({
        name: "Weddings",
        url: "https://example.test/services/weddings",
        providerName: "Aurora Coast Photography",
      }),
    ).toMatchObject({
      "@type": "Service",
      name: "Weddings",
      provider: { "@type": "Organization", name: "Aurora Coast Photography" },
    });
    expect(
      articleJsonLd({
        headline: "A clear day",
        url: "https://example.test/blog/a-clear-day",
        authorName: "Ada",
      }),
    ).toMatchObject({
      "@type": "Article",
      headline: "A clear day",
      author: { "@type": "Person", name: "Ada" },
    });
  });

  it("describes portfolio work and curated collections", () => {
    expect(
      creativeWorkJsonLd({
        name: "Courtyard studio",
        url: "https://example.test/portfolio/courtyard-studio",
        dateCreated: "2026-07-15",
        images: [{ url: "https://example.test/media/studio.jpg", caption: "Sunlit studio" }],
        services: [{ name: "Architecture", url: "https://example.test/products/architecture" }],
      }),
    ).toMatchObject({
      "@type": "CreativeWork",
      dateCreated: "2026-07-15",
      image: [{ "@type": "ImageObject", contentUrl: "https://example.test/media/studio.jpg" }],
      about: [{ "@type": "Service", name: "Architecture" }],
    });
    expect(
      collectionPageJsonLd({
        name: "Hospitality",
        url: "https://example.test/portfolio/collections-hospitality",
      }),
    ).toMatchObject({ "@type": "CollectionPage", name: "Hospitality" });
  });
});

describe("IndexNow", () => {
  it("derives a stable key and refuses localhost", () => {
    expect(indexNowKey()).toMatch(/^[a-f0-9]{32}$/);
    expect(isIndexablePublicHost("http://localhost:3000")).toBe(false);
    expect(isIndexablePublicHost("https://aurora.example")).toBe(true);
    const payload = indexNowPayload(
      ["https://aurora.example/about"],
      "https://aurora.example",
    );
    expect(payload.host).toBe("aurora.example");
    expect(payload.keyLocation).toBe(`https://aurora.example/${payload.key}.txt`);
    expect(payload.urlList).toEqual(["https://aurora.example/about"]);
  });

  it("posts only public hosts, in batches of 10,000", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const body = typeof init?.body === "string" ? init.body : "";
      calls.push({ url, body });
      return new Response("ok", { status: 200 });
    };

    const skipped = await submitIndexNow(["https://aurora.example/about"], {
      origin: "http://localhost:3000",
      fetchImpl,
    });
    expect(skipped).toEqual({ submitted: 0, skipped: true, batches: 0 });
    expect(calls).toEqual([]);

    const urls = Array.from({ length: INDEXNOW_BATCH + 2 }, (_, i) =>
      `https://aurora.example/p/${i}`,
    );
    const sent = await submitIndexNow(urls, {
      origin: "https://aurora.example",
      fetchImpl,
    });
    expect(sent).toEqual({ submitted: INDEXNOW_BATCH + 2, skipped: false, batches: 2 });
    expect(calls).toHaveLength(2);
  });
});

describe("entity feeds", () => {
  it("renders Atom from the registry and stays valid when a kind is empty", () => {
    expect(isFeedKind("products")).toBe(true);
    expect(isFeedKind("cart")).toBe(false);

    const entities = [
      toPublicEntity(
        {
          slug: "locations/courtenay",
          title: "Courtenay",
          description: "Studio 3",
          updatedAt: new Date("2026-08-02T10:00:00Z"),
        },
        "en",
      ),
      toPublicEntity({ slug: "about", title: "About" }, "en"),
    ];
    expect(entitiesOfKind(entities, "location")).toHaveLength(1);

    const xml = renderEntityFeed({
      origin: "https://example.test",
      kind: "locations",
      title: "Aurora Coast locations",
      entities,
    });
    expect(xml).toContain("<feed xmlns=\"http://www.w3.org/2005/Atom\">");
    expect(xml).toContain("https://example.test/locations/courtenay");
    expect(xml).toContain("Courtenay");
    expect(xml).not.toContain("/about");

    const empty = renderEntityFeed({
      origin: "https://example.test",
      kind: "events",
      title: "Events",
      entities,
    });
    expect(empty).toContain("<feed xmlns=\"http://www.w3.org/2005/Atom\">");
    expect(empty).not.toContain("<entry>");
  });
});
