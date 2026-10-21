// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.15: a member's export holds everything about them, and erasure removes
// their content, keeps the site's sales books anonymously, and waits while
// money is still moving.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { resolveContact } from "@/core/contacts/service";
import { ready } from "@/core/runtime";
import { updateBusiness } from "@/core/settings/service";
import { createDataRequest, fulfillDataRequest, verifyDataRequest } from "@/core/privacy/service";
import { dataRequestArtifacts } from "@/core/privacy/schema";
import { joinSite, updateMembershipRules } from "@/modules/members/service";
import { createListing } from "@/modules/members/listings";
import { createPost } from "@/modules/members/posts";
import { startConversation, viewConversation } from "@/modules/members/messages";
import { onOrderPaid, savePayoutInstructions, setPayoutAccountStatus } from "@/modules/members/payouts";
import { confirmDelivery, postSaleMessage, saleThread } from "@/modules/members/protection";
import { ERASED_MEMBER_ID } from "@/modules/members/data-rights";
import { memberPayouts, memberProfiles } from "@/modules/members/schema";
import { addCartItem, getOrCreateCart } from "@/modules/catalog/cart";
import { checkoutCart } from "@/modules/catalog/orders";
import { getProductVariants } from "@/modules/catalog/variants";
import { createPayment, settlePayment } from "@/modules/invoicing/invoice-service";
import { invoices } from "@/modules/invoicing/schema";
import { ANONYMOUS, closeDb, CUSTOMER, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const RAE = CUSTOMER; // seller who leaves
const SAM = { ...CUSTOMER, userId: "00000000-0000-4000-8000-0000000000c2" }; // buyer who stays

async function contactFor(email: string, userId: string) {
  const { contact } = await resolveContact.call({ email, name: email }, OWNER);
  await db().update(contacts).set({ userId }).where(eq(contacts.id, contact.id));
  return contact.id;
}

async function request(contactId: string, kind: "export" | "erasure") {
  const created = await createDataRequest.call({ contactId, request: { kind } }, OWNER);
  await verifyDataRequest.call({ id: created.id, method: "Verified member request" }, OWNER);
  return created.id;
}

async function samBuysFromRae(samContact: string) {
  const listing = await createListing.call({ title: "Presets", kind: "digital", price: "50", acceptPolicy: true }, RAE);
  const variantId = (await getProductVariants.call({ productId: listing.productId }, OWNER)).variants[0]!.id;
  const cart = await getOrCreateCart.call({ currency: "CAD", contactId: samContact }, OWNER);
  await addCartItem.call({ cartId: cart.cart.id, cartToken: cart.cart.token ?? undefined, variantId }, ANONYMOUS);
  const order = await checkoutCart.call({ cartId: cart.cart.id, contactId: samContact, idempotencyKey: `buy-${crypto.randomUUID()}`, acceptedTerms: true as const }, OWNER);
  const [invoice] = await db().select().from(invoices).where(eq(invoices.id, order.order.invoiceId!));
  const payment = await createPayment.call({ invoiceId: invoice!.id, provider: "manual", method: "bank_transfer", amountMinor: invoice!.totalMinor, idempotencyKey: `pay-${crypto.randomUUID()}` }, OWNER);
  await settlePayment.call({ id: payment.id, providerRef: `offline-${crypto.randomUUID()}` }, OWNER);
  await onOrderPaid({ orderId: order.order.id });
  return { orderId: order.order.id, sellerId: RAE.userId };
}

describe.runIf(hasDatabase)("member data rights (C12.15)", () => {
  let raeContact = "";
  let samContact = "";
  beforeAll(async () => { await ready(); }, 60_000);
  beforeEach(async () => {
    await truncateSpine();
    await db().insert(users).values([
      { id: OWNER.userId, email: "owner@example.test", role: "owner" },
      { id: RAE.userId, email: "rae@example.test", role: "customer" },
      { id: SAM.userId, email: "sam@example.test", role: "customer" },
    ]);
    await updateBusiness.call({ name: "Rights proof", country: "CA", baseCurrency: "CAD", timezone: "UTC" }, OWNER);
    raeContact = await contactFor("rae@example.test", RAE.userId);
    samContact = await contactFor("sam@example.test", SAM.userId);
    await joinSite.call({ handle: "rae", displayName: "Rae", meetsMinimumAge: true, isAdult: true }, RAE);
    await joinSite.call({ handle: "sam", displayName: "Sam", meetsMinimumAge: true, isAdult: true }, SAM);
    await updateMembershipRules.call({ marketplaceEnabled: true, listingReview: false }, OWNER);
    await savePayoutInstructions.call({ instructions: "Interac e-transfer" }, RAE);
    await setPayoutAccountStatus.call({ userId: RAE.userId, status: "ready" }, OWNER);
  });
  afterAll(closeDb);

  it("exports a member's posts, connections, decrypted conversations and sales", async () => {
    await createPost.call({ body: "Hello from Rae", visibility: "public" }, RAE);
    const { id: conversationId } = await startConversation.call({ handles: ["rae"], body: "Love your presets" }, SAM);
    const sale = await samBuysFromRae(samContact);
    await postSaleMessage.call({ ...sale, body: "Link sent!" }, RAE);

    const { artifact } = await fulfillDataRequest.call({ id: await request(raeContact, "export") }, OWNER);
    const [stored] = await db().select().from(dataRequestArtifacts).where(eq(dataRequestArtifacts.id, artifact.id));
    const members = (stored!.body as { sources: { members: Record<string, unknown[]> & { profile: { handle: string } } } }).sources.members;
    expect(members.profile.handle).toBe("rae");
    expect((members.posts as { body: string }[]).map((p) => p.body)).toEqual(["Hello from Rae"]);
    const conversation = (members.conversations as { conversationId: string; messages: { body: string }[] }[]).find((c) => c.conversationId === conversationId);
    expect(conversation?.messages.map((m) => m.body)).toEqual(["Love your presets"]);
    expect(members.payouts).toHaveLength(1);
    expect((members.saleMessages as { body: string; mine: boolean }[]).map((m) => [m.body, m.mine])).toEqual([["Link sent!", true]]);
  });

  it("waits while money is moving, then erases content and keeps the books anonymously", async () => {
    await createPost.call({ body: "Hello from Rae", visibility: "public" }, RAE);
    const { id: conversationId } = await startConversation.call({ handles: ["sam"], body: "Thanks for buying!" }, RAE);
    const sale = await samBuysFromRae(samContact);
    await postSaleMessage.call({ ...sale, body: "Link sent!" }, RAE);

    const erase = await request(raeContact, "erasure");
    expect((await failure(fulfillDataRequest.call({ id: erase, confirmation: "ERASE" }, OWNER))).code).toBe("conflict");

    await confirmDelivery.call(sale, SAM);
    await db().update(memberPayouts).set({ state: "paid" }).where(eq(memberPayouts.orderId, sale.orderId));
    await fulfillDataRequest.call({ id: erase, confirmation: "ERASE" }, OWNER);

    expect(await db().select().from(users).where(eq(users.id, RAE.userId))).toEqual([]);
    expect(await db().select().from(memberProfiles).where(eq(memberProfiles.userId, RAE.userId))).toEqual([]);
    expect((await viewConversation.call({ id: conversationId }, SAM)).messages.map((m) => m.body)).toEqual([null]);
    const [payout] = await db().select().from(memberPayouts).where(eq(memberPayouts.orderId, sale.orderId));
    expect(payout).toMatchObject({ sellerId: ERASED_MEMBER_ID, state: "paid" });
    const thread = await saleThread.call({ orderId: sale.orderId, sellerId: ERASED_MEMBER_ID }, OWNER);
    expect(thread.map((m) => m.body)).toEqual([""]);
  });
});
