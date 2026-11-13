// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C9.38: actual manual billing may invoice accepted terms but not grant an unpaid plan.
import { eq } from "drizzle-orm";
import { z } from "zod";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/core/db";
import { stopJobs } from "@/core/jobs";
import { ready } from "@/core/runtime";
import { setModuleEnabled } from "@/core/settings/service";
import { cartItems, productVariants } from "@/modules/catalog/schema";
import { invoices, invoiceLines, payments } from "@/modules/invoicing/schema";
import { quoteNewAgreement } from "@/modules/subscriptions/merchant-terms-quote";
import { quoteMerchantAmendment, acceptMerchantAmendment } from "@/modules/subscriptions/commercial-amendments";
import { subscriptionCommercialTerms, subscriptions } from "@/modules/subscriptions/schema";
import { completePaidCommercialAmendment, renewDue, savePlan, subscribe } from "@/modules/subscriptions/service";
import { seedMerchantCheckout80 } from "../helpers/merchant-checkout80";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";
describe.runIf(hasDatabase)("manual original amendment entitlement boundary", { timeout: 60000 }, () => {
  let fixture: Awaited<ReturnType<typeof seedMerchantCheckout80>> | undefined;
  beforeAll(ready, 60000); beforeEach(truncateSpine);
  afterEach(() => { vi.useRealTimers(); fixture?.cleanup(); fixture = undefined; vi.restoreAllMocks(); });
  afterAll(async () => { await stopJobs(); await closeDb(); });
  it("freezes the accepted future invoice and keeps the old plan/calendar until its full real payment", async () => {
    fixture = await seedMerchantCheckout80("destination", 1); await setModuleEnabled.call({ module: "subscriptions", enabled: true }, OWNER);
    const [item] = await db().select({ variant: productVariants }).from(cartItems).innerJoin(productVariants, eq(productVariants.id, cartItems.variantId)).where(eq(cartItems.cartId, fixture.cart.id)).limit(1);
    if (!item) throw new Error("Missing actual merchant offer");
    const old = await savePlan.call({ productId: item.variant.productId, name: "Original manual trial", interval: "month", trialDays: 7, trialRequiresCard: false, setupFeeMinor: 500, billingMode: "manual", proration: "none", status: "active" }, OWNER);
    const input = { planId: old.id, productVariantId: item.variant.id, contactId: fixture.buyer.id, currency: "CAD", taxDestination: { country: "CA", region: "BC" } };
    const quote = await quoteNewAgreement.call(input, OWNER); if (!quote) throw new Error("Missing actual merchant terms");
    const original = await subscribe.call({ ...input, commercialTerms: { quoteDigest: quote.quoteDigest, locale: "en", source: "owner_subscription" } }, OWNER);
    const [first] = await db().select().from(subscriptionCommercialTerms).where(eq(subscriptionCommercialTerms.subscriptionId, original.subscription.id));
    const next = await savePlan.call({ productId: item.variant.productId, name: "Accepted future manual plan", interval: "month", intervalCount: 2, billingMode: "manual", status: "active" }, OWNER);
    const selection = { id: original.subscription.id, planId: next.id, taxDestination: input.taxDestination, locale: "en" as const };
    const review = await quoteMerchantAmendment.call(selection, OWNER);
    const accepted = await acceptMerchantAmendment.call({ ...selection, previousTermsId: review.previousTermsId, acceptedQuoteDigest: review.quoteDigest, confirm: true }, OWNER); expect(accepted.state).toBe("activated");
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(original.subscription.currentPeriodEnd);
    await renewDue.call({}, { kind: "system" });
    const [invoice] = await db().select().from(invoices); if (!invoice) throw new Error("The actual renewal did not raise its canonical invoice");
    expect(invoice).toMatchObject({ totalMinor: 4725, taxMinor: 225, paidMinor: 0, status: "sent" });
    const lines = await db().select().from(invoiceLines).where(eq(invoiceLines.invoiceId, invoice.id)); expect(lines.every(line => z.object({ subscriptionTermsId: z.uuid() }).parse(line.snapshot).subscriptionTermsId === accepted.termsId)).toBe(true);
    expect(await completePaidCommercialAmendment.call({ invoiceId: invoice.id }, { kind: "system" })).toEqual({ applied: false });
    const [parent] = await db().select().from(subscriptions).where(eq(subscriptions.id, original.subscription.id));
    expect(parent?.planId).toBe(old.id); expect(parent?.pendingPlanId).toBe(next.id); expect(parent?.currentPeriodEnd).toEqual(original.subscription.currentPeriodEnd); expect(await db().select().from(payments)).toHaveLength(0);
    await renewDue.call({}, { kind: "system" }); expect(await db().select().from(invoices)).toHaveLength(1);
    expect((await db().select().from(subscriptionCommercialTerms).where(eq(subscriptionCommercialTerms.id, first!.id)))[0]).toEqual(first);
  });
});
