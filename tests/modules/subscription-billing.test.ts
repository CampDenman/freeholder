// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Automatic subscription billing (MASTER.md §4.15, C9.33).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { resolveContact } from "@/core/contacts/service";
import { updateBusiness } from "@/core/settings/service";
import { invoices, paymentMethods } from "@/modules/invoicing/schema";
import {
  priceListEntries,
  priceLists,
  productVariants,
  products,
} from "@/modules/catalog/schema";
import { subscriptions } from "@/modules/subscriptions/schema";
import {
  changeMyPlan,
  changePlan,
  chargePlatformDue,
  enroll,
  proratedDifference,
  reconcileProviderPeriod,
  savePlan,
  subscribe,
} from "@/modules/subscriptions/service";
import { ready } from "@/core/runtime";
import { closeDb, CUSTOMER, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const mocks = vi.hoisted(() => ({
  chargeSavedMethod: vi.fn(),
  createRecurringSchedule: vi.fn(),
  updateRecurringSchedule: vi.fn(),
  cancelRecurringSchedule: vi.fn(),
}));

vi.mock("@/adapters/payments", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    paymentAdapter: vi.fn(() => ({
      id: "stripe",
      status: { family: "payments", id: "stripe", available: true, message: "ok" },
      capabilities: () => ({
        refunds: true,
        partialRefunds: true,
        savedMethods: true,
        subscriptions: true,
        offSessionCharges: true,
        disputes: true,
        payouts: false,
        inPerson: false,
        strongCustomerAuthentication: true,
      }),
      chargeSavedMethod: mocks.chargeSavedMethod,
      createRecurringSchedule: mocks.createRecurringSchedule,
      updateRecurringSchedule: mocks.updateRecurringSchedule,
      cancelRecurringSchedule: mocks.cancelRecurringSchedule,
    })),
  };
});

const BUSINESS = {
  name: "Aurora Coast Studio",
  country: "CA",
  baseCurrency: "CAD",
  timezone: "America/Vancouver",
};

let sequence = 0;

async function priced(name: string, amountMinor: number) {
  sequence += 1;
  const [product] = await db()
    .insert(products)
    .values({
      name,
      slug: `bill-product-${sequence}`,
      kind: "digital",
      status: "active",
      publishedAt: new Date(),
    })
    .returning();
  const [variant] = await db()
    .insert(productVariants)
    .values({
      productId: product!.id,
      combinationKey: `default-${sequence}`,
      sku: `bill-sku-${sequence}`,
      isDefault: true,
    })
    .returning();
  const [list] = await db()
    .insert(priceLists)
    .values({ name: `Bill list ${sequence}`, currency: "CAD", active: true })
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
    { email: `${name}@billing.test`, name, country: "CA" },
    OWNER,
  );
  return contact;
}

