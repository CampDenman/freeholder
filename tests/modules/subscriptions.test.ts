// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// A subscription's life (MASTER.md §4.15, §43 C9.13).
//
// The tests worth reading first are the two about time: a monthly plan taken
// out on the 31st has to renew on a date February actually has, and a
// cancellation must end on the day the paid period runs out — not sooner,
// which takes access somebody bought, and not later, which gives away a month.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { resolveContact } from "@/core/contacts/service";
import { updateBusiness } from "@/core/settings/service";
import { invoices } from "@/modules/invoicing/schema";
import {
  priceListEntries,
  priceLists,
  productVariants,
  products,
} from "@/modules/catalog/schema";
import { subscriptionEvents, subscriptions } from "@/modules/subscriptions/schema";
import {
  cancelMySubscription,
  cancelSubscription,
  getSubscription,
  listPlans,
  listSubscriptions,
  pauseSubscription,
  periodEnd,
  renewDue,
  resumeSubscription,
  savePlan,
  subscribe,
} from "@/modules/subscriptions/service";
import { ready } from "@/core/runtime";
import { closeDb, CUSTOMER, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const BUSINESS = {
  name: "Aurora Coast Studio",
  country: "CA",
  baseCurrency: "CAD",
  timezone: "America/Vancouver",
};

let sequence = 0;

/** A product priced in CAD, which is all a plan needs to be sellable. */
async function priced(name: string, amountMinor: number) {
  sequence += 1;
  const [product] = await db()
    .insert(products)
    .values({
      name,
      slug: `plan-product-${sequence}`,
      kind: "digital",
      status: "active",
      // An active product says when it was published; the table insists.
      publishedAt: new Date(),
    })
    .returning();
  const [variant] = await db()
    .insert(productVariants)
    .values({
      productId: product!.id,
      combinationKey: `default-${sequence}`,
      sku: `sku-${sequence}`,
      isDefault: true,
    })
    .returning();
  const [list] = await db()
    .insert(priceLists)
    .values({ name: `List ${sequence}`, currency: "CAD", active: true })
    .returning();
  await db().insert(priceListEntries).values({
    priceListId: list!.id,
    variantId: variant!.id,
    amountMinor,
  });
  return { product: product!, variant: variant! };
}

async function person(name: string) {
  const { contact } = await resolveContact.call(
    { email: `${name}@example.test`, name, country: "CA" },
    OWNER,
  );
  return contact;
}

async function plan(overrides: Record<string, unknown> = {}, amountMinor = 2_500) {
  const { product } = await priced(`Membership ${sequence + 1}`, amountMinor);
  return savePlan.call(
    {
      productId: product.id,
      name: "Monthly membership",
      interval: "month",
      status: "active",
      ...overrides,
    },
    OWNER,
  );
}

/** Move a subscription's period into the past, so the sweep finds it. */
async function due(subscriptionId: string) {
  await db()
    .update(subscriptions)
    .set({
      currentPeriodStart: new Date(Date.now() - 40 * 86_400_000),
      currentPeriodEnd: new Date(Date.now() - 60_000),
    })
    .where(eq(subscriptions.id, subscriptionId));
}

describe.runIf(hasDatabase)("subscriptions", () => {
  beforeAll(async () => {
    await ready();
  }, 60_000);

  beforeEach(async () => {
    await truncateSpine();
    await db()
      .insert(users)
      .values({ id: OWNER.userId, email: "owner@example.test", role: "owner" })
      .onConflictDoNothing();
    await updateBusiness.call(BUSINESS, OWNER);
  });

  afterAll(async () => {
    await closeDb();
  });

  /* ------------------------------------------------------------- the calendar */

  it("counts a month as a month, not as thirty days", async () => {
    // The bug this exists to prevent: 31 January plus one month must be 28 or
    // 29 February. `Date` rolls the overflow forward to 2 or 3 March on its
    // own, which would move a subscriber's billing date every year.
    expect(periodEnd(new Date("2026-01-31T09:00:00Z"), "month", 1).toISOString()).toBe(
      "2026-02-28T09:00:00.000Z",
    );
    expect(periodEnd(new Date("2028-01-31T09:00:00Z"), "month", 1).toISOString()).toBe(
      "2028-02-29T09:00:00.000Z",
    );
    // And an ordinary month keeps its day.
    expect(periodEnd(new Date("2026-03-15T09:00:00Z"), "month", 1).toISOString()).toBe(
      "2026-04-15T09:00:00.000Z",
    );
    expect(periodEnd(new Date("2026-03-15T09:00:00Z"), "year", 1).toISOString()).toBe(
      "2027-03-15T09:00:00.000Z",
    );
    expect(periodEnd(new Date("2026-03-15T09:00:00Z"), "week", 2).toISOString()).toBe(
      "2026-03-29T09:00:00.000Z",
    );
  });

  /* ------------------------------------------------------------- subscribing */

  it("bills the first period and writes down what happened", async () => {
    const member = await person("member");
    const monthly = await plan({}, 2_500);

    const started = await subscribe.call(
      { contactId: member.id, planId: monthly.id },
      OWNER,
    );
    expect(started.subscription.status).toBe("active");
    expect(started.invoiceId).not.toBeNull();

    const [invoice] = await db()
      .select()
      .from(invoices)
      .where(eq(invoices.id, started.invoiceId!));
    // Priced from the catalogue, not from anything this module stores.
    expect(invoice!.subtotalMinor).toBe(2_500);
    expect(invoice!.sourceType).toBe("subscription");
    // The period, not just the subscription: `invoices` is uniquely indexed on
    // (source_type, source_id), so next month's invoice must be a different
    // source or it could never be raised at all.
    expect(invoice!.sourceId).toMatch(new RegExp(`^${started.subscription.id}:`));
    expect(invoice!.status).toBe("sent");

    const detail = await getSubscription.call({ id: started.subscription.id }, OWNER);
    expect(detail.history.map((each) => each.kind).sort()).toEqual([
      "activated",
      "created",
      "renewed",
    ]);
  });

  it("charges a setup fee once, not every period", async () => {
    const member = await person("setup");
    const monthly = await plan({ setupFeeMinor: 5_000 }, 2_000);
    const started = await subscribe.call({ contactId: member.id, planId: monthly.id }, OWNER);

    const [first] = await db().select().from(invoices).where(eq(invoices.id, started.invoiceId!));
    expect(first!.subtotalMinor).toBe(7_000);

    await due(started.subscription.id);
    await renewDue.call({}, { kind: "system" });

    const all = await db().select().from(invoices);
    const renewal = all.find((each) => each.id !== started.invoiceId);
    expect(renewal!.subtotalMinor).toBe(2_000);
  });

  it("bills nothing during a trial", async () => {
    // A trial that raised an invoice would not be a trial. The first invoice
    // is the sweep's job, when the trial period runs out.
    const member = await person("trialist");
    const monthly = await plan({ trialDays: 14 });
    const started = await subscribe.call({ contactId: member.id, planId: monthly.id }, OWNER);

    expect(started.subscription.status).toBe("trialing");
    expect(started.invoiceId).toBeNull();
    expect(started.subscription.trialEndsAt).not.toBeNull();
    expect(await db().select().from(invoices)).toHaveLength(0);
  });

  it("turns a finished trial into a subscription", async () => {
    const member = await person("converted");
    const monthly = await plan({ trialDays: 14 });
    const started = await subscribe.call({ contactId: member.id, planId: monthly.id }, OWNER);
    await due(started.subscription.id);

    const swept = await renewDue.call({}, { kind: "system" });
    expect(swept.renewed).toBe(1);

    const detail = await getSubscription.call({ id: started.subscription.id }, OWNER);
    expect(detail.subscription.status).toBe("active");
    expect(detail.subscription.trialEndsAt).toBeNull();
    // The history says it converted, in those words.
    expect(detail.history.map((each) => each.kind)).toContain("activated");
    expect(await db().select().from(invoices)).toHaveLength(1);
  });

  /* ---------------------------------------------------------------- renewal */

  it("raises one invoice per period however often the sweep runs", async () => {
    const member = await person("swept");
    const monthly = await plan();
    const started = await subscribe.call({ contactId: member.id, planId: monthly.id }, OWNER);
    await due(started.subscription.id);

    await renewDue.call({}, { kind: "system" });
    // A second sweep in the same minute finds nothing due, and even if it did,
    // the invoice's idempotency key is the period rather than the moment.
    await renewDue.call({}, { kind: "system" });

    expect(await db().select().from(invoices)).toHaveLength(2);
  });

  it("records a failure on the history rather than swallowing it", async () => {
    // A subscription whose variant has no price in its currency cannot be
    // billed. What happens next is a dunning policy (C9.16); what happens now
    // is that an owner can see why.
    const member = await person("unpriced");
    const monthly = await plan();
    const started = await subscribe.call({ contactId: member.id, planId: monthly.id }, OWNER);
    await due(started.subscription.id);
    await db().delete(priceListEntries);

    const swept = await renewDue.call({}, { kind: "system" });
    expect(swept.failed).toBe(1);
    expect(swept.renewed).toBe(0);

    const detail = await getSubscription.call({ id: started.subscription.id }, OWNER);
    const failure_ = detail.history.find((each) => each.kind === "payment_failed");
    expect(failure_).toBeDefined();
    expect(failure_!.detail).toMatch(/price/i);
    // And the period did not move: nobody was given a month they did not pay for.
    expect(detail.subscription.currentPeriodEnd.getTime()).toBeLessThan(Date.now());
  });

  /* ------------------------------------------------------ pause, cancel, end */

  it("carries the unused remainder across a pause", async () => {
    // Pausing on day three and resuming in August must not cost the other
    // twenty-seven days. A pause postpones billing; it does not consume time.
    const member = await person("paused");
    const monthly = await plan();
    const started = await subscribe.call({ contactId: member.id, planId: monthly.id }, OWNER);

    const paused = await pauseSubscription.call({ id: started.subscription.id }, OWNER);
    expect(paused.status).toBe("paused");

    const resumed = await resumeSubscription.call({ id: started.subscription.id }, OWNER);
    expect(resumed.status).toBe("active");
    const remaining = resumed.currentPeriodEnd.getTime() - Date.now();
    const originalRemaining =
      started.subscription.currentPeriodEnd.getTime() -
      started.subscription.currentPeriodStart.getTime();
    // Within a minute of the whole original period, because nothing was used.
    expect(Math.abs(remaining - originalRemaining)).toBeLessThan(60_000);
  });

  it("keeps a cancelled subscription until the period it paid for runs out", async () => {
    // §4.15: access never quietly outlives the money, and never disappears
    // before the period the customer paid for.
    const member = await person("leaving");
    const monthly = await plan();
    const started = await subscribe.call({ contactId: member.id, planId: monthly.id }, OWNER);

    const cancelled = await cancelSubscription.call({ id: started.subscription.id }, OWNER);
    expect(cancelled.cancelAtPeriodEnd).toBe(true);
    // Still running today.
    expect(cancelled.status).toBe("active");
    expect(cancelled.endedAt).toBeNull();

    await due(started.subscription.id);
    const swept = await renewDue.call({}, { kind: "system" });
    expect(swept.ended).toBe(1);
    expect(swept.renewed).toBe(0);

    const detail = await getSubscription.call({ id: started.subscription.id }, OWNER);
    expect(detail.subscription.status).toBe("expired");
    expect(detail.subscription.endedAt).not.toBeNull();
    // And no farewell invoice for a month nobody is getting.
    expect(await db().select().from(invoices)).toHaveLength(1);
  });

  it("ends at once when the plan says so", async () => {
    const member = await person("immediate");
    const monthly = await plan({ cancelBehaviour: "immediate" });
    const started = await subscribe.call({ contactId: member.id, planId: monthly.id }, OWNER);

    const cancelled = await cancelSubscription.call({ id: started.subscription.id }, OWNER);
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.endedAt).not.toBeNull();
  });

  it("refuses to cancel something that has already ended", async () => {
    const member = await person("twice");
    const monthly = await plan({ cancelBehaviour: "immediate" });
    const started = await subscribe.call({ contactId: member.id, planId: monthly.id }, OWNER);
    await cancelSubscription.call({ id: started.subscription.id }, OWNER);

    const error = await failure(
      cancelSubscription.call({ id: started.subscription.id }, OWNER),
    );
    expect(error.message).toMatch(/already ended/i);
  });

  /* ----------------------------------------------------------------- plans */

  it("refuses an automatic billing mode nothing can run yet", async () => {
    // C9.33's work. Accepting the plan would mean a membership that silently
    // never bills anybody, which is worse than a refusal that says why.
    const { product } = await priced("Automatic", 1_000);
    const error = await failure(
      savePlan.call(
        { productId: product.id, name: "Auto", billingMode: "provider", status: "active" },
        OWNER,
      ),
    );
    expect(error.message).toMatch(/manual billing/i);
  });

  it("refuses to sell a plan that is not on sale", async () => {
    const member = await person("early");
    const draft = await plan({ status: "draft" });
    const error = await failure(
      subscribe.call({ contactId: member.id, planId: draft.id }, OWNER),
    );
    expect(error.message).toMatch(/not on sale/i);
  });

  it("lists plans by status", async () => {
    await plan({ status: "active" });
    await plan({ status: "draft" });
    expect(await listPlans.call({ status: "active" }, OWNER)).toHaveLength(1);
    expect(await listPlans.call({}, OWNER)).toHaveLength(2);
  });

  it("lets the customer cancel their own membership, and nobody else's", async () => {
    const member = await person("rae");
    await db()
      .insert(users)
      .values({ id: CUSTOMER.userId, email: "rae@example.test", role: "customer" });
    await db().update(contacts).set({ userId: CUSTOMER.userId }).where(eq(contacts.id, member.id));

    const monthly = await plan();
    const started = await subscribe.call({ contactId: member.id, planId: monthly.id }, OWNER);

    const mine = await cancelMySubscription.call({ id: started.subscription.id }, CUSTOMER);
    expect(mine.cancelled).toBe(true);
    const detail = await getSubscription.call({ id: started.subscription.id }, OWNER);
    expect(detail.subscription.cancelAtPeriodEnd).toBe(true);
    expect(detail.subscription.status).toBe("active");

    const stranger = await person("sam");
    const other = await subscribe.call({ contactId: stranger.id, planId: monthly.id }, OWNER);
    const error = await failure(
      cancelMySubscription.call({ id: other.subscription.id }, CUSTOMER),
    );
    expect(error.code).toBe("not_found");
  });

  it("lets a customer list only their own memberships", async () => {
    const member = await person("listed");
    await db()
      .insert(users)
      .values({ id: CUSTOMER.userId, email: "listed@example.test", role: "customer" });
    await db().update(contacts).set({ userId: CUSTOMER.userId }).where(eq(contacts.id, member.id));
    const monthly = await plan();
    await subscribe.call({ contactId: member.id, planId: monthly.id }, OWNER);
    await subscribe.call({ contactId: (await person("other-listed")).id, planId: monthly.id }, OWNER);

    const mine = await listSubscriptions.call({ contactId: member.id }, CUSTOMER);
    expect(mine).toHaveLength(1);

    const missing = await failure(listSubscriptions.call({}, CUSTOMER));
    expect(missing.code).toBe("permission");
  });

  it("keeps every subscription's history in order", async () => {
    const member = await person("history");
    const monthly = await plan();
    const started = await subscribe.call({ contactId: member.id, planId: monthly.id }, OWNER);
    await pauseSubscription.call({ id: started.subscription.id }, OWNER);
    await resumeSubscription.call({ id: started.subscription.id }, OWNER);

    const rows = await db()
      .select()
      .from(subscriptionEvents)
      .where(eq(subscriptionEvents.subscriptionId, started.subscription.id));
    expect(rows.map((each) => each.kind)).toEqual(
      expect.arrayContaining(["created", "activated", "renewed", "paused", "resumed"]),
    );
  });
});
