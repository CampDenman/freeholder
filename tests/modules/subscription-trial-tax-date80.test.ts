// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: actual manual trial terms must use the actual dated first-paid tax.
// The certificate, declarations and people here are fictional; no provider creation.
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { stopJobs } from "@/core/jobs";
import { ready } from "@/core/runtime";
import { cartItems, productVariants } from "@/modules/catalog/schema";
import { requestMerchantTaxExemption, reviewMemberMerchantTaxExemption } from "@/modules/invoicing/merchant-tax-exemptions";
import { previewMerchantTax } from "@/modules/invoicing/merchant-tax-preview";
import { taxExemptions } from "@/modules/invoicing/schema";
import { quoteNewAgreement } from "@/modules/subscriptions/merchant-terms-quote";
import { subscriptionCommercialSnapshot } from "@/modules/subscriptions/merchant-terms-contract";
import { subscriptionCommercialTerms } from "@/modules/subscriptions/schema";
import { savePlan, subscribe } from "@/modules/subscriptions/service";
import { seedMerchantCheckout80 } from "../helpers/merchant-checkout80";
import { closeDb, CUSTOMER, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

describe.runIf(hasDatabase)("original trial tax calendar (C12.38)", { timeout: 60000 }, () => {
  let fixture: Awaited<ReturnType<typeof seedMerchantCheckout80>> | undefined;
  beforeAll(ready, 60000); beforeEach(truncateSpine);
  afterEach(() => { fixture?.cleanup(); fixture = undefined; vi.restoreAllMocks(); });
  afterAll(async () => { await stopJobs(); await closeDb(); });
  it("quotes the actual first-paid trial date after its known current exemption expires", async () => {
    fixture = await seedMerchantCheckout80("destination", 1);
    // Only login identity is seeded, matching the existing member fixture.
    // Actual certificate request/review and all economic operations are services.
    const buyer = { ...CUSTOMER, userId: randomUUID() };
    await db().insert(users).values({ id: buyer.userId, email: fixture.buyer.email!, role: "customer" });
    await db().update(contacts).set({ userId: buyer.userId }).where(eq(contacts.id, fixture.buyer.id));
    const requested = await requestMerchantTaxExemption.call({ cartId: fixture.cart.id, cartToken: fixture.cart.token,
      sellerUserId: fixture.sellers[0]!.userId, destination: { country: "CA", region: "BC" }, kind: "reseller", certificateRef: "synthetic-known-trial-expiry" }, buyer);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await reviewMemberMerchantTaxExemption.call({ id: requested.id, expectedStatus: "pending", decision: "valid", confirmEvidence: true, expiresAt: expiresAt.toISOString() }, fixture.sellers[0]!);
    const [certificate] = await db().select().from(taxExemptions).where(eq(taxExemptions.id, requested.id));
    expect(certificate).toMatchObject({ status: "valid", merchantProfileId: fixture.profiles[0]!.profileId });
    expect(certificate!.expiresAt).toEqual(expiresAt);
    const [selected] = await db().select({ variant: productVariants }).from(cartItems).innerJoin(productVariants, eq(productVariants.id, cartItems.variantId))
      .where(eq(cartItems.cartId, fixture.cart.id)).limit(1);
    const variant = selected?.variant;
    if (!variant) throw new Error("The real merchant fixture has no original variant.");
    const plan = await savePlan.call({ productId: variant.productId, name: "Original dated manual trial", interval: "month", trialDays: 7,
      trialRequiresCard: false, setupFeeMinor: 500, billingMode: "manual", cancelBehaviour: "period_end", proration: "none", status: "active" }, OWNER);
    const quote = await quoteNewAgreement.call({ planId: plan.id, productVariantId: variant.id, contactId: fixture.buyer.id, currency: "CAD",
      taxDestination: { country: "CA", region: "BC" }, locale: "en" }, OWNER);
    if (!quote) throw new Error("The actual original merchant quote unexpectedly selected legacy terms.");
    const accepted = await subscribe.call({ planId: plan.id, productVariantId: variant.id, contactId: fixture.buyer.id, currency: "CAD",
      taxDestination: { country: "CA", region: "BC" }, commercialTerms: { quoteDigest: quote.quoteDigest, locale: "en", source: "owner_subscription" } }, OWNER);
    expect(accepted.invoiceId).toBeNull(); expect(accepted.subscription.status).toBe("trialing");
    const firstPaidStart = accepted.subscription.trialEndsAt;
    if (!firstPaidStart) throw new Error("The real accepted trial has no first-paid calendar boundary.");
    expect(firstPaidStart.getTime()).toBeGreaterThan(certificate!.expiresAt!.getTime());
    const [terms] = await db().select().from(subscriptionCommercialTerms).where(eq(subscriptionCommercialTerms.subscriptionId, accepted.subscription.id));
    if (!terms?.taxDestination) throw new Error("The real accepted original tax terms were not retained.");
    const original = subscriptionCommercialSnapshot.parse(terms.snapshot);
    const item = { quantityMicros: 1000000, discountMinor: 0, category: original.taxCategoryCode, requiresShipping: original.requiresShipping };
    const firstPaid = await previewMerchantTax.call({ profileId: terms.profileId, profileVersion: terms.profileVersion, contactId: fixture.buyer.id,
      destination: terms.taxDestination, currency: original.currency, shippingMinor: 0, occurredAt: firstPaidStart,
      items: [{ ...item, id: "line:0", unitAmountMinor: original.periodAmountMinor }, { ...item, id: "line:1", unitAmountMinor: original.setupFeeMinor }] }, { kind: "system" });
    expect(quote.initialTaxQuote.totalMinor).toBe(0);
    expect(firstPaid.quote.exemption).toBeNull(); expect(firstPaid.amounts.taxMinor).toBe(225); expect(firstPaid.amounts.totalMinor).toBe(4725);
    // Native BEFORE oracle: the accepted first-paid amount must agree with
    // the actual future period, not the certificate's currently-valid date.
    expect(quote.firstPeriodTaxQuote.totalMinor).toBe(firstPaid.amounts.totalMinor);
    expect(terms.firstPeriodTaxQuote.quoteDigest).toBe(firstPaid.quoteDigest);
  });
});
