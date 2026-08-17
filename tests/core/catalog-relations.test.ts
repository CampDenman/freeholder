// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.12 relations and deterministic bundle quotes.

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  addBundleComponent,
  addProductRelation,
  applyVariantMatrix,
  createPriceList,
  createProduct,
  getProductVariants,
  quoteBundle,
  setPriceListEntry,
} from "@/modules/catalog/service";
import {
  closeDb,
  failure,
  hasDatabase,
  OWNER,
  truncateSpine,
} from "../helpers/spine";

describe.runIf(hasDatabase)("catalog relations and bundles", { timeout: 30_000 }, () => {
  beforeEach(truncateSpine);
  afterAll(closeDb);

  it("refuses a self-relation and quotes a bundle from component rules", async () => {
    const tray = await createProduct.call({ name: "Tray", slug: "tray", kind: "physical" }, OWNER);
    const cloth = await createProduct.call({ name: "Cloth", slug: "cloth", kind: "physical" }, OWNER);
    const bundle = await createProduct.call({ name: "Set", slug: "set", kind: "bundle" }, OWNER);
    expect((await failure(addProductRelation.call({
      productId: tray.id,
      expectedVersion: tray.version,
      relatedProductId: tray.id,
      kind: "upsell",
    }, OWNER))).code).toBe("validation");
    await addProductRelation.call({
      productId: tray.id,
      expectedVersion: tray.version,
      relatedProductId: cloth.id,
      kind: "accessory",
    }, OWNER);

    const trayVariant = (await applyVariantMatrix.call({ productId: tray.id, expectedVersion: tray.version + 1 }, OWNER),
      await getProductVariants.call({ productId: tray.id }, OWNER)).variants[0]!;
    const clothVariant = (await applyVariantMatrix.call({ productId: cloth.id, expectedVersion: cloth.version }, OWNER),
      await getProductVariants.call({ productId: cloth.id }, OWNER)).variants[0]!;
    const list = await createPriceList.call({ name: "CAD retail", currency: "CAD", kind: "retail" }, OWNER);
    await setPriceListEntry.call({ priceListId: list.id, variantId: trayVariant.id, amount: "40.00" }, OWNER);
    await setPriceListEntry.call({ priceListId: list.id, variantId: clothVariant.id, amount: "10.00" }, OWNER);

    let version = bundle.version;
    version = (await addBundleComponent.call({
      productId: bundle.id,
      expectedVersion: version,
      componentVariantId: trayVariant.id,
      quantity: 1,
      priceMode: "sum",
    }, OWNER)).version;
    await addBundleComponent.call({
      productId: bundle.id,
      expectedVersion: version,
      componentVariantId: clothVariant.id,
      quantity: 2,
      priceMode: "percent_off",
      percentOffPpm: 500_000,
    }, OWNER);

    const quote = await quoteBundle.call({ productId: bundle.id, currency: "CAD", quantity: 1 }, OWNER);
    expect(quote.available).toBe(true);
    expect(quote.totalMinor).toBe(4000 + 1000);
    expect((await failure(addBundleComponent.call({
      productId: tray.id,
      expectedVersion: tray.version + 2,
      componentVariantId: clothVariant.id,
    }, OWNER))).code).toBe("validation");
  });
});
