// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.09: member listings sell only when the seller can be paid; a paid order
// records each seller's share less the site fee; held funds release after the
// window or on the site's say; due payouts are paid with a reference; refunds
// cancel what is still owed; the payout model and provider are the owner's.
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
import {
  myPayoutAccount,
  myPayouts,
  onOrderPaid,
  releaseDuePayouts,
  reversePayouts,
  savePayoutInstructions,
  setPayoutAccountStatus,
  settlePayouts,
  sitePayouts,
} from "@/modules/members/payouts";
import { memberPayouts } from "@/modules/members/schema";
import { addCartItem, getOrCreateCart } from "@/modules/catalog/cart";
import { checkoutCart } from "@/modules/catalog/orders";
import { getProductVariants } from "@/modules/catalog/variants";
import { createPayment, settlePayment } from "@/modules/invoicing/invoice-service";
import { invoices } from "@/modules/invoicing/schema";
import { ANONYMOUS, closeDb, CUSTOMER, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const RAE = CUSTOMER;
const SAM = { ...CUSTOMER, userId: "00000000-0000-4000-8000-0000000000c2" };

async function variantOf(productId: string) {
  return (await getProductVariants.call({ productId }, OWNER)).variants[0]!.id;
}

describe.runIf(hasDatabase)("member payouts (C12.09)", () => {
  beforeAll(async () => { await ready(); }, 60_000);
  beforeEach(async () => {
    await truncateSpine();
    await db().insert(users).values([
      { id: OWNER.userId, email: "owner@example.test", role: "owner" },
      { id: RAE.userId, email: "rae@example.test", role: "customer" },
      { id: SAM.userId, email: "sam@example.test", role: "customer" },
    ]);
    await updateBusiness.call({ name: "Payout proof", country: "CA", baseCurrency: "CAD", timezone: "UTC" }, OWNER);
    await joinSite.call({ handle: "rae", displayName: "Rae", meetsMinimumAge: true, isAdult: true }, RAE);
    await joinSite.call({ handle: "sam", displayName: "Sam", meetsMinimumAge: true, isAdult: true }, SAM);
    await updateMembershipRules.call({ marketplaceEnabled: true, listingReview: false, siteFeeBps: 1000, holdDays: 7 }, OWNER);
  });
  afterAll(closeDb);

  it("refuses unpayable sellers, records shares less the fee, releases and pays", async () => {
    const print = await createListing.call({ acceptPolicy: true, title: "Harbour print (download)", kind: "digital", price: "40" }, RAE);
    const lesson = await createListing.call({ acceptPolicy: true, title: "Lesson", kind: "service", price: "100" }, SAM);
    const { contact: buyer } = await resolveContact.call({ email: "buyer@example.test", name: "Buyer" }, OWNER);
    const cart = await getOrCreateCart.call({ currency: "CAD", contactId: buyer.id }, OWNER);
    const add = (variantId: string) => addCartItem.call({ cartId: cart.cart.id, cartToken: cart.cart.token ?? undefined, variantId }, ANONYMOUS);
    expect((await failure(add(await variantOf(print.productId)))).message).toBe("This seller cannot receive payments yet.");

    await savePayoutInstructions.call({ instructions: "Interac e-transfer to rae@example.test" }, RAE);
    await savePayoutInstructions.call({ instructions: "Bank transfer, account on file" }, SAM);
    expect(await myPayoutAccount.call({}, RAE)).toMatchObject({ adapter: "manual", status: "pending", instructions: "Interac e-transfer to rae@example.test" });
    expect((await failure(setPayoutAccountStatus.call({ userId: RAE.userId, status: "ready" }, RAE))).code).toBe("permission");
    await setPayoutAccountStatus.call({ userId: RAE.userId, status: "ready" }, OWNER);
    await setPayoutAccountStatus.call({ userId: SAM.userId, status: "ready" }, OWNER);
    await add(await variantOf(print.productId));
    await add(await variantOf(lesson.productId));

    const order = await checkoutCart.call({ cartId: cart.cart.id, contactId: buyer.id, idempotencyKey: `market-${crypto.randomUUID()}`, acceptedTerms: true as const }, OWNER);
    const [invoice] = await db().select().from(invoices).where(eq(invoices.id, order.order.invoiceId!));
    const payment = await createPayment.call({ invoiceId: invoice!.id, provider: "manual", method: "bank_transfer", amountMinor: invoice!.totalMinor, idempotencyKey: `pay-${crypto.randomUUID()}` }, OWNER);
    await settlePayment.call({ id: payment.id, providerRef: "offline" }, OWNER);
    await onOrderPaid({ orderId: order.order.id });
    await onOrderPaid({ orderId: order.order.id });

    const ledger = (await sitePayouts.call({}, OWNER)).payouts;
    expect(ledger.map((p) => [p.sellerHandle, p.grossMinor, p.feeMinor, p.netMinor, p.state]).sort()).toEqual([
      ["rae", 4000, 400, 3600, "held"],
      ["sam", 10000, 1000, 9000, "held"],
    ]);
    expect((await myPayouts.call({}, RAE)).totals).toEqual([{ currency: "CAD", state: "held", netMinor: 3600 }]);
    expect((await myPayouts.call({}, SAM)).payouts.map((p) => p.sellerHandle)).toEqual(["sam"]);

    expect((await releaseDuePayouts.call({}, { kind: "system" })).released).toBe(0);
    const rae = ledger.find((p) => p.sellerHandle === "rae")!;
    const sam = ledger.find((p) => p.sellerHandle === "sam")!;
    await db().update(memberPayouts).set({ releaseAt: new Date(Date.now() - 1000) }).where(eq(memberPayouts.id, rae.id));
    expect((await releaseDuePayouts.call({}, { kind: "system" })).released).toBe(1);
    await settlePayouts.call({ ids: [sam.id], action: "release" }, OWNER);
    expect((await failure(settlePayouts.call({ ids: [rae.id], action: "paid" }, OWNER))).code).toBe("validation");
    expect((await settlePayouts.call({ ids: [rae.id, sam.id], action: "paid", reference: "e-transfer 2026-10-14" }, OWNER)).changed).toBe(2);
    expect((await myPayouts.call({}, RAE)).totals).toEqual([{ currency: "CAD", state: "paid", netMinor: 3600 }]);

    await reversePayouts.call({ invoiceId: invoice!.id, amountMinor: invoice!.totalMinor }, { kind: "system" });
    expect((await sitePayouts.call({ state: "review" }, OWNER)).payouts).toHaveLength(2);
  });

  it("cancels held payouts on a full refund and lets the owner change model and provider safely", async () => {
    expect((await failure(updateMembershipRules.call({ payoutModel: "seller_merchant" }, OWNER))).code).toBe("validation");
    expect((await failure(updateMembershipRules.call({ payoutAdapter: "nonexistent" }, OWNER))).code).toBe("validation");
    expect((await updateMembershipRules.call({ payoutModel: "instant" }, OWNER)).payoutModel).toBe("instant");
    const print = await createListing.call({ acceptPolicy: true, title: "Print (download)", kind: "digital", price: "20" }, RAE);
    await savePayoutInstructions.call({ instructions: "Interac e-transfer" }, RAE);
    await setPayoutAccountStatus.call({ userId: RAE.userId, status: "ready" }, OWNER);
    const { contact: buyer } = await resolveContact.call({ email: "buyer@example.test", name: "Buyer" }, OWNER);
    const cart = await getOrCreateCart.call({ currency: "CAD", contactId: buyer.id }, OWNER);
    await addCartItem.call({ cartId: cart.cart.id, cartToken: cart.cart.token ?? undefined, variantId: await variantOf(print.productId) }, ANONYMOUS);
    const order = await checkoutCart.call({ cartId: cart.cart.id, contactId: buyer.id, idempotencyKey: `market-${crypto.randomUUID()}`, acceptedTerms: true as const }, OWNER);
    const [invoice] = await db().select().from(invoices).where(eq(invoices.id, order.order.invoiceId!));
    const payment = await createPayment.call({ invoiceId: invoice!.id, provider: "manual", method: "bank_transfer", amountMinor: invoice!.totalMinor, idempotencyKey: `pay-${crypto.randomUUID()}` }, OWNER);
    await settlePayment.call({ id: payment.id, providerRef: "offline" }, OWNER);
    await onOrderPaid({ orderId: order.order.id });
    expect((await sitePayouts.call({}, OWNER)).payouts.map((p) => p.state)).toEqual(["due"]);
    await reversePayouts.call({ invoiceId: invoice!.id, amountMinor: invoice!.totalMinor }, { kind: "system" });
    expect((await sitePayouts.call({}, OWNER)).payouts.map((p) => p.state)).toEqual(["cancelled"]);
    void contacts;
  });
});
