// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: actual buyer privacy/jobs recover an explicitly seeded original
// schedule. The synthetic prior-create journal is not new provider creation or
// commercial acceptance evidence. Run only on the newly assembled terms schema.
import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createStripePayments } from "@/adapters/payments/stripe";
import { db } from "@/core/db";
import { getJob, stopJobs, type JobExecutionContext } from "@/core/jobs";
import { addRetentionException, createDataRequest, fulfillDataRequest, removeRetentionException, verifyDataRequest } from "@/core/privacy/service";
import { dataRequestArtifacts, dataRequests } from "@/core/privacy/schema";
import { ready } from "@/core/runtime";
import { cartItems, productVariants } from "@/modules/catalog/schema";
import { BUYER_MONEY_ERASURE_JOB, finishBuyerMoneyErasure } from "@/modules/invoicing/buyer-money-erasure";
import { merchantTaxProfiles } from "@/modules/invoicing/merchant-tax-schema";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { erasePaymentProviderCustomer } from "@/modules/invoicing/provider-erasure";
import { paymentMethods, paymentProviderCustomers } from "@/modules/invoicing/schema";
import { quiesceMerchantSchedules } from "@/modules/subscriptions/merchant-tax-quiescence";
import { subscriptionProviderScheduleErasures, subscriptionProviderScheduleOperations, subscriptionProviderScheduleResources } from "@/modules/subscriptions/provider-schedule-schema";
import { plans, subscriptionMarketPolicies, subscriptionMerchantScopes, subscriptions } from "@/modules/subscriptions/schema";
import { seedMerchantCheckout80 } from "../helpers/merchant-checkout80";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const receipt = z.object({ outcomes: z.array(z.object({ scope: z.string(), outcome: z.string(), pendingJobs: z.array(z.uuid()).optional() }).passthrough()) }).passthrough();
function jobContext(name: string, id: string): JobExecutionContext { return { id, name, attempt: 1, signal: new AbortController().signal,
  leaseSeconds: 120, heartbeat: async () => true, isCancelled: async () => false, throwIfCancelled: async () => {} }; }
function signal() { let resolve!: () => void; const promise = new Promise<void>(accept => { resolve = accept; }); return { promise, resolve }; }

