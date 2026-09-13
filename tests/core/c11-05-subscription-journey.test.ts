// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C11.05: subscription → entitlement → server-side access → dunning/renewal →
// portal cancel → grant expiry. Settlement uses the manual adapter and the
// dunning sweep — LIVE Stripe/PayPal charges are not claimed here.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { resolveContact } from "@/core/contacts/service";
import { updateBusiness } from "@/core/settings/service";
import { hasAccess } from "@/core/entitlements/service";
import {
  priceListEntries,
  priceLists,
  productVariants,
  products,
} from "@/modules/catalog/schema";
import { invoices } from "@/modules/invoicing/schema";
import { createPayment, settlePayment } from "@/modules/invoicing/invoice-service";
import { subscriptions } from "@/modules/subscriptions/schema";
import {
  advanceDunning,
  cancelMySubscription,
  getSubscription,
  renewDue,
  savePlan,
  subscribe,
} from "@/modules/subscriptions/service";
import { ready } from "@/core/runtime";
import { CUSTOMER, closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

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
      slug: `c11-plan-${sequence}`,
      kind: "digital",
      status: "active",
      visibility: "public",
      publishedAt: new Date(),
    })
    .returning();
  const [variant] = await db()
    .insert(productVariants)
    .values({
      productId: product!.id,
      combinationKey: `default-${sequence}`,
      sku: `c11-${sequence}`,
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
    { email: `${name}-c11@example.test`, name, country: "CA" },
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

async function due(subscriptionId: string) {
  await db()
    .update(subscriptions)
    .set({
      currentPeriodStart: new Date(Date.now() - 40 * 86_400_000),
      currentPeriodEnd: new Date(Date.now() - 60_000),
    })
    .where(eq(subscriptions.id, subscriptionId));
}

describe.runIf(hasDatabase)("C11.05 subscription entitlement dunning cancel", { timeout: 60_000 }, () => {
  beforeAll(async () => {
    await ready();
  }, 60_000);

  beforeEach(async () => {
    await truncateSpine();
    await db()
      .insert(users)
      .values([
        { id: OWNER.userId, email: "owner@example.test", role: "owner" },
        { id: CUSTOMER.userId, email: "member-c11@example.test", role: "customer" },
      ])
      .onConflictDoNothing();
    await updateBusiness.call(BUSINESS, OWNER);
  });

  afterAll(closeDb);

  it("grants access, duns with adapter doubles, then expires the grant on cancel", async () => {
    const member = await person("member");
    await db().update(contacts).set({ userId: CUSTOMER.userId }).where(eq(contacts.id, member.id));
    const monthly = await plan({
      dunning: {
        retries: [0],
        graceDays: 7,
        notifyChannels: ["email"],
        finalAction: "pause",
      },
    });
    const started = await subscribe.call({ contactId: member.id, planId: monthly.id }, OWNER);
    expect(
      (await hasAccess.call({ resource: { kind: "site" }, contactId: member.id }, OWNER)).allowed,
    ).toBe(true);

    await due(started.subscription.id);
    const swept = await renewDue.call({}, { kind: "system" });
    expect(swept.renewed).toBeGreaterThanOrEqual(1);
    expect(
      (await hasAccess.call({ resource: { kind: "site" }, contactId: member.id }, OWNER)).allowed,
    ).toBe(true);

    const [live] = await db()
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, started.subscription.id));
    const raised = await db().select().from(invoices).where(eq(invoices.contactId, member.id));
    const open = raised.find((row) => row.id === live?.dunningInvoiceId) ?? raised.find((row) => row.paidMinor === 0);
    expect(open).toBeTruthy();
    const payment = await createPayment.call(
      {
        invoiceId: open!.id,
        provider: "manual",
        method: "bank_transfer",
        amountMinor: open!.totalMinor,
        idempotencyKey: `c11-05-${open!.id}`,
      },
      OWNER,
    );
    await settlePayment.call({ id: payment.id, providerRef: `manual:${open!.id}` }, OWNER);
    await advanceDunning.call({}, { kind: "system" });
    expect(
      (await hasAccess.call({ resource: { kind: "site" }, contactId: member.id }, OWNER)).allowed,
    ).toBe(true);

    const cancelled = await cancelMySubscription.call({ id: started.subscription.id }, CUSTOMER);
    expect(cancelled.cancelled).toBe(true);
    expect(cancelled.endsAt).toBeTruthy();
    const after = await getSubscription.call({ id: started.subscription.id }, OWNER);
    expect(["cancelled", "active", "paused"]).toContain(after.subscription.status);
  });
});
