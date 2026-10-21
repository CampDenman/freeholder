// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The storefront browse surfaces (C3.25 slice 2): the URL codec, the
// presentational chrome, and both pages end to end.
//
// Three claims:
//   1. **The codec is the contract** — parse and serialise are inverse,
//      malformed input degrades fail-closed, and the string form is
//      deterministic (the clean address must be byte-identical wherever the
//      page mints it).
//   2. **The chrome is crawlable and themeless** — every facet control is an
//      anchor or a GET form, aria-current marks the active state, and markup
//      renders identically under light and dark themes with only token
//      classes.
//   3. **Both pages hold the SEO contract** — filtered views are noindexed
//      with a canonical on the clean address, the search page is a
//      noindexed utility everywhere, and the chrome translates in
//      EN/FR/ES/AR with prefixed product links.

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { createElement } from "react";
import { renderToReadableStream, renderToStaticMarkup } from "react-dom/server";
import {
  activateProduct,
  addCollectionProduct,
  addOptionValue,
  applyVariantMatrix,
  assignProductOption,
  browseProducts,
  createCollection,
  createOptionType,
  createPriceList,
  createProduct,
  getProductVariants,
  setPriceListEntry,
  setProductOptionValues,
  updateCollection,
} from "@/modules/catalog/service";
import { createTaxCategory } from "@/modules/invoicing/tax-service";
import { updateBusiness } from "@/core/settings/service";
import { localeDirection } from "@/core/i18n";
import { LOCALE_HEADER, PATH_HEADER } from "@/core/http/headers";
import { ANONYMOUS, closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";
import {
  browseQueryString,
  browseServiceFilters,
  clearFilters,
  EMPTY_BROWSE_QUERY,
  hiddenParams,
  parseBrowseQuery,
  setAvailability,
  setPrice,
  setSort,
  toggleAttributeValue,
  toggleOption,
  type BrowseQuery,
} from "../../app/(public)/browse-params";
import { FacetPanel, type FacetPanelData } from "../../app/(public)/browse/FacetPanel";
import { SearchBox } from "../../app/(public)/browse/SearchBox";
import { SortLinks } from "../../app/(public)/browse/SortLinks";
import PublicCollectionPage, {
  generateMetadata as collectionMetadata,
} from "../../app/(public)/c/[slug]/page";
import StorefrontSearchPage, {
  generateMetadata as searchMetadata,
} from "../../app/(public)/search/page";

const headerState = vi.hoisted(() => ({ locale: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (name: string) =>
      name === LOCALE_HEADER
        ? headerState.locale
        : name === PATH_HEADER
          ? "/search"
          : null,
  }),
  cookies: async () => ({ get: () => undefined }),
}));