async function plan(
  overrides: Record<string, unknown> = {},
  amountMinor = 2_500,
) {
  const { product } = await priced(`Bill plan ${sequence + 1}`, amountMinor);
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

async function card(contactId: string) {
  sequence += 1;
  const [method] = await db()
    .insert(paymentMethods)
    .values({
      contactId,
      provider: "stripe",
      providerMethodRef: `pm_${sequence}`,
      providerCustomerRef: `cus_${sequence}`,
      kind: "card",
      label: "card ending 4242",
      last4: "4242",
      status: "active",
      consentSource: "provider_checkout",
      consentedAt: new Date(),
      providerStatusAt: new Date(),
    })
    .returning();
  return method!;
}

describe("proratedDifference", () => {
  it("credits unused time on the old plan and charges unused time on the new one", () => {
    const start = new Date("2026-01-01T00:00:00Z");
    const end = new Date("2026-01-31T00:00:00Z");
    const mid = new Date("2026-01-16T00:00:00Z");
    expect(proratedDifference(1_000, 2_000, start, end, mid)).toBe(
      Math.round((2_000 * (end.getTime() - mid.getTime())) / (end.getTime() - start.getTime())) -
        Math.round((1_000 * (end.getTime() - mid.getTime())) / (end.getTime() - start.getTime())),
    );
    expect(proratedDifference(1_000, 2_000, start, end, end)).toBe(0);
    expect(proratedDifference(1_000, 2_000, start, end, start)).toBe(1_000);
  });
});

describe.runIf(hasDatabase)("subscription billing", () => {
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
    mocks.chargeSavedMethod.mockReset();
    mocks.createRecurringSchedule.mockReset();
    mocks.updateRecurringSchedule.mockReset();
    mocks.cancelRecurringSchedule.mockReset();
    let charges = 0;
    mocks.chargeSavedMethod.mockImplementation(async () => ({
      providerRef: `pi_off_${(charges += 1)}`,
      status: "succeeded" as const,
    }));
    mocks.createRecurringSchedule.mockResolvedValue({ providerRef: "sub_1" });
    mocks.updateRecurringSchedule.mockResolvedValue({ providerRef: "sub_1" });
    mocks.cancelRecurringSchedule.mockResolvedValue(undefined);
  });

  afterAll(async () => {
    await closeDb();
  });

  it("charges a stored method for a platform plan without skipping the paid period", async () => {
    const member = await person("platform");
    const method = await card(member.id);
    const monthly = await plan({ billingMode: "platform" });
    const started = await enroll.call(
      { contactId: member.id, planId: monthly.id, paymentMethodId: method.id },
      OWNER,
    );
    expect(mocks.chargeSavedMethod).toHaveBeenCalledOnce();
    expect(started.status).toBe("active");
    const [row] = await db()
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, started.subscriptionId));
    expect(row?.currentPeriodEnd.getTime()).toBeGreaterThan(Date.now());
    const [invoice] = await db()
      .select()
      .from(invoices)
      .where(eq(invoices.id, started.invoiceId!));
    expect(invoice?.status).toBe("paid");
  });

  it("renews a due platform subscription from the job", async () => {
    const member = await person("renew");
    const method = await card(member.id);
    const monthly = await plan({ billingMode: "platform" });
    const started = await enroll.call(
      { contactId: member.id, planId: monthly.id, paymentMethodId: method.id },
      OWNER,
    );
    await db()
      .update(subscriptions)
      .set({
        currentPeriodStart: new Date(Date.now() - 40 * 86_400_000),
        currentPeriodEnd: new Date(Date.now() - 60_000),
      })
      .where(eq(subscriptions.id, started.subscriptionId));
    mocks.chargeSavedMethod.mockClear();
    const result = await chargePlatformDue.call({}, { kind: "system" });
    expect(result.charged).toBe(1);
    expect(mocks.chargeSavedMethod).toHaveBeenCalledOnce();
    const [row] = await db()
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, started.subscriptionId));
    expect(row?.currentPeriodEnd.getTime()).toBeGreaterThan(Date.now());
  });

  it("hands a provider schedule over at enroll and follows a paid webhook", async () => {
    const member = await person("provider");
    const method = await card(member.id);
    const monthly = await plan({ billingMode: "provider" });
    const started = await enroll.call(
      { contactId: member.id, planId: monthly.id, paymentMethodId: method.id },
      OWNER,
    );
    expect(mocks.createRecurringSchedule).toHaveBeenCalledOnce();
    const [row] = await db()
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, started.subscriptionId));
    expect(row).toMatchObject({ provider: "stripe", providerRef: "sub_1" });

    const first = await reconcileProviderPeriod.call(
      {
        provider: "stripe",
        providerRef: "sub_1",
        kind: "subscription_period_paid",
        amountMinor: 2_500,
        currency: "CAD",
      },
      { kind: "system" },
    );
    expect(first.applied).toBe(true);
    const [invoice] = await db()
      .select()
      .from(invoices)
      .where(eq(invoices.sourceType, "subscription"));
    expect(invoice?.status).toBe("paid");

    await db()
      .update(subscriptions)
      .set({
        currentPeriodStart: new Date(Date.now() - 40 * 86_400_000),
        currentPeriodEnd: new Date(Date.now() - 60_000),
      })
      .where(eq(subscriptions.id, started.subscriptionId));
    const renewed = await reconcileProviderPeriod.call(
      {
        provider: "stripe",
        providerRef: "sub_1",
        kind: "subscription_period_paid",
        amountMinor: 2_500,
        currency: "CAD",
        periodStart: new Date().toISOString(),
        periodEnd: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      },
      { kind: "system" },
    );
    expect(renewed.applied).toBe(true);
    const [after] = await db()
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, started.subscriptionId));
    expect(after?.currentPeriodEnd.getTime()).toBeGreaterThan(Date.now());
  });

  it("defers a plan change when proration is none", async () => {
    const member = await person("defer");
    const from = await plan({ proration: "none" }, 2_500);
    const to = await plan({ name: "Yearly" }, 20_000);
    const started = await subscribe.call({ contactId: member.id, planId: from.id }, OWNER);
    const changed = await changePlan.call({ id: started.subscription.id, planId: to.id }, OWNER);
    expect(changed.deferred).toBe(true);
    const [row] = await db()
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, started.subscription.id));
    expect(row?.planId).toBe(from.id);
    expect(row?.pendingPlanId).toBe(to.id);
  });

  it("raises a proration invoice when the unused fraction costs more", async () => {
    const member = await person("prorate");
    const from = await plan({ proration: "create_prorations" }, 1_000);
    const to = await plan({ name: "Plus" }, 10_000);
    const started = await subscribe.call({ contactId: member.id, planId: from.id }, OWNER);
    const changed = await changePlan.call({ id: started.subscription.id, planId: to.id }, OWNER);
    expect(changed.deferred).toBe(false);
    expect(changed.proratedMinor).toBeGreaterThan(0);
    expect(changed.invoiceId).not.toBeNull();
    const [row] = await db()
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, started.subscription.id));
    expect(row?.planId).toBe(to.id);
  });

  it("refuses platform enroll without a stored method", async () => {
    const member = await person("nomethod");
    const monthly = await plan({ billingMode: "platform" });
    const error = await failure(
      enroll.call({ contactId: member.id, planId: monthly.id }, OWNER),
    );
    expect(error.message).toMatch(/stored payment method/i);
  });

  it("lets a customer change only their own plan", async () => {
    const member = await person("mine");
    await db()
      .insert(users)
      .values({ id: CUSTOMER.userId, email: "mine@billing.test", role: "customer" })
      .onConflictDoNothing();
    const { contacts } = await import("@/core/contacts/schema");
    await db().update(contacts).set({ userId: CUSTOMER.userId }).where(eq(contacts.id, member.id));
    const from = await plan();
    const to = await plan({ name: "Other" }, 3_000);
    const started = await subscribe.call({ contactId: member.id, planId: from.id }, OWNER);
    const mine = await changeMyPlan.call(
      { id: started.subscription.id, planId: to.id },
      CUSTOMER,
    );
    expect(mine.subscriptionId).toBe(started.subscription.id);
    const stranger = await person("not-mine");
    const other = await subscribe.call({ contactId: stranger.id, planId: from.id }, OWNER);
    const error = await failure(
      changeMyPlan.call({ id: other.subscription.id, planId: to.id }, CUSTOMER),
    );
    expect(error.code).toBe("not_found");
  });
});
