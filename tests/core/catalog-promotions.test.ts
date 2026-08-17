// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.23 coupons, gift-card credit and abandoned-cart recovery.

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { createContact } from "@/core/contacts/service";
import { carts, productVariants } from "@/modules/catalog/schema";
import {
  addCartItem,
  applyCouponToCart,
  applyVariantMatrix,
  checkoutCart,
  createCoupon,
  createOfferRule,
  createPriceList,
  createProduct,
  getOrCreateCart,
  getProductVariants,
  issueGiftCard,
  listCartOffers,
  recoverAbandonedCarts,
  setPriceListEntry,
} from "@/modules/catalog/service";
import { getCustomerBalance } from "@/modules/invoicing/advanced-money-service";
import { getInvoice } from "@/modules/invoicing/invoice-service";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

describe.runIf(hasDatabase)("catalog promotions", { timeout: 40_000 }, () => {
  beforeEach(truncateSpine);
  afterAll(closeDb);

  async function pricedCart(slug: string, amount = "40.00") {
    const product = await createProduct.call({ name: "Print", slug, kind: "digital" }, OWNER);
    const updated = await applyVariantMatrix.call({ productId: product.id, expectedVersion: product.version }, OWNER);
    const variant = (await getProductVariants.call({ productId: updated.id }, OWNER)).variants[0]!;
    await db().update(productVariants).set({ requiresShipping: false }).where(eq(productVariants.id, variant.id));
    const list = await createPriceList.call({ name: `${slug} retail`, currency: "CAD", kind: "retail" }, OWNER);
    await setPriceListEntry.call({ priceListId: list.id, variantId: variant.id, amount }, OWNER);
    const contact = await createContact.call({ name: slug, email: `${slug}@example.test` }, OWNER);
    const basket = await getOrCreateCart.call({ contactId: contact.id, currency: "CAD" }, OWNER);
    await addCartItem.call({ cartId: basket.cart.id, variantId: variant.id, quantity: 1 }, OWNER);
    return { contact, basket, variant };
  }

  it("applies a percent coupon as invoice discount, not a second money path", async () => {
    const { contact, basket } = await pricedCart("promo-percent");
    await createCoupon.call({ code: "TENOFF", kind: "percent", percentOffPpm: 100_000 }, OWNER);
    await applyCouponToCart.call({ cartId: basket.cart.id, code: "TENOFF" }, OWNER);
    const placed = await checkoutCart.call(
      {
        cartId: basket.cart.id,
        contactId: contact.id,
        idempotencyKey: "promo-percent-1",
        acceptedTerms: true,
      },
      OWNER,
    );
    expect(placed.order.discountMinor).toBe(400);
    const invoice = await getInvoice.call({ id: placed.order.invoiceId! }, OWNER);
    expect(invoice.invoice.discountMinor).toBe(400);
    expect(invoice.lines.reduce((sum, line) => sum + line.discountMinor, 0)).toBe(400);
  });

  it("spends a gift card through customer credit onto the invoice", async () => {
    const { contact, basket } = await pricedCart("promo-gift", "20.00");
    await issueGiftCard.call({ code: "GIFTCARD01", currency: "CAD", amount: "20.00" }, OWNER);
    const placed = await checkoutCart.call(
      {
        cartId: basket.cart.id,
        contactId: contact.id,
        idempotencyKey: "promo-gift-1",
        acceptedTerms: true,
        giftCardCode: "GIFTCARD01",
      },
      OWNER,
    );
    const invoice = await getInvoice.call({ id: placed.order.invoiceId! }, OWNER);
    expect(invoice.invoice.status).toBe("paid");
    expect(placed.order.status).toBe("fulfilled");
    const credit = await getCustomerBalance.call({ contactId: contact.id, currency: "CAD" }, OWNER);
    expect(credit.accounts[0]?.balanceMinor).toBe(0);
    expect(credit.entries.some((entry) => entry.sourceType === "manual_adjustment")).toBe(true);
    expect(invoice.payments.some((payment) => payment.provider === "balance")).toBe(true);
  });

  it("lists a post-add offer and sends one recovery coupon per abandoned cart", async () => {
    const { contact, basket, variant } = await pricedCart("promo-offer");
    const extra = await createProduct.call({ name: "Frame", slug: "promo-frame", kind: "digital" }, OWNER);
    const extraUpdated = await applyVariantMatrix.call({ productId: extra.id, expectedVersion: extra.version }, OWNER);
    const extraVariant = (await getProductVariants.call({ productId: extraUpdated.id }, OWNER)).variants[0]!;
    await createOfferRule.call(
      { kind: "post_add", name: "Add a frame", triggerVariantId: variant.id, offerVariantId: extraVariant.id },
      OWNER,
    );
    const offers = await listCartOffers.call({ cartId: basket.cart.id, justAddedVariantId: variant.id }, OWNER);
    expect(offers.map((row) => row.variant.id)).toContain(extraVariant.id);

    await db().update(carts).set({ status: "abandoned", abandonedAt: new Date(), contactId: contact.id }).where(eq(carts.id, basket.cart.id));
    const first = await recoverAbandonedCarts.call({}, OWNER);
    expect(first.sent).toBe(1);
    const second = await recoverAbandonedCarts.call({}, OWNER);
    expect(second.sent).toBe(0);
    expect((await failure(createCoupon.call({ code: "AB", kind: "percent", percentOffPpm: 100_000 }, OWNER))).code).toBe(
      "validation",
    );
  });
});
