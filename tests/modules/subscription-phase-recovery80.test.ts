// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: the actual phase producer consumes the actual HTTP adapter DTO.
// Fictional people, provider attachment and HTTP responses; no real account
// acceptance. No subscription, terms, operation, nonce or cash history is seeded.
import { createHash, createHmac } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as paymentAdapters from "@/adapters/payments";
import { createStripePayments } from "@/adapters/payments/stripe";
import { db } from "@/core/db";
import { z } from "zod";
import { getJob, stopJobs } from "@/core/jobs";
import { createDataRequest, fulfillDataRequest, verifyDataRequest } from "@/core/privacy/service";
import { ready } from "@/core/runtime";
import { setModuleEnabled } from "@/core/settings/service";
import { cartItems, productVariants } from "@/modules/catalog/schema";
import { listSavedPaymentMethods, processPaymentProviderEvents } from "@/modules/invoicing/payment-provider-service";
import { quoteNewAgreement } from "@/modules/subscriptions/merchant-terms-quote";
import { createMerchantPhaseProduct } from "@/modules/subscriptions/provider-phase-products";
import { admitMerchantProviderPhases } from "@/modules/subscriptions/provider-phase-dispatch";
import { quoteMerchantProviderHorizon } from "@/modules/subscriptions/provider-phase-quote";
import { quiesceMerchantSchedules } from "@/modules/subscriptions/merchant-tax-quiescence";
import { recoverMerchantSchedule } from "@/modules/subscriptions/provider-schedule-recovery";
import { stopMerchantPhaseSchedules } from "@/modules/subscriptions/provider-phase-stop";
import { closedOriginalPhaseSchedules } from "@/modules/subscriptions/provider-phase-resources";
import { subscriptionProviderScheduleErasures, subscriptionProviderScheduleOperations, subscriptionProviderScheduleResources } from "@/modules/subscriptions/provider-schedule-schema";
import { savePlan, subscribe } from "@/modules/subscriptions/service";
import { seedMerchantCheckout80 } from "../helpers/merchant-checkout80";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

