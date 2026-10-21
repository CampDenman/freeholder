// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Store sections (C2.25 slice C): page-level sections whose content is the
// live catalog, rendered through the same public components the storefront
// ships.
//
// Three claims:
//
//   1. **The palette knows the sections** — the registry carries the
//      collection showcase, the product row and the promo band; starters
//      parse; a composed landing-page tree validates end to end.
//   2. **The section renders what the catalog holds right now** — visible
//      products appear with links and buy buttons, draft products never do,
//      and a product added to the collection afterwards appears on the next
//      render without anyone touching the tree: the section holds a source,
//      not a copy.
//   3. **Composition round-trips through the services** — a tree with store
//      sections writes, publishes and renders back identically, and the
//      section-level layout choice (contained vs full-bleed) is present in
//      the rendered markup.

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { translator } from "@/core/i18n";
import { parseBlockTree, paletteFor } from "@/modules/cms/blocks/registry";
import type { BlockRenderContext } from "@/modules/cms/blocks/types";
import { renderBlocks } from "@/modules/cms/render";
import { createPage, publishPage, updatePage } from "@/modules/cms/service";
import { pages } from "@/modules/cms/schema";
import {
  activateProduct,
  addCollectionProduct,
  applyVariantMatrix,
  assignProductOption,
  createCollection,
  createOptionType,
  addOptionValue,
  createPriceList,
  createProduct,
  getProductVariants,
  setPriceListEntry,
  setProductOptionValues,
  updateCollection,
} from "@/modules/catalog/service";
import { productVariants } from "@/modules/catalog/schema";
import { createTaxCategory } from "@/modules/invoicing/tax-service";
import { updateBusiness } from "@/core/settings/service";
import { localizeCustomerHref } from "@/core/i18n/customer";
import { hasDatabase, closeDb, OWNER, truncateSpine } from "../helpers/spine";

function renderCtx(overrides: Partial<BlockRenderContext> = {}): BlockRenderContext {
  return {
    locale: "en",
    t: translator("en"),
    business: {
      name: "Aurora Coast Photography",
      tagline: "Coastal light, honestly made.",
      defaultLocale: "en",
      enabledLocales: ["en", "fr", "es", "ar"],
    },
    path: "/landing",
    ...overrides,
  };
}

async function renderTree(nodes: Parameters<typeof renderBlocks>[0], ctx: BlockRenderContext) {
  const rendered = await renderBlocks(nodes, ctx);
  return renderToStaticMarkup(createElement(Fragment, null, ...rendered));
}

describe("the store-section palette", () => {
  it("carries the three store sections with starters that satisfy their schemas", () => {
    const palette = paletteFor("page");
    for (const type of ["collectionShowcase", "productRow", "promoBand"]) {
      const entry = palette.find((candidate) => candidate.type === type);
      expect(entry, type).toBeDefined();
      expect(() => parseBlockTree([{ id: "x", type, props: entry!.starter }], "page")).not.toThrow();
    }
  });

  it("refuses a tree whose store section names nonsense", () => {
    expect(() =>
      parseBlockTree(
        [{ id: "s", type: "collectionShowcase", props: { width: "sideways" } }],
        "page",
      ),
    ).toThrow(/width/);
    expect(() =>
      parseBlockTree([{ id: "s", type: "productRow", props: { products: [{ slug: "" }] } }], "page"),
    ).toThrow(/slug/);
  });

  it("validates a composed landing page end to end", () => {
    const tree = parseBlockTree(
      [
        { id: "hero", type: "heading", props: { text: "Summer on the coast", level: 1 } },
        {
          id: "featured",
          type: "productRow",
          props: { heading: "Featured", products: [{ slug: "coast-print" }], width: "full" },
        },
        {
          id: "band",
          type: "promoBand",
          props: { heading: "The wall", collectionSlug: "wall", tone: "accent" },
        },
        {
          id: "showcase",
          type: "collectionShowcase",
          props: { heading: "Browse the collection", collectionSlug: "wall", width: "contained" },
        },
      ],
      "page",
    );
    expect(tree.map((node) => node.type)).toEqual([
      "heading",
      "productRow",
      "promoBand",
      "collectionShowcase",
    ]);
  });

  it("derives the section fields for the form panel, including the layout choice", () => {
    const palette = paletteFor("page");
    const showcase = palette.find((entry) => entry.type === "collectionShowcase")!;
    const names = showcase.fields.map((field) => field.name);
    expect(names).toEqual(
      expect.arrayContaining(["heading", "collectionSlug", "width", "limit", "showPrices"]),
    );
    const width = showcase.fields.find((field) => field.name === "width")!;
    expect(width.kind).toBe("choice");
    expect(width.choices!.map((choice) => choice.value)).toEqual(
      expect.arrayContaining(["contained", "full"]),
    );
  });
});

