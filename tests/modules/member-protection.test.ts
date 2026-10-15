// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.10: sellers ship, buyers confirm delivery to release funds early, the
// sale thread is private to buyer, seller and site, and a dispute freezes
// payouts until the site pays the seller or cancels the payout for a refund.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { resolveContact } from "@/core/contacts/service";
import { ready } from "@/core/runtime";
import { updateBusiness } from "@/core/settings/service";
import { joinSite, updateMembershipRules } from "@/modules/members/service";
import { createListing } from "@/modules/members/listings";
import { onOrderPaid, releaseDuePayouts, savePayoutInstructions, setPayoutAccountStatus, settlePayouts, sitePayouts } from "@/modules/members/payouts";
import {
  confirmDelivery,
  listDisputes,
  markShipped,
  myPurchases,
  mySales,
  postSaleMessage,
  raiseDispute,
  resolveDispute,
  saleThread,
  viewSale,
  withdrawDispute,
} from "@/modules/members/protection";
import { memberPayouts } from "@/modules/members/schema";
import { addCartItem, getOrCreateCart } from "@/modules/catalog/cart";
import { checkoutCart } from "@/modules/catalog/orders";
import { getProductVariants } from "@/modules/catalog/variants";
import { createPayment, settlePayment } from "@/modules/invoicing/invoice-service";
import { invoices } from "@/modules/invoicing/schema";
import { ANONYMOUS, closeDb, CUSTOMER, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const SELLER = CUSTOMER;
const BUYER = { ...CUSTOMER, userId: "00000000-0000-4000-8000-0000000000c2" };
const OTHER = { ...CUSTOMER, userId: "00000000-0000-4000-8000-0000000000c3" };

async function buy(title: string) {
  const listing = await createListing.call({ title, kind: "digital", price: "50" }, SELLER);
  const variantId = (await getProductVariants.call({ productId: listing.productId }, OWNER)).variants[0]!.id;
  const [buyerContact] = await db().select().from(contacts).where(eq(contacts.userId, BUYER.userId));
  const cart = await getOrCreateCart.call({ currency: "CAD", contactId: buyerContact!.id }, OWNER);
  await addCartItem.call({ cartId: cart.cart.id, cartToken: cart.cart.token ?? undefined, variantId }, ANONYMOUS);
  const order = await checkoutCart.call({ cartId: cart.cart.id, contactId: buyerContact!.id, idempotencyKey: `buy-${crypto.randomUUID()}`, acceptedTerms: true as const }, OWNER);
  const [invoice] = await db().select().from(invoices).where(eq(invoices.id, order.order.invoiceId!));
  const payment = await createPayment.call({ invoiceId: invoice!.id, provider: "manual", method: "bank_transfer", amountMinor: invoice!.totalMinor, idempotencyKey: `pay-${crypto.randomUUID()}` }, OWNER);
  await settlePayment.call({ id: payment.id, providerRef: `offline-${crypto.randomUUID()}` }, OWNER);
  await onOrderPaid({ orderId: order.order.id });
  return { orderId: order.order.id, sellerId: SELLER.userId };
}

describe.runIf(hasDatabase)("buyer protection (C12.10)", () => {
  beforeAll(async () => { await ready(); }, 60_000);
  beforeEach(async () => {
    await truncateSpine();
    await db().insert(users).values([
      { id: OWNER.userId, email: "owner@example.test", role: "owner" },
      { id: SELLER.userId, email: "rae@example.test", role: "customer" },
      { id: BUYER.userId, email: "buyer@example.test", role: "customer" },
      { id: OTHER.userId, email: "kim@example.test", role: "customer" },
    ]);
    await updateBusiness.call({ name: "Protection proof", country: "CA", baseCurrency: "CAD", timezone: "UTC" }, OWNER);
    await joinSite.call({ handle: "rae", displayName: "Rae", meetsMinimumAge: true, isAdult: true }, SELLER);
    await joinSite.call({ handle: "kim", displayName: "Kim", meetsMinimumAge: true, isAdult: true }, OTHER);
    const { contact } = await resolveContact.call({ email: "buyer@example.test", name: "Buyer" }, OWNER);
    await db().update(contacts).set({ userId: BUYER.userId }).where(eq(contacts.id, contact.id));
    await updateMembershipRules.call({ marketplaceEnabled: true, listingReview: false, holdDays: 14 }, OWNER);
    await savePayoutInstructions.call({ instructions: "Interac e-transfer" }, SELLER);
    await setPayoutAccountStatus.call({ userId: SELLER.userId, status: "ready" }, OWNER);
  });
  afterAll(closeDb);

  it("ships, talks privately, and releases early when the buyer confirms delivery", async () => {
    const s = await buy("Presets");
    expect((await mySales.call({}, SELLER)).map((x) => [x.role, x.fulfilment, x.payout])).toEqual([["seller", "awaiting", "held"]]);
    expect((await myPurchases.call({}, BUYER)).map((x) => [x.role, x.sellerHandle])).toEqual([["buyer", "rae"]]);
    expect((await failure(viewSale.call(s, OTHER))).code).toBe("not_found");
    expect((await failure(markShipped.call({ ...s, carrier: "Canada Post" }, BUYER))).code).toBe("permission");
    await markShipped.call({ ...s, carrier: "Canada Post", tracking: "123" }, SELLER);
    await postSaleMessage.call({ ...s, body: "Download link worked?" }, SELLER);
    await postSaleMessage.call({ ...s, body: "Yes, thanks!" }, BUYER);
    expect((await saleThread.call(s, OWNER)).map((m) => [m.role, m.body])).toEqual([["seller", "Download link worked?"], ["buyer", "Yes, thanks!"]]);
    expect((await failure(saleThread.call(s, OTHER))).code).toBe("not_found");
    expect((await failure(confirmDelivery.call(s, SELLER))).code).toBe("permission");
    await confirmDelivery.call(s, BUYER);
    expect((await viewSale.call(s, SELLER))).toMatchObject({ fulfilment: "delivered", payout: "due" });
  });

  it("freezes payouts during a dispute and resolves for either side", async () => {
    const s = await buy("Presets A");
    expect((await failure(raiseDispute.call({ ...s, reason: "not_received", details: "Never got the link." }, SELLER))).code).toBe("permission");
    const { id } = await raiseDispute.call({ ...s, reason: "not_received", details: "Never got the download link." }, BUYER);
    expect((await failure(raiseDispute.call({ ...s, reason: "other", details: "Second dispute attempt." }, BUYER))).code).toBe("conflict");
    expect((await failure(confirmDelivery.call(s, BUYER))).code).toBe("conflict");
    await db().update(memberPayouts).set({ releaseAt: new Date(Date.now() - 1000) }).where(eq(memberPayouts.orderId, s.orderId));
    expect((await releaseDuePayouts.call({}, { kind: "system" })).released).toBe(0);
    const [payout] = (await sitePayouts.call({}, OWNER)).payouts;
    expect((await settlePayouts.call({ ids: [payout!.id], action: "release" }, OWNER)).changed).toBe(0);
    expect((await listDisputes.call({ state: "open" }, OWNER)).map((d) => d.id)).toEqual([id]);
    expect((await failure(resolveDispute.call({ id, outcome: "refund", note: "x" }, OWNER))).code).toBe("validation");
    await resolveDispute.call({ id, outcome: "refund", note: "Seller could not show delivery." }, OWNER);
    expect((await viewSale.call(s, BUYER))).toMatchObject({ payout: "cancelled", dispute: { state: "refunded" } });

    const t = await buy("Presets B");
    const second = await raiseDispute.call({ ...t, reason: "not_as_described", details: "Files were the wrong size." }, BUYER);
    await withdrawDispute.call(t, BUYER);
    expect((await viewSale.call(t, SELLER)).dispute?.state).toBe("withdrawn");
    const u = await buy("Presets C");
    const third = await raiseDispute.call({ ...u, reason: "other", details: "Took a while to arrive." }, BUYER);
    await resolveDispute.call({ id: third.id, outcome: "release", note: "Delivered; just slow." }, OWNER);
    expect((await viewSale.call(u, SELLER)).payout).toBe("due");
    void second;
  });
});