function metadata(form: URLSearchParams, prefix: string) {
  return Object.fromEntries([...form].filter(([key]) => key.startsWith(`${prefix}[`) && key.endsWith("]")).map(([key, value]) => [key.slice(prefix.length + 1, -1), value]));
}
function originalForm(init: RequestInit) {
  if (typeof init.body !== "string" && !(init.body instanceof URLSearchParams)) throw new Error("Missing actual original form");
  return new URLSearchParams(init.body);
}
function edge(options: { failFirstPrice?: boolean; loseCancelReply?: boolean; unpaidInvoice?: boolean } = {}) {
  let product: Record<string, unknown> | undefined, schedule: Record<string, unknown> | undefined;
  const prices = new Map<string, Record<string, unknown>>(); let productPosts = 0, schedulePosts = 0, cancelPosts = 0, linkedDeletes = 0, intentPosts = 0, voidPosts = 0;
  let failPrice = options.failFirstPrice === true, canceledIntent = false, voidedInvoice = false, linkedCanceled = false;
  const fetcher = vi.fn<typeof fetch>(async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url), headers = new Headers(init.headers);
    expect(url.origin).toBe("https://stripe.example.test"); expect(headers.has("stripe-account")).toBe(false);
    if (url.pathname === "/v1/account") return Response.json({ id: "acct_fixturePlatform" });
    expect(headers.get("stripe-version")).toBe("2026-10-28.endive");
    if (url.pathname === "/v1/products" && init.method === "POST") {
      productPosts++; const form = originalForm(init);
      product = { id: "prod_actualProducer", object: "product", name: form.get("name"), active: form.get("active") === "true", metadata: metadata(form, "metadata") };
      return Response.json(product);
    }
    if (url.pathname === "/v1/products/prod_actualProducer" && init.method === "GET" && product) return Response.json(product);
    if (url.pathname === "/v1/subscription_schedules" && init.method === "POST") {
      schedulePosts++; const form = originalForm(init), phases: Array<Record<string, unknown>> = []; let start = Number(form.get("start_date"));
      const route = (prefix: string) => ({ transfer_data: { destination: form.get(`${prefix}[transfer_data][destination]`) }, on_behalf_of: form.get(`${prefix}[on_behalf_of]`) });
      for (let index = 0; form.has(`phases[${index}][end_date]`); index++) {
        const key = `phases[${index}]`, priceKey = `price_actualProducer${index}`, end = Number(form.get(`${key}[end_date]`));
        prices.set(priceKey, { id: priceKey, object: "price", product: form.get(`${key}[items][0][price_data][product]`), currency: form.get(`${key}[items][0][price_data][currency]`),
          unit_amount: Number(form.get(`${key}[items][0][price_data][unit_amount]`)), billing_scheme: "per_unit", type: "recurring", tax_behavior: form.get(`${key}[items][0][price_data][tax_behavior]`), transform_quantity: null,
          recurring: { interval: form.get(`${key}[items][0][price_data][recurring][interval]`), interval_count: Number(form.get(`${key}[items][0][price_data][recurring][interval_count]`)), usage_type: "licensed" } });
        phases.push({ start_date: start, end_date: end, currency: form.get(`${key}[currency]`), collection_method: form.get(`${key}[collection_method]`),
          default_payment_method: form.get(`${key}[default_payment_method]`), application_fee_percent: Number(form.get(`${key}[application_fee_percent]`)), ...route(key), automatic_tax: { enabled: false },
          default_tax_rates: [], add_invoice_items: [], discounts: [], billing_thresholds: null, trial_end: null, proration_behavior: form.get(`${key}[proration_behavior]`), billing_cycle_anchor: form.get(`${key}[billing_cycle_anchor]`),
          metadata: metadata(form, `${key}[metadata]`), items: [{ price: priceKey, quantity: 1, tax_rates: [], discounts: [], billing_thresholds: null }] });
        start = end;
      }
      schedule = { id: "sub_sched_actualProducer", object: "subscription_schedule", customer: form.get("customer"), subscription: null, released_subscription: null,
        created: Math.floor(Date.now() / 1000), canceled_at: null, billing_mode: { type: form.get("billing_mode[type]") }, status: "not_started", end_behavior: form.get("end_behavior"), metadata: metadata(form, "metadata"), pause_schedules: [], current_phase: null,
        default_settings: { collection_method: form.get("default_settings[collection_method]"), default_payment_method: form.get("default_settings[default_payment_method]"), automatic_tax: { enabled: false }, ...route("default_settings") }, phases };
      return Response.json(schedule);
    }
    if (url.pathname === "/v1/subscription_schedules/sub_sched_actualProducer/cancel" && init.method === "POST" && schedule) {
      cancelPosts++; schedule = { ...schedule, status: "canceled", canceled_at: Math.floor(Date.now() / 1000), current_phase: null };
      if (options.loseCancelReply) throw new Error("Synthetic original cancellation reply lost after acceptance");
      return Response.json(schedule);
    }
    const firstPhase = schedule && Array.isArray(schedule.phases) ? schedule.phases[0] as Record<string, unknown> : undefined;
    const firstPrice = prices.get("price_actualProducer0"), amount = firstPrice?.unit_amount;
    const originalInvoice = () => ({ id: "in_actualProducer", object: "invoice", customer: "cus_actualProducer", subscription: "sub_actualProducer", currency: "cad", status: voidedInvoice ? "void" : "open",
      total: amount, amount_paid: 0, amount_remaining: voidedInvoice ? 0 : amount, period_start: firstPhase?.start_date });
    if (url.pathname === "/v1/subscriptions/sub_actualProducer" && options.unpaidInvoice) {
      if (init.method === "DELETE") { linkedDeletes++; linkedCanceled = true; }
      return Response.json({ id: "sub_actualProducer", customer: "cus_actualProducer", status: linkedCanceled ? "canceled" : "active", pending_update: null,
        billing_mode: { type: "flexible" }, schedule: "sub_sched_actualProducer", collection_method: "charge_automatically", transfer_data: { destination: "acct_fixtureSeller0" }, on_behalf_of: "acct_fixtureSeller0",
        metadata: schedule?.metadata });
    }
    if (url.pathname === "/v1/invoices" && init.method === "GET" && options.unpaidInvoice) return Response.json({ data: [originalInvoice()], has_more: false });
    if (url.pathname === "/v1/invoices/in_actualProducer/void" && init.method === "POST" && options.unpaidInvoice) { voidPosts++; voidedInvoice = true; return Response.json(originalInvoice()); }
    if (url.pathname === "/v1/invoices/in_actualProducer" && init.method === "GET" && options.unpaidInvoice) return Response.json(originalInvoice());
    if (url.pathname === "/v1/invoice_payments" && init.method === "GET" && options.unpaidInvoice) return Response.json({ data: [{ id: "inpay_actualProducer", invoice: "in_actualProducer", status: canceledIntent ? "canceled" : "open", currency: "cad", amount_requested: amount, amount_paid: 0,
      payment: { type: "payment_intent", payment_intent: "pi_actualProducer" } }], has_more: false });
    if (url.pathname.startsWith("/v1/payment_intents/pi_actualProducer") && options.unpaidInvoice) {
      if (url.pathname.endsWith("/cancel") && init.method === "POST") { intentPosts++; canceledIntent = true; }
      else if (url.pathname !== "/v1/payment_intents/pi_actualProducer" || init.method !== "GET") throw new Error("Unexpected original PI mutation");
      return Response.json({ id: "pi_actualProducer", object: "payment_intent", customer: "cus_actualProducer", status: canceledIntent ? "canceled" : "requires_payment_method", amount, amount_received: 0, amount_capturable: 0, currency: "cad" });
    }
    if (url.pathname === "/v1/subscription_schedules/sub_sched_actualProducer" && init.method === "GET" && schedule) return Response.json(schedule);
    if (init.method === "GET" && prices.has(url.pathname.slice("/v1/prices/".length))) { if (failPrice) { failPrice = false; throw new Error("Synthetic original price read unavailable once"); } return Response.json(prices.get(url.pathname.slice("/v1/prices/".length))); }
    throw new Error(`Unexpected synthetic original provider request: ${init.method} ${url.pathname}`);
  });
  return { provider: createStripePayments({ secretKey: "sk_actual_producer_fixture", webhookSecrets: ["whsec_actual_producer_fixture"], apiBase: "https://stripe.example.test", fetch: fetcher }),
    productPosts: () => productPosts, schedulePosts: () => schedulePosts, cancelPosts: () => cancelPosts, linkedDeletes: () => linkedDeletes, intentPosts: () => intentPosts, voidPosts: () => voidPosts,
    activate: () => {
      if (!schedule || !Array.isArray(schedule.phases)) throw new Error("Create the actual original schedule before its first phase starts");
      const phase = schedule.phases[0] as Record<string, unknown>;
      vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Number(phase.start_date) * 1000);
      schedule = { ...schedule, status: "active", subscription: "sub_actualProducer", current_phase: { start_date: phase.start_date, end_date: phase.end_date } };
    } };
}

