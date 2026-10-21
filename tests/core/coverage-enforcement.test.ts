// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C6.18: the submission side of service-area coverage.
//
// The coverage check a visitor runs on a page is information; checkout is the
// gate. `catalog.checkoutCart` re-validates the shipping destination against
// the areas the owner actually named, inside the order's own transaction, and
// refuses a definite "outside" cleanly — before anything is written. The
// negative cases matter as much as the positive one: an address an unnamed
// area (a radius, a region, nothing at all) might reach is never refused,
// because coverage is never inferred in either direction.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/core/db";
import { createContact } from "@/core/contacts/service";
import {
  createLocationService,
  setServiceArea,
} from "@/core/locations/service";
import { orders } from "@/modules/catalog/schema";
import {
  addCartItem,
  applyVariantMatrix,
  checkoutCart,
  createPriceList,
  createProduct,
  createShippingMethod,
  createShippingZone,
  enableInventory,
  getOrCreateCart,
  getProductVariants,
  recordStockMovement,
  setPriceListEntry,
} from "@/modules/catalog/service";
import {
  closeDb,
  failure,
  hasDatabase,
  OWNER,
  truncateSpine,
} from "../helpers/spine";

describe.runIf(hasDatabase)("checkout enforces service-area coverage", { timeout: 30_000 }, () => {
  beforeEach(truncateSpine);
  afterAll(closeDb);

  async function physicalCart(slug: string) {
    const studio = await createLocationService.call(
      { name: "Studio", slug: `${slug}-studio`, city: "Courtenay", country: "CA" },
      OWNER,
    );
    const product = await createProduct.call(
      { name: "Print", slug, kind: "physical" },
      OWNER,
    );
    const updated = await applyVariantMatrix.call(
      { productId: product.id, expectedVersion: product.version },
      OWNER,
    );
    const variant = (await getProductVariants.call({ productId: updated.id }, OWNER)).variants[0]!;
    const list = await createPriceList.call(
      { name: `${slug} retail`, currency: "CAD", kind: "retail" },
      OWNER,
    );
    await setPriceListEntry.call(
      { priceListId: list.id, variantId: variant.id, amount: "25.00" },
      OWNER,
    );
    const item = await enableInventory.call(
      { variantId: variant.id, locationId: studio.id },
      OWNER,
    );
    await recordStockMovement.call({ itemId: item.id, delta: 5, reason: "receipt" }, OWNER);
    const zone = await createShippingZone.call(
      { name: "World", countries: [], regions: [], postalPatterns: [] },
      OWNER,
    );
    await createShippingMethod.call(
      { zoneId: zone.id, name: "Parcel", kind: "flat", currency: "CAD", amount: "8.00" },
      OWNER,
    );
    const contact = await createContact.call(
      { name: "Hana", email: `${slug}@example.test` },
      OWNER,
    );
    const basket = await getOrCreateCart.call(
      { contactId: contact.id, currency: "CAD" },
      OWNER,
    );
    await addCartItem.call(
      { cartId: basket.cart.id, variantId: variant.id, quantity: 1, locationId: studio.id },
      OWNER,
    );
    return { studio, basket };
  }

  const terms = { acceptedTerms: true as const, idempotencyKey: "coverage-order-1" };

  async function orderCount() {
    const [row] = await db()
      .select({ count: sql<number>`count(*)::int` })
      .from(orders);
    return row?.count ?? 0;
  }

  it("takes an order whose destination the owner named", async () => {
    const { studio, basket } = await physicalCart("in-area");
    await setServiceArea.call(
      {
        locationId: studio.id,
        area: { kind: "postal_codes", postalCodes: ["V9N3A1"] },
      },
      OWNER,
    );

    const placed = await checkoutCart.call(
      {
        cartId: basket.cart.id,
        contactId: basket.cart.contactId!,
        ...terms,
        shippingAddress: { country: "CA", region: "BC", postalCode: "V9N 3A1", city: "Courtenay" },
      },
      OWNER,
    );
    expect(placed.order.status).toBe("pending_payment");
    expect(await orderCount()).toBe(1);
  });

  it("refuses an order outside every named area, before anything is written", async () => {
    const { studio, basket } = await physicalCart("out-area");
    await setServiceArea.call(
      {
        locationId: studio.id,
        area: { kind: "postal_codes", postalCodes: ["V9N3A1"] },
      },
      OWNER,
    );

    const refused = await failure(
      checkoutCart.call(
        {
          cartId: basket.cart.id,
          contactId: basket.cart.contactId!,
          ...terms,
          shippingAddress: { country: "CA", region: "BC", postalCode: "V8W 1A1", city: "Victoria" },
        },
        OWNER,
      ),
    );
    expect(refused.code).toBe("validation");
    // Visitor-safe wording: the fact, the postcode, an invitation to ask —
    // nothing about how the system works.
    expect(refused.message).toContain("V8W1A1");
    expect(refused.message).toContain("outside the areas we have listed");
    expect(await orderCount()).toBe(0);

    // Refusal is clean: the cart is still open and a corrected address checks
    // out with the same idempotency key — nothing half-wrote.
    const placed = await checkoutCart.call(
      {
        cartId: basket.cart.id,
        contactId: basket.cart.contactId!,
        ...terms,
        shippingAddress: { country: "CA", region: "BC", postalCode: "V9N3A1", city: "Courtenay" },
      },
      OWNER,
    );
    expect(placed.order.status).toBe("pending_payment");
  });

  /**
   * The submission boundary is the query boundary: a code one character off a
   * listed code is refused at checkout exactly as the coverage check refuses
   * it on the page.
   */
  it("refuses a boundary postcode that shares a prefix with a listed code", async () => {
    const { studio, basket } = await physicalCart("boundary");
    await setServiceArea.call(
      {
        locationId: studio.id,
        area: { kind: "postal_codes", postalCodes: ["V9N3A1"] },
      },
      OWNER,
    );

    const refused = await failure(
      checkoutCart.call(
        {
          cartId: basket.cart.id,
          contactId: basket.cart.contactId!,
          ...terms,
          shippingAddress: { country: "CA", region: "BC", postalCode: "V9N 3A2", city: "Courtenay" },
        },
        OWNER,
      ),
    );
    expect(refused.code).toBe("validation");
    expect(await orderCount()).toBe(0);
  });

  it("never refuses on an unnamed area: a radius the address may well sit inside", async () => {
    const { studio, basket } = await physicalCart("radius");
    await setServiceArea.call(
      {
        locationId: studio.id,
        area: {
          kind: "radius",
          centerLatitude: 49.687,
          centerLongitude: -124.996,
          radiusKm: 15,
        },
      },
      OWNER,
    );

    // The shop is fifteen kilometres from Victoria as the crow flies and the
    // van does not go there — but the owner named a radius, and software that
    // inferred "outside" from a shape it cannot check would be inventing
    // coverage in the no direction. The order is taken; a human says no later
    // if no was the answer.
    const placed = await checkoutCart.call(
      {
        cartId: basket.cart.id,
        contactId: basket.cart.contactId!,
        ...terms,
        shippingAddress: { country: "CA", region: "BC", postalCode: "V8W 1A1", city: "Victoria" },
      },
      OWNER,
    );
    expect(placed.order.status).toBe("pending_payment");
  });

  it("never refuses on a named region, or on an owner who named nothing at all", async () => {
    const { studio, basket } = await physicalCart("region");
    await setServiceArea.call(
      { locationId: studio.id, area: { kind: "regions", regions: ["Comox Valley"] } },
      OWNER,
    );

    const regional = await checkoutCart.call(
      {
        cartId: basket.cart.id,
        contactId: basket.cart.contactId!,
        ...terms,
        shippingAddress: { country: "CA", region: "BC", postalCode: "V8W 1A1", city: "Victoria" },
      },
      OWNER,
    );
    expect(regional.order.status).toBe("pending_payment");
  });

  it("never refuses when the business has no service area at all", async () => {
    const { basket } = await physicalCart("no-area");

    const placed = await checkoutCart.call(
      {
        cartId: basket.cart.id,
        contactId: basket.cart.contactId!,
        ...terms,
        shippingAddress: { country: "CA", region: "BC", postalCode: "V8W 1A1", city: "Victoria" },
      },
      OWNER,
    );
    expect(placed.order.status).toBe("pending_payment");
  });

  /**
   * Scoped permission is not a bypass: enforcement lives in the service every
   * caller composes through, so the owner pressing the button in the admin
   * gets the same refusal a storefront visitor would.
   */
  it("refuses the owner too — the gate is not a client-side check", async () => {
    const { studio, basket } = await physicalCart("owner-refused");
    await setServiceArea.call(
      {
        locationId: studio.id,
        area: { kind: "postal_codes", postalCodes: ["V9N3A1"] },
      },
      OWNER,
    );

    const refused = await failure(
      checkoutCart.call(
        {
          cartId: basket.cart.id,
          contactId: basket.cart.contactId!,
          ...terms,
          shippingAddress: { country: "CA", region: "BC", postalCode: "V8W 1A1", city: "Victoria" },
        },
        OWNER,
      ),
    );
    expect(refused.code).toBe("validation");
    expect(await orderCount()).toBe(0);
  });
});