describe("the browse URL codec", () => {
  it("round-trips every dimension through parse and serialise", () => {
    const query: BrowseQuery = {
      filters: {
        options: [
          { code: "colour", values: ["blk", "wht"] },
          { code: "size", values: ["l"] },
        ],
        attributes: [
          { key: "material", values: ["Cotton"] },
          { key: "weight", values: [], min: "0.1", max: "0.4" },
        ],
        price: { min: 2000, max: 5000 },
        availability: "in_stock",
      },
      sort: "price-asc",
      page: 2,
    };
    const serialised = browseQueryString(query);
    // Repeated keys must survive — a plain object would keep only the last.
    const raw: Record<string, string[]> = {};
    for (const [name, value] of new URLSearchParams(serialised).entries()) {
      raw[name] = [...(raw[name] ?? []), value];
    }
    const parsed = parseBrowseQuery(raw);
    expect(parsed).toEqual(query);
    expect(browseServiceFilters(parsed)).toEqual({
      options: [
        { code: "colour", values: ["blk", "wht"] },
        { code: "size", values: ["l"] },
      ],
      attributes: [
        { key: "material", values: ["Cotton"], min: undefined, max: undefined },
        { key: "weight", values: [], min: "0.1", max: "0.4" },
      ],
      price: { min: 2000, max: 5000 },
      availability: "in_stock",
    });
  });

  it("serialises deterministically and keeps defaults out of the URL", () => {
    const a = browseQueryString(EMPTY_BROWSE_QUERY);
    const b = browseQueryString({ ...EMPTY_BROWSE_QUERY, sort: null, page: 1 });
    expect(a).toBe("");
    expect(b).toBe("");
    const left = browseQueryString(toggleOption(EMPTY_BROWSE_QUERY, "size", "s"));
    const right = browseQueryString(toggleOption(EMPTY_BROWSE_QUERY, "size", "s"));
    expect(left).toBe(right);
    expect(left).toBe("filter%5Boption%3Asize%5D=s");
  });

  it("drops malformed and unknown input fail-closed", () => {
    const parsed = parseBrowseQuery({
      "filter[option:size]": ["s", "BROKEN!!", "s"],
      "filter[attr:weight:min]": "not-a-number",
      "filter[attr:weight:max]": "0.4",
      "filter[price:min]": "12.5",
      "filter[price:max]": "9007199254740993",
      "filter[availability]": "maybe",
      sort: "price-sideways",
      page: "-3",
      "filter[evil]": "x",
    });
    expect(parsed.filters.options).toEqual([{ code: "size", values: ["s"] }]);
    expect(parsed.filters.attributes).toEqual([{ key: "weight", values: [], min: undefined, max: "0.4" }]);
    // Non-integer price bounds are junk; the inverted remainder matches
    // nothing, so the whole price filter is gone.
    expect(parsed.filters.price).toBeNull();
    expect(parsed.filters.availability).toBeNull();
    expect(parsed.sort).toBeNull();
    expect(parsed.page).toBe(1);
  });

  it("toggles, sorts and clears without mutating the caller's query", () => {
    const base: BrowseQuery = {
      filters: {
        options: [{ code: "size", values: ["s"] }],
        attributes: [{ key: "material", values: ["Cotton"] }],
        price: { min: 1000 },
        availability: "in_stock",
      },
      sort: "price-desc",
      page: 3,
    };
    const widened = toggleOption(base, "size", "l");
    expect(widened.filters.options).toEqual([{ code: "size", values: ["l", "s"] }]);
    expect(widened.page).toBe(1);
    expect(base.filters.options).toEqual([{ code: "size", values: ["s"] }]);

    const narrowed = toggleOption(widened, "size", "s");
    expect(narrowed.filters.options).toEqual([{ code: "size", values: ["l"] }]);
    const deSelected = toggleOption(narrowed, "size", "l");
    expect(deSelected.filters.options).toEqual([]);

    expect(toggleAttributeValue(base, "material", "Linen").filters.attributes[0]?.values).toEqual([
      "Cotton",
      "Linen",
    ]);
    expect(setPrice(base, null).filters.price).toBeNull();
    expect(setAvailability(base, null).filters.availability).toBeNull();
    expect(setSort(base, "featured").sort).toBeNull();
    expect(clearFilters(base)).toEqual({ ...EMPTY_BROWSE_QUERY, sort: "price-desc" });
  });

  it("hands a range form the rest of the query as hidden fields", () => {
    const query: BrowseQuery = {
      filters: {
        options: [{ code: "size", values: ["s"] }],
        attributes: [],
        price: null,
        availability: "in_stock",
      },
      sort: "title",
      page: 2,
    };
    const hidden = hiddenParams(query, ["filter[attr:weight:min]", "filter[attr:weight:max]"]);
    expect(hidden).toContainEqual({ name: "filter[option:size]", value: "s" });
    expect(hidden).toContainEqual({ name: "filter[availability]", value: "in_stock" });
    expect(hidden).toContainEqual({ name: "sort", value: "title" });
    expect(hidden.some((field) => field.name.includes("weight"))).toBe(false);
  });
});

const PANEL_FACETS: FacetPanelData = {
  options: [
    {
      code: "size",
      name: "Size",
      values: [
        { value: "l", label: "Large", count: 2 },
        { value: "s", label: "Small", count: 1 },
      ],
    },
  ],
  attributes: [
    {
      key: "material",
      label: "Material",
      kind: "text",
      unit: null,
      values: [{ value: "Cotton", label: "Cotton", count: 2 }],
      min: null,
      max: null,
    },
    {
      key: "weight",
      label: "Weight",
      kind: "measure",
      unit: "kg",
      values: [],
      min: "0.1",
      max: "0.4",
    },
  ],
  price: {
    bands: [
      { fromMinor: 0, toMinor: 2500, count: 2 },
      { fromMinor: 2500, toMinor: null, count: 1 },
    ],
  },
  availability: { inStock: 2, outOfStock: 1 },
};

