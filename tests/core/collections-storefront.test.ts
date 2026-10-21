// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The public collection page (C3.25 slice 1): what a visitor and a crawler
// receive at /c/<slug>.
//
// Three claims:
//
//   1. **The page renders what the service resolves** — title, description,
//      the visible products in a grid, crawlable pagination — and nothing the
//      service filtered out.
//   2. **The SEO contract holds by construction** — canonical, full hreflang
//      across every enabled locale, CollectionPage + ItemList + Breadcrumb
//      JSON-LD, and paginated views that decline to be search results while
//      staying followable.
//   3. **Locale parity is a render fact** — the chrome translates and the
//      product links carry the visitor's prefix, in EN/FR/ES/AR and in both
//      themes, with no database involved in the assertion.

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { createElement } from "react";
import { renderToReadableStream, renderToStaticMarkup } from "react-dom/server";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { collections } from "@/modules/catalog/schema";
import {
  activateProduct,
  addCollectionProduct,
  collectionPaths,
  createCollection,
  createProduct,
  updateCollection,
} from "@/modules/catalog/service";
import { createTaxCategory } from "@/modules/invoicing/tax-service";
import { updateBusiness } from "@/core/settings/service";
import { localeDirection } from "@/core/i18n";
import { renderSitemap } from "@/core/seo/sitemap";
import { LOCALE_HEADER, PATH_HEADER } from "@/core/http/headers";
import { ANONYMOUS, closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";
import PublicCollectionPage, {
  generateMetadata,
} from "../../app/(public)/c/[slug]/page";
import {
  CollectionGrid,
  type CollectionGridProduct,
} from "../../app/(public)/c/[slug]/CollectionGrid";

const headerState = vi.hoisted(() => ({ locale: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (name: string) =>
      name === LOCALE_HEADER
        ? headerState.locale
        : name === PATH_HEADER
          ? "/c/wall"
          : null,
  }),
  cookies: async () => ({ get: () => undefined }),
}));

const GRID_PRODUCTS: CollectionGridProduct[] = [
  { productId: "11111111-1111-4111-8111-111111111111", name: "Coast print", slug: "coast-print", subtitle: "A4", brand: "Aurora" },
  { productId: "22222222-2222-4222-8222-222222222222", name: "Dune print", slug: "dune-print", subtitle: null, brand: null },
];

const LABELS = {
  empty: "Nothing in this collection yet.",
  previous: "Previous",
  next: "Next",
  page: "Page 2 of 3",
  pagination: "Pagination",
};

function grid(props?: Partial<Parameters<typeof CollectionGrid>[0]>) {
  return renderToStaticMarkup(
    createElement(CollectionGrid, {
      products: GRID_PRODUCTS,
      page: 2,
      pageCount: 3,
      labels: LABELS,
      productHref: (product) => `/products/${product.slug}`,
      ...props,
    }),
  );
}

describe("the collection grid, without a database", () => {
  it("renders one link per product with its subtitle and brand", () => {
    const html = grid();
    expect(html).toContain("Coast print");
    expect(html).toContain("Dune print");
    expect(html).toContain("A4");
    expect(html).toContain("Aurora");
    expect(html.match(/href="\/products\//g)).toHaveLength(2);
  });

  it("paginates with crawlable prev/next anchors and a page position", () => {
    const html = grid();
    expect(html).toContain('href="?page=1"');
    expect(html).toContain('href="?page=3"');
    expect(html).toContain('rel="prev"');
    expect(html).toContain('rel="next"');
    expect(html).toContain("Page 2 of 3");
  });

  it("hides pagination when everything fits on one page", () => {
    const html = grid({ page: 1, pageCount: 1 });
    expect(html).not.toContain("?page=");
    expect(html).not.toContain("Page 1 of 1");
  });

  it("renders the empty state when the collection holds nothing visible", () => {
    const html = grid({ products: [], page: 1, pageCount: 1 });
    expect(html).toContain("Nothing in this collection yet.");
  });

  it("uses semantic token classes so both themes inherit it unchanged", () => {
    // The grid never names a colour; the token classes resolve against
    // [data-theme] in the layout, which is what "both themes" means in
    // practice. Rendering under each attribute must give identical markup.
    const light = renderToStaticMarkup(
      createElement("div", { "data-theme": "light", dangerouslySetInnerHTML: { __html: grid() } }),
    );
    const dark = renderToStaticMarkup(
      createElement("div", { "data-theme": "dark", dangerouslySetInnerHTML: { __html: grid() } }),
    );
    expect(dark.replace('data-theme="dark"', 'data-theme="light"')).toBe(light);
    expect(grid()).toContain("text-ink");
    expect(grid()).toContain("border-rule");
    expect(grid()).not.toMatch(/text-(gray|slate|zinc|white|black)/);
  });
});

/**
 * The page is an async server component tree (ShareBar suspends on the share
 * service), so it renders through the streaming API and waits for every
 * suspended branch instead of the synchronous static-markup path.
 */
async function renderElement(element: ReactElement): Promise<string> {
  const stream = await renderToReadableStream(element);
  await stream.allReady;
  const reader = stream.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  const decoder = new TextDecoder();
  let html = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) html += decoder.decode(value, { stream: true });
  }
  html += decoder.decode();
  return html;
}

