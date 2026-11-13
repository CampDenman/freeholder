// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Automatic subscription billing (MASTER.md §4.15, C9.33).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { createHash, createHmac, randomUUID } from "node:crypto";
import {createStripePayments} from "@/adapters/payments/stripe";
import type { PaymentAdapter } from "@/adapters/payments";
import { contacts,contactMergeOperations } from "@/core/contacts/schema";
import { beginCustomerCheckout, getCustomerInvoice } from "@/modules/invoicing/customer-service";
import { processPaymentProviderEvents } from "@/modules/invoicing/payment-provider-service";
import { publicMembershipPlans, joinMembership, activatePaidSignup, beginTrialCardSetup, startCardTrial,claimTrialCardSetup,applyTrialCardSetup } from "@/modules/subscriptions/public-signup";
import { createPayment, settlePayment } from "@/modules/invoicing/invoice-service";
import { users } from "@/core/auth/schema";
import { mergeContacts,undoContactMerge,updateContact,resolveContact } from "@/core/contacts/service";
import { updateBusiness } from "@/core/settings/service";
import { invoiceLines, invoices, paymentMethods,paymentProviderCustomers,payments } from "@/modules/invoicing/schema";
import {
  priceListEntries,
  priceLists,
  productVariants,
  products,
} from "@/modules/catalog/schema";
import { subscriptionCardSetups,subscriptionSetupDispatches,subscriptions } from "@/modules/subscriptions/schema";
import { hasAccess } from "@/core/entitlements/service";
import {
  attachProviderSchedule,
  cancelMySubscription,
  cancelSubscription,
  changeMyPlan,
  changePlan,
  chargePlatformInvoice,
  chargePlatformDue,
  enroll,
  listOfferedPlans,
  proratedDifference,
  reconcileProviderPeriod,
  renewDue,
  savePlan,
  subscribe,
} from "@/modules/subscriptions/service";
import { env } from "@/core/env";
import {createDataRequest,verifyDataRequest,fulfillDataRequest,completeErasureJob,addRetentionException} from "@/core/privacy/service";
import {dataRequests} from "@/core/privacy/schema";
import {auditLog} from "@/core/events/schema";
import {reconcileTrialSetupDispatch,listTrialSetupDispatches} from "@/modules/subscriptions/setup-reconciliation";
import {setupRequest,MAX_SETUP_UNDO_RECORDS} from "@/modules/subscriptions/card-setup";
import {getJob,type JobExecutionContext} from "@/core/jobs";
import {eraseTrialSetupCustomers} from "@/modules/subscriptions/setup-erasure";
import {erasePaymentProviderCustomer} from "@/modules/invoicing/provider-erasure";
import { ready } from "@/core/runtime";
import { closeDb, CUSTOMER, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const mocks = vi.hoisted(() => ({
  createCheckout: vi.fn<PaymentAdapter["createCheckout"]>(),
  createMethodSetup: vi.fn<NonNullable<PaymentAdapter["createMethodSetup"]>>(),
  createSetupCustomer:vi.fn<NonNullable<PaymentAdapter["createSetupCustomer"]>>(),
  eraseCustomer:vi.fn<NonNullable<PaymentAdapter["eraseCustomer"]>>(),
  recoverMethodSetup:vi.fn<NonNullable<PaymentAdapter["recoverMethodSetup"]>>(),
  offerMethodSetup: { current: true },
  chargeSavedMethod: vi.fn(),
  createRecurringSchedule: vi.fn<PaymentAdapter["createRecurringSchedule"]>(),
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
      createCheckout: mocks.createCheckout,
      ...(mocks.offerMethodSetup.current ? { createMethodSetup: mocks.createMethodSetup,createSetupCustomer:mocks.createSetupCustomer,recoverMethodSetup:mocks.recoverMethodSetup } : {}),
      chargeSavedMethod: mocks.chargeSavedMethod,
      eraseCustomer:mocks.eraseCustomer,
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
    mocks.offerMethodSetup.current = true;
    mocks.createCheckout.mockReset();
    mocks.createCheckout.mockResolvedValue({providerRef:"cs_signup",paymentRef:"pi_signup",url:"https://checkout.example.test/signup"});
    mocks.recoverMethodSetup.mockReset();
    mocks.eraseCustomer.mockReset();
    mocks.eraseCustomer.mockResolvedValue(undefined);
    mocks.createSetupCustomer.mockReset();
    mocks.createSetupCustomer.mockResolvedValue({providerCustomerRef:"cus_setup"});
    mocks.createMethodSetup.mockReset();
    mocks.createMethodSetup.mockResolvedValue({ providerRef: "cs_setup", url: "https://checkout.example.test/setup", providerCustomerRef: "cus_setup" });
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

  it("requires renewal consent and activates the exact saved method from the verified first payment",async()=>{
    const member=await person("public-member");
    await db().insert(users).values({id:CUSTOMER.userId,email:member.email!,role:"customer"});
    await db().update(contacts).set({userId:CUSTOMER.userId}).where(eq(contacts.id,member.id));
    const monthly=await plan({billingMode:"provider"});
    const offered=(await publicMembershipPlans.call({},{kind:"anonymous"})).find(p=>p.id===monthly.id)!;
    const joined=await joinMembership.call({planId:monthly.id,termsHash:offered.termsHash,requestKey:randomUUID(),acceptedTerms:true},CUSTOMER);
    expect((await getCustomerInvoice.call({id:joined.invoiceId!},CUSTOMER)).saveMethodRequired).toBe(true);
    expect((await failure(beginCustomerCheckout.call({id:joined.invoiceId!},CUSTOMER))).code).toBe("conflict");
    await beginCustomerCheckout.call({id:joined.invoiceId!,saveMethodConsent:true},CUSTOMER);
    expect(mocks.createCheckout.mock.calls[0]![0].saveMethod).toBe(true);
    const [invoice]=await db().select().from(invoices).where(eq(invoices.id,joined.invoiceId!));
    await processPaymentProviderEvents.call({provider:"stripe",bodySha256:"a".repeat(64),receivedAt:new Date().toISOString(),events:[{id:"evt_signup",kind:"payment_succeeded",providerRef:"pi_signup",checkoutRef:"cs_signup",invoiceId:invoice!.id,amountMinor:invoice!.totalMinor,currency:"CAD",occurredAt:new Date().toISOString(),savedMethod:{providerRef:"pm_signup",providerCustomerRef:"cus_signup",kind:"card",label:"card ending 4242",last4:"4242"}}]}, { kind: "system" });
    await activatePaidSignup.call({invoiceId:invoice!.id},{kind:"system"});
    const [sub]=await db().select().from(subscriptions).where(eq(subscriptions.id,joined.id));
    const [method]=await db().select().from(paymentMethods).where(eq(paymentMethods.providerMethodRef,"pm_signup"));
    expect(sub).toMatchObject({status:"active",signupPending:false,paymentMethodId:method!.id});
    await attachProviderSchedule.call({subscriptionId:joined.id},OWNER);
    expect(mocks.createRecurringSchedule.mock.calls[0]![0].firstBillingAt).toBe(sub!.currentPeriodEnd.toISOString());
    await attachProviderSchedule.call({subscriptionId:joined.id},OWNER);
    expect(mocks.createRecurringSchedule).toHaveBeenCalledOnce();
  });
  it("does not activate automatic signup from an unrelated saved card",async()=>{
    const member=await person("unconsented-member");
    await db().insert(users).values({id:CUSTOMER.userId,email:member.email!,role:"customer"});
    await db().update(contacts).set({userId:CUSTOMER.userId}).where(eq(contacts.id,member.id));
    const monthly=await plan({billingMode:"platform"});
    const offered=(await publicMembershipPlans.call({},{kind:"anonymous"})).find(p=>p.id===monthly.id)!;
    const joined=await joinMembership.call({planId:monthly.id,termsHash:offered.termsHash,requestKey:randomUUID(),acceptedTerms:true},CUSTOMER);
    await card(member.id);
    const [invoice]=await db().select().from(invoices).where(eq(invoices.id,joined.invoiceId!));
    const payment=await createPayment.call({invoiceId:invoice!.id,provider:"stripe",method:"card",amountMinor:invoice!.totalMinor,idempotencyKey:"unconsented-proof",metadata:{saveMethodRequested:true}},OWNER);
    await settlePayment.call({id:payment.id,providerRef:"pi_unconsented"},OWNER);
    expect((await activatePaidSignup.call({invoiceId:invoice!.id},{kind:"system"})).activated).toBe(false);
  });

  it("keeps a card-required trial paused until the saved card is confirmed", async () => {
    const contact = await person("card-trial");
    await db().insert(users).values({ id: CUSTOMER.userId, email: contact.email!, role: "customer" });
    await db().update(contacts).set({ userId: CUSTOMER.userId }).where(eq(contacts.id, contact.id));
    const monthly = await plan({ billingMode: "provider", trialDays: 14, trialRequiresCard: true });
    const offered = (await publicMembershipPlans.call({}, { kind: "anonymous" })).find((entry) => entry.id === monthly.id)!;
    expect(offered.available).toBe(true);
    const requestKey = randomUUID();
    const joined = await joinMembership.call({ planId: monthly.id, termsHash: offered.termsHash, requestKey, acceptedTerms: true }, CUSTOMER);
    expect(joined).toMatchObject({ pending: true, invoiceId: null, cardSetup: true });
    expect(await joinMembership.call({ planId: monthly.id, termsHash: offered.termsHash, requestKey, acceptedTerms: true }, CUSTOMER)).toEqual(joined);
    expect((await failure(joinMembership.call({ planId: monthly.id, termsHash: offered.termsHash, requestKey: randomUUID(), acceptedTerms: true }, CUSTOMER))).code).toBe("conflict");
    const [waiting] = await db().select().from(subscriptions).where(eq(subscriptions.id, joined.id));
    expect(waiting).toMatchObject({ status: "paused", signupPending: true, trialEndsAt: null });
    expect(await db().select().from(invoices).where(eq(invoices.contactId, contact.id))).toHaveLength(0);
    expect((await hasAccess.call({ contactId: contact.id, resource: { kind: "site" } }, OWNER)).allowed).toBe(false);

    const oldCard = await card(contact.id);
    await db().update(paymentMethods).set({ providerCustomerRef: "cus_setup" }).where(eq(paymentMethods.id, oldCard.id));
    const setup = await beginTrialCardSetup.call({ subscriptionId: joined.id, saveMethodConsent: true }, CUSTOMER);
    expect(setup.url).toBe("https://checkout.example.test/setup");
    const setupRequest = mocks.createMethodSetup.mock.calls[0]![0] as { contactId: string; subscriptionId: string; idempotencyKey: string; successUrl: string };
    expect(setupRequest).toMatchObject({ contactId: contact.id, subscriptionId: joined.id, currency:"CAD" });
    expect(setupRequest.idempotencyKey).toMatch(new RegExp(`^trial-card:${joined.id}:[0-9a-f-]{36}$`));
    expect(setupRequest.successUrl).toContain(`/memberships/trial-return?subscription=${joined.id}`);
    expect(new URL(setupRequest.successUrl).origin).toBe(new URL(env().APP_URL).origin);
    expect(await db().select().from(payments)).toHaveLength(0);
    expect((await failure(startCardTrial.call({ subscriptionId: joined.id, paymentMethodId: oldCard.id }, CUSTOMER))).code).toBe("conflict");

    const unrelated = await card(contact.id);
    expect((await failure(startCardTrial.call({ subscriptionId: joined.id, paymentMethodId: unrelated.id }, CUSTOMER))).code).toBe("conflict");
    const staffCard = await card(contact.id);
    await db().update(paymentMethods).set({ providerCustomerRef: "cus_setup", consentSource: "staff" }).where(eq(paymentMethods.id, staffCard.id));
    expect((await failure(startCardTrial.call({ subscriptionId: joined.id, paymentMethodId: staffCard.id }, CUSTOMER))).code).toBe("conflict");

    const [attempt]=await db().select().from(subscriptionCardSetups).where(eq(subscriptionCardSetups.subscriptionId,joined.id));
    const metadata={freeholder_contact_id:contact.id,freeholder_subscription_id:joined.id,freeholder_setup_attempt_id:attempt!.id};
    const at=Math.floor(Date.now()/1000);
    const raw=JSON.stringify({id:"evt_trial_card",type:"checkout.session.completed",created:at,data:{object:{id:"cs_setup",mode:"setup",payment_status:"no_payment_required",customer:"cus_setup",metadata,setup_intent:"seti_trial"}}});
    const signature=createHmac("sha256","whsec_trial_fixture").update(`${at}.${raw}`).digest("hex");
    const provider=createStripePayments({secretKey:"sk_trial_fixture",webhookSecrets:["whsec_trial_fixture"],apiBase:"https://stripe.example.test",fetch:async()=>Response.json({id:"seti_trial",status:"succeeded",usage:"off_session",customer:"cus_setup",metadata,payment_method:{id:"pm_trial",type:"card",customer:"cus_setup",card:{brand:"visa",last4:"4242",exp_month:12,exp_year:2030}}})});
    const receivedAt=new Date().toISOString();
    const events=await provider.verifyWebhook({headers:{"stripe-signature":`t=${at},v1=${signature}`},body:Uint8Array.from(Buffer.from(raw)),receivedAt});
    expect(events).toHaveLength(1);
    await processPaymentProviderEvents.call({provider:"stripe",bodySha256:createHash("sha256").update(raw).digest("hex"),receivedAt,events},{kind:"system"});
    const [method] = await db().select().from(paymentMethods).where(eq(paymentMethods.providerMethodRef, "pm_trial"));
    const started = await startCardTrial.call({ subscriptionId: joined.id, paymentMethodId: method!.id }, CUSTOMER);
    expect(started).toEqual({ id: joined.id, started: true });
    expect(await startCardTrial.call({ subscriptionId: joined.id, paymentMethodId: method!.id }, CUSTOMER)).toEqual(started);
    const [trial] = await db().select().from(subscriptions).where(eq(subscriptions.id, joined.id));
    expect(trial).toMatchObject({ status: "trialing", signupPending: false, paymentMethodId: method!.id });
    expect(trial!.trialEndsAt).toEqual(trial!.currentPeriodEnd);
    expect(trial!.trialEndsAt!.getTime() - trial!.currentPeriodStart.getTime()).toBe(14 * 86_400_000);
    expect((await hasAccess.call({ contactId: contact.id, resource: { kind: "site" } }, OWNER)).allowed).toBe(true);
  });

  it("starts the trial from a setup fee instead of billing the recurring price", async () => {
    const contact = await person("setup-fee-trial");
    await db().insert(users).values({ id: CUSTOMER.userId, email: contact.email!, role: "customer" });
    await db().update(contacts).set({ userId: CUSTOMER.userId }).where(eq(contacts.id, contact.id));
    const monthly = await plan({ billingMode: "provider", trialDays: 14, trialRequiresCard: true, setupFeeMinor: 900 }, 2_500);
    const offered = (await publicMembershipPlans.call({}, { kind: "anonymous" })).find((entry) => entry.id === monthly.id)!;
    const joined = await joinMembership.call({ planId: monthly.id, termsHash: offered.termsHash, requestKey: randomUUID(), acceptedTerms: true }, CUSTOMER);
    expect(joined.cardSetup).toBe(false);
    expect(joined.invoiceId).toBeTruthy();
    const [invoice] = await db().select().from(invoices).where(eq(invoices.id, joined.invoiceId!));
    expect(invoice!.status).not.toBe("paid");
    expect(invoice!.totalMinor).toBeGreaterThan(0);
    const lines = await db().select().from(invoiceLines).where(eq(invoiceLines.invoiceId, invoice!.id));
    expect(lines.map((line) => line.unitAmountMinor).sort((left, right) => left - right)).toEqual([0, 900]);
    expect((await getCustomerInvoice.call({ id: invoice!.id }, CUSTOMER)).saveMethodRequired).toBe(true);
    expect((await failure(beginCustomerCheckout.call({ id: invoice!.id }, CUSTOMER))).code).toBe("conflict");
    await beginCustomerCheckout.call({ id: invoice!.id, saveMethodConsent: true }, CUSTOMER);
    expect(mocks.createCheckout.mock.calls[0]![0].saveMethod).toBe(true);
    expect(mocks.createCheckout.mock.calls[0]![0].amountMinor).toBe(invoice!.totalMinor);
    await processPaymentProviderEvents.call({
      provider: "stripe",
      bodySha256: "c".repeat(64),
      receivedAt: new Date().toISOString(),
      events: [{
        id: "evt_setup_fee",
        kind: "payment_succeeded",
        providerRef: "pi_signup",
        checkoutRef: "cs_signup",
        invoiceId: invoice!.id,
        amountMinor: invoice!.totalMinor,
        currency: "CAD",
        occurredAt: new Date().toISOString(),
        savedMethod: { providerRef: "pm_fee", providerCustomerRef: "cus_fee", kind: "card", label: "card ending 4242", last4: "4242" },
      }],
    }, { kind: "system" });
    // invoice.paid already opened the trial. Calling activation again must not move the window.
    expect((await activatePaidSignup.call({ invoiceId: invoice!.id }, { kind: "system" })).activated).toBe(false);
    const [trial] = await db().select().from(subscriptions).where(eq(subscriptions.id, joined.id));
    const [method] = await db().select().from(paymentMethods).where(eq(paymentMethods.providerMethodRef, "pm_fee"));
    expect(trial).toMatchObject({ status: "trialing", signupPending: false, paymentMethodId: method!.id });
    expect(trial!.trialEndsAt).toEqual(trial!.currentPeriodEnd);
    expect(trial!.trialEndsAt!.getTime() - trial!.currentPeriodStart.getTime()).toBe(14 * 86_400_000);
    expect((await hasAccess.call({ contactId: contact.id, resource: { kind: "site" } }, OWNER)).allowed).toBe(true);
  });

  it("does not start a cancelled card trial or offer one the adapter cannot save", async () => {
    const contact = await person("cancelled-card-trial");
    await db().insert(users).values({ id: CUSTOMER.userId, email: contact.email!, role: "customer" });
    await db().update(contacts).set({ userId: CUSTOMER.userId }).where(eq(contacts.id, contact.id));
    const monthly = await plan({ billingMode: "provider", trialDays: 7, trialRequiresCard: true });
    const offered = (await publicMembershipPlans.call({}, { kind: "anonymous" })).find((entry) => entry.id === monthly.id)!;
    const joined = await joinMembership.call({ planId: monthly.id, termsHash: offered.termsHash, requestKey: randomUUID(), acceptedTerms: true }, CUSTOMER);
    await cancelMySubscription.call({ id: joined.id }, CUSTOMER);
    expect((await failure(beginTrialCardSetup.call({ subscriptionId: joined.id, saveMethodConsent: true }, CUSTOMER))).code).toBe("conflict");
    expect((await failure(startCardTrial.call({ subscriptionId: joined.id, paymentMethodId: (await card(contact.id)).id }, CUSTOMER))).code).toBe("conflict");
    expect((await hasAccess.call({ contactId: contact.id, resource: { kind: "site" } }, OWNER)).allowed).toBe(false);

    const manual = await plan({ billingMode: "manual", trialDays: 14, trialRequiresCard: true });
    const manualOffer = (await publicMembershipPlans.call({}, { kind: "anonymous" })).find((entry) => entry.id === manual.id)!;
    expect(manualOffer.available).toBe(false);
    expect((await failure(joinMembership.call({ planId: manual.id, termsHash: manualOffer.termsHash, requestKey: randomUUID(), acceptedTerms: true }, CUSTOMER))).code).toBe("conflict");

    mocks.offerMethodSetup.current = false;
    const unsupported = await plan({ billingMode: "provider", trialDays: 14, trialRequiresCard: true });
    const unsupportedOffer = (await publicMembershipPlans.call({}, { kind: "anonymous" })).find((entry) => entry.id === unsupported.id)!;
    expect(unsupportedOffer.available).toBe(false);
    const fee = await plan({ billingMode: "provider", trialDays: 14, trialRequiresCard: true, setupFeeMinor: 500 });
    const feeOffer = (await publicMembershipPlans.call({}, { kind: "anonymous" })).find((entry) => entry.id === fee.id)!;
    expect(feeOffer.available).toBe(true);
  });

  it("starts a card trial immediately when the customer already has a saved card", async () => {
    const contact = await person("card-ready");
    await db().insert(users).values({ id: CUSTOMER.userId, email: contact.email!, role: "customer" });
    await db().update(contacts).set({ userId: CUSTOMER.userId }).where(eq(contacts.id, contact.id));
    const method = await card(contact.id);
    const monthly = await plan({ billingMode: "provider", trialDays: 14, trialRequiresCard: true });
    const offered = (await publicMembershipPlans.call({}, { kind: "anonymous" })).find((entry) => entry.id === monthly.id)!;
    const joined = await joinMembership.call({ planId: monthly.id, termsHash: offered.termsHash, requestKey: randomUUID(), acceptedTerms: true, paymentMethodId: method.id }, CUSTOMER);
    expect(joined).toMatchObject({ pending: false, invoiceId: null, cardSetup: false });
    const [trial] = await db().select().from(subscriptions).where(eq(subscriptions.id, joined.id));
    expect(trial).toMatchObject({ status: "trialing", signupPending: false, paymentMethodId: method.id });
    expect(trial!.trialEndsAt!.getTime() - trial!.currentPeriodStart.getTime()).toBe(14 * 86_400_000);
    expect((await hasAccess.call({ contactId: contact.id, resource: { kind: "site" } }, OWNER)).allowed).toBe(true);
    expect(mocks.createMethodSetup).not.toHaveBeenCalled();
  });

  it("does not let a saved or staff-entered card skip a card trial's setup fee (C11.10)", async () => {
    const contact = await person("fee-skip");
    await db().insert(users).values({ id: CUSTOMER.userId, email: contact.email!, role: "customer" });
    await db().update(contacts).set({ userId: CUSTOMER.userId }).where(eq(contacts.id, contact.id));
    const method = await card(contact.id);
    const staffCard = await card(contact.id);
    await db().update(paymentMethods).set({ consentSource: "staff" }).where(eq(paymentMethods.id, staffCard.id));
    const fee = await plan({ billingMode: "provider", trialDays: 14, trialRequiresCard: true, setupFeeMinor: 900 });
    const offered = (await publicMembershipPlans.call({}, { kind: "anonymous" })).find((entry) => entry.id === fee.id)!;
    expect((await failure(joinMembership.call({ planId: fee.id, termsHash: offered.termsHash, requestKey: randomUUID(), acceptedTerms: true, paymentMethodId: staffCard.id }, CUSTOMER))).code).toBe("conflict");
    const joined = await joinMembership.call({ planId: fee.id, termsHash: offered.termsHash, requestKey: randomUUID(), acceptedTerms: true, paymentMethodId: method.id }, CUSTOMER);
    expect(joined.pending).toBe(true);
    expect(joined.invoiceId).toBeTruthy();
    const [waiting] = await db().select().from(subscriptions).where(eq(subscriptions.id, joined.id));
    expect(waiting).toMatchObject({ status: "paused", signupPending: true, trialEndsAt: null });
    expect((await hasAccess.call({ contactId: contact.id, resource: { kind: "site" } }, OWNER)).allowed).toBe(false);
  });

  it("cancels a provider schedule created while the customer was cancelling",async()=>{
    const member=await person("schedule-race");const method=await card(member.id);
    const monthly=await plan({billingMode:"provider"});
    const started=await subscribe.call({contactId:member.id,planId:monthly.id,paymentMethodId:method.id},OWNER);
    mocks.createRecurringSchedule.mockImplementationOnce(async()=>{
      await cancelSubscription.call({id:started.subscription.id,immediately:true},OWNER);
      return{providerRef:"sub_cancel_race"};
    });
    expect((await failure(attachProviderSchedule.call({subscriptionId:started.subscription.id},OWNER))).code).toBe("conflict");
    expect(mocks.cancelRecurringSchedule).toHaveBeenCalledWith(expect.objectContaining({providerRef:"sub_cancel_race"}));
    expect((await db().select().from(subscriptions).where(eq(subscriptions.id,started.subscription.id)))[0]?.providerRef).toBeNull();
  });
  it("keeps pending charges unsettled until authenticated provider evidence arrives", async () => {
    const member = await person("pending-charge");
    const method = await card(member.id);
    const monthly = await plan({ billingMode: "platform" });
    const started = await subscribe.call({ contactId: member.id, planId: monthly.id, paymentMethodId: method.id }, OWNER);
    mocks.chargeSavedMethod.mockResolvedValueOnce({ providerRef: "pi_pending", status: "pending" });
    expect(await chargePlatformInvoice.call({ subscriptionId: started.subscription.id, invoiceId: started.invoiceId! }, OWNER)).toEqual({ advanced: false, skipped: false });
    const [attempt] = await db().select().from(payments);
    expect(attempt).toMatchObject({ status: "processing", providerRef: "pi_pending", failureCode: null });
    const [invoice] = await db().select().from(invoices).where(eq(invoices.id, started.invoiceId!));
    expect(invoice!.paidMinor).toBe(0);
  });

  it("retains an unknown charge outcome and retries the original attempt with the same provider request", async () => {
    const member = await person("unknown-charge");
    const method = await card(member.id);
    const monthly = await plan({ billingMode: "platform" });
    const started = await subscribe.call({ contactId: member.id, planId: monthly.id, paymentMethodId: method.id }, OWNER);
    mocks.chargeSavedMethod.mockRejectedValueOnce(new Error("Response lost after provider accepted the charge"));
    await expect(chargePlatformInvoice.call({ subscriptionId: started.subscription.id, invoiceId: started.invoiceId! }, OWNER)).rejects.toMatchObject({ code: "conflict" });
    expect(await db().select().from(payments)).toMatchObject([{ status: "created", failureCode: null }]);
    await chargePlatformInvoice.call({ subscriptionId: started.subscription.id, invoiceId: started.invoiceId! }, OWNER);
    expect(mocks.chargeSavedMethod.mock.calls[0]![0]).toEqual(mocks.chargeSavedMethod.mock.calls[1]![0]);
    expect(await db().select().from(payments)).toHaveLength(1);
    expect((await db().select().from(payments))[0]!.status).toBe("succeeded");
  });

  it("refuses a successful charge response from another merchant without inventing a decline", async () => {
    const member = await person("wrong-merchant-charge");
    const method = await card(member.id);
    const monthly = await plan({ billingMode: "platform" });
    const started = await subscribe.call({ contactId: member.id, planId: monthly.id, paymentMethodId: method.id }, OWNER);
    mocks.chargeSavedMethod.mockResolvedValueOnce({ providerRef: "pi_wrong", status: "succeeded", providerAccountId: "acct_someoneelse" });
    await expect(chargePlatformInvoice.call({ subscriptionId: started.subscription.id, invoiceId: started.invoiceId! }, OWNER)).rejects.toMatchObject({ code: "conflict" });
    expect(await db().select().from(payments)).toMatchObject([{ status: "created", failureCode: null }]);
    const [invoice] = await db().select().from(invoices).where(eq(invoices.id, started.invoiceId!));
    expect(invoice!.paidMinor).toBe(0);
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

  it.each(["succeeded", "failed"] as const)("does not restore access when an in-flight %s charge finishes after cancellation", async (status) => {
    const member = await person(`cancel-charge-${status}`);
    const method = await card(member.id);
    const monthly = await plan({ billingMode: "platform", dunning: { retries: [1], graceDays: 7, notifyChannels: ["email"], finalAction: "pause" } });
    const started = await subscribe.call({ contactId: member.id, planId: monthly.id, paymentMethodId: method.id }, OWNER);
    mocks.chargeSavedMethod.mockImplementationOnce(async () => {
      await cancelSubscription.call({ id: started.subscription.id, immediately: true }, OWNER);
      return { providerRef: `pi_cancel_race_${status}`, status };
    });
    await chargePlatformInvoice.call({ subscriptionId: started.subscription.id, invoiceId: started.invoiceId! }, OWNER);
    const [row] = await db().select().from(subscriptions).where(eq(subscriptions.id, started.subscription.id));
    expect(row?.status).toBe("cancelled");
    expect((await hasAccess.call({ contactId: member.id, resource: { kind: "site" } }, OWNER)).allowed).toBe(false);
    const [invoice] = await db().select().from(invoices).where(eq(invoices.id, started.invoiceId!));
    expect(invoice?.status).toBe(status === "succeeded" ? "paid" : "sent");
  });

  it("does not begin charging a membership that has already been cancelled", async () => {
    const member = await person("cancel-before-charge");
    const method = await card(member.id);
    const monthly = await plan({ billingMode: "platform" });
    const started = await subscribe.call({ contactId: member.id, planId: monthly.id, paymentMethodId: method.id }, OWNER);
    await cancelSubscription.call({ id: started.subscription.id, immediately: true }, OWNER);
    const result = await chargePlatformInvoice.call({ subscriptionId: started.subscription.id, invoiceId: started.invoiceId! }, OWNER);
    expect(result.skipped).toBe(true);
    expect(mocks.chargeSavedMethod).not.toHaveBeenCalled();
  });

  it("refuses to charge a member's card against another member's invoice", async () => {
    const monthly = await plan({ billingMode: "platform" });
    const member = await person("charge-owner");
    const other = await person("invoice-owner");
    const method = await card(member.id);
    const otherMethod = await card(other.id);
    const started = await subscribe.call({ contactId: member.id, planId: monthly.id, paymentMethodId: method.id }, OWNER);
    const unrelated = await subscribe.call({ contactId: other.id, planId: monthly.id, paymentMethodId: otherMethod.id }, OWNER);
    const error = await failure(chargePlatformInvoice.call({ subscriptionId: started.subscription.id, invoiceId: unrelated.invoiceId! }, OWNER));
    expect(error.code).toBe("conflict");
    expect(mocks.chargeSavedMethod).not.toHaveBeenCalled();
    const [invoice] = await db().select().from(invoices).where(eq(invoices.id, unrelated.invoiceId!));
    expect(invoice?.paidMinor).toBe(0);
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

  it.each([{ amountMinor: 100, currency: "CAD" }, { amountMinor: 2500, currency: "USD" }])("refuses provider settlement evidence that differs from the canonical invoice: %o", async (evidence) => {
    const member = await person(`wrong-settlement-${evidence.currency}`);
    const method = await card(member.id);
    const monthly = await plan({ billingMode: "provider" });
    const started = await enroll.call({ contactId: member.id, planId: monthly.id, paymentMethodId: method.id }, OWNER);
    const error = await failure(reconcileProviderPeriod.call({ provider: "stripe", providerRef: "sub_1", kind: "subscription_period_paid", ...evidence }, { kind: "system" }));
    expect(error.code).toBe("conflict");
    const [invoice] = await db().select().from(invoices).where(eq(invoices.id, started.invoiceId!));
    expect(invoice?.status).toBe("sent");
    expect(invoice?.paidMinor).toBe(0);
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

  it("refuses to defer onto a plan that is not priced in the subscription's currency (C11.10)", async () => {
    const member = await person("unpriced");
    const from = await plan({ proration: "none" }, 2_500);
    const to = await plan({ name: "Unpriced" }, 9_000);
    const started = await subscribe.call({ contactId: member.id, planId: from.id }, OWNER);
    await db().delete(priceListEntries);
    const error = await failure(changePlan.call({ id: started.subscription.id, planId: to.id }, OWNER));
    expect(error.code).toBe("conflict");
    expect(mocks.updateRecurringSchedule).not.toHaveBeenCalled();
  });

  it("offers and accepts only public plans from the same seller, and holds customer upgrades until paid (C11.10)", async () => {
    const member = await person("self-serve");
    await db()
      .insert(users)
      .values([
        { id: CUSTOMER.userId, email: "self-serve@billing.test", role: "customer" },
        { id: randomUUID(), email: "seller@billing.test", role: "customer" },
      ])
      .onConflictDoNothing();
    await db().update(contacts).set({ userId: CUSTOMER.userId }).where(eq(contacts.id, member.id));
    const from = await plan({ proration: "create_prorations" }, 1_000);
    const upgrade = await plan({ name: "Plus" }, 10_000);
    const hidden = await plan({ name: "Staff comp" }, 1);
    await db().update(products).set({ visibility: "unlisted" }).where(eq(products.id, hidden.productId));
    const [seller] = await db().select().from(users).where(eq(users.email, "seller@billing.test"));
    const foreign = await plan({ name: "Another seller" }, 500);
    await db().update(products).set({ sellerUserId: seller!.id }).where(eq(products.id, foreign.productId));
    const started = await subscribe.call({ contactId: member.id, planId: from.id }, OWNER);

    const offered = (await listOfferedPlans.call({ subscriptionId: started.subscription.id }, CUSTOMER)).map((row) => row.id);
    expect(offered).toContain(upgrade.id);
    expect(offered).not.toContain(hidden.id);
    expect(offered).not.toContain(foreign.id);
    for (const target of [hidden, foreign]) {
      const refused = await failure(changeMyPlan.call({ id: started.subscription.id, planId: target.id }, CUSTOMER));
      expect(refused.code).toBe("conflict");
    }

    // The plan says "prorate", so the difference is invoiced now — but the
    // dearer plan is not granted until that invoice is paid.
    const changed = await changeMyPlan.call({ id: started.subscription.id, planId: upgrade.id }, CUSTOMER);
    expect(changed).toMatchObject({ deferred: false, awaitingPayment: true });
    expect(changed.invoiceId).not.toBeNull();
    expect(changed.proratedMinor).toBeGreaterThan(0);
    const [held] = await db().select().from(subscriptions).where(eq(subscriptions.id, started.subscription.id));
    expect(held).toMatchObject({ planId: from.id, productVariantId: started.subscription.productVariantId, pendingPlanId: null });

    // A second change cannot overtake the one waiting on its invoice.
    const other = await plan({ name: "Plus annual" }, 12_000);
    expect((await failure(changeMyPlan.call({ id: started.subscription.id, planId: other.id }, CUSTOMER))).code).toBe("conflict");

    const [owed] = await db().select().from(invoices).where(eq(invoices.id, changed.invoiceId!));
    const payment = await createPayment.call({ invoiceId: owed!.id, provider: "manual", method: "card", amountMinor: owed!.totalMinor - owed!.paidMinor, idempotencyKey: "upgrade-proration" }, OWNER);
    await settlePayment.call({ id: payment.id, providerRef: "upgrade-proration" }, OWNER);
    const [upgradeVariant] = await db().select().from(productVariants).where(eq(productVariants.productId, upgrade.productId));
    const [granted] = await db().select().from(subscriptions).where(eq(subscriptions.id, started.subscription.id));
    expect(granted).toMatchObject({ planId: upgrade.id, productVariantId: upgradeVariant!.id });
  });

  it("lets a new change through once the waiting invoice is voided, and never grants the voided one (C11.10)", async () => {
    const member = await person("superseded");
    await db().insert(users).values({ id: CUSTOMER.userId, email: "superseded@billing.test", role: "customer" }).onConflictDoNothing();
    await db().update(contacts).set({ userId: CUSTOMER.userId }).where(eq(contacts.id, member.id));
    const from = await plan({ proration: "create_prorations" }, 1_000);
    const first = await plan({ name: "First choice" }, 10_000);
    const second = await plan({ name: "Second choice" }, 8_000);
    const started = await subscribe.call({ contactId: member.id, planId: from.id }, OWNER);
    const waiting = await changeMyPlan.call({ id: started.subscription.id, planId: first.id }, CUSTOMER);
    expect(waiting.awaitingPayment).toBe(true);
    const { voidInvoice } = await import("@/modules/invoicing/invoice-service");
    await voidInvoice.call({ id: waiting.invoiceId!, reason: "Customer chose another plan." }, OWNER);
    const next = await changeMyPlan.call({ id: started.subscription.id, planId: second.id }, CUSTOMER);
    expect(next.awaitingPayment).toBe(true);
    const [row] = await db().select().from(subscriptions).where(eq(subscriptions.id, started.subscription.id));
    expect(row?.planId).toBe(from.id);
  });

  it("moves a deferred change onto the plan's active variant when its default is retired (C11.10)", async () => {
    const member = await person("variant-fallback");
    const from = await plan({ proration: "none" }, 2_500);
    const to = await plan({ name: "Retired default", proration: "none" }, 20_000);
    const [retired] = await db().select().from(productVariants).where(eq(productVariants.productId, to.productId));
    const [live] = await db()
      .insert(productVariants)
      .values({ productId: to.productId, combinationKey: `live-${retired!.id}`, sku: `live-${retired!.id}`, isDefault: false })
      .returning();
    const [list] = await db().insert(priceLists).values({ name: "Live variant", currency: "CAD", active: true }).returning();
    await db().insert(priceListEntries).values({ priceListId: list!.id, variantId: live!.id, amountMinor: 15_000 });
    const started = await subscribe.call({ contactId: member.id, planId: from.id }, OWNER);
    expect((await changePlan.call({ id: started.subscription.id, planId: to.id }, OWNER)).deferred).toBe(true);
    await db().update(productVariants).set({ status: "archived" }).where(eq(productVariants.id, retired!.id));
    await db()
      .update(subscriptions)
      .set({ currentPeriodStart: new Date(Date.now() - 40 * 86_400_000), currentPeriodEnd: new Date(Date.now() - 60_000) })
      .where(eq(subscriptions.id, started.subscription.id));
    await renewDue.call({}, { kind: "system" });
    const [renewed] = await db().select().from(subscriptions).where(eq(subscriptions.id, started.subscription.id));
    expect(renewed).toMatchObject({ planId: to.id, productVariantId: live!.id });
  });

  it("bills the new plan's price at the renewal after a deferred change (C11.10)", async () => {
    const member = await person("renew-after-change");
    const from = await plan({ proration: "none" }, 2_500);
    const to = await plan({ name: "Yearly", proration: "none" }, 20_000);
    const started = await subscribe.call({ contactId: member.id, planId: from.id }, OWNER);
    expect((await changePlan.call({ id: started.subscription.id, planId: to.id }, OWNER)).deferred).toBe(true);
    await db()
      .update(subscriptions)
      .set({ currentPeriodStart: new Date(Date.now() - 40 * 86_400_000), currentPeriodEnd: new Date(Date.now() - 60_000) })
      .where(eq(subscriptions.id, started.subscription.id));
    const before = new Set((await db().select({ id: invoices.id }).from(invoices).where(eq(invoices.contactId, member.id))).map((row) => row.id));
    await renewDue.call({}, { kind: "system" });
    const raised = (await db().select().from(invoices).where(eq(invoices.contactId, member.id))).filter((row) => !before.has(row.id));
    expect(raised).toHaveLength(1);
    const lines = await db().select().from(invoiceLines).where(eq(invoiceLines.invoiceId, raised[0]!.id));
    expect(lines.map((line) => line.unitAmountMinor)).toEqual([20_000]);
    const [renewed] = await db().select().from(subscriptions).where(eq(subscriptions.id, started.subscription.id));
    expect(renewed?.planId).toBe(to.id);
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
  async function pausedCardTrial(key:string){
    const contact=await person(key);
    await db().insert(users).values({id:CUSTOMER.userId,email:contact.email!,role:"customer"});
    await db().update(contacts).set({userId:CUSTOMER.userId}).where(eq(contacts.id,contact.id));
    const monthly=await plan({billingMode:"provider",trialDays:14,trialRequiresCard:true});
    const offered=(await publicMembershipPlans.call({},{kind:"anonymous"})).find(entry=>entry.id===monthly.id)!;
    const joined=await joinMembership.call({planId:monthly.id,termsHash:offered.termsHash,requestKey:randomUUID(),acceptedTerms:true},CUSTOMER);
    return {contact,joined};
  }
  it("freezes the first customer request before I/O and retries it after contact and customer changes",async()=>{
    const {contact,joined}=await pausedCardTrial("frozen-first-customer");
    mocks.createSetupCustomer.mockImplementationOnce(async request=>{
      const [stored]=await db().select().from(subscriptionCardSetups).where(eq(subscriptionCardSetups.subscriptionId,joined.id));
      expect(stored!.request).toEqual(JSON.parse(JSON.stringify(request)));
      expect(stored!.providerCustomerRef).toBeNull();
      throw new Error("Synthetic lost customer response");
    });
    await expect(beginTrialCardSetup.call({subscriptionId:joined.id,saveMethodConsent:true},CUSTOMER)).rejects.toMatchObject({code:"conflict"});
    const original=mocks.createSetupCustomer.mock.calls[0]![0];
    await updateContact.call({id:contact.id,name:"Changed later",email:"changed-first-customer@billing.test"},OWNER);
    await db().insert(paymentProviderCustomers).values({contactId:contact.id,provider:"stripe",providerCustomerRef:"cus_changed_later"});
    await beginTrialCardSetup.call({subscriptionId:joined.id,saveMethodConsent:true},CUSTOMER);
    expect(mocks.createSetupCustomer.mock.calls[1]![0]).toEqual(original);
    expect(mocks.createMethodSetup.mock.calls[0]![0]).toEqual({...original,providerCustomerRef:"cus_setup"});
  });
  it("commits the actual customer before Checkout and never recreates it after a lost session response",async()=>{
    const {contact,joined}=await pausedCardTrial("frozen-checkout");
    mocks.createMethodSetup.mockImplementationOnce(async request=>{
      const [stored]=await db().select().from(subscriptionCardSetups).where(eq(subscriptionCardSetups.subscriptionId,joined.id));
      expect(stored!.providerCustomerRef).toBe("cus_setup");
      expect((await db().select().from(paymentProviderCustomers))[0]!.providerCustomerRef).toBe("cus_setup");
      expect(request.providerCustomerRef).toBe("cus_setup");
      throw new Error("Synthetic lost Checkout response");
    });
    await expect(beginTrialCardSetup.call({subscriptionId:joined.id,saveMethodConsent:true},CUSTOMER)).rejects.toMatchObject({code:"conflict"});
    const original=mocks.createMethodSetup.mock.calls[0]![0];
    await updateContact.call({id:contact.id,name:"Changed checkout contact",email:"changed-checkout@billing.test"},OWNER);
    await beginTrialCardSetup.call({subscriptionId:joined.id,saveMethodConsent:true},CUSTOMER);
    expect(mocks.createSetupCustomer).toHaveBeenCalledOnce();
    expect(mocks.createMethodSetup.mock.calls[1]![0]).toEqual(original);
  });
  it("accepts an old saved card only after its exact current attempt is verified",async()=>{
    const {contact,joined}=await pausedCardTrial("old-card-exact-proof");
    const old=await card(contact.id),unrelated=await card(contact.id);
    await db().update(paymentMethods).set({providerCustomerRef:"cus_setup",createdAt:new Date("2020-01-01T00:00:00Z")}).where(eq(paymentMethods.id,old.id));
    await db().update(paymentMethods).set({providerCustomerRef:"cus_setup"}).where(eq(paymentMethods.id,unrelated.id));
    await beginTrialCardSetup.call({subscriptionId:joined.id,saveMethodConsent:true},CUSTOMER);
    const [attempt]=await db().select().from(subscriptionCardSetups).where(eq(subscriptionCardSetups.subscriptionId,joined.id));
    await expect(startCardTrial.call({subscriptionId:joined.id,paymentMethodId:unrelated.id},CUSTOMER)).rejects.toMatchObject({code:"conflict"});
    const receivedAt=new Date().toISOString();
    await processPaymentProviderEvents.call({provider:"stripe",bodySha256:"a".repeat(64),receivedAt,events:[{id:"evt_exact_reused_card",kind:"saved_method_added",contactId:contact.id,providerCustomerRef:"cus_setup",setup:{attemptId:attempt!.id,subscriptionId:joined.id,checkoutRef:"cs_setup",setupIntentRef:"seti_reused"},occurredAt:receivedAt,method:{providerRef:old.providerMethodRef,providerCustomerRef:"cus_setup",kind:"card",label:"Reverified old card"}}]},{kind:"system"});
    expect((await db().select().from(paymentMethods).where(eq(paymentMethods.id,old.id)))[0]!.createdAt).toEqual(new Date("2020-01-01T00:00:00Z"));
    expect(await startCardTrial.call({subscriptionId:joined.id,paymentMethodId:old.id},CUSTOMER)).toEqual({id:joined.id,started:true});
  });
  it("keeps original provider metadata after contact merge while binding evidence to the current parent owner",async()=>{
    const {contact,joined}=await pausedCardTrial("merged-setup-owner");
    await beginTrialCardSetup.call({subscriptionId:joined.id,saveMethodConsent:true},CUSTOMER);
    const [attempt]=await db().select().from(subscriptionCardSetups).where(eq(subscriptionCardSetups.subscriptionId,joined.id));
    const survivor=await person("setup-survivor");
    await mergeContacts.call({survivingId:survivor.id,duplicateId:contact.id},OWNER);
    const receivedAt=new Date().toISOString();
    await processPaymentProviderEvents.call({provider:"stripe",bodySha256:"c".repeat(64),receivedAt,events:[{id:"evt_merged_setup",kind:"saved_method_added",contactId:contact.id,providerCustomerRef:"cus_setup",setup:{attemptId:attempt!.id,subscriptionId:joined.id,checkoutRef:"cs_setup",setupIntentRef:"seti_merged"},occurredAt:receivedAt,method:{providerRef:"pm_merged_setup",providerCustomerRef:"cus_setup",kind:"card",label:"Merged setup card"}}]},{kind:"system"});
    const [saved]=await db().select().from(paymentMethods).where(eq(paymentMethods.providerMethodRef,"pm_merged_setup"));
    expect(saved!.contactId).toBe(survivor.id);
    expect((await db().select().from(subscriptionCardSetups))[0]!.request).toEqual(attempt!.request);
    expect(await startCardTrial.call({subscriptionId:joined.id,paymentMethodId:saved!.id},CUSTOMER)).toEqual({id:joined.id,started:true});
  });
  it("preserves immutable setup requests and blocks a prior image from activating an unrelated fresh card",async()=>{
    const {contact,joined}=await pausedCardTrial("setup-old-image");
    await beginTrialCardSetup.call({subscriptionId:joined.id,saveMethodConsent:true},CUSTOMER);
    const [attempt]=await db().select().from(subscriptionCardSetups).where(eq(subscriptionCardSetups.subscriptionId,joined.id));
    await expect(db().update(subscriptionCardSetups).set({request:{...attempt!.request,customer:{email:"changed@billing.test"}}}).where(eq(subscriptionCardSetups.id,attempt!.id))).rejects.toMatchObject({cause:{code:"23514"}});
    await expect(db().update(subscriptionCardSetups).set({providerAccountId:"acct_other"}).where(eq(subscriptionCardSetups.id,attempt!.id))).rejects.toMatchObject({cause:{code:"23514"}});
    const other=await card(contact.id),end=new Date(Date.now()+14*86400000);
    await expect(db().update(subscriptions).set({status:"trialing",signupPending:false,paymentMethodId:other.id,currentPeriodStart:new Date(),currentPeriodEnd:end,trialEndsAt:end}).where(eq(subscriptions.id,joined.id))).rejects.toMatchObject({cause:{code:"23514",constraint_name:"subscription_trial_setup_confirmation"}});
    expect((await db().select().from(subscriptions).where(eq(subscriptions.id,joined.id)))[0]!.signupPending).toBe(true);
  });

  it("refuses an unrelated newly saved card on the same customer without exact trial setup proof",async()=>{
    const contact=await person("unrelated-fresh-setup-card");
    await db().insert(users).values({id:CUSTOMER.userId,email:contact.email!,role:"customer"});
    await db().update(contacts).set({userId:CUSTOMER.userId}).where(eq(contacts.id,contact.id));
    const monthly=await plan({billingMode:"provider",trialDays:14,trialRequiresCard:true});
    const offered=(await publicMembershipPlans.call({},{kind:"anonymous"})).find(entry=>entry.id===monthly.id)!;
    const joined=await joinMembership.call({planId:monthly.id,termsHash:offered.termsHash,requestKey:randomUUID(),acceptedTerms:true},CUSTOMER);
    await beginTrialCardSetup.call({subscriptionId:joined.id,saveMethodConsent:true},CUSTOMER);
    const receivedAt=new Date().toISOString();
    await processPaymentProviderEvents.call({provider:"stripe",bodySha256:"e".repeat(64),receivedAt,events:[{id:"evt_unrelated_fresh_card",kind:"saved_method_added",contactId:contact.id,providerCustomerRef:"cus_setup",occurredAt:receivedAt,method:{providerRef:"pm_unrelated_setup",providerCustomerRef:"cus_setup",kind:"card",label:"Saved by another checkout"}}]},{kind:"system"});
    const [saved]=await db().select().from(paymentMethods).where(eq(paymentMethods.providerMethodRef,"pm_unrelated_setup"));
    await expect(startCardTrial.call({subscriptionId:joined.id,paymentMethodId:saved!.id},CUSTOMER)).rejects.toMatchObject({code:"conflict"});
  });

  it("reopens only an actually expired provider session with a new immutable attempt",async()=>{
    const {joined}=await pausedCardTrial("expired-provider-session");
    const originalNow=Date.now();
    mocks.createMethodSetup.mockResolvedValueOnce({providerRef:"cs_expired",providerCustomerRef:"cus_setup",url:"https://checkout.example.test/expired",expiresAt:new Date(originalNow+1800000).toISOString()});
    await beginTrialCardSetup.call({subscriptionId:joined.id,saveMethodConsent:true},CUSTOMER);
    const [original]=await db().select().from(subscriptionCardSetups).where(eq(subscriptionCardSetups.subscriptionId,joined.id));
    const metadata={freeholder_contact_id:(original!.request as {contactId:string}).contactId,freeholder_subscription_id:joined.id,freeholder_setup_attempt_id:original!.id};
    const fetcher=vi.fn<typeof fetch>().mockResolvedValue(Response.json({id:"cs_expired",mode:"setup",status:"expired",customer:"cus_setup",currency:"cad",metadata}));
    const provider=createStripePayments({secretKey:"sk_recovery_fixture",webhookSecrets:["whsec_recovery_fixture"],apiBase:"https://stripe.example.test",fetch:fetcher});
    if(!provider.recoverMethodSetup)throw new Error("Stripe recovery must exist");
    mocks.recoverMethodSetup.mockImplementation(provider.recoverMethodSetup.bind(provider));
    const clock=vi.spyOn(Date,"now").mockReturnValue(originalNow+31*60000);
    try{expect(await beginTrialCardSetup.call({subscriptionId:joined.id,saveMethodConsent:true},CUSTOMER)).toEqual({url:"https://checkout.example.test/setup"});}finally{clock.mockRestore();}
    const attempts=await db().select().from(subscriptionCardSetups).where(eq(subscriptionCardSetups.subscriptionId,joined.id));
    expect(attempts).toHaveLength(2);
    expect(attempts.find(attempt=>attempt.id===original!.id)).toMatchObject({closedReason:"expired",request:original!.request,requestHash:original!.requestHash});
    expect(attempts.find(attempt=>attempt.id!==original!.id)!.requestHash).not.toBe(original!.requestHash);
    expect(mocks.createSetupCustomer).toHaveBeenCalledOnce();expect(fetcher).toHaveBeenCalledOnce();
  });
  it("refuses an aged unknown Customer dispatch even when actual lookup finds a customer without a final call outcome",async()=>{
    const {joined}=await pausedCardTrial("recover-lost-customer");
    await claimTrialCardSetup.call({subscriptionId:joined.id,saveMethodConsent:true},CUSTOMER);
    const [attempt]=await db().select().from(subscriptionCardSetups).where(eq(subscriptionCardSetups.subscriptionId,joined.id));
    const old=new Date(Date.now()-24*3600000);
    await db().insert(subscriptionSetupDispatches).values({setupId:attempt!.id,kind:"customer",state:"unknown",requestHash:attempt!.requestHash,initiatedBy:`user:${CUSTOMER.userId}`,startedAt:old,finishedAt:old});
    const metadata={freeholder_contact_id:(attempt!.request as {contactId:string}).contactId,freeholder_subscription_id:joined.id,freeholder_setup_attempt_id:attempt!.id};
    const fetcher=vi.fn<typeof fetch>().mockImplementation(async input=>Response.json((typeof input==="string"?input:input instanceof URL?input.href:input.url).includes("/v1/customers?")?{has_more:false,data:[{id:"cus_setup",metadata}]}:{has_more:false,data:[]}));
    const provider=createStripePayments({secretKey:"sk_recovery_fixture",webhookSecrets:["whsec_recovery_fixture"],apiBase:"https://stripe.example.test",fetch:fetcher});
    if(!provider.recoverMethodSetup)throw new Error("Stripe recovery must exist");
    mocks.recoverMethodSetup.mockImplementation(provider.recoverMethodSetup.bind(provider));
    await expect(beginTrialCardSetup.call({subscriptionId:joined.id,saveMethodConsent:true},CUSTOMER)).rejects.toMatchObject({code:"conflict"});
    expect(mocks.createSetupCustomer).not.toHaveBeenCalled();
    expect(mocks.createMethodSetup).not.toHaveBeenCalled();
    expect((await db().select().from(subscriptionSetupDispatches))[0]!.state).toBe("unknown");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect((await db().select().from(subscriptionCardSetups))[0]!.request).toEqual(attempt!.request);
  });
  it("recovers a completed lost session from actual provider reads and confirms only that exact trial",async()=>{
    const {contact,joined}=await pausedCardTrial("recover-completed-session");
    await claimTrialCardSetup.call({subscriptionId:joined.id,saveMethodConsent:true},CUSTOMER);
    const [attempt]=await db().select().from(subscriptionCardSetups).where(eq(subscriptionCardSetups.subscriptionId,joined.id));
    await applyTrialCardSetup.call({stage:"customer",attemptId:attempt!.id,subscriptionId:joined.id,provider:"stripe",providerCustomerRef:"cus_setup"},CUSTOMER);
    const frozen=setupRequest.parse({...attempt!.request,providerCustomerRef:"cus_setup"}),old=new Date(Date.now()-24*3600000);
    await db().insert(subscriptionSetupDispatches).values({setupId:attempt!.id,kind:"session",state:"unknown",requestHash:createHash("sha256").update(JSON.stringify(frozen)).digest("hex"),customerAtStart:"cus_setup",initiatedBy:`user:${CUSTOMER.userId}`,startedAt:old,finishedAt:old});
    const metadata={freeholder_contact_id:contact.id,freeholder_subscription_id:joined.id,freeholder_setup_attempt_id:attempt!.id};
    const created=Math.floor(Date.now()/1000);
    const fetcher=vi.fn<typeof fetch>().mockImplementation(async input=>Response.json((typeof input==="string"?input:input instanceof URL?input.href:input.url).includes("/v1/setup_intents/")?{id:"seti_recovered",created,status:"succeeded",usage:"off_session",customer:"cus_setup",metadata,payment_method:{id:"pm_recovered",customer:"cus_setup",type:"card",card:{brand:"visa",last4:"4242"}}}:{has_more:false,data:[{id:"cs_recovered",mode:"setup",status:"complete",payment_status:"no_payment_required",customer:"cus_setup",currency:"cad",metadata,created,setup_intent:"seti_recovered"}]}));
    const provider=createStripePayments({secretKey:"sk_recovery_fixture",webhookSecrets:["whsec_recovery_fixture"],apiBase:"https://stripe.example.test",fetch:fetcher});
    if(!provider.recoverMethodSetup)throw new Error("Stripe recovery must exist");
    mocks.recoverMethodSetup.mockImplementation(provider.recoverMethodSetup.bind(provider));
    expect((await beginTrialCardSetup.call({subscriptionId:joined.id,saveMethodConsent:true},CUSTOMER)).url).toContain(`/memberships/trial-return?subscription=${joined.id}`);
    const [saved]=await db().select().from(paymentMethods).where(eq(paymentMethods.providerMethodRef,"pm_recovered"));
    expect(await startCardTrial.call({subscriptionId:joined.id,paymentMethodId:saved!.id},CUSTOMER)).toEqual({id:joined.id,started:true});
    expect(mocks.createMethodSetup).not.toHaveBeenCalled();expect(mocks.createSetupCustomer).not.toHaveBeenCalled();expect(fetcher).toHaveBeenCalledTimes(2);
    expect((await db().select().from(subscriptionSetupDispatches))[0]!.state).toBe("unknown");
  });
  it.each(["contact","account","customer","checkout","subscription"] as const)("refuses exact-attempt evidence with the wrong %s",async field=>{
    const {contact,joined}=await pausedCardTrial(`wrong-setup-${field}`);
    await beginTrialCardSetup.call({subscriptionId:joined.id,saveMethodConsent:true},CUSTOMER);
    const [attempt]=await db().select().from(subscriptionCardSetups).where(eq(subscriptionCardSetups.subscriptionId,joined.id));
    const receivedAt=new Date().toISOString(),customer=field==="customer"?"cus_other":"cus_setup";
    const event={id:`evt_wrong_setup_${field}`,kind:"saved_method_added" as const,contactId:field==="contact"?randomUUID():contact.id,...(field==="account"?{providerAccountId:"acct_other"}:{}),providerCustomerRef:customer,setup:{attemptId:attempt!.id,subscriptionId:field==="subscription"?randomUUID():joined.id,checkoutRef:field==="checkout"?"cs_other":"cs_setup",setupIntentRef:"seti_wrong"},occurredAt:receivedAt,method:{providerRef:"pm_wrong_setup",providerCustomerRef:customer,kind:"card",label:"Unproven card"}};
    await expect(processPaymentProviderEvents.call({provider:"stripe",bodySha256:"f".repeat(64),receivedAt,events:[event]},{kind:"system"})).rejects.toMatchObject({code:"conflict"});
    expect(await db().select().from(paymentMethods)).toHaveLength(0);
    expect((await db().select().from(subscriptionCardSetups))[0]!.confirmedAt).toBeNull();
  });


  it("keeps a dispatched Customer creation pending through erasure and records its actual late result before cleanup",async()=>{
    const member=await person("dispatched-erasure");
    await db().insert(users).values({id:CUSTOMER.userId,email:member.email!,role:"customer"});
    await db().update(contacts).set({userId:CUSTOMER.userId}).where(eq(contacts.id,member.id));
    const monthly=await plan({billingMode:"provider",trialDays:14,trialRequiresCard:true});
    const offered=(await publicMembershipPlans.call({},{kind:"anonymous"})).find(p=>p.id===monthly.id)!;
    const joined=await joinMembership.call({planId:monthly.id,termsHash:offered.termsHash,requestKey:randomUUID(),acceptedTerms:true},CUSTOMER);
    let release!:()=>void,entered!:()=>void;
    const resumed=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{entered=resolve;});
    mocks.createSetupCustomer.mockImplementationOnce(async()=>{
      const [dispatch]=await db().select().from(subscriptionSetupDispatches);
      expect(dispatch!.state).toBe("running");
      entered();await resumed;return {providerCustomerRef:"cus_LateSetup"};
    });
    const pending=beginTrialCardSetup.call({subscriptionId:joined.id,saveMethodConsent:true},CUSTOMER).then(value=>({value}),error=>({error:error as unknown}));
    let requestId="",jobId="";
    const cleanup=mocks.eraseCustomer;
    try{
      await started;
      const request=await createDataRequest.call({contactId:member.id,request:{kind:"erasure"}},OWNER);requestId=request.id;
      await verifyDataRequest.call({id:request.id,method:"Synthetic original setup identity verification"},OWNER);
      const erased=await fulfillDataRequest.call({id:request.id,confirmation:"ERASE"},OWNER);
      expect(erased.request.status).toBe("in_progress");
      const body=erased.artifact.body as {outcomes:Array<{scope:string;pendingJobs?:string[]}>};
      jobId=body.outcomes.find(item=>item.scope==="subscriptions.cardSetups")!.pendingJobs![0]!;
      const job=await getJob(eraseTrialSetupCustomers.name,jobId);
      const context:JobExecutionContext={id:randomUUID(),name:eraseTrialSetupCustomers.name,attempt:1,signal:new AbortController().signal,leaseSeconds:300,heartbeat:async()=>true,isCancelled:async()=>false,throwIfCancelled:async()=>{}};
      await expect(eraseTrialSetupCustomers.handler(job!.data,context)).rejects.toMatchObject({code:"conflict"});
      expect(cleanup).not.toHaveBeenCalled();
      await expect(db().delete(subscriptionCardSetups)).rejects.toMatchObject({cause:{code:"23514"}});
      await expect(completeErasureJob.call({requestId,scope:"subscriptions.cardSetups",jobId},{kind:"system"})).rejects.toMatchObject({cause:{code:"23514"}});
      expect((await db().select().from(dataRequests).where(eq(dataRequests.id,requestId)))[0]!.status).toBe("in_progress");
    }finally{release();}
    expect(await pending).toMatchObject({error:{code:"conflict"}});
    expect((await db().select().from(subscriptionSetupDispatches))[0]).toMatchObject({state:"succeeded",providerCustomerRef:"cus_LateSetup"});
    expect(await db().select().from(paymentProviderCustomers)).toHaveLength(0);
    const job=await getJob(eraseTrialSetupCustomers.name,jobId);
    const context:JobExecutionContext={id:randomUUID(),name:eraseTrialSetupCustomers.name,attempt:2,signal:new AbortController().signal,leaseSeconds:300,heartbeat:async()=>true,isCancelled:async()=>false,throwIfCancelled:async()=>{}};
    await eraseTrialSetupCustomers.handler(job!.data,context);
    expect(cleanup).toHaveBeenCalledWith(expect.objectContaining({providerCustomerRef:"cus_LateSetup",providerAccountId:undefined}));
    expect(await db().select().from(subscriptionCardSetups)).toHaveLength(0);
    expect(await db().select().from(subscriptionSetupDispatches)).toHaveLength(0);
    expect((await db().select().from(dataRequests).where(eq(dataRequests.id,requestId)))[0]!.status).toBe("completed");
    expect(mocks.createMethodSetup).not.toHaveBeenCalled();
  });


  it("keeps an ambiguous Customer dispatch pending even when provider lookup finds nothing",async()=>{
    const member=await person("unknown-dispatch-erasure");
    await db().insert(users).values({id:CUSTOMER.userId,email:member.email!,role:"customer"});
    await db().update(contacts).set({userId:CUSTOMER.userId}).where(eq(contacts.id,member.id));
    const monthly=await plan({billingMode:"provider",trialDays:14,trialRequiresCard:true});
    const offered=(await publicMembershipPlans.call({},{kind:"anonymous"})).find(p=>p.id===monthly.id)!;
    const joined=await joinMembership.call({planId:monthly.id,termsHash:offered.termsHash,requestKey:randomUUID(),acceptedTerms:true},CUSTOMER);
    mocks.createSetupCustomer.mockRejectedValueOnce(new Error("Synthetic ambiguous provider timeout"));
    await expect(beginTrialCardSetup.call({subscriptionId:joined.id,saveMethodConsent:true},CUSTOMER)).rejects.toMatchObject({code:"conflict"});
    expect((await db().select().from(subscriptionSetupDispatches))[0]!.state).toBe("unknown");
    await expect(db().update(subscriptionSetupDispatches).set({state:"provider_cancelled",finishedAt:new Date(),resolution:{}})).rejects.toMatchObject({cause:{code:"23514"}});
    const request=await createDataRequest.call({contactId:member.id,request:{kind:"erasure"}},OWNER);
    await verifyDataRequest.call({id:request.id,method:"Synthetic identity verification"},OWNER);
    const erased=await fulfillDataRequest.call({id:request.id,confirmation:"ERASE"},OWNER);
    const body=erased.artifact.body as {outcomes:Array<{scope:string;pendingJobs?:string[]}>};
    const id=body.outcomes.find(item=>item.scope==="subscriptions.cardSetups")!.pendingJobs![0]!;
    mocks.recoverMethodSetup.mockResolvedValue({state:"unresolved"});
    const cleanup=mocks.eraseCustomer;
    {
      const job=await getJob(eraseTrialSetupCustomers.name,id);
      const context:JobExecutionContext={id:randomUUID(),name:eraseTrialSetupCustomers.name,attempt:1,signal:new AbortController().signal,leaseSeconds:300,heartbeat:async()=>true,isCancelled:async()=>false,throwIfCancelled:async()=>{}};
      await expect(eraseTrialSetupCustomers.handler(job!.data,context)).rejects.toMatchObject({code:"conflict"});
      expect(cleanup).not.toHaveBeenCalled();expect(mocks.recoverMethodSetup).not.toHaveBeenCalled();
      expect((await db().select().from(dataRequests).where(eq(dataRequests.id,request.id)))[0]!.status).toBe("in_progress");
      expect(await db().select().from(subscriptionCardSetups)).toHaveLength(1);
      expect((await db().select().from(subscriptionSetupDispatches))[0]!.state).toBe("unknown");
    }
  });


  it("requires a fresh real human and concrete final provider/caller evidence before reconciling an unknown dispatch",async()=>{
    const {joined}=await pausedCardTrial("human-setup-recovery");
    mocks.createSetupCustomer.mockRejectedValueOnce(new Error("Synthetic unknown customer operation"));
    await expect(beginTrialCardSetup.call({subscriptionId:joined.id,saveMethodConsent:true},CUSTOMER)).rejects.toMatchObject({code:"conflict"});
    const [dispatch]=await db().select().from(subscriptionSetupDispatches);
    const input={dispatchId:dispatch!.id,outcome:"completed" as const,providerOperationRef:"case-original-operation-123",providerEvidence:"Synthetic provider operation log confirms this exact request completed with cus_Confirmed.",callerStopEvidence:"Synthetic caller process was terminated and its outstanding operation was confirmed final.",confirmation:"PROVIDER OUTCOME CONFIRMED" as const,providerCustomerRef:"cus_Confirmed"};
    await expect(reconcileTrialSetupDispatch.call(input,{kind:"agent",keyName:"no-human-evidence",scopes:["subscriptions.*"]})).rejects.toMatchObject({code:"permission"});
    await expect(reconcileTrialSetupDispatch.call(input,{kind:"system"})).rejects.toMatchObject({code:"permission"});
    await expect(reconcileTrialSetupDispatch.call(input,CUSTOMER)).rejects.toMatchObject({code:"permission"});
    await expect(reconcileTrialSetupDispatch.call(input,{...OWNER,keyScopes:["subscriptions.reconcileTrialSetupDispatch"]})).rejects.toMatchObject({code:"permission"});
    await expect(reconcileTrialSetupDispatch.call(input,{...OWNER,security:{twoFactorRequired:true,twoFactorEnrolled:true,twoFactorVerified:true,stepUpValid:false}})).rejects.toMatchObject({code:"step_up_required"});
    await expect(reconcileTrialSetupDispatch.call({...input,callerStopEvidence:""},OWNER)).rejects.toMatchObject({code:"validation"});
    expect(mocks.recoverMethodSetup).not.toHaveBeenCalled();
    mocks.recoverMethodSetup.mockResolvedValueOnce({state:"unresolved"});
    await expect(reconcileTrialSetupDispatch.call(input,OWNER)).rejects.toMatchObject({code:"conflict"});
    expect((await db().select().from(subscriptionSetupDispatches))[0]!.state).toBe("unknown");
    mocks.recoverMethodSetup.mockResolvedValueOnce({state:"customer_only",providerCustomerRef:"cus_Confirmed"});
    expect(await reconcileTrialSetupDispatch.call(input,OWNER)).toMatchObject({state:"provider_completed",source:"human_provider_confirmation"});
    expect(mocks.recoverMethodSetup.mock.calls.at(-1)![0]).toMatchObject({providerCustomerRef:"cus_Confirmed",verifyCustomerCreation:true});
    const [resolved]=await db().select().from(subscriptionSetupDispatches);
    expect(resolved!.resolution).toMatchObject({source:"human_provider_confirmation",actor:`user:${OWNER.userId}`,providerOperationRef:input.providerOperationRef,providerEvidence:input.providerEvidence,callerStopEvidence:input.callerStopEvidence,originalRequestHash:dispatch!.requestHash});
    const viewer={...OWNER,role:"subscription-reader",grants:[{module:"subscriptions",access:"view" as const}],security:{twoFactorRequired:true,twoFactorEnrolled:true,twoFactorVerified:true,stepUpValid:true}};
    await expect(listTrialSetupDispatches.call({subscriptionId:joined.id},viewer)).rejects.toMatchObject({code:"permission"});
    expect((await listTrialSetupDispatches.call({subscriptionId:joined.id},OWNER)).rows[0]!.resolution).toMatchObject({providerEvidence:input.providerEvidence});
    const entries=await db().select().from(auditLog);
    expect(entries.find(entry=>entry.action==="subscriptions.applyTrialSetupReconciliation")?.actor).toBe(`user:${OWNER.userId}`);
    const count=mocks.recoverMethodSetup.mock.calls.length;
    expect(await reconcileTrialSetupDispatch.call(input,OWNER)).toMatchObject({state:"provider_completed",source:"human_provider_confirmation"});
    expect(mocks.recoverMethodSetup.mock.calls).toHaveLength(count);
    await expect(reconcileTrialSetupDispatch.call({...input,outcome:"cancelled",providerCustomerRef:undefined},OWNER)).rejects.toMatchObject({code:"conflict"});
  });

  it("records a concrete human-confirmed cancellation guarantee without calling provider absence a machine outcome",async()=>{
    const {joined}=await pausedCardTrial("cancelled-setup-recovery");
    mocks.createSetupCustomer.mockRejectedValueOnce(new Error("Synthetic unknown customer operation"));
    await expect(beginTrialCardSetup.call({subscriptionId:joined.id,saveMethodConsent:true},CUSTOMER)).rejects.toMatchObject({code:"conflict"});
    const [dispatch]=await db().select().from(subscriptionSetupDispatches);
    const input={dispatchId:dispatch!.id,outcome:"cancelled" as const,providerOperationRef:"support-case-no-resource-456",providerEvidence:"Synthetic original-account provider support guarantee: exact operation cancelled with no resources and no future completion.",callerStopEvidence:"Synthetic original caller and retries terminated; provider confirmed every dispatched operation is final.",confirmation:"PROVIDER OUTCOME CONFIRMED" as const};
    expect(await reconcileTrialSetupDispatch.call(input,OWNER)).toMatchObject({state:"provider_cancelled",source:"human_provider_confirmation"});
    expect(mocks.recoverMethodSetup).not.toHaveBeenCalled();
    const [resolved]=await db().select().from(subscriptionSetupDispatches);
    expect(resolved!.providerCustomerRef).toBeNull();
    expect(resolved!.resolution).toMatchObject({source:"human_provider_confirmation",providerOperationRef:input.providerOperationRef,providerEvidence:input.providerEvidence,callerStopEvidence:input.callerStopEvidence});
    const [old]=await db().select().from(subscriptionCardSetups);
    expect(old).toMatchObject({closedReason:"provider_cancelled"});
    expect(await beginTrialCardSetup.call({subscriptionId:joined.id,saveMethodConsent:true},CUSTOMER)).toEqual({url:"https://checkout.example.test/setup"});
    const attempts=await db().select().from(subscriptionCardSetups);
    expect(attempts).toHaveLength(2);
    expect(attempts.find(item=>item.id!==old!.id)!.requestHash).not.toBe(old!.requestHash);
    expect(mocks.createSetupCustomer).toHaveBeenCalledTimes(2);
  });


  it("retains every actual concurrent Customer result for original-account privacy cleanup",async()=>{
    const {contact,joined}=await pausedCardTrial("concurrent-setup-customers");
    let ready!:()=>void,release!:()=>void,entered!:()=>void,count=0;
    const both=new Promise<void>(resolve=>{ready=resolve;}),resumed=new Promise<void>(resolve=>{release=resolve;}),firstEntered=new Promise<void>(resolve=>{entered=resolve;});
    mocks.createSetupCustomer.mockImplementation(async()=>{const mine=++count;if(count===1)entered();if(count===2)ready();await resumed;return {providerCustomerRef:`cus_Concurrent${mine}`};});
    mocks.createMethodSetup.mockImplementation(async request=>({providerRef:"cs_Concurrent",providerCustomerRef:request.providerCustomerRef,url:"https://checkout.example.test/concurrent"}));
    const first=beginTrialCardSetup.call({subscriptionId:joined.id,saveMethodConsent:true},CUSTOMER).then(value=>({value}),error=>({error:error as unknown}));
    await Promise.race([firstEntered,first.then(outcome=>{throw new Error(`First request ended before provider I/O: ${JSON.stringify(outcome)}`);})]);
    const second=beginTrialCardSetup.call({subscriptionId:joined.id,saveMethodConsent:true},CUSTOMER).then(value=>({value}),error=>({error:error as unknown}));
    try{await Promise.race([both,second.then(outcome=>{throw new Error(`Second request ended before provider I/O: ${JSON.stringify(outcome)}`);})]);}finally{release();}
    const outcomes=await Promise.all([first,second]);
    expect(outcomes.filter(outcome=>"value" in outcome)).toHaveLength(1);
    expect(outcomes.filter(outcome=>"error" in outcome)).toHaveLength(1);
    const customers=(await db().select().from(subscriptionSetupDispatches)).filter(item=>item.kind==="customer");
    expect(customers.map(item=>item.providerCustomerRef).sort()).toEqual(["cus_Concurrent1","cus_Concurrent2"]);
    expect(customers.every(item=>item.state==="succeeded")).toBe(true);
    expect(mocks.createSetupCustomer.mock.calls[0]![0]).toEqual(mocks.createSetupCustomer.mock.calls[1]![0]);
    const request=await createDataRequest.call({contactId:contact.id,request:{kind:"erasure"}},OWNER);
    await verifyDataRequest.call({id:request.id,method:"Synthetic original account identity verification"},OWNER);
    const erased=await fulfillDataRequest.call({id:request.id,confirmation:"ERASE"},OWNER);
    const body=erased.artifact.body as {outcomes:Array<{scope:string;pendingJobs?:string[]}>};
    const id=body.outcomes.find(item=>item.scope==="subscriptions.cardSetups")!.pendingJobs![0]!;
    const job=await getJob(eraseTrialSetupCustomers.name,id);
    const context:JobExecutionContext={id:randomUUID(),name:eraseTrialSetupCustomers.name,attempt:1,signal:new AbortController().signal,leaseSeconds:300,heartbeat:async()=>true,isCancelled:async()=>false,throwIfCancelled:async()=>{}};
    await eraseTrialSetupCustomers.handler(job!.data,context);
    expect(mocks.eraseCustomer.mock.calls.map(([input])=>input.providerCustomerRef).sort()).toEqual(["cus_Concurrent1","cus_Concurrent2"]);
    expect(await db().select().from(subscriptionCardSetups)).toHaveLength(0);
    // commerce.money has its own registered binding task and must still finish.
    expect((await db().select().from(dataRequests).where(eq(dataRequests.id,request.id)))[0]!.status).toBe("in_progress");
  });


  it.each(["commerce.money","subscriptions.cardSetups"] as const)("honors the %s hold without making a historical card proof block credential erasure",async scope=>{
    const {contact,joined}=await pausedCardTrial(`setup-hold-${scope.replaceAll(".","-")}`);
    await beginTrialCardSetup.call({subscriptionId:joined.id,saveMethodConsent:true},CUSTOMER);
    const [attempt]=await db().select().from(subscriptionCardSetups);
    const receivedAt=new Date().toISOString();
    await processPaymentProviderEvents.call({provider:"stripe",bodySha256:"9".repeat(64),receivedAt,events:[{id:"evt_held_setup_proof",kind:"saved_method_added",contactId:contact.id,providerCustomerRef:"cus_setup",setup:{attemptId:attempt!.id,subscriptionId:joined.id,checkoutRef:"cs_setup",setupIntentRef:"seti_HeldSetup"},occurredAt:receivedAt,method:{providerRef:"pm_HeldSetup",providerCustomerRef:"cus_setup",kind:"card",label:"Held setup proof card"}}]},{kind:"system"});
    const [confirmed]=await db().select().from(subscriptionCardSetups);
    const request=await createDataRequest.call({contactId:contact.id,request:{kind:"erasure"}},OWNER);
    await verifyDataRequest.call({id:request.id,method:"Synthetic hold identity verification"},OWNER);
    await addRetentionException.call({dataRequestId:request.id,scope,reason:"legal_claim",legalBasis:"Synthetic exact-scope operational evidence hold"},OWNER);
    const erased=await fulfillDataRequest.call({id:request.id,confirmation:"ERASE"},OWNER);
    const body=erased.artifact.body as {outcomes:Array<{scope:string;outcome:string;pendingJobs?:string[]}>};
    expect(body.outcomes.find(item=>item.scope==="subscriptions.cardSetups")!.outcome).toBe("retained");
    expect((await db().select().from(subscriptionCardSetups))[0]).toMatchObject({confirmedMethodId:confirmed!.confirmedMethodId,request:attempt!.request,erasureRequestId:null});
    if(scope==="commerce.money"){
      expect(await db().select().from(paymentMethods)).toHaveLength(1);
      expect(erased.request.status).toBe("partially_completed");
    }else{
      expect(await db().select().from(paymentMethods)).toHaveLength(0);
      expect(erased.request.status).toBe("in_progress");
      const id=body.outcomes.find(item=>item.scope==="commerce.money")!.pendingJobs![0]!;
      const job=await getJob(erasePaymentProviderCustomer.name,id);
      const context:JobExecutionContext={id,name:erasePaymentProviderCustomer.name,attempt:1,signal:new AbortController().signal,leaseSeconds:300,heartbeat:async()=>true,isCancelled:async()=>false,throwIfCancelled:async()=>{}};
      await erasePaymentProviderCustomer.handler(job!.data,context);
      expect((await db().select().from(dataRequests).where(eq(dataRequests.id,request.id)))[0]!.status).toBe("partially_completed");
    }
  });


  it("does not leave human recovery evidence in global audit copies after setup erasure finishes",async()=>{
    const {contact,joined}=await pausedCardTrial("setup-recovery-audit-subject");
    mocks.createSetupCustomer.mockRejectedValueOnce(new Error("Synthetic unknown customer operation"));
    await expect(beginTrialCardSetup.call({subscriptionId:joined.id,saveMethodConsent:true},CUSTOMER)).rejects.toMatchObject({code:"conflict"});
    const [dispatch]=await db().select().from(subscriptionSetupDispatches);
    const request=await createDataRequest.call({contactId:contact.id,request:{kind:"erasure"}},OWNER);
    await verifyDataRequest.call({id:request.id,method:"Synthetic original identity verification"},OWNER);
    const erased=await fulfillDataRequest.call({id:request.id,confirmation:"ERASE"},OWNER);
    mocks.recoverMethodSetup.mockResolvedValueOnce({state:"customer_only",providerCustomerRef:"cus_AuditCleanup"});
    const evidence=`Synthetic exact provider log for ${contact.email} guarantees final completion of the original customer operation.`;
    await reconcileTrialSetupDispatch.call({dispatchId:dispatch!.id,outcome:"completed",providerOperationRef:"synthetic-case-audit-123",providerEvidence:evidence,callerStopEvidence:"Synthetic original caller and all retries stopped before the provider confirmed final completion.",confirmation:"PROVIDER OUTCOME CONFIRMED",providerCustomerRef:"cus_AuditCleanup"},OWNER);
    const body=erased.artifact.body as {outcomes:Array<{scope:string;pendingJobs?:string[]}>};
    const id=body.outcomes.find(item=>item.scope==="subscriptions.cardSetups")!.pendingJobs![0]!;
    const job=await getJob(eraseTrialSetupCustomers.name,id);
    const context:JobExecutionContext={id:randomUUID(),name:eraseTrialSetupCustomers.name,attempt:1,signal:new AbortController().signal,leaseSeconds:300,heartbeat:async()=>true,isCancelled:async()=>false,throwIfCancelled:async()=>{}};
    await eraseTrialSetupCustomers.handler(job!.data,context);
    expect((await db().select().from(dataRequests).where(eq(dataRequests.id,request.id)))[0]!.status).toBe("completed");
    const entries=await db().select().from(auditLog);
    const recovery=entries.filter(item=>item.action.includes("TrialSetupReconciliation"));
    expect(recovery).toHaveLength(2);
    expect(recovery.every(item=>item.actor===`user:${OWNER.userId}` && item.subjectType==="subscription" && item.subjectId===joined.id)).toBe(true);
    expect(recovery.map(item=>item.diff)).toEqual([{dispatchId:dispatch!.id,outcome:"completed"},{dispatchId:dispatch!.id,outcome:"completed"}]);
    expect(JSON.stringify(recovery.map(item=>item.diff))).not.toContain(contact.email!);
    expect(JSON.stringify(recovery.map(item=>item.diff))).not.toContain(evidence);
  });


  it.each(["before","after","changed"] as const)("allows identity separation only when original setup evidence was unchanged (%s merge)",async phase=>{
    const {contact,joined}=await pausedCardTrial(`setup-undo-${phase}`),survivor=await person(`setup-other-${phase}`);
    mocks.createSetupCustomer.mockRejectedValue(new Error("Synthetic unresolved provider creation"));
    if(phase!=="after")await expect(beginTrialCardSetup.call({subscriptionId:joined.id,saveMethodConsent:true},CUSTOMER)).rejects.toMatchObject({code:"conflict"});
    const merged=await mergeContacts.call({survivingId:survivor.id,duplicateId:contact.id},OWNER);
    const [operation]=await db().select().from(contactMergeOperations).where(eq(contactMergeOperations.id,merged.mergeOperationId));
    const witness=(operation!.referenceState as Array<{table:string;before:unknown;after:unknown}>).find(item=>item.table==="subscription_card_setups")!;
    expect(witness).toBeDefined();
    expect(JSON.stringify(witness)).not.toContain(contact.email!);
    expect(JSON.stringify(witness)).not.toContain(survivor.email!);
    if(phase!=="before")await expect(beginTrialCardSetup.call({subscriptionId:joined.id,saveMethodConsent:true},CUSTOMER)).rejects.toMatchObject({code:"conflict"});
    if(phase!=="before"){
      await expect(undoContactMerge.call({operationId:merged.mergeOperationId},OWNER)).rejects.toMatchObject({code:"conflict"});
      expect((await db().select().from(subscriptions).where(eq(subscriptions.id,joined.id)))[0]!.contactId).toBe(survivor.id);
      expect((await db().select().from(subscriptionCardSetups))[0]!.request).toMatchObject({contactId:phase==="after"?survivor.id:contact.id,customer:{email:phase==="after"?survivor.email:contact.email}});
      expect(await db().select().from(contacts).where(eq(contacts.id,contact.id))).toHaveLength(0);
    }else{
      expect(await undoContactMerge.call({operationId:merged.mergeOperationId},OWNER)).toMatchObject({restoredContact:{id:contact.id}});
      expect((await db().select().from(subscriptions).where(eq(subscriptions.id,joined.id)))[0]!.contactId).toBe(contact.id);
      expect((await db().select().from(subscriptionCardSetups))[0]!.request).toMatchObject({contactId:contact.id,customer:{email:contact.email}});
    }
  });


  it.each(["setup","dispatch"] as const)("marks an over-cap %s witness non-undoable without retaining a truncated prefix",async family=>{
    const {contact,joined}=await pausedCardTrial(`setup-cap-${family}`),survivor=await person(`setup-cap-root-${family}`);
    mocks.createSetupCustomer.mockRejectedValue(new Error("Synthetic unresolved provider creation"));
    await expect(beginTrialCardSetup.call({subscriptionId:joined.id,saveMethodConsent:true},CUSTOMER)).rejects.toMatchObject({code:"conflict"});
    const [attempt]=await db().select().from(subscriptionCardSetups),[dispatch]=await db().select().from(subscriptionSetupDispatches);
    if(family==="setup"){
      const createdAt=new Date("2020-01-01T00:00:00Z"),closedAt=new Date("2020-01-02T00:00:00Z");
      const rows=Array.from({length:MAX_SETUP_UNDO_RECORDS},(_,index)=>{
        const id=randomUUID(),request=setupRequest.parse({...attempt!.request,setupAttemptId:id,idempotencyKey:`trial-card:${joined.id}:${id}`});
        return {id,subscriptionId:joined.id,provider:"stripe",request,requestHash:createHash("sha256").update(JSON.stringify(request)).digest("hex"),providerCustomerRef:"cus_Capacity",providerCheckoutRef:`cs_Capacity${index}`,createdAt,closedAt,closedReason:"expired"};
      });
      await db().insert(subscriptionCardSetups).values(rows);
    }else{
      await db().insert(subscriptionSetupDispatches).values(Array.from({length:MAX_SETUP_UNDO_RECORDS},()=>({setupId:attempt!.id,kind:"customer" as const,state:"unknown" as const,requestHash:dispatch!.requestHash,initiatedBy:"synthetic-capacity-history",finishedAt:new Date()})));
    }
    const merged=await mergeContacts.call({survivingId:survivor.id,duplicateId:contact.id},OWNER);
    const [operation]=await db().select().from(contactMergeOperations).where(eq(contactMergeOperations.id,merged.mergeOperationId));
    expect(operation!.undoable).toBe(false);
    expect(operation!.undoBlockers.some(item=>item.includes("safe undo limit"))).toBe(true);
    const witness=(operation!.referenceState as Array<{table:string;before:unknown;after:unknown}>).find(item=>item.table==="subscription_card_setups")!;
    expect(witness).toEqual({table:"subscription_card_setups",before:[],after:[]});
    await expect(undoContactMerge.call({operationId:merged.mergeOperationId},OWNER)).rejects.toMatchObject({code:"conflict"});
  });

  it("refuses later dispatch overflow instead of comparing only a previously captured prefix",async()=>{
    const {contact,joined}=await pausedCardTrial("setup-later-cap"),survivor=await person("setup-later-cap-root");
    mocks.createSetupCustomer.mockRejectedValue(new Error("Synthetic unresolved provider creation"));
    await expect(beginTrialCardSetup.call({subscriptionId:joined.id,saveMethodConsent:true},CUSTOMER)).rejects.toMatchObject({code:"conflict"});
    const [attempt]=await db().select().from(subscriptionCardSetups),[dispatch]=await db().select().from(subscriptionSetupDispatches);
    const merged=await mergeContacts.call({survivingId:survivor.id,duplicateId:contact.id},OWNER);
    await db().insert(subscriptionSetupDispatches).values(Array.from({length:MAX_SETUP_UNDO_RECORDS},()=>({setupId:attempt!.id,kind:"customer" as const,state:"unknown" as const,requestHash:dispatch!.requestHash,initiatedBy:"synthetic-later-capacity-history",finishedAt:new Date()})));
    await expect(undoContactMerge.call({operationId:merged.mergeOperationId},OWNER)).rejects.toMatchObject({code:"conflict"});
    expect((await db().select().from(subscriptions).where(eq(subscriptions.id,joined.id)))[0]!.contactId).toBe(survivor.id);
  });

});
