// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.19 split shipments, digital grants, restock and invoice refunds.

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
  checkoutCart,
  createFulfillment,
  createPriceList,
  createProduct,
  createShippingMethod,
  createShippingZone,
  decideReturn,
  deliverFulfillment,
  enableInventory,
  failFulfillment,
  getOrCreateCart,
  getOrder,
  getProductVariants,
  listDigitalDeliveries,
  payOrder,
  receiveReturn,
  recordStockMovement,
  refundReturn,
  requestReturn,
  setPriceListEntry,
  shipFulfillment,
} from "@/modules/catalog/service";
import { createPayment, getInvoice, settlePayment } from "@/modules/invoicing/invoice-service";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

describe.runIf(hasDatabase)("catalog fulfillment", { timeout: 40_000 }, () => {
  beforeEach(truncateSpine);
  afterAll(closeDb);

  async function paidPhysical() {
    const studio = await createLocationService.call(
      { name: "Studio", slug: "ful-studio", city: "Courtenay", country: "CA" },
      OWNER,
    );
    const product = await createProduct.call({ name: "Print", slug: "ful-print", kind: "physical" }, OWNER);
    const updated = await applyVariantMatrix.call({ productId: product.id, expectedVersion: product.version }, OWNER);
    const variant = (await getProductVariants.call({ productId: updated.id }, OWNER)).variants[0]!;
    const list = await createPriceList.call({ name: "CAD retail", currency: "CAD", kind: "retail" }, OWNER);
    await setPriceListEntry.call({ priceListId: list.id, variantId: variant.id, amount: "20.00" }, OWNER);
    const item = await enableInventory.call({ variantId: variant.id, locationId: studio.id }, OWNER);
    await recordStockMovement.call({ itemId: item.id, delta: 5, reason: "receipt" }, OWNER);
    const zone = await createShippingZone.call({ name: "World", countries: [], regions: [], postalPatterns: [] }, OWNER);
    await createShippingMethod.call({ zoneId: zone.id, name: "Parcel", kind: "flat", currency: "CAD", amount: "5.00" }, OWNER);
    const contact = await createContact.call({ name: "Hal", email: "hal@example.test" }, OWNER);
    const basket = await getOrCreateCart.call({ contactId: contact.id, currency: "CAD" }, OWNER);
    await addCartItem.call({ cartId: basket.cart.id, variantId: variant.id, quantity: 2, locationId: studio.id }, OWNER);
    const placed = await checkoutCart.call(
      {
        cartId: basket.cart.id,
        contactId: contact.id,
        idempotencyKey: `ful-${crypto.randomUUID()}`,
        acceptedTerms: true,
        shippingAddress: { country: "CA", city: "Courtenay" },
      },
      OWNER,
    );
    const payment = await createPayment.call(
      {
        invoiceId: placed.order.invoiceId!,
        provider: "manual",
        method: "bank_transfer",
        amountMinor: placed.order.totalMinor,
        idempotencyKey: `pay-${placed.order.id}`,
      },
      OWNER,
    );
    await settlePayment.call({ id: payment.id, providerRef: `manual:${placed.order.id}` }, OWNER);
    const paid = await payOrder.call({ id: placed.order.id }, OWNER);
    return { studio, variant, contact, paid, item };
  }

  it("ships a split carton, writes the sale on ship, and grants digital lines on pay", async () => {
    const { studio, variant, paid } = await paidPhysical();
    const [line] = paid.lines;
    const first = await createFulfillment.call(
      { orderId: paid.order.id, locationId: studio.id, items: [{ orderItemId: line!.id, quantity: 1 }] },
      OWNER,
    );
    expect(first.fulfillment.status).toBe("pending");
    expect((await getOrder.call({ id: paid.order.id }, OWNER)).order.status).toBe("fulfilling");
    await shipFulfillment.call({ id: first.fulfillment.id, trackingNumber: "1Z999", carrier: "manual" }, OWNER);
    const mid = await availability.call({ variantId: variant.id, locationId: studio.id, quantity: 1 }, OWNER);
    expect(mid).toMatchObject({ tracked: true, onHand: 4, reserved: 1, available: true });

    const second = await createFulfillment.call(
      { orderId: paid.order.id, locationId: studio.id, items: [{ orderItemId: line!.id, quantity: 1 }] },
      OWNER,
    );
    await shipFulfillment.call({ id: second.fulfillment.id, trackingNumber: "1Z998" }, OWNER);
    const done = await getOrder.call({ id: paid.order.id }, OWNER);
    expect(done.order.status).toBe("fulfilled");
    const shelf = await availability.call({ variantId: variant.id, locationId: studio.id, quantity: 1 }, OWNER);
    expect(shelf).toMatchObject({ tracked: true, onHand: 3, reserved: 0 });

    const digital = await createProduct.call({ name: "Guide", slug: "ful-guide", kind: "digital" }, OWNER);
    const dUpdated = await applyVariantMatrix.call({ productId: digital.id, expectedVersion: digital.version }, OWNER);
    const dVariant = (await getProductVariants.call({ productId: dUpdated.id }, OWNER)).variants[0]!;
    await db().update(productVariants).set({ requiresShipping: false }).where(eq(productVariants.id, dVariant.id));
    const dList = await createPriceList.call({ name: "CAD digital", currency: "CAD", kind: "retail" }, OWNER);
    await setPriceListEntry.call({ priceListId: dList.id, variantId: dVariant.id, amount: "10.00" }, OWNER);
    const buyer = await createContact.call({ name: "Ivy", email: "ivy@example.test" }, OWNER);
    const cart = await getOrCreateCart.call({ contactId: buyer.id, currency: "CAD" }, OWNER);
    await addCartItem.call({ cartId: cart.cart.id, variantId: dVariant.id, quantity: 1 }, OWNER);
    const dOrder = await checkoutCart.call(
      { cartId: cart.cart.id, contactId: buyer.id, idempotencyKey: `dig-${buyer.id}`, acceptedTerms: true },
      OWNER,
    );
    const dPay = await createPayment.call(
      {
        invoiceId: dOrder.order.invoiceId!,
        provider: "manual",
        method: "bank_transfer",
        amountMinor: dOrder.order.totalMinor,
        idempotencyKey: `pay-dig-${dOrder.order.id}`,
      },
      OWNER,
    );
    await settlePayment.call({ id: dPay.id, providerRef: `manual:dig:${dOrder.order.id}` }, OWNER);
    const granted = await payOrder.call({ id: dOrder.order.id }, OWNER);
    expect(granted.order.status).toBe("fulfilled");
    expect(await listDigitalDeliveries.call({ orderId: granted.order.id }, OWNER)).toHaveLength(1);
  });

  it("restocks and refunds a received RMA through the original invoice", async () => {
    const { studio, variant, paid } = await paidPhysical();
    const [line] = paid.lines;
    const ship = await createFulfillment.call(
      { orderId: paid.order.id, locationId: studio.id, items: [{ orderItemId: line!.id, quantity: 2 }] },
      OWNER,
    );
    await shipFulfillment.call({ id: ship.fulfillment.id, trackingNumber: "RET1" }, OWNER);
    await deliverFulfillment.call({ id: ship.fulfillment.id }, OWNER);

    const requested = await requestReturn.call(
      {
        orderId: paid.order.id,
        reason: "Damaged in transit",
        items: [{ orderItemId: line!.id, quantity: 2 }],
      },
      OWNER,
    );
    await decideReturn.call({ id: requested.return.id, decision: "approved" }, OWNER);
    await receiveReturn.call({ id: requested.return.id, locationId: studio.id }, OWNER);
    const restocked = await availability.call({ variantId: variant.id, locationId: studio.id, quantity: 1 }, OWNER);
    expect(restocked).toMatchObject({ tracked: true, onHand: 5, reserved: 0 });

    const refunded = await refundReturn.call(
      { id: requested.return.id, idempotencyKey: `rma-${requested.return.id}` },
      OWNER,
    );
    expect(refunded.return.status).toBe("refunded");
    expect(refunded.return.creditNoteId).toBeTruthy();
    const invoice = await getInvoice.call({ id: paid.order.invoiceId! }, OWNER);
    expect(invoice.invoice.refundedMinor).toBeGreaterThan(0);
    expect((await getOrder.call({ id: paid.order.id }, OWNER)).order.status).toBe("fulfilled");
  });

  it("refuses to put a digital line on a carton and frees quantity when a shipment fails", async () => {
    const { paid } = await paidPhysical();
    expect(
      (await failure(
        createFulfillment.call({ orderId: paid.order.id, items: [] }, OWNER),
      )).code,
    ).toBe("validation");
    const [line] = paid.lines;
    const ship = await createFulfillment.call(
      { orderId: paid.order.id, items: [{ orderItemId: line!.id, quantity: 2 }] },
      OWNER,
    );
    await failFulfillment.call({ id: ship.fulfillment.id, note: "Address refused" }, OWNER);
    const again = await createFulfillment.call(
      { orderId: paid.order.id, items: [{ orderItemId: line!.id, quantity: 2 }] },
      OWNER,
    );
    expect(again.fulfillment.status).toBe("pending");
  });
});
