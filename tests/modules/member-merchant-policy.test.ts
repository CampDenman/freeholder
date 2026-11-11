// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: pin merchant authority before the first invoice, including trials.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as adapters from "@/adapters/payments";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { resolveContact } from "@/core/contacts/service";
import { ready } from "@/core/runtime";
import { updateBusiness } from "@/core/settings/service";
import { joinSite, updateMembershipRules } from "@/modules/members/service";
import { createMemberPlan, recordInvoicePayout } from "@/modules/members/member-subscriptions";
import { reversePayouts } from "@/modules/members/payouts";
import { verifyInvoiceMerchantAccount } from "@/modules/members/market-merchant";
import { memberPayoutAccounts, memberPayouts, memberSettings } from "@/modules/members/schema";
import { getInvoiceMarketPolicy } from "@/modules/invoicing/market-policy";
import { invoices, paymentMethods, paymentProviderCustomers, paymentProviderEvents, payments } from "@/modules/invoicing/schema";
import { processPaymentProviderEvents } from "@/modules/invoicing/payment-provider-service";
import { createRefund, startRefund } from "@/modules/invoicing/invoice-service";
import { attachProviderSchedule, cancelAgreement, changePlan } from "@/modules/subscriptions/billing";
import { getSubscription, renewDue, savePlan, subscribe } from "@/modules/subscriptions/service";
import { getSubscriptionMarketPolicy } from "@/modules/subscriptions/market-policy";
import { beginTrialCardSetup, myMembershipPaymentMethods, startCardTrial } from "@/modules/subscriptions/public-signup";
import { plans, subscriptions } from "@/modules/subscriptions/schema";
import { closeDb, CUSTOMER, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const SYSTEM = { kind: "system" } as const;
const BUYER = { ...CUSTOMER, userId: "00000000-0000-4000-8000-0000000000c2" };

describe.runIf(hasDatabase)("immutable member merchant agreements (C12.38)", () => {
  let contactId: string;
  beforeAll(ready, 60_000);
  beforeEach(async () => {
    await truncateSpine();
    await db().insert(users).values([
      { id: OWNER.userId, email: "owner@example.test", role: "owner" },
      { id: CUSTOMER.userId, email: "seller@example.test", role: "customer" },
      { id: BUYER.userId, email: "buyer@example.test", role: "customer" },
    ]);
    await updateBusiness.call({ name: "Agreement proof", country: "CA", baseCurrency: "CAD", timezone: "UTC" }, OWNER);
    await joinSite.call({ handle: "seller", displayName: "Seller", meetsMinimumAge: true, isAdult: true }, CUSTOMER);
    await updateMembershipRules.call({ marketplaceEnabled: true, listingReview: false, siteFeeBps: 1000, holdDays: 7 }, OWNER);
    contactId = (await resolveContact.call({ email: "buyer@example.test", name: "Buyer" }, OWNER)).contact.id;
    await db().update(contacts).set({ userId: BUYER.userId }).where(eq(contacts.id, contactId));
    await db().insert(memberPayoutAccounts).values({ userId: CUSTOMER.userId, adapter: "manual", status: "ready" });
  });
  afterAll(closeDb);
  afterEach(() => vi.restoreAllMocks());

  async function offer(billingMode: "manual" | "platform" | "provider" = "manual") {
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

  it("sets up and selects only the original merchant's trial card after the site's default provider changes", async () => {
    const manual = adapters.createManualPayments();
    const createMethodSetup = vi.fn<NonNullable<adapters.PaymentAdapter["createMethodSetup"]>>();
    const stripe = { ...manual, id: "stripe", createMethodSetup, capabilities: () => ({ ...manual.capabilities(), offSessionCharges: true, savedMethods: true, sellerMerchantCharges: true }) };
    let defaultStripe = true;
    vi.spyOn(adapters, "paymentAdapter").mockImplementation(id => id === "stripe" || id === undefined && defaultStripe ? stripe : manual);
    const planId = await offer("platform");
    await db().update(plans).set({ trialRequiresCard: true }).where(eq(plans.id, planId));
    await directModel();
    const started = await subscribe.call({ planId, contactId, deferFirstPayment: true }, OWNER);
    expect(started.subscription.status).toBe("paused");
    expect(started.invoiceId).toBeNull();
    defaultStripe = false;
    const methods = [];
    for (const [account, suffix] of [["", "platform"], ["acct_other", "other"], ["acct_original", "original"]] as const) {
      await db().insert(paymentProviderCustomers).values({ contactId, provider: "stripe", providerAccountId: account, providerCustomerRef: `cus_${suffix}` });
      const [method] = await db().insert(paymentMethods).values({ contactId, provider: "stripe", providerAccountId: account, providerMethodRef: `pm_${suffix}`, providerCustomerRef: `cus_${suffix}`, kind: "card", label: "Card ending 4242", consentSource: "provider_checkout", consentedAt: new Date(), providerStatusAt: new Date() }).returning();
      methods.push(method!);
    }
    expect(await myMembershipPaymentMethods.call({ subscriptionId: started.subscription.id }, BUYER)).toEqual([]);
    expect(await myMembershipPaymentMethods.call({ planId }, BUYER)).toEqual([{ id: methods[2]!.id, label: "Card ending 4242" }]);
    await expect(myMembershipPaymentMethods.call({ subscriptionId: started.subscription.id }, CUSTOMER)).rejects.toMatchObject({ code: "not_found" });
    createMethodSetup.mockResolvedValueOnce({ providerRef: "cs_wrong", url: "https://checkout.example.test/setup", providerCustomerRef: "cus_wrong", providerAccountId: "acct_other" });
    await expect(beginTrialCardSetup.call({ subscriptionId: started.subscription.id, saveMethodConsent: true }, BUYER)).rejects.toMatchObject({ code: "conflict" });
    expect(await db().select().from(paymentProviderCustomers)).toHaveLength(3);
    createMethodSetup.mockResolvedValueOnce({ providerRef: "cs_trial", url: "https://checkout.example.test/setup", providerCustomerRef: "cus_original", providerAccountId: "acct_original" });
    expect(await beginTrialCardSetup.call({ subscriptionId: started.subscription.id, saveMethodConsent: true }, BUYER)).toEqual({ url: "https://checkout.example.test/setup" });
    expect(createMethodSetup.mock.calls[1]![0]).toMatchObject({ providerAccountId: "acct_original", providerCustomerRef: "cus_original" });
    await expect(startCardTrial.call({ subscriptionId: started.subscription.id, paymentMethodId: methods[0]!.id }, BUYER)).rejects.toMatchObject({ code: "conflict" });
    await expect(startCardTrial.call({ subscriptionId: started.subscription.id, paymentMethodId: methods[2]!.id }, BUYER)).rejects.toMatchObject({ code: "conflict" });
    const receivedAt = new Date().toISOString();
    await processPaymentProviderEvents.call({ provider: "stripe", bodySha256: "b".repeat(64), receivedAt, events: [{ id: "evt_trial_card", kind: "saved_method_added", providerAccountId: "acct_original", providerCustomerRef: "cus_original", occurredAt: receivedAt, method: { providerRef: "pm_trial", providerCustomerRef: "cus_original", kind: "card", label: "Trial card ending 4242" } }] }, SYSTEM);
    const [saved] = await db().select().from(paymentMethods).where(eq(paymentMethods.providerMethodRef,"pm_trial"));
    expect(await myMembershipPaymentMethods.call({ subscriptionId: started.subscription.id }, BUYER)).toEqual([{ id: saved!.id, label: "Trial card ending 4242" }]);
    expect(await startCardTrial.call({ subscriptionId: started.subscription.id, paymentMethodId: saved!.id }, BUYER)).toEqual({ id: started.subscription.id, started: true });
    expect((await db().select().from(subscriptions).where(eq(subscriptions.id, started.subscription.id)))[0]!.status).toBe("trialing");
  });

  it("keeps an automatic trial's original provider when the default changes before its card is saved", async () => {
    const manual = adapters.createManualPayments();
    const createMethodSetup = vi.fn<NonNullable<adapters.PaymentAdapter["createMethodSetup"]>>().mockResolvedValue({providerRef:"cs_platform_trial",providerCustomerRef:"cus_platform_trial",url:"https://checkout.example.test/setup"});
    const stripe = {...manual,id:"stripe",createMethodSetup,capabilities:()=>({...manual.capabilities(),offSessionCharges:true,savedMethods:true})};
    let defaultStripe=true;
    vi.spyOn(adapters,"paymentAdapter").mockImplementation(id=>id==="stripe" || id===undefined && defaultStripe ? stripe : manual);
    const planId=await offer("platform");
    await db().update(plans).set({trialRequiresCard:true}).where(eq(plans.id,planId));
    const started=await subscribe.call({planId,contactId,deferFirstPayment:true},OWNER);
    expect(started.subscription.provider).toBe("stripe");
    defaultStripe=false;
    await beginTrialCardSetup.call({subscriptionId:started.subscription.id,saveMethodConsent:true},BUYER);
    expect(createMethodSetup).toHaveBeenCalledOnce();
    expect(createMethodSetup.mock.calls[0]![0].providerAccountId).toBeUndefined();
    const receivedAt=new Date().toISOString();
    await processPaymentProviderEvents.call({provider:"stripe",bodySha256:"d".repeat(64),receivedAt,events:[{id:"evt_platform_trial_card",kind:"saved_method_added",providerCustomerRef:"cus_platform_trial",occurredAt:receivedAt,method:{providerRef:"pm_platform_trial",providerCustomerRef:"cus_platform_trial",kind:"card",label:"Trial card"}}]},SYSTEM);
    const [method]=await db().select().from(paymentMethods).where(eq(paymentMethods.providerMethodRef,"pm_platform_trial"));
    expect(await myMembershipPaymentMethods.call({subscriptionId:started.subscription.id},BUYER)).toEqual([{id:method!.id,label:"Trial card"}]);
    expect(await startCardTrial.call({subscriptionId:started.subscription.id,paymentMethodId:method!.id},BUYER)).toEqual({id:started.subscription.id,started:true});
  });

  it("records an authenticated scheduled charge on its original account after a seller is disabled, without losing its refund reference", async () => {
    const manual = adapters.createManualPayments();
    const createRecurringSchedule = vi.fn<adapters.PaymentAdapter["createRecurringSchedule"]>().mockResolvedValue({ providerRef: "sub_direct", providerAccountId: "acct_original", applicationFeePercent: 10 });
    const cancelRecurringSchedule = vi.fn<adapters.PaymentAdapter["cancelRecurringSchedule"]>().mockResolvedValue();
    const stripe = { ...manual, id: "stripe", createRecurringSchedule, cancelRecurringSchedule, capabilities: () => ({ ...manual.capabilities(), subscriptions: true, offSessionCharges: true, savedMethods: true, sellerMerchantCharges: true }) };
    vi.spyOn(adapters,"paymentAdapter").mockReturnValue(stripe);
    const planId = await offer("provider");
    await directModel();
    const [method] = await db().insert(paymentMethods).values({ contactId, provider: "stripe", providerAccountId: "acct_original", providerMethodRef: "pm_direct", providerCustomerRef: "cus_direct", kind: "card", label: "Card ending 4242", consentSource: "provider_checkout", consentedAt: new Date(), providerStatusAt: new Date() }).returning();
    const started = await subscribe.call({ planId, contactId, paymentMethodId: method!.id }, OWNER);
    await attachProviderSchedule.call({ subscriptionId: started.subscription.id }, OWNER);
    expect(createRecurringSchedule.mock.calls[0]![0]).toMatchObject({ providerAccountId: "acct_original", applicationFeePercent: 10 });
    await db().update(subscriptions).set({ currentPeriodStart: new Date("2026-01-01Z"),currentPeriodEnd: new Date("2026-02-01Z"),trialEndsAt:new Date("2026-02-01Z") }).where(eq(subscriptions.id,started.subscription.id));
    await updateMembershipRules.call({ payoutModel: "hold",payoutAdapter: "manual",siteFeeBps: 5000 }, OWNER);
    await db().update(memberPayoutAccounts).set({ externalAccountId: "acct_replacement",chargesReady:false,status:"disabled" }).where(eq(memberPayoutAccounts.userId,CUSTOMER.userId));
    const receivedAt = new Date().toISOString();
    const event = { id:"evt_direct_period",kind:"subscription_period_paid" as const,providerRef:"sub_direct",providerAccountId:"acct_original",paymentProviderRef:"pi_direct_period",applicationFeeMinor:100,amountMinor:1000,currency:"CAD",occurredAt:receivedAt,periodStart:"2026-02-01T00:00:00.000Z",periodEnd:"2026-03-01T00:00:00.000Z" };
    const deliver = (item: typeof event | Omit<typeof event,"paymentProviderRef">) => processPaymentProviderEvents.call({provider:"stripe",bodySha256:"c".repeat(64),receivedAt,events:[item]},SYSTEM);
    const { paymentProviderRef: _ref, ...missingCharge } = event;
    for (const invalid of [{...event,providerAccountId:"acct_other"},{...event,applicationFeeMinor:99},missingCharge]) await expect(deliver(invalid)).rejects.toMatchObject({code:"conflict"});
    expect(await db().select().from(invoices)).toHaveLength(0);
    expect(await db().select().from(paymentProviderEvents)).toHaveLength(0);
    expect(await deliver(event)).toEqual({processed:1,duplicates:0});
    expect(await deliver(event)).toEqual({processed:0,duplicates:1});
    const [payment] = await db().select().from(payments);
    expect(payment).toMatchObject({status:"succeeded",providerRef:"pi_direct_period",amountMinor:1000});
    expect(await getInvoiceMarketPolicy.call({invoiceId:payment!.invoiceId},SYSTEM)).toMatchObject({providerAccountId:"acct_original",siteFeeBps:1000,feeMinor:100});
    await recordInvoicePayout.call({invoiceId:payment!.invoiceId},SYSTEM);
    expect(await recordInvoicePayout.call({invoiceId:payment!.invoiceId},SYSTEM)).toEqual({recorded:false});
    expect(await db().select().from(memberPayouts)).toMatchObject([{model:"seller_merchant",state:"paid",netMinor:900,reference:`stripe-direct:${payment!.invoiceId}`}]);
    expect(await db().select().from(memberPayouts)).toHaveLength(1);
    await expect(deliver({...event,id:"evt_extra_charge",paymentProviderRef:"pi_extra_charge"})).rejects.toMatchObject({code:"conflict"});
    expect(await db().select().from(payments)).toHaveLength(1);
    const refund=await createRefund.call({paymentId:payment!.id,amountMinor:1000,reason:"Buyer refunded on original account",idempotencyKey:"direct-period-refund"},OWNER);
    await startRefund.call({id:refund.id,providerRef:"re_direct_period"},OWNER);
    await processPaymentProviderEvents.call({provider:"stripe",bodySha256:"e".repeat(64),receivedAt,events:[{id:"evt_direct_period_refund",kind:"refund_succeeded",providerRef:"re_direct_period",paymentProviderRef:"pi_direct_period",providerAccountId:"acct_original",amountMinor:1000,currency:"CAD",occurredAt:receivedAt}]},SYSTEM);
    expect(await reversePayouts.call({invoiceId:payment!.invoiceId,amountMinor:1000},SYSTEM)).toEqual({changed:1});
    expect((await db().select().from(memberPayouts))[0]!.state).toBe("cancelled");
    await cancelAgreement.call({ id:started.subscription.id,immediately:true },OWNER);
    expect(cancelRecurringSchedule.mock.calls[0]![0]).toMatchObject({providerAccountId:"acct_original",providerRef:"sub_direct"});
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