describe.runIf(hasDatabase)("original buyer schedule and money erasure", { timeout: 60000 }, () => {
  let fixture: Awaited<ReturnType<typeof seedMerchantCheckout80>> | undefined;
  beforeAll(ready, 60000); beforeEach(truncateSpine);
  afterEach(() => { fixture?.cleanup(); fixture = undefined; vi.restoreAllMocks(); });
  afterAll(async () => { await stopJobs(); await closeDb(); });

  async function pending(scope: string, requestId: string): Promise<string[]> {
    const [artifact] = await db().select().from(dataRequestArtifacts).where(eq(dataRequestArtifacts.dataRequestId, requestId));
    return receipt.parse(artifact?.body).outcomes.find(outcome => outcome.scope === scope)?.pendingJobs ?? [];
  }
  async function seedPriorBuyer() {
    fixture = await seedMerchantCheckout80("destination");
    const [profile] = await db().select().from(merchantTaxProfiles).where(eq(merchantTaxProfiles.id, fixture.profiles[0]!.profileId));
    const [item] = await db().select({ variant: productVariants }).from(cartItems).innerJoin(productVariants, eq(productVariants.id, cartItems.variantId)).where(eq(cartItems.cartId, fixture.cart.id));
    if (!profile?.contactId || !item) throw new Error("The real merchant fixture did not retain its original business/product.");
    expect(profile.contactId).not.toBe(fixture.buyer.id);
    const [plan] = await db().insert(plans).values({ productId: item.variant.productId, name: "Synthetic prior buyer agreement", interval: "month", billingMode: "provider", status: "active" }).returning();
    const subscriptionId = randomUUID(), operationId = randomUUID();
    const completionDigest = createHash("sha256").update("synthetic prior completed original buyer creator").digest("hex");
    await db().transaction(async tx => {
      await tx.execute(sql`select set_config('freeholder.subscription_scope_v1','1',true),set_config('freeholder.subscription_schedule_v1','1',true)`);
      await tx.insert(subscriptions).values({ id: subscriptionId, merchantScopeVersion: 1, contactId: fixture!.buyer.id, planId: plan!.id, productVariantId: item.variant.id,
        currency: "CAD", billingMode: "provider", provider: "stripe", providerRef: "sub_originalBuyer", status: "active", grants: {},
        currentPeriodStart: new Date("2026-11-01T00:00:00Z"), currentPeriodEnd: new Date("2026-12-01T00:00:00Z") });
      await tx.insert(subscriptionMarketPolicies).values({ subscriptionId, model: "seller_merchant", adapter: "stripe_connect", siteFeeBps: 1000, holdDays: 0,
        sellerUserId: fixture!.sellers[0]!.userId, merchantName: "Original fixture seller", merchantContactId: profile.contactId, providerAccountId: "acct_fixtureSeller0" });
      await tx.insert(subscriptionMerchantScopes).values({ subscriptionId, collectionKind: "destination", providerPlatformAccountId: "acct_fixturePlatform", chargeAccountId: null,
        recipientAccountId: "acct_fixtureSeller0", settlementMerchantAccountId: "acct_fixtureSeller0", taxProfileId: profile.id, taxProfileVersion: profile.currentVersion,
        taxLiability: "seller", taxDestination: { country: "CA", region: "BC" } });
      await tx.insert(subscriptionProviderScheduleResources).values({ subscriptionId, providerSubscriptionRef: "sub_originalBuyer", providerCustomerRef: "cus_originalBuyer", operationRevision: 1, state: "active" });
      const originalRequest = { providerPlatformAccountId: "acct_fixturePlatform", providerCustomerRef: "cus_originalBuyer", subscriptionId, callerCompletionDigest: completionDigest };
      const requestDigest = merchantTaxDigest(originalRequest);
      await tx.insert(subscriptionProviderScheduleOperations).values({ id: operationId, subscriptionId, operationRevision: 1, kind: "create", providerApiVersion: "2026-10-28.endive",
        originalRequest, requestDigest, idempotencyKey: `synthetic-prior-buyer-create:${operationId}` });
      await tx.update(subscriptionProviderScheduleOperations).set({ state: "confirmed", positiveObserved: true, finishedAt: new Date(), providerObservation: { history: [
        { source: "synthetic_prior_provider_create_ack", providerSubscriptionRef: "sub_originalBuyer", providerCustomerRef: "cus_originalBuyer" },
        { source: "physical_caller_finished", operationId, requestDigest, completionDigest },
      ] } }).where(eq(subscriptionProviderScheduleOperations.id, operationId));
      await tx.insert(paymentProviderCustomers).values({ contactId: fixture!.buyer.id, provider: "stripe", providerAccountId: "", providerPlatformAccountId: "acct_fixturePlatform", providerCustomerRef: "cus_originalBuyer" });
      await tx.insert(paymentMethods).values({ contactId: fixture!.buyer.id, provider: "stripe", providerAccountId: "", providerPlatformAccountId: "acct_fixturePlatform",
        providerCustomerRef: "cus_originalBuyer", providerMethodRef: "pm_originalBuyer", kind: "card", label: "Synthetic original saved method", status: "active",
        consentSource: "provider_checkout", consentedAt: new Date(), providerStatusAt: new Date() });
    });
    return { subscriptionId, profile, buyerId: fixture.buyer.id };
  }
  async function originalBuyer() {
    const { subscriptionId, profile, buyerId } = await seedPriorBuyer();
    const request = await createDataRequest.call({ contactId: buyerId, request: { kind: "erasure" } }, OWNER);
    await verifyDataRequest.call({ id: request.id, method: "Synthetic original buyer verified separately from the seller" }, OWNER);
    const erased = await fulfillDataRequest.call({ id: request.id, confirmation: "ERASE" }, OWNER);
    expect(erased.request.status).toBe("in_progress");
    const [cohort] = await db().select().from(subscriptionProviderScheduleErasures).where(and(eq(subscriptionProviderScheduleErasures.requestId, request.id), eq(subscriptionProviderScheduleErasures.privacyScope, "subscriptions.agreements")));
    if (!cohort || cohort.subscriptionId !== subscriptionId) throw new Error("The actual buyer source did not admit its original agreement task.");
    const stop = await getJob(quiesceMerchantSchedules.name, cohort.jobId);
    const moneyIds = await pending("commerce.money", request.id);
    expect(moneyIds).toHaveLength(1);
    const money = await getJob(BUYER_MONEY_ERASURE_JOB, moneyIds[0]!);
    if (!stop || !money) throw new Error("The source receipt named an actual queued task that could not be read.");
    expect(money.data).toMatchObject({ requestId: request.id, originalJobId: money.id, originalAgreementIds: [subscriptionId], originalPaymentIds: [] });
    return { subscriptionId, request, cohort, stop, money, profile, buyerId };
  }

  function provider(subscriptionId: string, pause?: { entered: ReturnType<typeof signal>; release: ReturnType<typeof signal> }) {
    let stopped = false, deletedCustomer = false, subscriptionDeletes = 0, customerDeletes = 0;
    const fetcher = vi.fn<typeof fetch>(async (input, init = {}) => {
      const [active] = await db().execute<{ count: number }>(sql`select count(*)::int as count from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid() and state like 'idle in transaction%'`);
      expect(active?.count).toBe(0);
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url), headers = new Headers(init.headers);
      expect(headers.has("stripe-account")).toBe(false);
      if (url.pathname === "/v1/account") return Response.json({ id: "acct_fixturePlatform" });
      if (url.pathname === "/v1/customers/cus_originalBuyer") {
        if (init.method === "DELETE") { customerDeletes++; deletedCustomer = true; }
        return Response.json({ id: "cus_originalBuyer", deleted: deletedCustomer });
      }
      expect(headers.get("stripe-version")).toBe("2026-10-28.endive");
      const resource = () => ({ id: "sub_originalBuyer", customer: "cus_originalBuyer", status: stopped ? "canceled" : "active", pending_update: null,
        billing_mode: { type: "flexible" }, schedule: null, collection_method: "charge_automatically", transfer_data: { destination: "acct_fixtureSeller0" }, on_behalf_of: "acct_fixtureSeller0",
        metadata: { freeholder_subscription_id: subscriptionId, freeholder_platform_account_id: "acct_fixturePlatform" } });
      if (url.pathname === "/v1/subscriptions/sub_originalBuyer" && init.method === "GET") return Response.json(resource());
      if (url.pathname === "/v1/subscriptions/sub_originalBuyer" && init.method === "DELETE") {
        if (typeof init.body !== "string" && !(init.body instanceof URLSearchParams)) throw new Error("Expected the exact original cancellation form.");
        expect(Object.fromEntries(new URLSearchParams(init.body))).toEqual({ invoice_now: "false", prorate: "false" });
        subscriptionDeletes++; pause?.entered.resolve(); if (pause) await pause.release.promise;
        stopped = true; return Response.json(resource());
      }
      if (url.pathname === "/v1/invoices" && init.method === "GET") return Response.json({ data: [], has_more: false });
      throw new Error(`Unexpected synthetic provider route: ${init.method} ${url.pathname}`);
    });
    const stripe = createStripePayments({ secretKey: "sk_original_buyer_fixture", webhookSecrets: ["whsec_original_buyer_fixture"], apiBase: "https://stripe.example.test", fetch: fetcher });
    fixture!.stripe.cancelMerchantSchedule = stripe.cancelMerchantSchedule!.bind(stripe);
    fixture!.stripe.inspectMerchantScheduleInvoices = stripe.inspectMerchantScheduleInvoices!.bind(stripe);
    fixture!.stripe.eraseCustomer = stripe.eraseCustomer!.bind(stripe);
    return { subscriptionDeletes: () => subscriptionDeletes, customerDeletes: () => customerDeletes, customerDeleted: () => deletedCustomer };
  }
  async function finishMoney(source: Awaited<ReturnType<typeof originalBuyer>>) {
    return finishBuyerMoneyErasure.handler(source.money.data, jobContext(BUYER_MONEY_ERASURE_JOB, source.money.id));
  }
  async function customerTasks(requestId: string) {
    const ids = await pending("commerce.money", requestId);
    const jobs = await Promise.all(ids.map(id => getJob(erasePaymentProviderCustomer.name, id)));
    if (!jobs.length || jobs.some(job => !job)) throw new Error("Expected actual provider-customer tasks in the current money receipt.");
    return jobs.map(job => job!);
  }
  async function runCustomers(requestId: string) {
    for (const job of await customerTasks(requestId)) await erasePaymentProviderCustomer.handler(job.data, jobContext(erasePaymentProviderCustomer.name, job.id));
  }
  async function holdBuyer(buyerId: string) {
    const request = await createDataRequest.call({ contactId: buyerId, request: { kind: "erasure" } }, OWNER);
    return addRetentionException.call({ dataRequestId: request.id, scope: "commerce.money", reason: "accounting_tax", legalBasis: "Synthetic current original-buyer financial hold" }, OWNER);
  }

  it("defers money while the original cancellation caller is paused, then converges the actual buyer jobs without erasing the seller", async () => {
    const source = await originalBuyer(), entered = signal(), release = signal(), physical = provider(source.subscriptionId, { entered, release });
    const worker = quiesceMerchantSchedules.handler(source.stop.data, jobContext(quiesceMerchantSchedules.name, source.stop.id)).then(value => ({ value }), (error: unknown) => ({ error }));
    try {
      expect(await Promise.race([entered.promise.then(() => "entered"), worker.then(() => "ended")])).toBe("entered");
      await expect(finishMoney(source)).rejects.toMatchObject({ code: "conflict" });
      expect(physical.customerDeletes()).toBe(0);
      expect(await db().select().from(paymentProviderCustomers).where(eq(paymentProviderCustomers.contactId, source.buyerId))).toHaveLength(1);
      expect(await db().select().from(paymentMethods).where(eq(paymentMethods.contactId, source.buyerId))).toHaveLength(1);
    } finally { release.resolve(); await worker; }
    expect(await worker).toHaveProperty("value.settled", true);
    expect(physical.subscriptionDeletes()).toBe(1);
    expect(await finishMoney(source)).toMatchObject({ settled: true });
    expect(physical.customerDeletes()).toBe(0);
    expect(await db().select().from(paymentProviderCustomers).where(eq(paymentProviderCustomers.contactId, source.buyerId))).toHaveLength(0);
    await runCustomers(source.request.id);
    expect(physical.customerDeletes()).toBe(1);
    expect((await db().select().from(dataRequests).where(eq(dataRequests.id, source.request.id)))[0]?.status).toBe("completed");
    expect((await db().select().from(merchantTaxProfiles).where(eq(merchantTaxProfiles.id, source.profile.id)))[0]).toMatchObject({ state: "active", contactId: source.profile.contactId });
    expect((await db().select().from(subscriptionMerchantScopes).where(eq(subscriptionMerchantScopes.subscriptionId, source.subscriptionId)))[0]).toMatchObject({ taxDestination: null });
  });

  it("preserves money credentials under a current hold before the finisher and converges only after actual hold release", async () => {
    const source = await originalBuyer(), physical = provider(source.subscriptionId);
    await quiesceMerchantSchedules.handler(source.stop.data, jobContext(quiesceMerchantSchedules.name, source.stop.id));
    const hold = await holdBuyer(source.buyerId);
    await expect(finishMoney(source)).rejects.toMatchObject({ code: "conflict" });
    expect(physical.customerDeletes()).toBe(0);
    expect(await db().select().from(paymentMethods).where(eq(paymentMethods.contactId, source.buyerId))).toHaveLength(1);
    await removeRetentionException.call({ id: hold.id }, OWNER);
    await finishMoney(source); await runCustomers(source.request.id);
    expect(physical.customerDeletes()).toBe(1);
    expect((await db().select().from(dataRequests).where(eq(dataRequests.id, source.request.id)))[0]?.status).toBe("completed");
  });

  it("commits original-artifact recovery without customer I/O or money minimization on parseable corruption", async () => {
    const source = await originalBuyer(), physical = provider(source.subscriptionId);
    const [original] = await db().select().from(dataRequestArtifacts).where(eq(dataRequestArtifacts.dataRequestId, source.request.id));
    const body = { ...z.record(z.string(), z.unknown()).parse(original!.body), note: "Synthetic parseable original-receipt corruption" };
    await db().update(dataRequestArtifacts).set({ body }).where(eq(dataRequestArtifacts.id, original!.id));
    await expect(finishMoney(source)).rejects.toMatchObject({ code: "conflict" });
    expect(physical.subscriptionDeletes()).toBe(0); expect(physical.customerDeletes()).toBe(0);
    expect(await db().select().from(paymentProviderCustomers).where(eq(paymentProviderCustomers.contactId, source.buyerId))).toHaveLength(1);
    const [after] = await db().select().from(dataRequestArtifacts).where(eq(dataRequestArtifacts.id, original!.id));
    expect(after).toMatchObject({ body, sha256: original!.sha256 });
    expect((await db().select().from(dataRequests).where(eq(dataRequests.id, source.request.id)))[0]).toMatchObject({ status: "in_progress", fulfilledAt: null });
  });

  it("rechecks a new hold on the actual customer job after money completion and before any provider-customer DELETE", async () => {
    const source = await originalBuyer(), physical = provider(source.subscriptionId);
    await quiesceMerchantSchedules.handler(source.stop.data, jobContext(quiesceMerchantSchedules.name, source.stop.id));
    await finishMoney(source);
    const [job] = await customerTasks(source.request.id), before = structuredClone(job!.data), hold = await holdBuyer(source.buyerId);
    await expect(erasePaymentProviderCustomer.handler(job!.data, jobContext(erasePaymentProviderCustomer.name, job!.id))).rejects.toMatchObject({ code: "conflict" });
    expect(physical.customerDeleted()).toBe(false); expect(physical.customerDeletes()).toBe(0);
    expect((await getJob(erasePaymentProviderCustomer.name, job!.id))?.data).toEqual(before);
    await removeRetentionException.call({ id: hold.id }, OWNER);
    await runCustomers(source.request.id);
    expect(physical.customerDeletes()).toBe(1);
    expect((await db().select().from(dataRequests).where(eq(dataRequests.id, source.request.id)))[0]?.status).toBe("completed");
  });

  it("keeps original provider debt pending after a restored local billing mode changes", async () => {
    const prior = await seedPriorBuyer(), physical = provider(prior.subscriptionId);
    // A declared recovery fixture, not a newly accepted manual agreement:
    // original create/route/resource facts stay intact while local state has
    // changed. applyPendingPlan can write this local field; it is not stop proof.
    await db().update(subscriptions).set({ billingMode: "manual" }).where(eq(subscriptions.id, prior.subscriptionId));
    const request = await createDataRequest.call({ contactId: prior.buyerId, request: { kind: "erasure" } }, OWNER);
    await verifyDataRequest.call({ id: request.id, method: "Synthetic restored buyer history with original provider resource still live" }, OWNER);
    const result = await fulfillDataRequest.call({ id: request.id, confirmation: "ERASE" }, OWNER);
    expect((await db().select().from(subscriptionProviderScheduleResources).where(eq(subscriptionProviderScheduleResources.subscriptionId, prior.subscriptionId)))[0])
      .toMatchObject({ state: "active", providerSubscriptionRef: "sub_originalBuyer", operationRevision: 1 });
    const agreement = receipt.parse(result.artifact.body).outcomes.find(outcome => outcome.scope === "subscriptions.agreements");
    expect(agreement).toMatchObject({ outcome: "pending" });
    expect(agreement?.pendingJobs?.length).toBeGreaterThan(0);
    expect(await db().select().from(paymentProviderCustomers).where(eq(paymentProviderCustomers.contactId, prior.buyerId))).toHaveLength(1);
    expect(physical.subscriptionDeletes()).toBe(0); expect(physical.customerDeletes()).toBe(0);
  });

});
