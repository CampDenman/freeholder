// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C11.02: product browse → variant/price/tax/stock → cart → mixed checkout →
// payment → split/digital fulfillment → return/refund. Checkout is the catalog
// service (there is no public storefront cart). Manual payment adapter doubles
// stand in for hosted settlement — this does not claim a live charge.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { createContact } from "@/core/contacts/service";
import { createLocationService } from "@/core/locations/service";
import { updateBusiness } from "@/core/settings/service";
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
  getOrCreateCart,
  getOrder,
  getProductVariants,
  listDigitalDeliveries,
  listVisibleProducts,
  payOrder,
  receiveReturn,
  recordStockMovement,
  refundReturn,
  requestReturn,
  resolveVisibleProduct,
  setPriceListEntry,
  shipFulfillment,
  activateProduct,
} from "@/modules/catalog/service";
import { createTaxCategory } from "@/modules/invoicing/tax-service";
import { createPayment, getInvoice, settlePayment } from "@/modules/invoicing/invoice-service";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

describe.runIf(hasDatabase)("C11.02 catalog browse to refund", { timeout: 60_000 }, () => {
  beforeEach(async () => {
    await truncateSpine();
    await updateBusiness.call(
      {
        name: "C11 Shop",
        country: "CA",
        baseCurrency: "CAD",
        timezone: "America/Vancouver",
      },
      OWNER,
    );
  });
  afterAll(closeDb);

  it("browses, checks out a mixed cart, splits fulfillment and refunds", async () => {
    const tax = await createTaxCategory.call(
      { code: "c11_standard", name: "C11 standard taxable" },
      OWNER,
    );
    const studio = await createLocationService.call(
      { name: "Studio", slug: "c11-studio", city: "Courtenay", country: "CA" },
      OWNER,
    );

    const print = await createProduct.call(
      { name: "Coastal print", slug: "c11-print", kind: "physical", taxCategoryId: tax.id },
      OWNER,
    );
    const printLive = await applyVariantMatrix.call(
      { productId: print.id, expectedVersion: print.version },
      OWNER,
    );
    await activateProduct.call({ id: printLive.id, expectedVersion: printLive.version }, OWNER);
    const printVariant = (await getProductVariants.call({ productId: printLive.id }, OWNER)).variants[0]!;
    const printList = await createPriceList.call({ name: "CAD prints", currency: "CAD", kind: "retail" }, OWNER);
    await setPriceListEntry.call({ priceListId: printList.id, variantId: printVariant.id, amount: "20.00" }, OWNER);
    const stock = await enableInventory.call({ variantId: printVariant.id, locationId: studio.id }, OWNER);
    await recordStockMovement.call({ itemId: stock.id, delta: 5, reason: "receipt" }, OWNER);

    const guide = await createProduct.call(
      { name: "Sitting guide", slug: "c11-guide", kind: "digital", taxCategoryId: tax.id },
      OWNER,
    );
    const guideLive = await applyVariantMatrix.call(
      { productId: guide.id, expectedVersion: guide.version },
      OWNER,
    );
    await db()
      .update(productVariants)
      .set({ requiresShipping: false })
      .where(eq(productVariants.id, (await getProductVariants.call({ productId: guideLive.id }, OWNER)).variants[0]!.id));
    await activateProduct.call({ id: guideLive.id, expectedVersion: guideLive.version }, OWNER);
    const guideVariant = (await getProductVariants.call({ productId: guideLive.id }, OWNER)).variants[0]!;
    const guideList = await createPriceList.call({ name: "CAD digital", currency: "CAD", kind: "retail" }, OWNER);
    await setPriceListEntry.call({ priceListId: guideList.id, variantId: guideVariant.id, amount: "10.00" }, OWNER);

    const visible = await listVisibleProducts.call({ limit: 20 }, { kind: "anonymous" });
    expect(visible.map((row) => row.slug)).toEqual(expect.arrayContaining(["c11-print", "c11-guide"]));
    expect((await resolveVisibleProduct.call({ slug: "c11-print" }, { kind: "anonymous" }))?.name).toBe(
      "Coastal print",
    );
    expect(print.taxCategoryId).toBe(tax.id);
    const shelf = await availability.call(
      { variantId: printVariant.id, locationId: studio.id, quantity: 1 },
      OWNER,
    );
    expect(shelf).toMatchObject({ tracked: true, onHand: 5, available: true });

    const zone = await createShippingZone.call(
      { name: "World", countries: [], regions: [], postalPatterns: [] },
      OWNER,
    );
    await createShippingMethod.call(
      { zoneId: zone.id, name: "Parcel", kind: "flat", currency: "CAD", amount: "5.00" },
      OWNER,
    );
    const contact = await createContact.call({ name: "Hal", email: "hal-c11@example.test" }, OWNER);
    const basket = await getOrCreateCart.call({ contactId: contact.id, currency: "CAD" }, OWNER);
    await addCartItem.call(
      { cartId: basket.cart.id, variantId: printVariant.id, quantity: 2, locationId: studio.id },
      OWNER,
    );
    await addCartItem.call({ cartId: basket.cart.id, variantId: guideVariant.id, quantity: 1 }, OWNER);

    const placed = await checkoutCart.call(
      {
        cartId: basket.cart.id,
        contactId: contact.id,
        idempotencyKey: `c11-02-${contact.id}`,
        acceptedTerms: true,
        shippingAddress: { country: "CA", city: "Courtenay" },
      },
      OWNER,
    );
    expect(placed.lines.length).toBe(2);
    expect(placed.order.invoiceId).toBeTruthy();
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
    expect(await listDigitalDeliveries.call({ orderId: paid.order.id }, OWNER)).toHaveLength(1);

    const physical = paid.lines.find((line) => line.variantId === printVariant.id)!;
    const first = await createFulfillment.call(
      { orderId: paid.order.id, locationId: studio.id, items: [{ orderItemId: physical.id, quantity: 1 }] },
      OWNER,
    );
    await shipFulfillment.call({ id: first.fulfillment.id, trackingNumber: "C11-1", carrier: "manual" }, OWNER);
    const second = await createFulfillment.call(
      { orderId: paid.order.id, locationId: studio.id, items: [{ orderItemId: physical.id, quantity: 1 }] },
      OWNER,
    );
    await shipFulfillment.call({ id: second.fulfillment.id, trackingNumber: "C11-2" }, OWNER);
    await deliverFulfillment.call({ id: second.fulfillment.id }, OWNER);
    expect((await getOrder.call({ id: paid.order.id }, OWNER)).order.status).toBe("fulfilled");

    const requested = await requestReturn.call(
      {
        orderId: paid.order.id,
        reason: "Damaged in transit",
        items: [{ orderItemId: physical.id, quantity: 1 }],
      },
      OWNER,
    );
    await decideReturn.call({ id: requested.return.id, decision: "approved" }, OWNER);
    await receiveReturn.call({ id: requested.return.id, locationId: studio.id }, OWNER);
    const refunded = await refundReturn.call(
      { id: requested.return.id, idempotencyKey: `rma-${requested.return.id}` },
      OWNER,
    );
    expect(refunded.return.status).toBe("refunded");
    const invoice = await getInvoice.call({ id: paid.order.invoiceId! }, OWNER);
    expect(invoice.invoice.refundedMinor).toBeGreaterThan(0);
  });
});