describe.runIf(hasDatabase)("actual original phase read and invoice stop lifecycle (C12.38/C1.08)", { timeout: 60000 }, () => {
  let fixture: Awaited<ReturnType<typeof seedMerchantCheckout80>> | undefined;
  beforeAll(ready, 60000); beforeEach(truncateSpine);
  afterEach(() => { vi.useRealTimers(); fixture?.cleanup(); fixture = undefined; vi.restoreAllMocks(); });
  afterAll(async () => { await stopJobs(); await closeDb(); });
  async function original(options: Parameters<typeof edge>[0] = {}) {
    fixture = await seedMerchantCheckout80("destination", 1);
    const remote = edge(options), { provider } = remote; vi.spyOn(paymentAdapters, "paymentAdapter").mockReturnValue(provider);
    await setModuleEnabled.call({ module: "subscriptions", enabled: true }, OWNER);
    const receivedAt = new Date().toISOString(), timestamp = Math.floor(Date.parse(receivedAt) / 1000);
    const body = Buffer.from(JSON.stringify({ id: "evt_actualProducerMethod", type: "payment_method.attached", created: timestamp, data: { object: {
      id: "pm_actualProducer", object: "payment_method", type: "card", customer: "cus_actualProducer", card: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2030 },
      metadata: { freeholder_contact_id: fixture.buyer.id, freeholder_platform_account_id: "acct_fixturePlatform" } } } }));
    const signature = createHmac("sha256", "whsec_actual_producer_fixture").update(`${timestamp}.`).update(body).digest("hex");
    const events = await provider.verifyWebhook({ body, receivedAt, headers: { "stripe-signature": `t=${timestamp},v1=${signature}` } });
    expect(events).toHaveLength(1);
    await processPaymentProviderEvents.call({ provider: "stripe", bodySha256: createHash("sha256").update(body).digest("hex"), receivedAt, events: [...events] }, { kind: "system" });
    const saved = await listSavedPaymentMethods.call({ contactId: fixture.buyer.id }, OWNER); expect(saved).toHaveLength(1);
    const [item] = await db().select({ variant: productVariants }).from(cartItems).innerJoin(productVariants, eq(productVariants.id, cartItems.variantId)).where(eq(cartItems.cartId, fixture.cart.id)).limit(1);
    if (!item || !saved[0]) throw new Error("The actual original fixture has no variant or saved method.");
    const plan = await savePlan.call({ productId: item.variant.productId, name: "Actual original provider trial", interval: "month", trialDays: 7, trialRequiresCard: true, setupFeeMinor: 500,
      billingMode: "provider", cancelBehaviour: "period_end", proration: "none", status: "active" }, OWNER);
    const input = { planId: plan.id, productVariantId: item.variant.id, contactId: fixture.buyer.id, paymentMethodId: saved[0].id, currency: "CAD", taxDestination: { country: "CA", region: "BC" } };
    const quote = await quoteNewAgreement.call(input, OWNER); if (!quote) throw new Error("The real provider quote unexpectedly selected legacy terms.");
    const accepted = await subscribe.call({ ...input, commercialTerms: { quoteDigest: quote.quoteDigest, locale: "en", source: "owner_subscription" } }, OWNER);
    expect(accepted.invoiceId).toBeNull(); expect(accepted.subscription.status).toBe("trialing");
    await createMerchantPhaseProduct.call({ subscriptionId: accepted.subscription.id }, { kind: "system" });
    const horizon = await quoteMerchantProviderHorizon.call({ subscriptionId: accepted.subscription.id, additionalPeriods: 1 }, { kind: "system" });
    const create = () => admitMerchantProviderPhases.call({ subscriptionId: accepted.subscription.id, additionalPeriods: 1, expectedHorizonDigest: horizon.horizonDigest }, { kind: "system" });
    const operations = () => db().select().from(subscriptionProviderScheduleOperations).where(eq(subscriptionProviderScheduleOperations.subscriptionId, accepted.subscription.id)).orderBy(subscriptionProviderScheduleOperations.operationRevision);
    return { remote, accepted, create, operations };
  }
  async function erasure(subscriptionId: string) {
    if (!fixture) throw new Error("Create the actual original buyer first");
    const request = await createDataRequest.call({ contactId: fixture.buyer.id, request: { kind: "erasure" } }, OWNER);
    await verifyDataRequest.call({ id: request.id, method: "Synthetic original buyer verification" }, OWNER);
    await fulfillDataRequest.call({ id: request.id, confirmation: "ERASE" }, OWNER);
    const [cohort] = await db().select().from(subscriptionProviderScheduleErasures).where(and(eq(subscriptionProviderScheduleErasures.requestId, request.id), eq(subscriptionProviderScheduleErasures.subscriptionId, subscriptionId)));
    if (!cohort) throw new Error("The real privacy service did not retain the original agreement task");
    const job = await getJob(quiesceMerchantSchedules.name, cohort.jobId);
    if (!job) throw new Error("The original retained privacy task has no actual queued job");
    const input = z.object({ profileId: z.uuid(), requestId: z.uuid(), cohortId: z.uuid(), originalJobId: z.uuid() }).parse(job.data);
    expect(input.originalJobId).toBe(job.id); return { input, job };
  }
  it("recovers the actual failed commercial GET after the original POST and caller finish without another creation", async () => {
    const source = await original({ failFirstPrice: true }); await expect(source.create()).rejects.toMatchObject({ code: "provider_failure" });
    const before = await source.operations(), creator = before.find(operation => operation.kind === "create");
    if (!creator) throw new Error("The original phase creator was not retained");
    expect(creator.state).toBe("unknown"); expect(creator.positiveObserved).toBe(true);
    const result = await recoverMerchantSchedule.call({ operationId: creator.id }, { kind: "system" }); expect(result.verified).toBe(true);
    expect(source.remote.productPosts()).toBe(1); expect(source.remote.schedulePosts()).toBe(1);
    const after = (await source.operations()).find(operation => operation.id === creator.id);
    expect(after?.state).toBe("confirmed");
    const [resource] = await db().select().from(subscriptionProviderScheduleResources).where(eq(subscriptionProviderScheduleResources.subscriptionId, source.accepted.subscription.id));
    expect(resource).toMatchObject({ state: "active", recoveryPending: false, providerSubscriptionRef: null });
    expect(after?.providerObservation.history).toContainEqual(expect.objectContaining({ source: "physical_caller_finished", outcome: "threw" }));
    expect(after?.providerObservation.history).toContainEqual(expect.objectContaining({ source: "schedule_read_finished", outcome: "returned", verified: true }));
  });
  it("recovers a genuinely lost primary cancel reply with its separate GET and never sends the cancel twice", async () => {
    const source = await original({ loseCancelReply: true }); expect((await source.create()).verified).toBe(true);
    const { input } = await erasure(source.accepted.subscription.id);
    await expect(stopMerchantPhaseSchedules(input)).rejects.toMatchObject({ code: "provider_failure" });
    const before = await source.operations(), canceled = before.find(operation => operation.originalRequest.resourceKind === "phase_schedule_stop");
    expect(canceled?.state).toBe("unknown"); expect(source.remote.cancelPosts()).toBe(1);
    await stopMerchantPhaseSchedules(input); expect(source.remote.cancelPosts()).toBe(1);
    const after = await source.operations(), stopped = after.find(operation => operation.id === canceled?.id);
    expect(stopped?.state).toBe("confirmed"); expect(stopped?.providerObservation.history).toContainEqual(expect.objectContaining({ source: "physical_caller_finished", outcome: "threw" }));
    expect(stopped?.providerObservation.history).toContainEqual(expect.objectContaining({ source: "schedule_read_finished", outcome: "returned", verified: true }));
    expect(closedOriginalPhaseSchedules(after)).toHaveLength(1);
  });
  it("runs the retained original job body through actual unpaid PI cancellation and invoice void callers", async () => {
    const source = await original({ unpaidInvoice: true }); expect((await source.create()).verified).toBe(true);
    source.remote.activate(); // Synthetic provider/test clock reaches the actually admitted first paid phase.
    const creator = (await source.operations()).find(operation => operation.kind === "create"); if (!creator) throw new Error("Missing actual original creator");
    expect((await recoverMerchantSchedule.call({ operationId: creator.id }, { kind: "system" })).verified).toBe(true);
    const { job } = await erasure(source.accepted.subscription.id);
    // Actual durable payload; the registered worker builds every service context.
    // This is a worker-body control, not a live queue lease or provider account acceptance.
    await quiesceMerchantSchedules.handler(job.data);
    expect(source.remote.schedulePosts()).toBe(1); expect(source.remote.cancelPosts()).toBe(1); expect(source.remote.linkedDeletes()).toBe(1);
    expect(source.remote.intentPosts()).toBe(1); expect(source.remote.voidPosts()).toBe(1);
    const operations = await source.operations(), actions = operations.filter(operation => operation.originalRequest.resourceKind === "invoice_stop");
    expect(actions).toHaveLength(2);
    for (const action of actions) { expect(action.state).toBe("confirmed"); expect(action.providerObservation.history).toContainEqual(expect.objectContaining({ source: "physical_caller_finished", outcome: "returned", operationId: action.id, requestDigest: action.requestDigest })); }
    const [resource] = await db().select().from(subscriptionProviderScheduleResources).where(eq(subscriptionProviderScheduleResources.subscriptionId, source.accepted.subscription.id));
    expect(resource).toMatchObject({ state: "quiesced", recoveryPending: false });
  });
});
