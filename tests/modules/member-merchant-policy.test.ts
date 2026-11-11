// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: pin merchant authority before the first invoice, including trials.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as adapters from "@/adapters/payments";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { resolveContact } from "@/core/contacts/service";
import { ready } from "@/core/runtime";
import { updateBusiness } from "@/core/settings/service";
import { joinSite, updateMembershipRules } from "@/modules/members/service";
import { createMemberPlan } from "@/modules/members/member-subscriptions";
import { verifyInvoiceMerchantAccount } from "@/modules/members/market-merchant";
import { memberPayoutAccounts, memberSettings } from "@/modules/members/schema";
import { getInvoiceMarketPolicy } from "@/modules/invoicing/market-policy";
import { paymentMethods } from "@/modules/invoicing/schema";
import { changePlan } from "@/modules/subscriptions/billing";
import { getSubscription, renewDue, savePlan, subscribe } from "@/modules/subscriptions/service";
import { getSubscriptionMarketPolicy } from "@/modules/subscriptions/market-policy";
import { plans, subscriptions } from "@/modules/subscriptions/schema";
import { closeDb, CUSTOMER, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const SYSTEM = { kind: "system" } as const;

describe.runIf(hasDatabase)("immutable member merchant agreements (C12.38)", () => {
  let contactId: string;
  beforeAll(ready, 60_000);
  beforeEach(async () => {
    await truncateSpine();
    await db().insert(users).values([
      { id: OWNER.userId, email: "owner@example.test", role: "owner" },
      { id: CUSTOMER.userId, email: "seller@example.test", role: "customer" },
    ]);
    await updateBusiness.call({ name: "Agreement proof", country: "CA", baseCurrency: "CAD", timezone: "UTC" }, OWNER);
    await joinSite.call({ handle: "seller", displayName: "Seller", meetsMinimumAge: true, isAdult: true }, CUSTOMER);
    await updateMembershipRules.call({ marketplaceEnabled: true, listingReview: false, siteFeeBps: 1000, holdDays: 7 }, OWNER);
    contactId = (await resolveContact.call({ email: "buyer@example.test", name: "Buyer" }, OWNER)).contact.id;
    await db().insert(memberPayoutAccounts).values({ userId: CUSTOMER.userId, adapter: "manual", status: "ready" });
  });
  afterAll(closeDb);
  afterEach(() => vi.restoreAllMocks());

  async function offer(billingMode: "manual" | "platform" = "manual") {
    const { planId } = await createMemberPlan.call({ name: "Original merchant", price: "10" }, CUSTOMER);
    const [plan] = await db().select().from(plans).where(eq(plans.id, planId));
    await savePlan.call({ id: planId, productId: plan!.productId, name: plan!.name, interval: "month", status: "active", trialDays: 14, billingMode }, OWNER);
    return planId;
  }

  async function directModel() {
    // Deliberately seed the not-yet-enabled mode to exercise its internal
    // boundaries. Owner-facing configuration still refuses seller_merchant.
    await db().update(memberSettings).set({ payoutModel: "seller_merchant", payoutAdapter: "stripe_connect" }).where(eq(memberSettings.id, 1));
    await db().update(memberPayoutAccounts).set({ adapter: "stripe_connect", externalAccountId: "acct_original", chargesReady: true, merchantName: "Seller studio" }).where(eq(memberPayoutAccounts.userId, CUSTOMER.userId));
  }

  async function renewal(subscriptionId: string) {
    await db().update(subscriptions).set({ currentPeriodStart: new Date("2026-01-01T00:00:00Z"), currentPeriodEnd: new Date("2026-02-01T00:00:00Z"), trialEndsAt: new Date("2026-02-01T00:00:00Z") }).where(eq(subscriptions.id, subscriptionId));
    const renewed = await renewDue.call({}, SYSTEM);
    expect(renewed.renewed).toBe(1);
    return renewed;
  }

  it("pins platform fees before a free trial and preserves them on renewal after defaults change", async () => {
    const planId = await offer();
    const started = await subscribe.call({ planId, contactId }, OWNER);
    expect(started.invoiceId).toBeNull();
    expect(await getSubscriptionMarketPolicy.call({ subscriptionId: started.subscription.id }, SYSTEM)).toMatchObject({ model: "hold", siteFeeBps: 1000, holdDays: 7, sellerUserId: CUSTOMER.userId, providerAccountId: null });
    await updateMembershipRules.call({ payoutModel: "instant", siteFeeBps: 5000, holdDays: 2 }, OWNER);
    await renewal(started.subscription.id);
    const { invoices } = await import("@/modules/invoicing/schema");
    const [invoice] = await db().select().from(invoices);
    expect(await getInvoiceMarketPolicy.call({ invoiceId: invoice!.id }, SYSTEM)).toMatchObject({ model: "hold", siteFeeBps: 1000, holdDays: 7, feeMinor: 100 });
  });

  it("pins the connected merchant before a trial and refuses collection after the account changes", async () => {
    const planId = await offer();
    await directModel();
    const started = await subscribe.call({ planId, contactId }, OWNER);
    expect(started.invoiceId).toBeNull();
    expect(await getSubscriptionMarketPolicy.call({ subscriptionId: started.subscription.id }, SYSTEM)).toMatchObject({ model: "seller_merchant", providerAccountId: "acct_original", merchantName: "Seller studio" });
    await updateMembershipRules.call({ payoutModel: "hold", payoutAdapter: "manual", siteFeeBps: 5000 }, OWNER);
    await db().update(memberPayoutAccounts).set({ externalAccountId: "acct_replacement" }).where(eq(memberPayoutAccounts.userId, CUSTOMER.userId));
    await renewal(started.subscription.id);
    const { invoices } = await import("@/modules/invoicing/schema");
    const [invoice] = await db().select().from(invoices);
    expect(await getInvoiceMarketPolicy.call({ invoiceId: invoice!.id }, SYSTEM)).toMatchObject({ model: "seller_merchant", providerAccountId: "acct_original", feeMinor: 100 });
    await expect(verifyInvoiceMerchantAccount.call({ invoiceId: invoice!.id }, SYSTEM)).rejects.toMatchObject({ code: "conflict" });
    expect(JSON.stringify(await getSubscription.call({ id: started.subscription.id }, OWNER))).not.toContain("acct_original");
  });

  it("does not open a trial with transfer readiness alone", async () => {
    const planId = await offer();
    await directModel();
    await db().update(memberPayoutAccounts).set({ chargesReady: false }).where(eq(memberPayoutAccounts.userId, CUSTOMER.userId));
    await expect(subscribe.call({ planId, contactId }, OWNER)).rejects.toMatchObject({ code: "conflict" });
    expect(await db().select().from(subscriptions)).toHaveLength(0);
  });

  it("cannot attach a platform's saved card to a connected merchant's trial", async () => {
    const manual = adapters.createManualPayments();
    vi.spyOn(adapters, "paymentAdapter").mockReturnValue({ ...manual, id: "stripe", capabilities: () => ({ ...manual.capabilities(), offSessionCharges: true, savedMethods: true, sellerMerchantCharges: true }) });
    const planId = await offer("platform");
    await directModel();
    const [method] = await db().insert(paymentMethods).values({ contactId, provider: "stripe", providerMethodRef: "pm_platform", providerCustomerRef: "cus_platform", kind: "card", label: "Card ending 4242", consentSource: "merchant-policy-test", consentedAt: new Date(), providerStatusAt: new Date() }).returning();
    await expect(subscribe.call({ planId, contactId, paymentMethodId: method!.id }, OWNER)).rejects.toMatchObject({ code: "conflict" });
    expect(await db().select().from(subscriptions)).toHaveLength(0);
  });

  it("requires a new agreement to switch from a member's plan to the site's plan", async () => {
    const planId = await offer();
    const started = await subscribe.call({ planId, contactId }, OWNER);
    const { products } = await import("@/modules/catalog/schema");
    const [product] = await db().insert(products).values({ name: "Site plan", slug: "site-plan", kind: "digital" }).returning();
    const other = await savePlan.call({ productId: product!.id, name: "Site plan", interval: "month", status: "active" }, OWNER);
    await expect(changePlan.call({ id: started.subscription.id, planId: other.id }, OWNER)).rejects.toMatchObject({ code: "conflict" });
    const [unchanged] = await db().select().from(subscriptions).where(eq(subscriptions.id, started.subscription.id));
    expect(unchanged!.planId).toBe(planId);
  });
});
