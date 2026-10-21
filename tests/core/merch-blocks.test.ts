// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The storefront commerce blocks (MASTER.md C2.24) — the editor half of the
// storefront-parity gaps G1 and G2 (deploy/c324-storefront-parity-2026-09-29.md).
//
// Four claims:
//   1. **One render path** — a grid composed on a page renders through the
//      exact components the /c/<slug> page uses (CollectionGrid, SortLinks,
//      FacetPanel, AddToCart, the browse-params codec), so the composed page
//      and the entity page cannot drift apart.
//   2. **The browse machinery is inherited** — filter state rides the page's
//      query params (repeated keys included), sort and paginate through the
//      same anchors, and the shelf emits ItemList JSON-LD with the same
//      helper, fields and order as the collection page.
//   3. **The buy flow is the shelf's** — buyButton, productCard and product
//      detail quote catalog.purchaseOptions and render AddToCart, so a
//      single-variant product gets its direct button and an options product
//      gets its picker on any page.
//   4. **The pickers round-trip** — collection/product fields derive as
//      picker kinds, the form select and the on-canvas replace affordance
//      draw from one choice list, and a pick is an ordinary prop edit the
//      schema accepts.

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { localeDirection, translator } from "@/core/i18n";
import { localizeCustomerHref } from "@/core/i18n/customer";
import { paletteFor, parseBlockTree } from "@/modules/cms/blocks/registry";
import { setPropAtPath } from "@/modules/cms/blocks/edit";
import { renderBlocks } from "@/modules/cms/render";
import type { BlockNode, BlockRenderContext } from "@/modules/cms/blocks/types";
import { editorBlockTypes } from "../../app/(admin)/admin/editorLabels";
import {
  activateProduct,
  addCollectionProduct,
  addOptionValue,
  applyVariantMatrix,
  assignProductOption,
  createCollection,
  createOptionType,
  createPriceList,
  createProduct,
  getProductVariants,
  resolveVisibleProduct,
  setPriceListEntry,
  setProductOptionValues,
  updateCollection,
} from "@/modules/catalog/service";
import { createTaxCategory } from "@/modules/invoicing/tax-service";
import { updateBusiness } from "@/core/settings/service";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const BUSINESS = {
  name: "Aurora Coast Photography",
  country: "CA",
  baseCurrency: "CAD",
  timezone: "America/Vancouver",
  defaultLocale: "en",
  enabledLocales: ["en", "fr", "es", "ar"],
};

function ctx(overrides: Partial<BlockRenderContext> = {}): BlockRenderContext {
  const locale = overrides.locale ?? "en";
  return {
    locale,
    t: translator(locale),
    business: { ...BUSINESS, tagline: null },
    path: "/shop",
    localizeHref: (href) => localizeCustomerHref(href, locale, BUSINESS),
    ...overrides,
  };
}

async function htmlOf(nodes: BlockNode[], overrides: Partial<BlockRenderContext> = {}) {
  // parseBlockTree first, as every real render does: the schema's defaults
  // (pageSize, showFacets…) are a property of the parsed tree.
  const rendered = await renderBlocks(parseBlockTree(nodes, "page"), ctx(overrides));
  return renderToStaticMarkup(createElement(Fragment, null, ...rendered));
}

function gridNode(props: Record<string, unknown> = {}): BlockNode {
  return { id: "g1", type: "productGrid", props: { collectionSlug: "wall", ...props } };
}

function jsonLdOf(html: string): Record<string, unknown>[] {
  const blocks: Record<string, unknown>[] = [];
  for (const match of html.matchAll(/<script type="application\/ld\+json">([^<]+)<\/script>/g)) {
    blocks.push(JSON.parse(match[1]!) as Record<string, unknown>);
  }
  return blocks;
}

/* ---------------------------------------------------- the palette and picks */

