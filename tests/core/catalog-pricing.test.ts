// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.13 price lists, audiences and currency-safe resolution.

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createContact } from "@/core/contacts/service";
import {
  applyVariantMatrix,
  createCustomerGroup,
  createPriceList,
  createProduct,
  getProductVariants,
  resolvePrice,
  setPriceBreak,
  setPriceListEntry,
} from "@/modules/catalog/service";
import {
  closeDb,
  failure,
  hasDatabase,
  OWNER,
  truncateSpine,
} from "../helpers/spine";

describe.runIf(hasDatabase)("catalog pricing", { timeout: 30_000 }, () => {
  beforeEach(truncateSpine);
  afterAll(closeDb);

  async function variant() {
    const product = await createProduct.call({ name: "Print", slug: "print", kind: "physical" }, OWNER);
    const updated = await applyVariantMatrix.call({ productId: product.id, expectedVersion: product.version }, OWNER);
    const bundle = await getProductVariants.call({ productId: updated.id }, OWNER);
    return bundle.variants[0]!;
  }

  it("resolves contract over wholesale over sale over retail and refuses another currency", async () => {
    const item = await variant();
    const wholesale = await createCustomerGroup.call({ name: "Trade", tag: "wholesale" }, OWNER);
    const trade = await createContact.call({ name: "Trade buyer", email: "trade@example.test", tags: ["wholesale"] }, OWNER);
    const guest = await createContact.call({ name: "Guest", email: "guest@example.test" }, OWNER);

    const retail = await createPriceList.call({ name: "CAD retail", currency: "CAD", kind: "retail", priority: 1 }, OWNER);
    const sale = await createPriceList.call({
      name: "CAD sale",
      currency: "CAD",
      kind: "sale",
      priority: 10,
      startsAt: new Date("2026-01-01T00:00:00Z"),
      endsAt: new Date("2026-12-31T00:00:00Z"),
    }, OWNER);
    const tradeList = await createPriceList.call({
      name: "CAD wholesale",
      currency: "CAD",
      kind: "wholesale",
      customerGroupId: wholesale.id,
      priority: 5,
    }, OWNER);
    const contract = await createPriceList.call({
      name: "Ada contract",
      currency: "CAD",
      kind: "contract",
      contactId: trade.id,
      priority: 1,
    }, OWNER);
    await setPriceListEntry.call({ priceListId: retail.id, variantId: item.id, amount: "80.00" }, OWNER);
    await setPriceListEntry.call({ priceListId: sale.id, variantId: item.id, amount: "70.00" }, OWNER);
    await setPriceListEntry.call({ priceListId: tradeList.id, variantId: item.id, amount: "60.00" }, OWNER);
    await setPriceListEntry.call({ priceListId: contract.id, variantId: item.id, amount: "50.00" }, OWNER);

    const forGuest = await resolvePrice.call({ variantId: item.id, currency: "CAD", contactId: guest.id, at: new Date("2026-06-01") }, OWNER);
    expect(forGuest).toMatchObject({ available: true, amountMinor: 7000, kind: "sale" });
    const forTrade = await resolvePrice.call({ variantId: item.id, currency: "CAD", contactId: trade.id, at: new Date("2026-06-01") }, OWNER);
    expect(forTrade).toMatchObject({ available: true, amountMinor: 5000, kind: "contract" });
    const usd = await resolvePrice.call({ variantId: item.id, currency: "USD" }, OWNER);
    expect(usd.available).toBe(false);
    const unit = await resolvePrice.call({ variantId: item.id, currency: "CAD", contactId: guest.id, quantity: 1, at: new Date("2026-06-01") }, OWNER);
    expect(unit.totalMinor).toBe(7000);
    await setPriceBreak.call({ priceListId: sale.id, mode: "volume", minQty: 10, amount: "50.00" }, OWNER);
    const volume = await resolvePrice.call({ variantId: item.id, currency: "CAD", contactId: guest.id, quantity: 12, at: new Date("2026-06-01") }, OWNER);
    expect(volume.totalMinor).toBe(60_000);
    expect(volume.breakMode).toBe("volume");
    expect((await failure(createPriceList.call({ name: "Bad contract", currency: "CAD", kind: "contract" }, OWNER))).code)
      .toBe("validation");
  });
});