const PANEL_LABELS = {
  nav: "Filters",
  heading: "Filters",
  clearAll: "Clear filters",
  price: "Price",
  priceMin: "Min",
  priceMax: "Max",
  priceApply: "Apply",
  availability: "Availability",
  inStock: "In stock",
  outOfStock: "Out of stock",
  observedRange: (min: string, max: string, unit: string) => `From ${min} to ${max} ${unit}`,
};

function panel(query: BrowseQuery = EMPTY_BROWSE_QUERY) {
  return renderToStaticMarkup(
    createElement(FacetPanel, {
      facets: PANEL_FACETS,
      query,
      hrefFor: (next) => {
        const params = browseQueryString(next);
        return params ? `/c/wall?${params}` : "/c/wall";
      },
      formatMinor: (minor) => `$${(minor / 100).toFixed(2)}`,
      labels: PANEL_LABELS,
    }),
  );
}

describe("the browse chrome, without a database", () => {
  it("renders facet anchors with counts, forms for ranges, and clear-all only when active", () => {
    const html = panel();
    expect(html).toContain('href="/c/wall?filter%5Boption%3Asize%5D=l"');
    expect(html).toContain("Large");
    expect(html).toContain("$0.00 – $25.00");
    expect(html).toContain("$25.00+");
    expect(html).toContain('name="filter[attr:weight:min]"');
    expect(html).toContain('name="filter[price:min]"');
    expect(html).toContain("In stock");
    // Nothing selected yet: no clear-all link.
    expect(html).not.toContain("Clear filters");

    const active = panel({
      filters: {
        options: [{ code: "size", values: ["s"] }],
        attributes: [],
        price: null,
        availability: null,
      },
      sort: null,
      page: 1,
    });
    expect(active).toContain("Clear filters");
    // The picked value links back to the clean shelf; the other value keeps
    // the pick alongside itself.
    expect(active).toContain('aria-current="true"');
    expect(active).toContain('href="/c/wall"');
    expect(active).toContain('href="/c/wall?filter%5Boption%3Asize%5D=l&amp;filter%5Boption%3Asize%5D=s"');
  });

  it("marks the active sort and links each ordering", () => {
    const html = renderToStaticMarkup(
      createElement(SortLinks, {
        query: { ...EMPTY_BROWSE_QUERY, sort: "price-asc" },
        hrefFor: (next) => {
        const params = browseQueryString(next);
        return params ? `/c/wall?${params}` : "/c/wall";
      },
        labels: {
          nav: "Sort by",
          featured: "Featured",
          priceAsc: "Price: low to high",
          priceDesc: "Price: high to low",
          newest: "Newest",
          title: "Name",
        },
      }),
    );
    expect(html).toContain('href="/c/wall?sort=price-desc"');
    expect(html).toContain('aria-current="true"');
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
  });

  it("renders the search box as a GET form to the localized address", () => {
    const html = renderToStaticMarkup(
      createElement(SearchBox, {
        action: "/fr/search",
        term: "côte",
        labels: { aria: "Search", placeholder: "Search products", submit: "Search" },
      }),
    );
    expect(html).toContain('action="/fr/search"');
    expect(html).toContain('method="get"');
    expect(html).toContain('type="search"');
    expect(html).toContain('name="q"');
    expect(html).toContain('value="côte"');
  });

  it("uses semantic token classes so both themes inherit it unchanged", () => {
    const light = renderToStaticMarkup(
      createElement("div", { "data-theme": "light", dangerouslySetInnerHTML: { __html: panel() } }),
    );
    const dark = renderToStaticMarkup(
      createElement("div", { "data-theme": "dark", dangerouslySetInnerHTML: { __html: panel() } }),
    );
    expect(dark.replace('data-theme="dark"', 'data-theme="light"')).toBe(light);
    expect(panel()).toContain("text-ink");
    expect(panel()).toContain("border-rule");
    expect(panel()).not.toMatch(/text-(gray|slate|zinc|white|black)/);
  });
});

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

