// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.11: buyer and seller review each other only after a completed sale,
// reviews stay hidden until both are written or two weeks pass, and the
// subject can reply once.
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
import { onOrderPaid, savePayoutInstructions, setPayoutAccountStatus } from "@/modules/members/payouts";
import { confirmDelivery, raiseDispute, resolveDispute } from "@/modules/members/protection";
import { memberReviews } from "@/modules/members/schema";
import { leaveReview, myReviews, replyToReview, reviewsFor } from "@/modules/members/reputation";
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
  const listing = await createListing.call({ acceptPolicy: true, title, kind: "digital", price: "50" }, SELLER);
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

describe.runIf(hasDatabase)("reputation (C12.11)", () => {
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
    await joinSite.call({ handle: "bob", displayName: "Bob", meetsMinimumAge: true, isAdult: true }, BUYER);
    await joinSite.call({ handle: "kim", displayName: "Kim", meetsMinimumAge: true, isAdult: true }, OTHER);
    const { contact } = await resolveContact.call({ email: "buyer@example.test", name: "Buyer" }, OWNER);
    await db().update(contacts).set({ userId: BUYER.userId }).where(eq(contacts.id, contact.id));
    await updateMembershipRules.call({ marketplaceEnabled: true, listingReview: false, holdDays: 14 }, OWNER);
    await savePayoutInstructions.call({ instructions: "Interac e-transfer" }, SELLER);
    await setPayoutAccountStatus.call({ userId: SELLER.userId, status: "ready" }, OWNER);
  });
  afterAll(closeDb);

  it("only allows reviews of a completed sale, by its two parties", async () => {
    const s = await buy("Presets");
    expect((await failure(leaveReview.call({ ...s, rating: 5 }, BUYER))).code).toBe("conflict");
    await confirmDelivery.call(s, BUYER);
    expect((await failure(leaveReview.call({ ...s, rating: 5 }, OTHER))).code).toBe("not_found");
    expect((await failure(leaveReview.call({ ...s, rating: 5 }, OWNER))).code).toBe("permission");
    expect((await failure(leaveReview.call({ ...s, rating: 6 }, BUYER))).code).toBe("validation");
    await leaveReview.call({ ...s, rating: 5, body: "Great presets." }, BUYER);
    expect((await failure(leaveReview.call({ ...s, rating: 1 }, BUYER))).code).toBe("conflict");
  });

  it("keeps reviews double-blind until both sides write or the window passes", async () => {
    const s = await buy("Presets");
    await confirmDelivery.call(s, BUYER);
    await leaveReview.call({ ...s, rating: 4, body: "Good, a bit slow." }, BUYER);
    expect((await reviewsFor.call({ handle: "rae" }, ANONYMOUS)).reviews).toEqual([]);
    expect(await myReviews.call({}, SELLER)).toMatchObject({ received: [], waitingCount: 1 });
    expect((await myReviews.call({}, BUYER)).written.map((r) => r.revealed)).toEqual([false]);
    expect((await failure(replyToReview.call({ id: (await myReviews.call({}, BUYER)).written[0]!.id, body: "Thanks" }, SELLER))).code).toBe("not_found");

    await leaveReview.call({ ...s, rating: 5, body: "Paid fast." }, SELLER);
    const rae = await reviewsFor.call({ handle: "rae" }, ANONYMOUS);
    expect(rae.asSeller).toEqual({ average: 4, count: 1 });
    expect(rae.reviews.map((r) => [r.direction, r.rating, r.author?.handle])).toEqual([["of_seller", 4, "bob"]]);
    expect((await reviewsFor.call({ handle: "bob" }, ANONYMOUS)).asBuyer).toEqual({ average: 5, count: 1 });

    const t = await buy("Presets B");
    await confirmDelivery.call(t, BUYER);
    await leaveReview.call({ ...t, rating: 2 }, BUYER);
    expect((await reviewsFor.call({ handle: "rae" }, ANONYMOUS)).asSeller.count).toBe(1);
    await db().update(memberReviews).set({ revealAt: new Date(Date.now() - 1000) }).where(eq(memberReviews.orderId, t.orderId));
    expect((await reviewsFor.call({ handle: "rae" }, ANONYMOUS)).asSeller).toEqual({ average: 3, count: 2 });
  });

  it("lets the subject reply once, and reviews after a resolved dispute", async () => {
    const s = await buy("Presets");
    const { id: disputeId } = await raiseDispute.call({ ...s, reason: "not_received", details: "Never got the download link." }, BUYER);
    expect((await failure(leaveReview.call({ ...s, rating: 1 }, BUYER))).code).toBe("conflict");
    await resolveDispute.call({ id: disputeId, outcome: "refund", note: "Seller could not show delivery." }, OWNER);
    await leaveReview.call({ ...s, rating: 1, body: "Never arrived." }, BUYER);
    await leaveReview.call({ ...s, rating: 3 }, SELLER);
    const [review] = (await myReviews.call({}, SELLER)).received;
    expect((await failure(replyToReview.call({ id: review!.id, body: "Sorry" }, BUYER))).code).toBe("not_found");
    await replyToReview.call({ id: review!.id, body: "The link was resent; sorry for the trouble." }, SELLER);
    expect((await failure(replyToReview.call({ id: review!.id, body: "Again" }, SELLER))).code).toBe("not_found");
    expect((await reviewsFor.call({ handle: "rae" }, ANONYMOUS)).reviews[0]!.reply).toBe("The link was resent; sorry for the trouble.");
  });
});
