// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C9.13: run only with the composed original setup-fee fragment.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { resolveContact } from "@/core/contacts/service";
import { ready } from "@/core/runtime";
import { updateBusiness } from "@/core/settings/service";
import { priceListEntries, priceLists, productVariants, products } from "@/modules/catalog/schema";
import { invoiceLines, invoices } from "@/modules/invoicing/schema";
import { voidInvoice } from "@/modules/invoicing/invoice-service";
import { renewDue, savePlan, subscribe } from "@/modules/subscriptions/service";
import { subscriptions } from "@/modules/subscriptions/schema";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const firstStart = new Date("2020-01-01T00:00:00Z");
async function seed(trialDays = 14) {
  await db().insert(users).values({ id: OWNER.userId, email: "trial-setup-owner@example.test", role: "owner" });
  await updateBusiness.call({ name: "Original trial setup fixture", country: "CA", baseCurrency: "CAD", timezone: "UTC" }, OWNER);
  const [product] = await db().insert(products).values({ name: "Original trial product", slug: "trial-setup-original", kind: "digital", status: "active", publishedAt: new Date() }).returning();
  const [variant] = await db().insert(productVariants).values({ productId: product!.id, combinationKey: "default", sku: "trial-setup-original", isDefault: true, requiresShipping: false }).returning();
  const [list] = await db().insert(priceLists).values({ name: "Original trial prices", currency: "CAD", active: true }).returning();
  await db().insert(priceListEntries).values({ priceListId: list!.id, variantId: variant!.id, amountMinor: 2000 });
  const plan = await savePlan.call({ productId: product!.id, name: "Original no-card trial", interval: "month", billingMode: "manual", status: "active",
    trialDays, trialRequiresCard: false, setupFeeMinor: 500 }, OWNER);
  const buyer = (await resolveContact.call({ email: "trial-setup-buyer@example.test", name: "Original trial buyer" }, OWNER)).contact;
  const started = await subscribe.call({ planId: plan.id, contactId: buyer.id }, OWNER);
  return { product: product!, plan, started };
}
async function due(id: string, end = firstStart) {
  await db().update(subscriptions).set({ currentPeriodStart: new Date("2019-12-01T00:00:00Z"), currentPeriodEnd: end,
    trialEndsAt: end }).where(eq(subscriptions.id, id));
}

describe.runIf(hasDatabase)("accepted original trial setup fee", { timeout: 60000 }, () => {
  beforeAll(ready, 60000); beforeEach(truncateSpine); afterAll(closeDb);
  it("retains the accepted fee through a trial and later plan edits, once, including first-period replay", async () => {
    const { product, plan, started } = await seed();
    expect(started.invoiceId).toBeNull();
    await savePlan.call({ id: plan.id, productId: product.id, name: plan.name, interval: "month", billingMode: "manual", status: "active",
      trialDays: 14, trialRequiresCard: false, setupFeeMinor: 999 }, OWNER);
    await due(started.subscription.id);
    expect((await renewDue.call({}, { kind: "system" })).renewed).toBe(1);
    const [first] = await db().select().from(invoices).where(eq(invoices.sourceType, "subscription"));
    expect(first?.totalMinor).toBe(2500);
    expect(await db().select().from(invoiceLines).where(eq(invoiceLines.invoiceId, first!.id)))
      .toEqual(expect.arrayContaining([expect.objectContaining({ position: 1, unitAmountMinor: 500, description: "Original trial product — setup" })]));
    const [original] = await db().select().from(subscriptions).where(eq(subscriptions.id, started.subscription.id));
    expect(original).toMatchObject({ acceptedSetupFeeMinor: 500, setupFeeInvoiceId: first!.id });
    expect((await renewDue.call({}, { kind: "system" })).renewed).toBe(1);
    const all = await db().select().from(invoices);
    expect(all).toHaveLength(2);
    expect(all.find(invoice => invoice.id !== first!.id)?.totalMinor).toBe(2000);
    await due(started.subscription.id);
    expect((await renewDue.call({}, { kind: "system" })).renewed).toBe(1);
    expect(await db().select().from(invoices)).toHaveLength(2);
    expect((await db().select().from(invoices).where(eq(invoices.id, first!.id)))[0]?.requestHash).toBe(first!.requestHash);
  });
  it("keeps a setup invoice raised at signup and never charges the obligation again", async () => {
    const { started } = await seed(0);
    expect((await db().select().from(invoices).where(eq(invoices.id, started.invoiceId!)))[0]?.totalMinor).toBe(2500);
    await due(started.subscription.id);
    expect((await renewDue.call({}, { kind: "system" })).renewed).toBe(1);
    expect((await db().select().from(invoices)).find(invoice => invoice.id !== started.invoiceId)?.totalMinor).toBe(2000);
  });
  it("preserves an unknown pre-upgrade fee without inventing a later obligation", async () => {
    const { started } = await seed();
    const [newAgreement] = await db().select().from(subscriptions).where(eq(subscriptions.id, started.subscription.id));
    // A documented historical-state fixture, not old-software acceptance.
    const [legacy] = await db().insert(subscriptions).values({ ...newAgreement!, id: randomUUID(), merchantScopeVersion: 0,
      acceptedSetupFeeMinor: null, setupFeeInvoiceId: null, currentPeriodStart: new Date("2019-12-01T00:00:00Z"), currentPeriodEnd: firstStart, trialEndsAt: firstStart }).returning();
    expect((await renewDue.call({}, { kind: "system" })).renewed).toBe(1);
    expect((await db().select().from(invoices))[0]?.totalMinor).toBe(2000);
    expect((await db().select().from(subscriptions).where(eq(subscriptions.id, legacy!.id)))[0])
      .toMatchObject({ acceptedSetupFeeMinor: null, setupFeeInvoiceId: null });
    await expect(db().update(subscriptions).set({ acceptedSetupFeeMinor: 999 }).where(eq(subscriptions.id, legacy!.id))).rejects.toThrow();
  });
  it("retains the original voided setup debt for review instead of silently dropping or rebilling it", async () => {
    const { started } = await seed(0);
    await voidInvoice.call({ id: started.invoiceId!, reason: "Review original setup obligation." }, OWNER);
    await due(started.subscription.id);
    await expect(renewDue.call({}, { kind: "system" })).rejects.toThrow("Review the voided original setup-fee invoice");
    expect(await db().select().from(invoices)).toHaveLength(1);
    expect((await db().select().from(subscriptions).where(eq(subscriptions.id, started.subscription.id)))[0]?.setupFeeInvoiceId).toBe(started.invoiceId);
    await expect(db().update(subscriptions).set({ setupFeeInvoiceId: null }).where(eq(subscriptions.id, started.subscription.id))).rejects.toThrow();
  });
});