describe.runIf(hasDatabase)("the faceted collection page and search page", { timeout: 60_000 }, () => {
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
    const tax = await createTaxCategory.call({ code: "standard", name: "Standard" }, OWNER);
    const size = await createOptionType.call({ name: "Size", code: "size" }, OWNER);
    const small = await addOptionValue.call({ optionTypeId: size.id, name: "Small", skuFragment: "s" }, OWNER);
    const large = await addOptionValue.call({ optionTypeId: size.id, name: "Large", skuFragment: "l" }, OWNER);
    const list = await createPriceList.call({ name: "CAD retail", currency: "CAD", kind: "retail" }, OWNER);
    async function print(name: string, slug: string, fragments: string[]) {
      const fragmentId: Record<string, string> = { s: small.id, l: large.id };
      let product = await createProduct.call(
        { name, slug, kind: "physical", taxCategoryId: tax.id },
        OWNER,
      );
      let version = (
        await assignProductOption.call(
          { productId: product.id, expectedVersion: product.version, optionTypeId: size.id },
          OWNER,
        )
      ).version;
      version = (
        await setProductOptionValues.call(
          {
            productId: product.id,
            expectedVersion: version,
            optionTypeId: size.id,
            optionValueIds: fragments
              .map((fragment) => fragmentId[fragment])
              .filter((value): value is string => Boolean(value)),
          },
          OWNER,
        )
      ).version;
      version = (
        await applyVariantMatrix.call({ productId: product.id, expectedVersion: version }, OWNER)
      ).version;
      for (const variant of (await getProductVariants.call({ productId: product.id }, OWNER)).variants) {
        if (variant.status === "active") {
          await setPriceListEntry.call(
            { priceListId: list.id, variantId: variant.id, amount: "20.00" },
            OWNER,
          );
        }
      }
      product = await activateProduct.call({ id: product.id, expectedVersion: version }, OWNER);
      return product;
    }
    const coast = await print("Coast print", "coast-print", ["s"]);
    const dune = await print("Dune print", "dune-print", ["l"]);
    const collection = await createCollection.call({ title: "The Wall", slug: "wall" }, OWNER);
    await addCollectionProduct.call({ collectionId: collection.id, productId: coast.id }, OWNER);
    await addCollectionProduct.call({ collectionId: collection.id, productId: dune.id }, OWNER);
    await updateCollection.call({ id: collection.id, expectedVersion: 1, published: true }, OWNER);
  });
  afterAll(closeDb);

  async function renderCollection(slug: string, query: Record<string, string> = {}, locale?: string) {
    headerState.locale = locale;
    const params = Promise.resolve({ slug });
    const searchParams = Promise.resolve(query);
    const metadata = await collectionMetadata({ params, searchParams });
    const element = await PublicCollectionPage({ params, searchParams });
    const html = await renderElement(element);
    return { metadata, html };
  }

  async function renderSearch(query: Record<string, string> = {}, locale?: string) {
    headerState.locale = locale;
    const searchParams = Promise.resolve(query);
    const metadata = await searchMetadata({ searchParams });
    const element = await StorefrontSearchPage({ searchParams });
    const html = await renderElement(element);
    return { metadata, html };
  }

  it("filters the collection through crawlable facet URLs and declines to index them", async () => {
    const { metadata, html } = await renderCollection("wall", {
      "filter[option:size]": "s",
      sort: "price-asc",
    });

    // The grid shows only the small print; the facet panel offers the links.
    expect(html).toContain("Coast print");
    expect(html).not.toContain("Dune print");
    // The unselected size links keep the active pick alongside it; the
    // selected one links back to the clean (sort-only) shelf.
    expect(html).toContain(
      'href="/c/wall?filter%5Boption%3Asize%5D=l&amp;filter%5Boption%3Asize%5D=s&amp;sort=price-asc"',
    );
    expect(html).toContain('aria-current="true"');
    expect(html).toContain('href="/c/wall?sort=price-asc"');
    expect(html).toContain('href="/c/wall?filter%5Boption%3Asize%5D=s&amp;sort=price-desc"');

    // The doctrine: a filter-shaped URL is a different page to a crawler —
    // noindexed, followable, canonical on the clean collection.
    expect(metadata.robots).toEqual({ index: false, follow: true });
    expect(metadata.alternates?.canonical).toBe("http://localhost:3000/c/wall");
  });

  it("keeps the clean collection indexable with its full hreflang set", async () => {
    const { metadata } = await renderCollection("wall");
    expect(metadata.robots).toBeUndefined();
    expect(metadata.alternates?.canonical).toBe("http://localhost:3000/c/wall");
    expect(metadata.alternates?.languages).toEqual({
      en: "http://localhost:3000/c/wall",
      fr: "http://localhost:3000/fr/c/wall",
      es: "http://localhost:3000/es/c/wall",
      ar: "http://localhost:3000/ar/c/wall",
      "x-default": "http://localhost:3000/c/wall",
    });
  });

  it("translates the browse chrome and prefixes links in fr, es and ar", async () => {
    const expected: Record<string, { filters: string; clear: string; inStock: string }> = {
      fr: { filters: "Filtres", clear: "Effacer les filtres", inStock: "En stock" },
      es: { filters: "Filtros", clear: "Borrar filtros", inStock: "En stock" },
      ar: { filters: "التصفية", clear: "مسح عوامل التصفية", inStock: "متوفر" },
    };
    for (const [locale, labels] of Object.entries(expected)) {
      const { html } = await renderCollection("wall", {}, locale);
      expect(html).toContain(labels.filters);
      expect(html).toContain(labels.inStock);
      expect(html).toContain(`href="/${locale}/products/coast-print"`);
      expect(localeDirection(locale)).toBe(locale === "ar" ? "rtl" : "ltr");
      // Localized facet links stay on the prefixed address.
      expect(html).toContain(`href="/${locale}/c/wall?`);
    }
    const { html: english } = await renderCollection("wall", {}, "en");
    expect(english).toContain('href="/products/coast-print"');
  });

  it("searches the storefront and renders the results page", async () => {
    const { metadata, html } = await renderSearch({ q: "coast" });

    expect(html).toContain('action="/search"');
    expect(html).toContain('name="q"');
    expect(html).toContain("1 results for “coast”");
    expect(html).toContain("Coast print");
    expect(html).not.toContain("Dune print");

    // The utility page never indexes, at any address.
    expect(metadata.robots).toEqual({ index: false, follow: true });
    expect(metadata.alternates?.canonical).toBe("http://localhost:3000/search");

    // A second render over both prints exercises the facet machinery: the
    // term rides along on every facet and sort link.
    const both = await renderSearch({ q: "print" });
    expect(both.html).toContain('href="/search?q=print&amp;filter%5Boption%3Asize%5D=l"');
    expect(both.html).toContain('href="/search?q=print&amp;sort=price-desc"');
  });

  it("keeps filters through storefront search results", async () => {
    const { html } = await renderSearch({ q: "print", "filter[option:size]": "l" });
    expect(html).toContain("Dune print");
    expect(html).not.toContain("Coast print");
    // The empty-state copy never leaks in while results exist.
    expect(html).not.toContain("Nothing matches");
  });

  it("renders the localized empty state when nothing matches", async () => {
    const { html } = await renderSearch({ q: "zzzz" });
    expect(html).toContain("Nothing matches that search yet");
    const { html: french } = await renderSearch({ q: "zzzz" }, "fr");
    expect(french).toContain("Aucun résultat pour cette recherche");
    expect(french).toContain('action="/fr/search"');
  });

  it("surfaces the same facet counts the service computes", async () => {
    const service = await browseProducts.call({ collectionSlug: "wall" }, ANONYMOUS);
    expect(service.facets.options.find((dimension) => dimension.code === "size")?.values).toEqual([
      { value: "l", label: "Large", count: 1 },
      { value: "s", label: "Small", count: 1 },
    ]);
    const { html } = await renderCollection("wall");
    expect(html).toContain("Large");
    expect(html).toContain("Small");
  });
});
