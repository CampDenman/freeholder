// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.21 checkout and C5.22 orders from a cart.

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { createContact } from "@/core/contacts/service";
import { createLocationService } from "@/core/locations/service";
import { orderPaymentMilestones, orders, productVariants } from "@/modules/catalog/schema";
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
  releaseOrderPaymentMilestone,
  setPriceListEntry,
} from "@/modules/catalog/service";
import { cancelPayment, createPayment, failPayment, getInvoice, settlePayment } from "@/modules/invoicing/invoice-service";
import { getCustomerInvoice } from "@/modules/invoicing/customer-service";
import { invoiceAccessToken } from "@/modules/invoicing/customer-tokens";
import { setModuleConfig } from "@/core/settings/service";
import { checkoutTermsHash } from "@/modules/catalog/checkout-policy";
import {
  ANONYMOUS,
  CUSTOMER,
  STAFF,
  closeDb,
  failure,
  hasDatabase,
  OWNER,
  truncateSpine,
} from "../helpers/spine";

describe.runIf(hasDatabase)("catalog orders", { timeout: 30_000 }, () => {
  beforeEach(truncateSpine);
  afterAll(closeDb);

  it("requires catalog read authority for private order details even when the caller knows the ID", async () => {
    const contact = await createContact.call({ name: "Private Buyer", email: "private-order@example.test" }, OWNER);
    const [order] = await db().insert(orders).values({ contactId: contact.id, currency: "CAD", shippingAddress: { street: "Private street" } }).returning();
    const input = { id: order!.id };
    await expect(getOrder.call(input, ANONYMOUS)).rejects.toMatchObject({ code: "permission" });
    await expect(getOrder.call(input, CUSTOMER)).rejects.toMatchObject({ code: "permission" });
    await expect(getOrder.call(input, { ...STAFF, grants: [{ module: "contacts", access: "view" }] })).rejects.toMatchObject({ code: "permission" });
    const key = { kind: "agent" as const, keyName: "order-reader", scopes: ["catalog.createProduct"] };
    await expect(getOrder.call(input, key)).rejects.toMatchObject({ code: "permission" });
    expect((await getOrder.call(input, { ...key, scopes: ["catalog.getOrder"] })).order.shippingAddress).toEqual({ street: "Private street" });
    expect((await getOrder.call(input, { ...STAFF, grants: [{ module: "catalog", access: "view" }] })).order.id).toBe(order!.id);
  });

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

  it("snapshots binding terms and settles a 50/50 order only after seller release", async () => {
    await setModuleConfig.call({ module: "catalog", config: {
      checkoutPayment: { mode: "milestones", currency: "CAD", firstPayment: { type: "percent", sharePpm: 500_000 },
        milestones: [{ label: "Down payment at checkout", sharePpm: 500_000 }, { label: "Balance before delivery", sharePpm: 500_000 }] },
      checkoutTerms: { version: "capsule-v1", title: "Purchase agreement", body: "The full CAD price is binding. Half is due now; the balance is due before delivery." },
    } }, OWNER);
    const product = await createProduct.call({ name: "Capsule", slug: "capsule-order", kind: "physical" }, OWNER);
    const updated = await applyVariantMatrix.call({ productId: product.id, expectedVersion: product.version }, OWNER);
    const variant = (await getProductVariants.call({ productId: updated.id }, OWNER)).variants[0]!;
    const list = await createPriceList.call({ name: "CAD capsules", currency: "CAD", kind: "retail" }, OWNER);
    await setPriceListEntry.call({ priceListId: list.id, variantId: variant.id, amount: "79999.01" }, OWNER);
    const zone = await createShippingZone.call({ name: "Capsule destinations", countries: [], regions: [], postalPatterns: [] }, OWNER);
    await createShippingMethod.call({ zoneId: zone.id, name: "Included delivery", kind: "flat", currency: "CAD", amount: "0.00" }, OWNER);
    const contact = await createContact.call({ name: "Capsule Buyer", email: "capsule-buyer@example.test" }, OWNER);
    const basket = await getOrCreateCart.call({ contactId: contact.id, currency: "CAD" }, OWNER);
    await addCartItem.call({ cartId: basket.cart.id, variantId: variant.id, quantity: 1 }, OWNER);
    const input = { cartId: basket.cart.id, contactId: contact.id, idempotencyKey: "capsule-odd-cent", acceptedTerms: true as const, termsVersion: "capsule-v1", termsHash: checkoutTermsHash("The full CAD price is binding. Half is due now; the balance is due before delivery."), shippingAddress: { country: "CA" } };
    expect((await failure(checkoutCart.call({ ...input, termsHash: "0".repeat(64) }, OWNER))).code).toBe("conflict");
    const placed = await checkoutCart.call(input, OWNER);
    expect(placed.order.totalMinor).toBe(7_999_901);
    expect(placed.order.checkoutTermsSnapshot).toMatchObject({ version: "capsule-v1", body: "The full CAD price is binding. Half is due now; the balance is due before delivery.", sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
    const stages = await db().select().from(orderPaymentMilestones).where(eq(orderPaymentMilestones.orderId, placed.order.id)).orderBy(orderPaymentMilestones.position);
    expect(stages.map((stage) => stage.amountMinor)).toEqual([3_999_950, 3_999_951]);
    expect(stages[0]?.releasedAt).toBeTruthy();
    expect(stages[1]?.releasedAt).toBeNull();
    const invoice = await getInvoice.call({ id: placed.order.invoiceId! }, OWNER);
    const token = invoiceAccessToken(invoice.invoice);
    expect((await getCustomerInvoice.call({ id: invoice.invoice.id, token }, ANONYMOUS)).nextPaymentMinor).toBe(3_999_950);
    expect((await failure(releaseOrderPaymentMilestone.call({ orderId: placed.order.id, position: 1 }, OWNER))).code).toBe("conflict");
    const first = await createPayment.call({ invoiceId: invoice.invoice.id, provider: "manual", method: "bank_transfer", amountMinor: 3_999_950, idempotencyKey: "capsule-first" }, OWNER);
    await settlePayment.call({ id: first.id, providerRef: "manual:capsule-first" }, OWNER);
    expect((await getOrder.call({ id: placed.order.id }, OWNER)).order.status).toBe("partially_paid");
    expect((await getCustomerInvoice.call({ id: invoice.invoice.id, token }, ANONYMOUS)).nextPaymentMinor).toBeNull();
    expect((await failure(cancelOrder.call({ id: placed.order.id }, OWNER))).code).toBe("conflict");
    await releaseOrderPaymentMilestone.call({ orderId: placed.order.id, position: 1 }, OWNER);
    expect((await getCustomerInvoice.call({ id: invoice.invoice.id, token }, ANONYMOUS)).nextPaymentMinor).toBe(3_999_951);
    const final = await createPayment.call({ invoiceId: invoice.invoice.id, provider: "manual", method: "bank_transfer", amountMinor: 3_999_951, idempotencyKey: "capsule-final" }, OWNER);
    await settlePayment.call({ id: final.id, providerRef: "manual:capsule-final" }, OWNER);
    await settlePayment.call({ id: final.id, providerRef: "manual:capsule-final" }, OWNER);
    expect((await getOrder.call({ id: placed.order.id }, OWNER)).order.status).toBe("paid");
    expect((await getInvoice.call({ id: invoice.invoice.id }, OWNER)).invoice.paidMinor).toBe(7_999_901);
  });

  it("refuses cancellation while a provider attempt can still settle", async () => {
    const variant = await sellable("cancel-active");
    const contact = await createContact.call({ name: "Pending Buyer", email: "pending-buyer@example.test" }, OWNER);
    const basket = await getOrCreateCart.call({ contactId: contact.id, currency: "CAD" }, OWNER);
    await addCartItem.call({ cartId: basket.cart.id, variantId: variant.id, quantity: 1 }, OWNER);
    const placed = await checkoutCart.call({ cartId: basket.cart.id, contactId: contact.id, idempotencyKey: "cancel-active-order", acceptedTerms: true }, OWNER);
    const payment = await createPayment.call({ invoiceId: placed.order.invoiceId!, provider: "manual", method: "bank_transfer", amountMinor: placed.order.totalMinor, idempotencyKey: "cancel-active-payment" }, OWNER);
    expect((await failure(cancelOrder.call({ id: placed.order.id }, OWNER))).code).toBe("conflict");
    expect((await getOrder.call({ id: placed.order.id }, OWNER)).order.status).toBe("pending_payment");
    await cancelPayment.call({ id: payment.id, reason: "Buyer withdrew before payment" }, OWNER);
    const hosted = await createPayment.call({ invoiceId: placed.order.invoiceId!, provider: "stripe", method: "hosted_checkout", amountMinor: placed.order.totalMinor, idempotencyKey: "cancel-hosted-payment" }, OWNER);
    expect((await failure(cancelPayment.call({ id: hosted.id, reason: "Local cancellation is unsafe" }, OWNER))).code).toBe("conflict");
    await failPayment.call({ id: hosted.id, code: "provider_declined", message: "The provider confirmed no charge." }, OWNER);
    expect((await cancelOrder.call({ id: placed.order.id }, OWNER)).order.status).toBe("cancelled");
    expect((await failure(settlePayment.call({ id: payment.id, providerRef: "late" }, OWNER))).code).toBe("conflict");
  });
});
