// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.11 attributes, comparison, ordered media and variant swaps.

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/core/db";
import { assets } from "@/core/media/schema";
import {
  applyVariantMatrix,
  attachProductMedia,
  compareProducts,
  createAttributeDefinition,
  createProduct,
  filterProductsByAttribute,
  listProductMedia,
  setProductAttribute,
} from "@/modules/catalog/service";
import {
  closeDb,
  failure,
  hasDatabase,
  OWNER,
  truncateSpine,
} from "../helpers/spine";

describe.runIf(hasDatabase)("catalog merchandising", { timeout: 30_000 }, () => {
  beforeEach(truncateSpine);
  afterAll(closeDb);

  async function readyAsset(filename: string, mime: string, kind: "image" | "video" | "doc") {
    const [asset] = await db()
      .insert(assets)
      .values({
        kind,
        storageKey: `test/${filename}`,
        filename,
        mime,
        legacyBytes: 100,
        bytes: 100,
        status: "ready",
      })
      .returning();
    return asset!;
  }

  it("filters and compares products on comparable attributes", async () => {
    const material = await createAttributeDefinition.call(
      { key: "material", label: "Material", kind: "enum", isFilterable: true, isComparable: true, enumOptions: ["oak", "steel"] },
      OWNER,
    );
    const weight = await createAttributeDefinition.call(
      { key: "weight_g", label: "Weight", kind: "measure", unit: "g", isFilterable: true, isComparable: true },
      OWNER,
    );
    const oak = await createProduct.call({ name: "Oak tray", slug: "oak-tray", kind: "physical" }, OWNER);
    const steel = await createProduct.call({ name: "Steel tray", slug: "steel-tray", kind: "physical" }, OWNER);
    await setProductAttribute.call(
      { productId: oak.id, expectedVersion: oak.version, attributeId: material.id, enum: "oak" },
      OWNER,
    );
    await setProductAttribute.call(
      { productId: steel.id, expectedVersion: steel.version, attributeId: material.id, enum: "steel" },
      OWNER,
    );
    const oakAfter = await setProductAttribute.call(
      { productId: oak.id, expectedVersion: oak.version + 1, attributeId: weight.id, number: "420" },
      OWNER,
    );
    expect(oakAfter.version).toBe(oak.version + 2);
    const filtered = await filterProductsByAttribute.call({ key: "material", equals: "oak" }, OWNER);
    expect(filtered.map((row) => row.slug)).toEqual(["oak-tray"]);
    const table = await compareProducts.call({ productIds: [oak.id, steel.id] }, OWNER);
    expect(table.rows.some((row) => row.key === "material" && row.values[oak.id] === "oak")).toBe(true);
    expect((await failure(createAttributeDefinition.call({ key: "material", label: "Dup", kind: "text" }, OWNER))).code)
      .toBe("conflict");
  });

  it("swaps variant media and refuses a PDF as a 3D model", async () => {
    const product = await createProduct.call({ name: "Lamp", slug: "lamp", kind: "physical" }, OWNER);
    const variant = await applyVariantMatrix.call({ productId: product.id, expectedVersion: product.version }, OWNER);
    const bundle = (await import("@/modules/catalog/service")).getProductVariants;
    const variants = await bundle.call({ productId: product.id }, OWNER);
    const variantId = variants.variants[0]!.id;
    const hero = await readyAsset("hero.jpg", "image/jpeg", "image");
    const sage = await readyAsset("sage.jpg", "image/jpeg", "image");
    const pdf = await readyAsset("spec.pdf", "application/pdf", "doc");
    await attachProductMedia.call(
      { productId: product.id, expectedVersion: variant.version, assetId: hero.id, role: "hero" },
      OWNER,
    );
    await attachProductMedia.call(
      { productId: product.id, expectedVersion: variant.version + 1, assetId: sage.id, role: "hero", variantId },
      OWNER,
    );
    const all = await listProductMedia.call({ productId: product.id }, OWNER);
    expect(all).toHaveLength(2);
    const swapped = await listProductMedia.call({ productId: product.id, variantId }, OWNER);
    expect(swapped).toHaveLength(1);
    expect(swapped[0]?.asset.id).toBe(sage.id);
    expect(
      (await failure(attachProductMedia.call(
        { productId: product.id, expectedVersion: variant.version + 2, assetId: pdf.id, role: "model" },
        OWNER,
      ))).code,
    ).toBe("validation");
  });
});
