// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.05: a member offers a subscription; once a subscriber's first invoice is
// paid they see that member's subscriber-only posts, and the member is owed a
// payout through the same ledger as sales.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { resolveContact } from "@/core/contacts/service";
import { ready } from "@/core/runtime";
import { updateBusiness } from "@/core/settings/service";
import { joinSite, updateMembershipRules } from "@/modules/members/service";
import { savePayoutInstructions, setPayoutAccountStatus, reversePayouts } from "@/modules/members/payouts";
import { createMemberPlan, memberPlans, myMemberPlans, onInvoicePaid, setMemberPlanStatus } from "@/modules/members/member-subscriptions";
import { createPost, postsBy, viewPost } from "@/modules/members/posts";
import { memberPayouts } from "@/modules/members/schema";
import { joinMembership, publicMembershipPlans } from "@/modules/subscriptions/public-signup";
import { onInvoicePaid as activateSubscription } from "@/modules/subscriptions/service";
import { createPayment, settlePayment } from "@/modules/invoicing/invoice-service";
import { invoices } from "@/modules/invoicing/schema";
import { ANONYMOUS, closeDb, CUSTOMER, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const RAE = CUSTOMER;
const SAM = { ...CUSTOMER, userId: "00000000-0000-4000-8000-0000000000c2" };

async function pay(invoiceId: string) {
  const [invoice] = await db().select().from(invoices).where(eq(invoices.id, invoiceId));
  const payment = await createPayment.call({ invoiceId, provider: "manual", method: "bank_transfer", amountMinor: invoice!.totalMinor, idempotencyKey: `pay-${crypto.randomUUID()}` }, OWNER);
  await settlePayment.call({ id: payment.id, providerRef: `offline-${crypto.randomUUID()}` }, OWNER);
  await activateSubscription({ invoiceId });
  await onInvoicePaid({ invoiceId });
}

describe.runIf(hasDatabase)("member subscriptions (C12.05)", () => {
  beforeAll(async () => { await ready(); }, 60_000);
  beforeEach(async () => {
    await truncateSpine();
    await db().insert(users).values([
      { id: OWNER.userId, email: "owner@example.test", role: "owner" },
      { id: RAE.userId, email: "rae@example.test", role: "customer" },
      { id: SAM.userId, email: "sam@example.test", role: "customer" },
    ]);
    await updateBusiness.call({ name: "Subscriptions proof", country: "CA", baseCurrency: "CAD", timezone: "UTC" }, OWNER);
    for (const [actor, email] of [[RAE, "rae@example.test"], [SAM, "sam@example.test"]] as const) {
      const { contact } = await resolveContact.call({ email, name: email }, OWNER);
      await db().update(contacts).set({ userId: actor.userId }).where(eq(contacts.id, contact.id));
    }
    await joinSite.call({ handle: "rae", displayName: "Rae", meetsMinimumAge: true, isAdult: true }, RAE);
    await joinSite.call({ handle: "sam", displayName: "Sam", meetsMinimumAge: true, isAdult: true }, SAM);
    await updateMembershipRules.call({ marketplaceEnabled: true, listingReview: false, holdDays: 7 }, OWNER);
  });
  afterAll(closeDb);

  it("sells only once the member can be paid, and keeps member plans off the site's own list", async () => {
    const { planId } = await createMemberPlan.call({ name: "Behind the scenes", price: "5", interval: "month" }, RAE);
    expect((await memberPlans.call({ handle: "rae" }, ANONYMOUS)).plans).toMatchObject([{ id: planId, available: false, amountMinor: 500 }]);
    await savePayoutInstructions.call({ instructions: "Interac e-transfer" }, RAE);
    await setPayoutAccountStatus.call({ userId: RAE.userId, status: "ready" }, OWNER);
    expect((await memberPlans.call({ handle: "rae" }, ANONYMOUS)).plans).toMatchObject([{ id: planId, available: true }]);
    expect((await publicMembershipPlans.call({}, ANONYMOUS)).map((p) => p.id)).not.toContain(planId);
    expect((await myMemberPlans.call({}, RAE)).map((p) => [p.name, p.subscribers])).toEqual([["Behind the scenes", 0]]);
    await setMemberPlanStatus.call({ planId, offered: false }, RAE);
    expect((await memberPlans.call({ handle: "rae" }, ANONYMOUS)).plans).toEqual([]);
    expect((await failure(setMemberPlanStatus.call({ planId, offered: true }, SAM))).code).toBe("not_found");
  });

  it("opens subscriber-only posts after the first payment and owes the member a payout", async () => {
    await savePayoutInstructions.call({ instructions: "Interac e-transfer" }, RAE);
    await setPayoutAccountStatus.call({ userId: RAE.userId, status: "ready" }, OWNER);
    const { planId } = await createMemberPlan.call({ name: "Behind the scenes", price: "5", interval: "month" }, RAE);
    const post = await createPost.call({ body: "Raw edit for subscribers", visibility: "subscribers" }, RAE);
    expect((await failure(viewPost.call({ id: post.id }, SAM))).code).toBe("not_found");

    const [offer] = (await memberPlans.call({ handle: "rae" }, SAM)).plans as { id: string; termsHash: string }[];
    const joined = await joinMembership.call({ planId: offer!.id, termsHash: offer!.termsHash, requestKey: crypto.randomUUID(), acceptedTerms: true }, SAM);
    expect(joined.pending).toBe(true);
    expect((await failure(viewPost.call({ id: post.id }, SAM))).code).toBe("not_found");

    await pay(joined.invoiceId!);
    expect((await viewPost.call({ id: post.id }, SAM)).post.body).toBe("Raw edit for subscribers");
    expect((await postsBy.call({ handle: "rae" }, SAM)).posts.map((p) => p.body)).toContain("Raw edit for subscribers");
    expect((await memberPlans.call({ handle: "rae" }, SAM)).subscribed).toBe(true);
    expect((await myMemberPlans.call({}, RAE))[0]!.subscribers).toBe(1);
    expect(planId).toBe(offer!.id);

    const [payout] = await db().select().from(memberPayouts).where(eq(memberPayouts.invoiceId, joined.invoiceId!));
    expect(payout).toMatchObject({ sellerId: RAE.userId, state: "held", grossMinor: 500, orderId: null });
    await onInvoicePaid({ invoiceId: joined.invoiceId });
    expect(await db().select().from(memberPayouts)).toHaveLength(1);

    expect((await reversePayouts.call({ invoiceId: joined.invoiceId!, amountMinor: 10_000 }, { kind: "system" })).changed).toBe(1);
    const [after] = await db().select().from(memberPayouts).where(eq(memberPayouts.invoiceId, joined.invoiceId!));
    expect(after!.state).toBe("cancelled");
  });
});
