// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C9.33/C11.10: ordinary paid manual period and real shared payments; no80 model dependency.
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { stopJobs } from "@/core/jobs";
import { resolveContact } from "@/core/contacts/service";
import { setModuleEnabled } from "@/core/settings/service";
import { entitlementGrants, entitlements } from "@/core/entitlements/schema";
import { products, productVariants, priceLists, priceListEntries } from "@/modules/catalog/schema";
import { createPayment, settlePayment } from "@/modules/invoicing/invoice-service";
import { invoices, payments } from "@/modules/invoicing/schema";
import { savePlan, subscribe } from "@/modules/subscriptions/service";
import { changePlan, completePaidPlanChange } from "@/modules/subscriptions/billing";
import { subscriptions } from "@/modules/subscriptions/schema";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";
describe.runIf(hasDatabase)("owner proration paid-access boundary through the ordinary invoice spine", { timeout: 60000 }, () => {
  beforeAll(ready, 60000); beforeEach(truncateSpine); afterEach(() => vi.useRealTimers());
  afterAll(async () => { await stopJobs(); await closeDb(); });
  async function offer(name: string, amountMinor: number) {
    const [product] = await db().insert(products).values({ name, slug: `paid-proration-${name.toLowerCase()}`, kind: "digital", status: "active", publishedAt: new Date() }).returning();
    const [variant] = await db().insert(productVariants).values({ productId: product!.id, combinationKey: "default", sku: `paid-proration-${name.toLowerCase()}`, isDefault: true }).returning();
    const [list] = await db().insert(priceLists).values({ name: `Paid proration ${name}`, currency: "CAD", active: true }).returning();
    await db().insert(priceListEntries).values({ priceListId: list!.id, variantId: variant!.id, amountMinor });
    return savePlan.call({ productId: product!.id, name, interval: "month", billingMode: "manual", proration: "create_prorations", status: "active" }, OWNER);
  }
  it("keeps the actual paid original plan/grants/calendar through an owner upgrade and partial payment; only full exact invoice payment unlocks the new plan", async () => {
    for (const module of ["catalog", "invoicing", "subscriptions"]) await setModuleEnabled.call({ module, enabled: true }, OWNER);
    const contact = (await resolveContact.call({ email: "fictional-paid-proration@example.test", name: "Paid proration fixture", country: "CA" }, OWNER)).contact;
    const old = await offer("Original", 1000), next = await offer("Upgraded", 10000);
    const original = await subscribe.call({ contactId: contact.id, planId: old.id, currency: "CAD" }, OWNER);
    if (!original.invoiceId) throw Error("The actual original manual period did not issue its invoice.");
    const [originalInvoice] = await db().select().from(invoices).where(eq(invoices.id, original.invoiceId)); if (!originalInvoice || originalInvoice.totalMinor <= 0) throw Error("Missing original period principal.");
    const principal = await createPayment.call({ invoiceId: originalInvoice.id, provider: "manual", method: "bank_transfer", amountMinor: originalInvoice.totalMinor, idempotencyKey: "original-paid-period" }, OWNER);
    await settlePayment.call({ id: principal.id, providerRef: "manual-original-paid-period" }, OWNER);
    const [paidOriginal] = await db().select().from(invoices).where(eq(invoices.id, originalInvoice.id)); expect(paidOriginal?.status).toBe("paid");
    const period = original.subscription;
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(Math.floor((period.currentPeriodStart.getTime() + period.currentPeriodEnd.getTime()) / 2)));
    const changed = await changePlan.call({ id: period.id, planId: next.id }, OWNER);
    expect(changed).toMatchObject({ awaitingPayment: true, deferred: false, proratedMinor: 4500 });
    if (!changed.invoiceId) throw Error("The actual upgrade did not issue its original proration invoice.");
    const [parent] = await db().select().from(subscriptions).where(eq(subscriptions.id, period.id)); expect(parent?.planId).toBe(old.id);
    const access = () => db().select({ planId: entitlements.grantorId }).from(entitlementGrants).innerJoin(entitlements, eq(entitlements.id, entitlementGrants.entitlementId)).where(eq(entitlementGrants.sourceSubscriptionId, period.id));
    expect((await access()).some(row => row.planId === next.id)).toBe(false);
    const [invoice] = await db().select().from(invoices).where(eq(invoices.id, changed.invoiceId)); if (!invoice || invoice.totalMinor <= 1) throw Error("The exact proration invoice is missing its positive balance.");
    const partial = await createPayment.call({ invoiceId: invoice.id, provider: "manual", method: "bank_transfer", amountMinor: 1, idempotencyKey: "partial-proration" }, OWNER);
    await settlePayment.call({ id: partial.id, providerRef: "manual-partial-proration" }, OWNER);
    expect(await completePaidPlanChange.call({ invoiceId: invoice.id }, { kind: "system" })).toEqual({ switched: false });
    expect((await access()).some(row => row.planId === next.id)).toBe(false);
    await expect(changePlan.call({ id: period.id, planId: next.id }, OWNER)).rejects.toMatchObject({ code: "conflict" });
    const final = await createPayment.call({ invoiceId: invoice.id, provider: "manual", method: "bank_transfer", amountMinor: invoice.totalMinor - 1, idempotencyKey: "final-proration" }, OWNER);
    await settlePayment.call({ id: final.id, providerRef: "manual-final-proration" }, OWNER);
    await completePaidPlanChange.call({ invoiceId: invoice.id }, { kind: "system" });
    const [applied] = await db().select().from(subscriptions).where(eq(subscriptions.id, period.id)); expect(applied).toMatchObject({ planId: next.id, currentPeriodStart: period.currentPeriodStart, currentPeriodEnd: period.currentPeriodEnd });
    expect((await access()).some(row => row.planId === next.id)).toBe(true);
    expect((await db().select().from(invoices).where(eq(invoices.id, originalInvoice.id)))[0]).toEqual(paidOriginal);
    await changePlan.call({ id: period.id, planId: next.id }, OWNER);
    expect(await db().select().from(invoices)).toHaveLength(2); expect(await db().select().from(payments)).toHaveLength(3);
  });
});