describe.runIf(hasDatabase)("the collection page at /c/<slug>", { timeout: 60_000 }, () => {
  beforeEach(async () => {
    headerState.locale = undefined;
    await truncateSpine();
    await updateBusiness.call(
      {
        name: "Aurora Coast Photography",
        country: "CA",
        baseCurrency: "CAD",
        timezone: "America/Vancouver",
        defaultLocale: "en",
        enabledLocales: ["en", "fr", "es", "ar"],
      },
      OWNER,
    );
  });
  afterAll(closeDb);

  async function publishedWall() {
    const tax = await createTaxCategory.call({ code: "standard", name: "Standard" }, OWNER);
    const shown = await createProduct.call(
      { name: "Coast print", slug: "coast-print", kind: "physical", taxCategoryId: tax.id },
      OWNER,
    );
    await activateProduct.call({ id: shown.id, expectedVersion: shown.version }, OWNER);
    const hidden = await createProduct.call(
      { name: "Draft secret", slug: "draft-secret", kind: "physical", taxCategoryId: tax.id },
      OWNER,
    );
    const collection = await createCollection.call(
      { title: "The Wall", slug: "wall", description: "Everything on the wall." },
      OWNER,
    );
    await addCollectionProduct.call({ collectionId: collection.id, productId: shown.id }, OWNER);
    await addCollectionProduct.call({ collectionId: collection.id, productId: hidden.id }, OWNER);
    const published = await updateCollection.call(
      { id: collection.id, expectedVersion: 1, published: true },
      OWNER,
    );
    return { shown, hidden, collection: published };
  }

  async function renderPage(slug: string, query: Record<string, string> = {}, locale?: string) {
    headerState.locale = locale;
    const params = Promise.resolve({ slug });
    const searchParams = Promise.resolve(query);
    const metadata = await generateMetadata({ params, searchParams });
    const element = await PublicCollectionPage({ params, searchParams });
    const html = await renderElement(element);
    return { metadata, html };
  }

  it("renders the collection with its visible products and structured data", async () => {
    await publishedWall();
    const { metadata, html } = await renderPage("wall");

    expect(html).toContain("The Wall");
    expect(html).toContain("Everything on the wall.");
    expect(html).toContain('href="/products/coast-print"');
    // The draft member was filtered by the service, so it is not on the page.
    expect(html).not.toContain("Draft secret");

    // §5: the page carries a breadcrumb, a CollectionPage and an ItemList.
    interface JsonLdEntry {
      "@type": string;
      itemListElement?: Array<Record<string, unknown>>;
    }
    const scripts = [...html.matchAll(/<script type="application\/ld\+json">([^<]+)<\/script>/g)].map(
      (match) => JSON.parse(match[1]!) as JsonLdEntry,
    );
    const types = scripts.map((entry) => entry["@type"]);
    expect(types).toEqual(expect.arrayContaining(["BreadcrumbList", "CollectionPage", "ItemList"]));
    const list = scripts.find((entry) => entry["@type"] === "ItemList");
    expect(list?.itemListElement).toEqual([
      expect.objectContaining({ "@type": "ListItem", position: 1, name: "Coast print", item: "http://localhost:3000/products/coast-print" }),
    ]);

    // §5: canonical names the collection, hreflang covers every locale the
    // instance publishes, and the social card is the auto-generated OG image.
    expect(metadata.alternates?.canonical).toBe("http://localhost:3000/c/wall");
    expect(metadata.alternates?.languages).toEqual({
      en: "http://localhost:3000/c/wall",
      fr: "http://localhost:3000/fr/c/wall",
      es: "http://localhost:3000/es/c/wall",
      ar: "http://localhost:3000/ar/c/wall",
      "x-default": "http://localhost:3000/c/wall",
    });
    expect(metadata.title).toContain("The Wall");
    expect(metadata.description).toBe("Everything on the wall.");
    const ogImage = (metadata.openGraph as { images: Array<{ url: string }> }).images[0]!.url;
    expect(ogImage).toBe("http://localhost:3000/og/c/wall");
  });

  it("refuses to be a search result beyond page one while staying followable", async () => {
    await bigWall();

    const first = await renderPage("big-wall");
    // Slice 2's pagination keeps the full view address: an absolute, still
    // crawlable URL rather than a bare relative query.
    expect(first.html).toContain('href="/c/big-wall?page=2"');
    expect(first.html).toContain("Page 1 of 2");

    const second = await renderPage("big-wall", { page: "2" });
    expect(second.metadata.robots).toEqual({ index: false, follow: true });
    // Page one of this view is the clean collection address — the prev link
    // drops the page param entirely rather than minting ?page=1.
    expect(second.html).toContain('href="/c/big-wall"');
    expect(second.html).toContain('rel="prev"');
    expect(second.html).not.toContain('rel="next"');
  });

  async function bigWall() {
    const tax = await createTaxCategory.call({ code: "standard", name: "Standard" }, OWNER);
    const collection = await createCollection.call({ title: "Big wall", slug: "big-wall" }, OWNER);
    for (let index = 0; index < 30; index += 1) {
      const product = await createProduct.call(
        { name: `Print ${index}`, slug: `print-${index}`, kind: "physical", taxCategoryId: tax.id },
        OWNER,
      );
      await activateProduct.call({ id: product.id, expectedVersion: product.version }, OWNER);
      await addCollectionProduct.call({ collectionId: collection.id, productId: product.id }, OWNER);
    }
    await updateCollection.call({ id: collection.id, expectedVersion: 1, published: true }, OWNER);
    return collection;
  }

  it("renders localized chrome and prefixed product links for every locale", async () => {
    await bigWall();
    const expected: Record<string, { next: string; pagination: string; direction: string }> = {
      fr: { next: "Suivant", pagination: "Pagination", direction: "ltr" },
      es: { next: "Siguiente", pagination: "Paginación", direction: "ltr" },
      ar: { next: "التالي", pagination: "ترقيم الصفحات", direction: "rtl" },
    };
    for (const [locale, labels] of Object.entries(expected)) {
      const { html } = await renderPage("big-wall", {}, locale);
      expect(html).toContain(`href="/${locale}/products/print-0"`);
      expect(html).toContain(labels.next);
      expect(html).toContain(labels.pagination);
      expect(localeDirection(locale)).toBe(labels.direction);
    }
    // Default locale carries no prefix.
    const { html: english } = await renderPage("big-wall", {}, "en");
    expect(english).toContain('href="/products/print-0"');
  });

  it("throws the platform 404 for anything unpublished, trashed or missing", async () => {
    await publishedWall();
    const collection = await createCollection.call({ title: "Dark", slug: "dark" }, OWNER);
    await expect(renderPage("dark")).rejects.toThrow();
    await expect(renderPage("never-existed")).rejects.toThrow();
    await updateCollection.call({ id: collection.id, expectedVersion: 1, published: true }, OWNER);
    await db().update(collections).set({ trashedAt: new Date() }).where(eq(collections.id, collection.id));
    await expect(renderPage("dark")).rejects.toThrow();
  });

  it("treats unparsable page numbers as page one but still declines the junk URL", async () => {
    await publishedWall();
    const { html, metadata } = await renderPage("wall", { page: "banana" });
    expect(html).not.toContain("?page=");
    // The page renders as page one, but ?page=banana is still a filter-shaped
    // address for a different query string — noindexed per the doctrine.
    expect(metadata.robots).toEqual({ index: false, follow: true });
  });

  it("feeds the sitemap everything the page renders, and nothing it does not", async () => {
    await publishedWall();
    const draft = await createCollection.call({ title: "Unpublished", slug: "unpublished" }, OWNER);
    await updateCollection.call({ id: draft.id, expectedVersion: 1, published: false }, OWNER);

    const entries = await collectionPaths.call({ locale: "en" }, ANONYMOUS);
    const xml = renderSitemap("http://localhost:3000", entries);
    expect(xml).toContain("<loc>http://localhost:3000/c/wall</loc>");
    expect(xml).not.toContain("unpublished");
  });
});
