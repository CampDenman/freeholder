// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.10 option dimensions and safe variant-matrix reconciliation.

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  addOptionValue,
  applyVariantMatrix,
  assignProductOption,
  createOptionType,
  createProduct,
  getProductVariants,
  setDefaultVariant,
  setProductOptionValues,
} from "@/modules/catalog/service";
import { productVariants } from "@/modules/catalog/schema";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import {
  closeDb,
  failure,
  hasDatabase,
  OWNER,
  truncateSpine,
} from "../helpers/spine";

describe.runIf(hasDatabase)("catalog variant matrices", { timeout: 30_000 }, () => {
  beforeEach(truncateSpine);
  afterAll(closeDb);

  async function product() {
    return createProduct.call(
      { name: "Tee", slug: "tee", kind: "physical" },
      OWNER,
    );
  }

  it("generates a matrix, retains identities, and archives unused combinations", async () => {
    const created = await product();
    const size = await createOptionType.call({ name: "Size", code: "size" }, OWNER);
    const colour = await createOptionType.call({ name: "Colour", code: "colour" }, OWNER);
    const small = await addOptionValue.call({ optionTypeId: size.id, name: "Small", skuFragment: "s" }, OWNER);
    const large = await addOptionValue.call({ optionTypeId: size.id, name: "Large", skuFragment: "l" }, OWNER);
    const black = await addOptionValue.call({ optionTypeId: colour.id, name: "Black", skuFragment: "blk" }, OWNER);
    const white = await addOptionValue.call({ optionTypeId: colour.id, name: "White", skuFragment: "wht" }, OWNER);

    let version = (await assignProductOption.call(
      { productId: created.id, expectedVersion: created.version, optionTypeId: size.id },
      OWNER,
    )).version;
    version = (await assignProductOption.call(
      { productId: created.id, expectedVersion: version, optionTypeId: colour.id },
      OWNER,
    )).version;
    version = (await setProductOptionValues.call(
      { productId: created.id, expectedVersion: version, optionTypeId: size.id, optionValueIds: [small.id, large.id] },
      OWNER,
    )).version;
    version = (await setProductOptionValues.call(
      { productId: created.id, expectedVersion: version, optionTypeId: colour.id, optionValueIds: [black.id, white.id] },
      OWNER,
    )).version;

    const preview = await getProductVariants.call({ productId: created.id }, OWNER);
    expect(preview.preview.add).toHaveLength(4);
    expect(preview.preview.retain).toHaveLength(0);

    version = (await applyVariantMatrix.call({ productId: created.id, expectedVersion: version }, OWNER)).version;
    const first = await getProductVariants.call({ productId: created.id }, OWNER);
    expect(first.variants.filter((variant) => variant.status === "active")).toHaveLength(4);
    expect(first.variants.some((variant) => variant.isDefault)).toBe(true);
    const keptId = first.variants.find((variant) => variant.sku === "tee-s-blk")?.id;
    expect(keptId).toBeTruthy();

    version = (await setProductOptionValues.call(
      { productId: created.id, expectedVersion: version, optionTypeId: colour.id, optionValueIds: [black.id] },
      OWNER,
    )).version;
    await applyVariantMatrix.call({ productId: created.id, expectedVersion: version }, OWNER);
    const second = await getProductVariants.call({ productId: created.id }, OWNER);
    const smallBlack = second.variants.find((variant) => variant.id === keptId);
    expect(smallBlack?.status).toBe("active");
    expect(second.variants.filter((variant) => variant.status === "archived")).toHaveLength(2);
    const rows = await db().select().from(productVariants).where(eq(productVariants.productId, created.id));
    expect(rows).toHaveLength(4);
  });

  it("refuses a stale writer and a default on an archived variant", async () => {
    const created = await product();
    const size = await createOptionType.call({ name: "Size", code: "size" }, OWNER);
    const small = await addOptionValue.call({ optionTypeId: size.id, name: "Small", skuFragment: "s" }, OWNER);
    let version = (await assignProductOption.call(
      { productId: created.id, expectedVersion: created.version, optionTypeId: size.id },
      OWNER,
    )).version;
    version = (await setProductOptionValues.call(
      { productId: created.id, expectedVersion: version, optionTypeId: size.id, optionValueIds: [small.id] },
      OWNER,
    )).version;
    const applied = await applyVariantMatrix.call({ productId: created.id, expectedVersion: version }, OWNER);
    expect((await failure(applyVariantMatrix.call({ productId: created.id, expectedVersion: version }, OWNER))).code)
      .toBe("conflict");
    const archived = await getProductVariants.call({ productId: created.id }, OWNER);
    const variant = archived.variants[0]!;
    await db().update(productVariants).set({ status: "archived", isDefault: false }).where(eq(productVariants.id, variant.id));
    expect(
      (await failure(setDefaultVariant.call(
        { productId: created.id, expectedVersion: applied.version, variantId: variant.id },
        OWNER,
      ))).code,
    ).toBe("conflict");
  });
});