describe.runIf(hasDatabase)("store sections render the live catalog", { timeout: 60_000 }, () => {
  beforeEach(async () => {
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

  /** Two prints, one on the wall and one still a draft; the wall published. */
  async function seedWall() {
    const tax = await createTaxCategory.call({ code: "standard_print", name: "Standard" }, OWNER);
    async function print(name: string, slug: string, price: string) {
      const size = await createOptionType.call({ name: "Size", code: `size-${slug}` }, OWNER);
      const small = await addOptionValue.call(
        { optionTypeId: size.id, name: "Small", skuFragment: "s" },
        OWNER,
      );
      const large = await addOptionValue.call(
        { optionTypeId: size.id, name: "Large", skuFragment: "l" },
        OWNER,
      );
      let product = await createProduct.call(
        { name, slug, kind: "digital", taxCategoryId: tax.id },
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
            optionValueIds: [small.id, large.id],
          },
          OWNER,
        )
      ).version;
      version = (
        await applyVariantMatrix.call({ productId: product.id, expectedVersion: version }, OWNER)
      ).version;
      const list = await createPriceList.call(
        { name: `CAD retail ${slug}`, currency: "CAD", kind: "retail" },
        OWNER,
      );
      for (const variant of (await getProductVariants.call({ productId: product.id }, OWNER)).variants) {
        if (variant.status === "active") {
          await db()
            .update(productVariants)
            .set({ requiresShipping: false })
            .where(eq(productVariants.id, variant.id));
          await setPriceListEntry.call(
            { priceListId: list.id, variantId: variant.id, amount: price },
            OWNER,
          );
        }
      }
      product = await activateProduct.call({ id: product.id, expectedVersion: version }, OWNER);
      return product;
    }
    const shown = await print("Coast print", "coast-print", "25.00");
    const late = await print("Dune print", "dune-print", "30.00");
    const hidden = await createProduct.call(
      { name: "Draft secret", slug: "draft-secret", kind: "digital", taxCategoryId: tax.id },
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
    return { shown, late, hidden, collection: published };
  }

  it("renders the showcase with live products, links and buy buttons — and stays live", async () => {
    const { shown, late, hidden, collection } = await seedWall();
    const tree = parseBlockTree(
      [
        {
          id: "showcase",
          type: "collectionShowcase",
          props: { heading: "From the wall", collectionSlug: "wall", width: "contained" },
        },
      ],
      "page",
    );

    const first = await renderTree(tree, renderCtx());
    expect(first).toContain("From the wall");
    expect(first).toContain("Coast print");
    expect(first).toContain('href="/products/coast-print"');
    expect(first).not.toContain('href="/c/wall"');
    // The shoppable card quotes the live purchase projection.
    expect(first).toContain("Add to cart");
    expect(first).toContain("$25.00");
    // The draft member never reaches the page.
    expect(first).not.toContain("Draft secret");

    // LIVE is the point: add a product to the collection *after* composing,
    // render the same tree again, and the new shelf is there.
    await addCollectionProduct.call(
      { collectionId: collection.id, productId: late.id },
      OWNER,
    );
    const second = await renderTree(tree, renderCtx());
    expect(second).toContain("Dune print");
    expect(second).toContain("$30.00");
    // …and the hidden one is still hidden.
    expect(second).not.toContain("Draft secret");
    void shown;
    void hidden;
  });

  it("renders the product row in the owner's picked order and skips what is not sellable", async () => {
    const { shown, late, hidden } = await seedWall();
    const tree = parseBlockTree(
      [
        {
          id: "row",
          type: "productRow",
          props: {
            heading: "Featured",
            products: [
              { slug: "dune-print" },
              { slug: "draft-secret" },
              { slug: "coast-print" },
            ],
          },
        },
      ],
      "page",
    );
    const html = await renderTree(tree, renderCtx());
    expect(html).toContain("Dune print");
    expect(html).toContain("Coast print");
    expect(html).not.toContain("Draft secret");
    // The owner's order is the render order.
    expect(html.indexOf("Dune print")).toBeLessThan(html.indexOf("Coast print"));
    void shown;
    void late;
    void hidden;
  });

  it("renders the promo band full-bleed with its live shelf and collection link", async () => {
    const { collection } = await seedWall();
    const tree = parseBlockTree(
      [
        {
          id: "band",
          type: "promoBand",
          props: {
            heading: "The wall, right now",
            ctaLabel: "Shop the wall",
            tone: "accent",
            collectionSlug: "wall",
            limit: 4,
          },
        },
      ],
      "page",
    );
    const html = await renderTree(tree, renderCtx());
    expect(html).toContain("The wall, right now");
    expect(html).toContain("Shop the wall");
    expect(html).toContain("Coast print");
    // Full-bleed band: the breakout inline style is the layout machinery.
    expect(html).toContain("100vw");
    expect(html).toContain("Shop The Wall");
    void collection;
  });

  it("renders nothing on the public surface when the section has no source or copy", async () => {
    await seedWall();
    const tree = parseBlockTree(
      [
        { id: "row", type: "productRow", props: {} },
        { id: "band", type: "promoBand", props: {} },
        { id: "showcase", type: "collectionShowcase", props: {} },
      ],
      "page",
    );
    const html = await renderTree(tree, renderCtx({ identifyBlocks: false }));
    expect(html).toBe("");
  });

  it("translates the chrome and localizes links per locale", async () => {
    await seedWall();
    const business = {
      name: "Aurora Coast Photography",
      tagline: null,
      defaultLocale: "en",
      enabledLocales: ["en", "fr", "es", "ar"],
    };
    const frCtx = renderCtx({
      locale: "fr",
      t: translator("fr"),
      business,
      localizeHref: (href) => localizeCustomerHref(href, "fr", business),
    });
    const tree = parseBlockTree(
      [
        {
          id: "showcase",
          type: "collectionShowcase",
          props: { heading: "Du mur", collectionSlug: "wall", width: "contained" },
        },
      ],
      "page",
    );
    const html = await renderTree(tree, frCtx);
    expect(html).toContain('href="/fr/products/coast-print"');
    expect(html).toContain("Ajouter au panier");
  });

  it("marks the section's source for the canvas affordances in the preview", async () => {
    await seedWall();
    const tree = parseBlockTree(
      [
        {
          id: "showcase",
          type: "collectionShowcase",
          props: { heading: "From the wall", collectionSlug: "wall" },
        },
      ],
      "page",
    );
    const html = await renderTree(tree, renderCtx({ identifyBlocks: true }));
    expect(html).toContain('data-store-prop="collectionSlug"');
    expect(html).toContain('data-store-current="wall"');
    expect(html).toContain('data-replace-collection="collectionSlug"');
    expect(html).toContain("Swap collection");
    // The heading is typeable where it renders.
    expect(html).toContain('data-editable-prop="heading"');
  });
});

describe.runIf(hasDatabase)("store-section composition round-trips", { timeout: 60_000 }, () => {
  beforeEach(async () => {
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

  it("writes, publishes and renders a landing page of store sections back", async () => {
    const tax = await createTaxCategory.call({ code: "standard_print", name: "Standard" }, OWNER);
    const product = await createProduct.call(
      { name: "Coast print", slug: "coast-print", kind: "digital", taxCategoryId: tax.id },
      OWNER,
    );
    const active = await activateProduct.call(
      { id: product.id, expectedVersion: product.version },
      OWNER,
    );
    const collection = await createCollection.call({ title: "The Wall", slug: "wall" }, OWNER);
    await addCollectionProduct.call({ collectionId: collection.id, productId: active.id }, OWNER);
    await updateCollection.call({ id: collection.id, expectedVersion: 1, published: true }, OWNER);

    const page = await createPage.call(
      { title: "Landing", slug: "landing", locale: "en" },
      OWNER,
    );
    const tree = [
      { id: "hero", type: "heading", props: { text: "Summer on the coast", level: 1 } },
      {
        id: "featured",
        type: "productRow",
        props: { heading: "Featured", products: [{ slug: "coast-print" }] },
      },
      {
        id: "showcase",
        type: "collectionShowcase",
        props: { heading: "Browse", collectionSlug: "wall" },
      },
    ];
    await updatePage.call({ id: page.id, blocks: tree, expectedVersion: page.version }, OWNER);
    const published = await publishPage.call({ id: page.id, published: true }, OWNER);

    // The published tree is what the registry validated — reading it back and
    // parsing proves the round-trip, and rendering it as the public surface
    // proves the sections carry their live data onto the page.
    const [row] = await db()
      .select()
      .from(pages)
      .where(eq(pages.id, page.id))
      .limit(1);
    expect(row!.publishedAt).not.toBeNull();
    const publishedTree = parseBlockTree(row!.blocks, "page");
    expect(publishedTree.map((node) => node.type)).toEqual([
      "heading",
      "productRow",
      "collectionShowcase",
    ]);
    const html = await renderTree(publishedTree, renderCtx({ path: "/landing" }));
    expect(html).toContain("Summer on the coast");
    expect(html).toContain("Coast print");
    void published;
  });
});
