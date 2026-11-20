// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C9.13/C12.38: actual existing writer before any commercial-terms repair.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { resolveContact } from "@/core/contacts/service";
import { ready } from "@/core/runtime";
import { updateBusiness } from "@/core/settings/service";
import { priceListEntries, priceLists, productVariants, products } from "@/modules/catalog/schema";
import { invoiceLines, invoices } from "@/modules/invoicing/schema";
import { renewDue, savePlan, subscribe } from "@/modules/subscriptions/service";
import { subscriptions } from "@/modules/subscriptions/schema";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

describe.runIf(hasDatabase)("original setup fee after a no-card trial", { timeout: 60000 }, () => {
  beforeAll(ready, 60000); beforeEach(truncateSpine); afterAll(closeDb);
  it("puts the declared one-time setup fee on the trial's first actual invoice", async () => {
    await db().insert(users).values({ id: OWNER.userId, email: "trial-setup-owner@example.test", role: "owner" });
    await updateBusiness.call({ name: "Original trial setup fixture", country: "CA", baseCurrency: "CAD", timezone: "UTC" }, OWNER);
    const [product] = await db().insert(products).values({ name: "Original trial product", slug: "trial-setup-original", kind: "digital", status: "active", publishedAt: new Date() }).returning();
    const [variant] = await db().insert(productVariants).values({ productId: product!.id, combinationKey: "default", sku: "trial-setup-original", isDefault: true, requiresShipping: false }).returning();
    const [list] = await db().insert(priceLists).values({ name: "Original trial prices", currency: "CAD", active: true }).returning();
    await db().insert(priceListEntries).values({ priceListId: list!.id, variantId: variant!.id, amountMinor: 2000 });
    const plan = await savePlan.call({ productId: product!.id, name: "Original no-card trial", interval: "month", billingMode: "manual", status: "active",
      trialDays: 14, trialRequiresCard: false, setupFeeMinor: 500 }, OWNER);
    const buyer = (await resolveContact.call({ email: "trial-setup-buyer@example.test", name: "Original trial buyer" }, OWNER)).contact;
    const started = await subscribe.call({ planId: plan.id, contactId: buyer.id }, OWNER);
    expect(started.invoiceId).toBeNull();
    expect(started.subscription.status).toBe("trialing");
    await db().update(subscriptions).set({ currentPeriodStart: new Date("2026-10-01T00:00:00Z"), currentPeriodEnd: new Date("2026-11-01T00:00:00Z"),
      trialEndsAt: new Date("2026-11-01T00:00:00Z") }).where(eq(subscriptions.id, started.subscription.id));
    expect((await renewDue.call({}, { kind: "system" })).renewed).toBe(1);
    const [first] = await db().select().from(invoices).where(eq(invoices.sourceType, "subscription"));
    expect(first?.totalMinor).toBe(2500);
    const lines = await db().select().from(invoiceLines).where(eq(invoiceLines.invoiceId, first!.id));
    expect(lines).toEqual(expect.arrayContaining([expect.objectContaining({ unitAmountMinor: 500, description: "Original trial product — setup" })]));
  });
});
