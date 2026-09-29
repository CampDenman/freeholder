// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The faceted browse service (C3.25 slice 2): one public query powers the
// collection page's filter UI and the storefront search page.
//
// Claims under test, all against a seeded mini-catalog:
//   1. Facet math — every dimension's counts are exact, and a selected
//      dimension's counts are computed without its own filter (the shopper
//      can switch values without the facet wiping itself to zero).
//   2. Combined filters — OR within a dimension, AND across dimensions.
//   3. Price — the from-price mirrors catalog.resolvePrice's anonymous
//      reading (sale beats retail; audience lists do not apply; an
//      audience-less wholesale list does), bands are half-open, and the
//      price facet ignores its own filter.
//   4. Availability mirrors catalog.availability at quantity one.
//   5. Sorting, pagination, and the liveness rule behind both storefront
//      surfaces: active + public only.

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  activateProduct,
  addCollectionProduct,
  addOptionValue,
  applyVariantMatrix,
  assignProductOption,
  browseProducts,
  createAttributeDefinition,
  createCollection,
  createCustomerGroup,
  createOptionType,
  createPriceList,
  createProduct,
  getProductVariants,
  enableInventory,
  recordStockMovement,
  resolvePrice,
  setPriceListEntry,
  setProductAttribute,
  setProductOptionValues,
  updateCollection,
} from "@/modules/catalog/service";
import { createTaxCategory } from "@/modules/invoicing/tax-service";
import { updateBusiness } from "@/core/settings/service";
import { createLocationService } from "@/core/locations/service";
import { ANONYMOUS, closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

interface Seed {
  coast: { id: string };
  dune: { id: string };
  harbour: { id: string };
  collection: { id: string };
  coastDefaultVariant: string;
  retail: { id: string };
  studio: { id: string };
}

async function seed(): Promise<Seed> {
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
  const colour = await createOptionType.call({ name: "Colour", code: "colour" }, OWNER);
  const small = await addOptionValue.call({ optionTypeId: size.id, name: "Small", skuFragment: "s" }, OWNER);
  const large = await addOptionValue.call({ optionTypeId: size.id, name: "Large", skuFragment: "l" }, OWNER);
  const black = await addOptionValue.call({ optionTypeId: colour.id, name: "Black", skuFragment: "blk" }, OWNER);
  const white = await addOptionValue.call({ optionTypeId: colour.id, name: "White", skuFragment: "wht" }, OWNER);
  const material = await createAttributeDefinition.call(
    { key: "material", label: "Material", kind: "text", isFilterable: true },
    OWNER,
  );
  const weight = await createAttributeDefinition.call(
    { key: "weight", label: "Weight", kind: "measure", unit: "kg", isFilterable: true },
    OWNER,
  );
  const certified = await createAttributeDefinition.call(
    { key: "certified", label: "Certified", kind: "bool", isFilterable: true },
    OWNER,
  );
  const retail = await createPriceList.call({ name: "CAD retail", currency: "CAD", kind: "retail" }, OWNER);
  const studio = await createLocationService.call(
    { name: "Studio", slug: "studio", city: "Courtenay", country: "CA" },
    OWNER,
  );

  async function makeProduct(input: {
    name: string;
    slug: string;
    brand?: string;
    sizes?: string[];
    colours?: string[];
    materialValue?: string;
    weightValue?: string;
    price?: string;
    stock?: number;
    certifiedValue?: boolean;
  }) {
    let product = await createProduct.call(
      {
        name: input.name,
        slug: input.slug,
        kind: "physical",
        brand: input.brand,
        taxCategoryId: tax.id,
      },
      OWNER,
    );
    let version = product.version;
    const sizeFragment: Record<string, string> = { s: small.id, l: large.id };
    const colourFragment: Record<string, string> = { blk: black.id, wht: white.id };
    const pickValues = (map: Record<string, string>, fragments?: string[]) =>
      (fragments ?? [])
        .map((fragment) => map[fragment])
        .filter((value): value is string => Boolean(value));
    const usesOptions = (input.sizes?.length ?? 0) > 0 || (input.colours?.length ?? 0) > 0;
    if (usesOptions) {
      version = (
        await assignProductOption.call(
          { productId: product.id, expectedVersion: version, optionTypeId: size.id },
          OWNER,
        )
      ).version;
      version = (
        await assignProductOption.call(
          { productId: product.id, expectedVersion: version, optionTypeId: colour.id },
          OWNER,
        )
      ).version;
      version = (
        await setProductOptionValues.call(
          {
            productId: product.id,
            expectedVersion: version,
            optionTypeId: size.id,
            optionValueIds: pickValues(sizeFragment, input.sizes),
          },
          OWNER,
        )
      ).version;
      version = (
        await setProductOptionValues.call(
          {
            productId: product.id,
            expectedVersion: version,
            optionTypeId: colour.id,
            optionValueIds: pickValues(colourFragment, input.colours),
          },
          OWNER,
        )
      ).version;
      version = (
        await applyVariantMatrix.call({ productId: product.id, expectedVersion: version }, OWNER)
      ).version;
      const variants = (await getProductVariants.call({ productId: product.id }, OWNER)).variants;
      for (const variant of variants.filter((entry) => entry.status === "active")) {
        if (input.price) {
          await setPriceListEntry.call(
            { priceListId: retail.id, variantId: variant.id, amount: input.price },
            OWNER,
          );
        }
        if (input.stock !== undefined) {
          const item = await enableInventory.call({ variantId: variant.id, locationId: studio.id }, OWNER);
          if (input.stock > 0) {
            await recordStockMovement.call({ itemId: item.id, delta: input.stock, reason: "receipt" }, OWNER);
          }
        }
      }
    }
    if (input.materialValue) {
      version = (
        await setProductAttribute.call(
          { productId: product.id, expectedVersion: version, attributeId: material.id, text: input.materialValue },
          OWNER,
        )
      ).version;
    }
    if (input.weightValue) {
      version = (
        await setProductAttribute.call(
          { productId: product.id, expectedVersion: version, attributeId: weight.id, number: input.weightValue },
          OWNER,
        )
      ).version;
    }
    if (input.certifiedValue !== undefined) {
      version = (
        await setProductAttribute.call(
          { productId: product.id, expectedVersion: version, attributeId: certified.id, bool: input.certifiedValue },
          OWNER,
        )
      ).version;
    }
    product = await activateProduct.call({ id: product.id, expectedVersion: version }, OWNER);
    return { id: product.id, slug: input.slug };
  }

  const coast = await makeProduct({
    name: "Coast print",
    slug: "coast-print",
    brand: "Aurora",
    sizes: ["s", "l"],
    colours: ["blk"],
    materialValue: "Cotton",
    weightValue: "0.2",
    price: "20.00",
    stock: 5,
    certifiedValue: true,
  });
  const dune = await makeProduct({
    name: "Dune print",
    slug: "dune-print",
    sizes: ["l"],
    colours: ["wht"],
    materialValue: "Linen",
    weightValue: "0.4",
    price: "35.00",
    stock: 0,
    certifiedValue: false,
  });
  const harbour = await makeProduct({
    name: "Harbour print",
    slug: "harbour-print",
    sizes: ["s"],
    colours: ["blk"],
    materialValue: "Cotton",
    weightValue: "0.1",
    certifiedValue: true,
  });

  // Live rows the anonymous storefront must never see.
  await createProduct.call({ name: "Draft secret", slug: "draft-secret", kind: "physical", taxCategoryId: tax.id }, OWNER);
  const unlisted = await createProduct.call(
    { name: "Unlisted lantern", slug: "unlisted-lantern", kind: "physical", taxCategoryId: tax.id, visibility: "unlisted" },
    OWNER,
  );
  await activateProduct.call({ id: unlisted.id, expectedVersion: unlisted.version }, OWNER);
  const member = await createProduct.call(
    { name: "Member folio", slug: "member-folio", kind: "physical", taxCategoryId: tax.id, visibility: "member_only" },
    OWNER,
  );
  await activateProduct.call({ id: member.id, expectedVersion: member.version }, OWNER);

  const collection = await createCollection.call({ title: "The Wall", slug: "wall" }, OWNER);
  await addCollectionProduct.call({ collectionId: collection.id, productId: coast.id }, OWNER);
  await addCollectionProduct.call({ collectionId: collection.id, productId: dune.id }, OWNER);
  await addCollectionProduct.call({ collectionId: collection.id, productId: harbour.id }, OWNER);
  const published = await updateCollection.call(
    { id: collection.id, expectedVersion: 1, published: true },
    OWNER,
  );

  const coastDefaultVariant = (await getProductVariants.call({ productId: coast.id }, OWNER)).variants.find(
    (variant) => variant.isDefault,
  )!.id;

  return { coast, dune, harbour, collection: published, coastDefaultVariant, retail, studio };
}

describe.runIf(hasDatabase)("the faceted browse service", { timeout: 60_000 }, () => {
  beforeEach(async () => {
    await truncateSpine();
  });
  afterAll(closeDb);

  it("counts every facet dimension over a collection and orders by featured", async () => {
    await seed();
    const result = await browseProducts.call({ collectionSlug: "wall" }, ANONYMOUS);

    expect(result.collection?.title).toBe("The Wall");
    expect(result.total).toBe(3);
    // Featured inside a collection is the owner's stored membership order.
    expect(result.products.map((product) => product.slug)).toEqual([
      "coast-print",
      "dune-print",
      "harbour-print",
    ]);
    expect(result.products.map((product) => product.priceFromMinor)).toEqual([2000, 3500, null]);
    expect(result.products.map((product) => product.inStock)).toEqual([true, false, true]);
    expect(result.currency).toBe("CAD");

    const size = result.facets.options.find((dimension) => dimension.code === "size");
    // Ties sort by label ascending — "Large" before "Small".
    expect(size?.values).toEqual([
      { value: "l", label: "Large", count: 2 },
      { value: "s", label: "Small", count: 2 },
    ]);
    const colour = result.facets.options.find((dimension) => dimension.code === "colour");
    expect(colour?.values).toEqual([
      { value: "blk", label: "Black", count: 2 },
      { value: "wht", label: "White", count: 1 },
    ]);

    const material = result.facets.attributes.find((dimension) => dimension.key === "material");
    expect(material?.values).toEqual([
      { value: "Cotton", label: "Cotton", count: 2 },
      { value: "Linen", label: "Linen", count: 1 },
    ]);
    const weight = result.facets.attributes.find((dimension) => dimension.key === "weight");
    expect(weight?.values).toEqual([]);
    expect(weight?.min).toBe("0.1");
    expect(weight?.max).toBe("0.4");
    const certified = result.facets.attributes.find((dimension) => dimension.key === "certified");
    expect(certified?.values).toEqual([
      { value: "true", label: "true", count: 2 },
      { value: "false", label: "false", count: 1 },
    ]);

    // Bands cover the priced scope (the unpriced print sits outside them).
    expect(result.facets.price?.currency).toBe("CAD");
    expect(result.facets.price?.min).toBe(2000);
    expect(result.facets.price?.max).toBe(3500);
    expect(result.facets.price?.bands.reduce((sum, band) => sum + band.count, 0)).toBe(2);

    expect(result.facets.availability).toEqual({ inStock: 2, outOfStock: 1 });
  });

  it("ORs within a dimension, ANDs across, and keeps counts self-exclusive", async () => {
    await seed();
    const small = await browseProducts.call(
      {
        collectionSlug: "wall",
        filters: { options: [{ code: "size", values: ["s"] }] },
      },
      ANONYMOUS,
    );
    expect(small.products.map((product) => product.slug).sort()).toEqual(["coast-print", "harbour-print"]);
    // The size facet was computed without its own filter: switching values
    // stays possible, and the colour facet shows the ANDed-down truth.
    expect(small.facets.options.find((dimension) => dimension.code === "size")?.values).toEqual([
      { value: "l", label: "Large", count: 2 },
      { value: "s", label: "Small", count: 2 },
    ]);
    expect(small.facets.options.find((dimension) => dimension.code === "colour")?.values).toEqual([
      { value: "blk", label: "Black", count: 2 },
    ]);

    const either = await browseProducts.call(
      { collectionSlug: "wall", filters: { options: [{ code: "size", values: ["s", "l"] }] } },
      ANONYMOUS,
    );
    expect(either.total).toBe(3);

    const combined = await browseProducts.call(
      {
        collectionSlug: "wall",
        filters: {
          options: [
            { code: "size", values: ["s", "l"] },
            { code: "colour", values: ["blk"] },
          ],
          availability: "in_stock",
        },
      },
      ANONYMOUS,
    );
    expect(combined.products.map((product) => product.slug).sort()).toEqual(["coast-print", "harbour-print"]);
    // The availability facet honors the other applied filters (dune is out
    // on colour) but ignores its own — the in_stock filter above.
    expect(combined.facets.availability).toEqual({ inStock: 2, outOfStock: 0 });
  });

  it("filters price half-open and keeps the price facet free of its own filter", async () => {
    await seed();
    const result = await browseProducts.call(
      { collectionSlug: "wall", filters: { price: { min: 2000, max: 3500 } } },
      ANONYMOUS,
    );
    expect(result.products.map((product) => product.slug)).toEqual(["coast-print"]);
    expect(result.facets.price?.bands.reduce((sum, band) => sum + band.count, 0)).toBe(2);

    const upper = await browseProducts.call(
      { collectionSlug: "wall", filters: { price: { min: 3500 } } },
      ANONYMOUS,
    );
    expect(upper.products.map((product) => product.slug)).toEqual(["dune-print"]);

    const bands = result.facets.price!.bands;
    for (const band of bands) {
      expect(band.toMinor === null || band.fromMinor < band.toMinor).toBe(true);
      expect(band.fromMinor % 1).toBe(0);
    }
  });

  it("sorts by price both directions with unpriced last, and by title and newest", async () => {
    await seed();
    const ascResult = await browseProducts.call({ collectionSlug: "wall", sort: "price-asc" }, ANONYMOUS);
    expect(ascResult.products.map((product) => product.slug)).toEqual([
      "coast-print",
      "dune-print",
      "harbour-print",
    ]);
    const descResult = await browseProducts.call({ collectionSlug: "wall", sort: "price-desc" }, ANONYMOUS);
    expect(descResult.products.map((product) => product.slug)).toEqual([
      "dune-print",
      "coast-print",
      "harbour-print",
    ]);
    const titled = await browseProducts.call({ collectionSlug: "wall", sort: "title" }, ANONYMOUS);
    expect(titled.products.map((product) => product.name)).toEqual([
      "Coast print",
      "Dune print",
      "Harbour print",
    ]);
    const newest = await browseProducts.call({ collectionSlug: "wall", sort: "newest" }, ANONYMOUS);
    expect(newest.products[0]?.slug).toBe("harbour-print");
  });

  it("searches by term across name, brand, attribute text and option values", async () => {
    await seed();
    const byName = await browseProducts.call({ term: "coast" }, ANONYMOUS);
    expect(byName.products.map((product) => product.slug)).toEqual(["coast-print"]);
    const byBrand = await browseProducts.call({ term: "aurora" }, ANONYMOUS);
    expect(byBrand.products.map((product) => product.slug)).toEqual(["coast-print"]);
    const byAttribute = await browseProducts.call({ term: "cotton" }, ANONYMOUS);
    expect(byAttribute.products.map((product) => product.slug).sort()).toEqual(["coast-print", "harbour-print"]);
    const byOption = await browseProducts.call({ term: "black" }, ANONYMOUS);
    expect(byOption.products.map((product) => product.slug).sort()).toEqual(["coast-print", "harbour-print"]);

    // Liveness is the same rule the global search registry honors.
    for (const result of [byName, byBrand, byAttribute, byOption]) {
      const slugs = result.products.map((product) => product.slug);
      expect(slugs).not.toContain("draft-secret");
      expect(slugs).not.toContain("unlisted-lantern");
      expect(slugs).not.toContain("member-folio");
    }
  });

  it("ranks exact and prefix name matches first for featured search order", async () => {
    await seed();
    const result = await browseProducts.call({ term: "dune" }, ANONYMOUS);
    expect(result.products[0]?.slug).toBe("dune-print");
    const all = await browseProducts.call({ term: "print" }, ANONYMOUS);
    expect(all.products.map((product) => product.slug)).toEqual([
      "coast-print",
      "dune-print",
      "harbour-print",
    ]);
  });

  it("paginates the scope with a stable total", async () => {
    await seed();
    const first = await browseProducts.call({ collectionSlug: "wall", limit: 2, offset: 0 }, ANONYMOUS);
    expect(first.products).toHaveLength(2);
    expect(first.total).toBe(3);
    const second = await browseProducts.call({ collectionSlug: "wall", limit: 2, offset: 2 }, ANONYMOUS);
    expect(second.products.map((product) => product.slug)).toEqual(["harbour-print"]);
    expect(second.total).toBe(3);
  });

  it("mirrors catalog.resolvePrice's anonymous reading", async () => {
    const seeded = await seed();
    const before = await browseProducts.call({ collectionSlug: "wall" }, ANONYMOUS);
    const coastRow = before.products.find((product) => product.slug === "coast-print")!;
    const resolved = await resolvePrice.call(
      { variantId: seeded.coastDefaultVariant, currency: "CAD" },
      OWNER,
    );
    expect(resolved.available).toBe(true);
    expect(coastRow.priceFromMinor).toBe(resolved.amountMinor);

    // A sale list inside its window wins over retail for the anonymous shopper.
    const sale = await createPriceList.call(
      { name: "CAD sale", currency: "CAD", kind: "sale" },
      OWNER,
    );
    await setPriceListEntry.call(
      { priceListId: sale.id, variantId: seeded.coastDefaultVariant, amount: "15.00" },
      OWNER,
    );
    // A member list gated to a customer group does not apply anonymously.
    const group = await createCustomerGroup.call({ name: "Members", tag: "member" }, OWNER);
    const memberList = await createPriceList.call(
      { name: "CAD members", currency: "CAD", kind: "member", customerGroupId: group.id },
      OWNER,
    );
    await setPriceListEntry.call(
      { priceListId: memberList.id, variantId: seeded.coastDefaultVariant, amount: "5.00" },
      OWNER,
    );
    // An audience-less wholesale list genuinely applies to everyone, exactly
    // as resolvePrice says it does — the mirror must not editorialize.
    const wholesale = await createPriceList.call(
      { name: "CAD trade", currency: "CAD", kind: "wholesale" },
      OWNER,
    );
    await setPriceListEntry.call(
      { priceListId: wholesale.id, variantId: seeded.coastDefaultVariant, amount: "10.00" },
      OWNER,
    );

    const afterLists = await browseProducts.call({ collectionSlug: "wall" }, ANONYMOUS);
    const coast = afterLists.products.find((product) => product.slug === "coast-print")!;
    const resolvedAfter = await resolvePrice.call(
      { variantId: seeded.coastDefaultVariant, currency: "CAD" },
      OWNER,
    );
    expect(resolvedAfter.amountMinor).toBe(1000);
    expect(coast.priceFromMinor).toBe(1000);
  });

  it("filters measure attributes by range and bool attributes by value", async () => {
    await seed();
    const heavy = await browseProducts.call(
      {
        collectionSlug: "wall",
        filters: { attributes: [{ key: "weight", min: "0.3" }] },
      },
      ANONYMOUS,
    );
    expect(heavy.products.map((product) => product.slug)).toEqual(["dune-print"]);
    expect(heavy.facets.attributes.find((dimension) => dimension.key === "weight")?.min).toBe("0.1");
    expect(heavy.facets.attributes.find((dimension) => dimension.key === "weight")?.max).toBe("0.4");

    const light = await browseProducts.call(
      {
        collectionSlug: "wall",
        filters: { attributes: [{ key: "weight", min: "0.05", max: "0.15" }] },
      },
      ANONYMOUS,
    );
    expect(light.products.map((product) => product.slug)).toEqual(["harbour-print"]);

    const certified = await browseProducts.call(
      { collectionSlug: "wall", filters: { attributes: [{ key: "certified", values: ["true"] }] } },
      ANONYMOUS,
    );
    expect(certified.products.map((product) => product.slug).sort()).toEqual(["coast-print", "harbour-print"]);
  });

  it("narrows a search to one collection", async () => {
    const seeded = await seed();
    const result = await browseProducts.call(
      { collectionId: seeded.collection.id, term: "harbour" },
      ANONYMOUS,
    );
    expect(result.products.map((product) => product.slug)).toEqual(["harbour-print"]);
  });

  it("site-wide browse with no term is the live public shelf in name order", async () => {
    await seed();
    const result = await browseProducts.call({}, ANONYMOUS);
    expect(result.collection).toBeNull();
    expect(result.total).toBe(3);
    expect(result.products.map((product) => product.slug)).toEqual([
      "coast-print",
      "dune-print",
      "harbour-print",
    ]);
  });

  it("answers unknown slugs empty rather than erroring", async () => {
    await seed();
    const result = await browseProducts.call({ collectionSlug: "never-existed" }, ANONYMOUS);
    expect(result.collection).toBeNull();
    expect(result.products).toEqual([]);
    expect(result.total).toBe(0);
  });

  it("refuses contradictory input", async () => {
    const seeded = await seed();
    expect(
      (await failure(
        browseProducts.call(
          { collectionId: seeded.collection.id, collectionSlug: "wall" },
          ANONYMOUS,
        ),
      )).code,
    ).toBe("validation");
    expect(
      (await failure(
        browseProducts.call(
          { collectionSlug: "wall", filters: { price: { min: 5000, max: 1000 } } },
          ANONYMOUS,
        ),
      )).code,
    ).toBe("validation");
  });
});
