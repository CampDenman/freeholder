// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.21 checkout and C5.22 orders from a cart.

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { createContact } from "@/core/contacts/service";
import { createLocationService } from "@/core/locations/service";
import { productVariants } from "@/modules/catalog/schema";
import {
  addCartItem,
  applyVariantMatrix,
  availability,
  cancelOrder,
  checkoutCart,
  createPriceList,
  createProduct,
  createShippingMethod,
  createShippingZone,
  enableInventory,
  getOrCreateCart,
  getOrder,
  getProductVariants,
  payOrder,
  recordStockMovement,
  setPriceListEntry,
} from "@/modules/catalog/service";
import { createPayment, getInvoice, settlePayment } from "@/modules/invoicing/invoice-service";
import {
  ANONYMOUS,
  closeDb,
  failure,
  hasDatabase,
  OWNER,
  truncateSpine,
} from "../helpers/spine";

describe.runIf(hasDatabase)("catalog orders", { timeout: 30_000 }, () => {
  beforeEach(truncateSpine);
  afterAll(closeDb);

  async function sellable(slug: string, ship = false) {
    const product = await createProduct.call(
      { name: ship ? "Print" : "Download", slug, kind: ship ? "physical" : "digital" },
      OWNER,
    );
    const updated = await applyVariantMatrix.call({ productId: product.id, expectedVersion: product.version }, OWNER);
    const bundle = await getProductVariants.call({ productId: updated.id }, OWNER);
    const variant = bundle.variants[0]!;
    if (!ship) {
      await db().update(productVariants).set({ requiresShipping: false }).where(eq(productVariants.id, variant.id));
    }
    const list = await createPriceList.call({ name: `${slug} retail`, currency: "CAD", kind: "retail" }, OWNER);
    await setPriceListEntry.call({ priceListId: list.id, variantId: variant.id, amount: "25.00" }, OWNER);
    return variant;
  }

  it("checks out a digital cart into an issued invoice and refuses a second conversion", async () => {
    const variant = await sellable("dl");
    const contact = await createContact.call({ name: "Eve", email: "eve@example.test" }, OWNER);
    const basket = await getOrCreateCart.call({ contactId: contact.id, currency: "CAD" }, OWNER);
    await addCartItem.call({ cartId: basket.cart.id, variantId: variant.id, quantity: 2 }, OWNER);
    expect((await failure(checkoutCart.call({
      cartId: basket.cart.id,
      contactId: contact.id,
      idempotencyKey: "order-dl-1",
      acceptedTerms: false as unknown as true,
    }, OWNER))).code).toBe("validation");

    // Anonymous checkout against a named contact is authority nobody proved:
    // the storefront path verifies the shopper first and composes as system.
    expect(
      (
        await failure(
          checkoutCart.call(
            {
              cartId: basket.cart.id,
              contactId: contact.id,
              idempotencyKey: "order-dl-1",
              acceptedTerms: true,
            },
            ANONYMOUS,
          ),
        )
      ).code,
    ).toBe("permission");

    const placed = await checkoutCart.call(
      {
        cartId: basket.cart.id,
        contactId: contact.id,
        idempotencyKey: "order-dl-1",
        acceptedTerms: true,
      },
      OWNER,
    );
    expect(placed.order.status).toBe("pending_payment");
    expect(placed.order.contactId).toBe(contact.id);
    expect(placed.lines).toHaveLength(1);
    expect(placed.order.subtotalMinor).toBe(5_000);
    expect(placed.order.invoiceId).toBeTruthy();
    const invoice = await getInvoice.call({ id: placed.order.invoiceId! }, OWNER);
    expect(invoice.invoice.status).toBe("sent");
    expect(invoice.invoice.sourceType).toBe("order");
    expect(invoice.invoice.sourceId).toBe(placed.order.id);

    const retry = await checkoutCart.call(
      {
        cartId: basket.cart.id,
        contactId: contact.id,
        idempotencyKey: "order-dl-1",
        acceptedTerms: true,
      },
      OWNER,
    );
    expect(retry.order.id).toBe(placed.order.id);
    expect((await failure(payOrder.call({ id: placed.order.id }, OWNER))).message).toMatch(/not settled/);
  });

  it("quotes shipping for a physical cart, then pays and keeps stock on hold until shipment", async () => {
    const studio = await createLocationService.call(
      { name: "Studio", slug: "order-studio", city: "Courtenay", country: "CA" },
      OWNER,
    );
    const variant = await sellable("ship", true);
    const item = await enableInventory.call({ variantId: variant.id, locationId: studio.id }, OWNER);
    await recordStockMovement.call({ itemId: item.id, delta: 5, reason: "receipt" }, OWNER);
    const zone = await createShippingZone.call({ name: "World", countries: [], regions: [], postalPatterns: [] }, OWNER);
    await createShippingMethod.call({
      zoneId: zone.id,
      name: "Parcel",
      kind: "flat",
      currency: "CAD",
      amount: "8.00",
    }, OWNER);

    const contact = await createContact.call({ name: "Fay", email: "fay@example.test" }, OWNER);
    const basket = await getOrCreateCart.call({ contactId: contact.id, currency: "CAD" }, OWNER);
    await addCartItem.call(
      { cartId: basket.cart.id, variantId: variant.id, quantity: 1, locationId: studio.id },
      OWNER,
    );
    const reserved = await availability.call({ variantId: variant.id, locationId: studio.id, quantity: 1 }, OWNER);
    expect(reserved).toMatchObject({ tracked: true, available: true });

    const placed = await checkoutCart.call(
      {
        cartId: basket.cart.id,
        contactId: contact.id,
        idempotencyKey: "order-ship-1",
        acceptedTerms: true,
        shippingAddress: { country: "CA", region: "BC", postalCode: "V9N1A1", city: "Courtenay" },
      },
      OWNER,
    );
    expect(placed.order.shippingMinor).toBe(800);
    expect(placed.order.totalMinor).toBeGreaterThanOrEqual(placed.order.subtotalMinor + 800);

    const payment = await createPayment.call(
      {
        invoiceId: placed.order.invoiceId!,
        provider: "manual",
        method: "bank_transfer",
        amountMinor: placed.order.totalMinor,
        idempotencyKey: "pay-ship-1",
      },
      OWNER,
    );
    await settlePayment.call({ id: payment.id, providerRef: "manual:ship" }, OWNER);
    const paid = await payOrder.call({ id: placed.order.id }, OWNER);
    expect(paid.order.status).toBe("paid");
    const after = await availability.call({ variantId: variant.id, locationId: studio.id, quantity: 1 }, OWNER);
    expect(after).toMatchObject({ tracked: true, onHand: 5, reserved: 1, available: true, canPromise: 4 });
  });

  it("cancels an unpaid order and voids its invoice", async () => {
    const variant = await sellable("cancel");
    const contact = await createContact.call({ name: "Gus", email: "gus@example.test" }, OWNER);
    const basket = await getOrCreateCart.call({ contactId: contact.id, currency: "CAD" }, OWNER);
    await addCartItem.call({ cartId: basket.cart.id, variantId: variant.id, quantity: 1 }, OWNER);
    const placed = await checkoutCart.call(
      {
        cartId: basket.cart.id,
        contactId: contact.id,
        idempotencyKey: "order-cancel-1",
        acceptedTerms: true,
      },
      OWNER,
    );
    const cancelled = await cancelOrder.call({ id: placed.order.id }, OWNER);
    expect(cancelled.order.status).toBe("cancelled");
    const invoice = await getInvoice.call({ id: placed.order.invoiceId! }, OWNER);
    expect(invoice.invoice.status).toBe("void");
    expect((await getOrder.call({ id: placed.order.id }, OWNER)).order.status).toBe("cancelled");
  });
});