describe("the commerce blocks in the vocabulary", () => {
  it("offers the merchandising blocks on pages only", () => {
    const page = paletteFor("page").map((entry) => entry.type);
    expect(page).toEqual(
      expect.arrayContaining([
        "productGrid",
        "featuredCollection",
        "buyButton",
        "storeSearch",
        "productCard",
      ]),
    );
    expect(paletteFor("chrome").map((entry) => entry.type)).not.toContain("productGrid");
    expect(paletteFor("email").map((entry) => entry.type)).not.toContain("buyButton");
  });

  it("derives collection and product picker fields from the hints", () => {
    const fields = (type: string) =>
      Object.fromEntries(
        paletteFor("page")
          .find((entry) => entry.type === type)!
          .fields.map((field) => [field.name, field.kind]),
      );
    expect(fields("productGrid")).toMatchObject({ collectionSlug: "collection" });
    expect(fields("featuredCollection")).toMatchObject({ collectionSlug: "collection" });
    expect(fields("buyButton")).toMatchObject({ productSlug: "product" });
    expect(fields("productCard")).toMatchObject({ slug: "product" });
  });

  it("translates the pick lists once, None first, exactly as the form select needs", () => {
    const entries = editorBlockTypes(translator("en"), "page", [], {
      collections: [{ slug: "wall", title: "The Wall" }],
      products: [{ slug: "coast-print", name: "Coast print" }],
    });
    const grid = entries.find((entry) => entry.type === "productGrid")!;
    const buy = entries.find((entry) => entry.type === "buyButton")!;
    expect(grid.fields.find((field) => field.name === "collectionSlug")).toMatchObject({
      kind: "collection",
      choices: [
        { value: "", label: "No collection" },
        { value: "wall", label: "The Wall" },
      ],
    });
    expect(buy.fields.find((field) => field.name === "productSlug")).toMatchObject({
      kind: "product",
      choices: [
        { value: "", label: "No product" },
        { value: "coast-print", label: "Coast print" },
      ],
    });
    // productCard upgraded to a picker without losing its stored shape.
    const card = entries.find((entry) => entry.type === "productCard")!;
    expect(card.fields.find((field) => field.name === "slug")).toMatchObject({
      kind: "product",
      choices: [
        { value: "", label: "No product" },
        { value: "coast-print", label: "Coast print" },
      ],
    });
  });

  it("round-trips a canvas pick through the schema", () => {
    // A pick is an ordinary prop edit: the canvas writes the slug through
    // setPropAtPath and the tree must still parse — the save validates it.
    const picked = setPropAtPath({ collectionSlug: "" }, "collectionSlug", "wall");
    const [node] = [gridNode(picked)];
    expect(node.props.collectionSlug).toBe("wall");
    const productPicked = setPropAtPath({ productSlug: "product" }, "productSlug", "coast-print");
    expect(productPicked.productSlug).toBe("coast-print");
  });
});

/* --------------------------------------- the canvas affordances (no database) */

describe("the canvas affordances", () => {
  it("marks the grid with the pick host and leaves media assets alone", async () => {
    // Unbound block: a placeholder, not a hole. The bridge only repaints
    // [data-asset-prop]; entity hosts carry [data-pick-prop] instead.
    const html = await htmlOf([gridNode({ collectionSlug: "" })], { identifyBlocks: true });
    expect(html).toContain('data-pick-prop="collectionSlug"');
    expect(html).toContain('data-replace-pick="collectionSlug"');
    expect(html).toContain("No collection chosen");
    expect(html).not.toContain("data-asset-prop");
    expect(html).not.toContain('application/ld+json');
  });
});

/* -------------------------------------------------- the blocks on real data */

describe.runIf(hasDatabase)("the merchandising blocks against the catalog", { timeout: 60_000 }, () => {
  beforeEach(async () => {
    await truncateSpine();
    await updateBusiness.call(BUSINESS, OWNER);
    const tax = await createTaxCategory.call({ code: "standard", name: "Standard" }, OWNER);
    const size = await createOptionType.call({ name: "Size", code: "size" }, OWNER);
    const small = await addOptionValue.call({ optionTypeId: size.id, name: "Small", skuFragment: "s" }, OWNER);
    const large = await addOptionValue.call({ optionTypeId: size.id, name: "Large", skuFragment: "l" }, OWNER);
    const list = await createPriceList.call({ name: "CAD retail", currency: "CAD", kind: "retail" }, OWNER);
    async function print(name: string, slug: string, fragments: string[], price: string) {
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
            { priceListId: list.id, variantId: variant.id, amount: price },
            OWNER,
          );
        }
      }
      product = await activateProduct.call({ id: product.id, expectedVersion: version }, OWNER);
      return product;
    }
    // Coast print carries both sizes (a picker product); Dune print is the
    // large-only single-variant product with a direct add button.
    await print("Coast print", "coast-print", ["s", "l"], "20.00");
    await print("Dune print", "dune-print", ["l"], "35.00");
    const collection = await createCollection.call(
      { title: "The Wall", slug: "wall", description: "Prints for the long wall." },
      OWNER,
    );
    const coast = await resolveVisibleProduct.call({ slug: "coast-print" }, OWNER);
    const dune = await resolveVisibleProduct.call({ slug: "dune-print" }, OWNER);
    await addCollectionProduct.call({ collectionId: collection.id, productId: coast!.id }, OWNER);
    await addCollectionProduct.call({ collectionId: collection.id, productId: dune!.id }, OWNER);
    await updateCollection.call({ id: collection.id, expectedVersion: 1, published: true }, OWNER);
  });
  afterAll(closeDb);

  it("renders the collection's grid, sort links and buy flow through the shared components", async () => {
    const html = await htmlOf([gridNode()]);
    // The same grid the /c/<slug> page renders: both products, card links,
    // sort links, and the variant picker from the purchase projection.
    expect(html).toContain('aria-label="The Wall"');
    expect(html).toContain("Coast print");
    expect(html).toContain("Dune print");
    expect(html).toContain('href="/products/coast-print"');
    expect(html).toContain("Sort by");
    expect(html).toContain("Choose options");
    expect(html).toContain("Size: Small");
    expect(html).toContain("Size: Large");
    expect(html).toContain("CA$20.00");
    expect(html).toContain('name="variantId"');
    // ItemList JSON-LD, same helper and order as the collection page.
    const [list] = jsonLdOf(html);
    expect(list!).toMatchObject({ "@type": "ItemList", name: "The Wall" });
    expect(list!.itemListElement).toEqual([
      { "@type": "ListItem", position: 1, name: "Coast print", item: "http://localhost:3000/products/coast-print" },
      { "@type": "ListItem", position: 2, name: "Dune print", item: "http://localhost:3000/products/dune-print" },
    ]);
  });

  it("reads filter state from the page's query, repeated keys included", async () => {
    const filtered = await htmlOf([gridNode()], {
      query: { "filter[option:size]": "s" },
    });
    expect(filtered).toContain("Coast print");
    expect(filtered).not.toContain("Dune print");

    const either = await htmlOf([gridNode()], {
      query: { "filter[option:size]": ["s", "l"] },
    });
    expect(either).toContain("Coast print");
    expect(either).toContain("Dune print");
    // The facet-shaped address stays on the page the block lives on.
    expect(either).toContain('href="/shop?filter%5Boption%3Asize%5D=l&amp;filter%5Boption%3Asize%5D=s"');
  });

  it("paginates through crawlable page anchors", async () => {
    const first = await htmlOf([gridNode({ pageSize: 1 })]);
    expect(first).toContain("Coast print");
    expect(first).not.toContain("Dune print");
    expect(first).toContain('href="/shop?page=2"');
    expect(first).toContain('rel="next"');

    const second = await htmlOf([gridNode({ pageSize: 1 })], { query: { page: "2" } });
    expect(second).toContain("Dune print");
    expect(second).not.toContain("Coast print");
    expect(second).toContain('rel="prev"');
  });

  it("optionally renders the browse machinery's facet panel", async () => {
    const html = await htmlOf([gridNode({ showFacets: true })]);
    expect(html).toContain("Filters");
    expect(html).toContain("Small");
    expect(html).toContain("Large");
    expect(html).toContain('name="filter[price:min]"');
    // The layout makes room for the panel.
    expect(html).toContain("lg:grid-cols-[16rem_1fr]");
  });

  it("renders nothing publicly when the collection is unbound or missing", async () => {
    const unbound = await htmlOf([gridNode({ collectionSlug: "" })]);
    expect(unbound).not.toContain("The Wall");
    expect(unbound).not.toContain('application/ld+json');
    const missing = await htmlOf([gridNode({ collectionSlug: "never-there" })]);
    expect(missing).not.toContain('application/ld+json');
    expect(missing).not.toContain("Sort by");
  });

  it("searches the storefront from a composed page, term riding every link", async () => {
    const searchNode = (): BlockNode => ({
      id: "s1",
      type: "storeSearch",
      props: { pageSize: 12, showFacets: true },
    });
    const prompt = await htmlOf([searchNode()]);
    expect(prompt).toContain("Search the store");
    expect(prompt).toContain('action="/shop"');
    expect(prompt).toContain('method="get"');
    // Search is a utility: no ItemList JSON-LD, empty or not.
    expect(prompt).not.toContain('application/ld+json');

    const results = await htmlOf([searchNode()], { query: { q: "print" } });
    expect(results).toContain("2 results for “print”");
    expect(results).toContain("Coast print");
    expect(results).toContain("Dune print");
    // The term survives on the facet and sort links, on this page's address.
    expect(results).toContain('href="/shop?q=print&amp;filter%5Boption%3Asize%5D=l"');
    expect(results).toContain('href="/shop?q=print&amp;sort=price-desc"');
    expect(results).not.toContain('application/ld+json');

    const narrowed = await htmlOf([searchNode()], {
      query: { q: "print", "filter[option:size]": "s" },
    });
    expect(narrowed).toContain("Coast print");
    expect(narrowed).not.toContain("Dune print");
  });

  it("shows the grid inert with the replace affordance on the canvas", async () => {
    const html = await htmlOf([gridNode()], { identifyBlocks: true });
    expect(html).toContain('data-pick-prop="collectionSlug"');
    expect(html).toContain('data-pick-current="wall"');
    expect(html).toContain('data-replace-pick="collectionSlug"');
    expect(html).toContain("Replace collection");
    // The buy chrome is present but inert: the preview shows what ships
    // without a form that could submit inside the frame.
    expect(html).toContain("inert");
    expect(html).not.toContain('application/ld+json');
  });

  it("renders the featured hero, its curated front and the collection link", async () => {
    const html = await htmlOf([
      {
        id: "f1",
        type: "featuredCollection",
        props: {
          collectionSlug: "wall",
          eyebrow: "This week",
          intro: "Chosen for the north wall.",
          limit: 1,
          showViewAll: true,
        },
      },
    ]);
    // The hero reads the collection itself; the eyebrow and intro are the
    // owner's own words for this page.
    expect(html).toContain("The Wall");
    expect(html).toContain("Prints for the long wall.");
    expect(html).toContain("This week");
    expect(html).toContain("Chosen for the north wall.");
    // The curated front honours the limit, in the collection's order.
    expect(html).toContain("Coast print");
    expect(html).not.toContain("Dune print");
    // The full shelf has its own address.
    expect(html).toContain('href="/c/wall"');
    expect(html).toContain("View all");
    const [list] = jsonLdOf(html);
    expect(list).toMatchObject({ "@type": "ItemList", name: "The Wall" });
  });

  it("renders the featured block's editable copy on the canvas", async () => {
    const html = await htmlOf(
      [
        {
          id: "f1",
          type: "featuredCollection",
          props: { collectionSlug: "wall", eyebrow: "This week", intro: "Hello", limit: 2 },
        },
      ],
      { identifyBlocks: true },
    );
    expect(html).toContain('data-editable-prop="eyebrow"');
    expect(html).toContain('data-editable-prop="intro"');
    expect(html).toContain('data-pick-prop="collectionSlug"');
    expect(html).toContain("This week");
  });

  it("embeds one product's buy flow with the shelf's own projection", async () => {
    const html = await htmlOf([{ id: "b1", type: "buyButton", props: { productSlug: "coast-print" } }]);
    expect(html).toContain("Coast print");
    expect(html).toContain('href="/products/coast-print"');
    expect(html).toContain("Choose options");
    expect(html).toContain("Size: Small");
    expect(html).toContain("CA$20.00");
    // The card sits on the canvas with the pick affordance and no live form.
    const canvas = await htmlOf(
      [{ id: "b1", type: "buyButton", props: { productSlug: "coast-print" } }],
      { identifyBlocks: true },
    );
    expect(canvas).toContain('data-pick-prop="productSlug"');
    expect(canvas).toContain('data-replace-pick="productSlug"');
    expect(canvas).toContain("inert");
  });

  it("upgrades the product card with its price line and add-to-cart", async () => {
    const multi = await htmlOf([{ id: "c1", type: "productCard", props: { slug: "coast-print" } }]);
    expect(multi).toContain("Coast print");
    expect(multi).toContain("From CA$20.00");
    expect(multi).toContain("Choose options");
    expect(multi).toContain("View details");
    // The single-variant card quotes the exact price with a direct button.
    const single = await htmlOf([{ id: "c2", type: "productCard", props: { slug: "dune-print" } }]);
    expect(single).toContain("CA$35.00");
    expect(single).not.toContain("From CA$35.00");
    expect(single).toContain("Add to cart");
    expect(single).toContain('name="variantId"');
  });

  it("translates the chrome and prefixes links in fr, es and ar", async () => {
    const expected: Record<string, { sort: string; choose: string; viewAll: string }> = {
      fr: { sort: "Trier par", choose: "Choisir les options", viewAll: "Tout voir" },
      es: { sort: "Ordenar por", choose: "Elegir opciones", viewAll: "Ver todo" },
      ar: { sort: "ترتيب حسب", choose: "اختيار الخيارات", viewAll: "عرض الكل" },
    };
    for (const [locale, labels] of Object.entries(expected)) {
      const grid = await htmlOf([gridNode()], { locale });
      expect(grid).toContain(labels.sort);
      expect(grid).toContain(labels.choose);
      expect(grid).toContain(`href="/${locale}/products/coast-print"`);
      expect(localeDirection(locale)).toBe(locale === "ar" ? "rtl" : "ltr");

      const featured = await htmlOf(
        [{ id: "f1", type: "featuredCollection", props: { collectionSlug: "wall" } }],
        { locale },
      );
      expect(featured).toContain(labels.viewAll);
      expect(featured).toContain(`href="/${locale}/c/wall"`);

      const canvas = await htmlOf([gridNode()], { locale, identifyBlocks: true });
      expect(canvas).toContain(
        locale === "fr" ? "Remplacer la collection" : locale === "es" ? "Cambiar colección" : "استبدال المجموعة",
      );
    }
  });
});
