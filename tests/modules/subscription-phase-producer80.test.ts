// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: the actual phase producer consumes the actual HTTP adapter DTO.
// Fictional people, provider attachment and HTTP responses; no real account
// acceptance. No subscription, terms, operation, nonce or cash history is seeded.
import { createHash, createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as paymentAdapters from "@/adapters/payments";
import { createStripePayments } from "@/adapters/payments/stripe";
import { db } from "@/core/db";
import { stopJobs } from "@/core/jobs";
import { ready } from "@/core/runtime";
import { setModuleEnabled } from "@/core/settings/service";
import { cartItems, productVariants } from "@/modules/catalog/schema";
import { listSavedPaymentMethods, processPaymentProviderEvents } from "@/modules/invoicing/payment-provider-service";
import { quoteNewAgreement } from "@/modules/subscriptions/merchant-terms-quote";
import { createMerchantPhaseProduct } from "@/modules/subscriptions/provider-phase-products";
import { admitMerchantProviderPhases } from "@/modules/subscriptions/provider-phase-dispatch";
import { quoteMerchantProviderHorizon } from "@/modules/subscriptions/provider-phase-quote";
import { subscriptionProviderScheduleOperations, subscriptionProviderScheduleResources } from "@/modules/subscriptions/provider-schedule-schema";
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
function edge() {
  let product: Record<string, unknown> | undefined, schedule: Record<string, unknown> | undefined;
  const prices = new Map<string, Record<string, unknown>>(); let productPosts = 0, schedulePosts = 0;
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
        billing_mode: { type: form.get("billing_mode[type]") }, status: "not_started", end_behavior: form.get("end_behavior"), metadata: metadata(form, "metadata"), pause_schedules: [], current_phase: null,
        default_settings: { collection_method: form.get("default_settings[collection_method]"), default_payment_method: form.get("default_settings[default_payment_method]"), automatic_tax: { enabled: false }, ...route("default_settings") }, phases };
      return Response.json(schedule);
    }
    if (url.pathname === "/v1/subscription_schedules/sub_sched_actualProducer" && init.method === "GET" && schedule) return Response.json(schedule);
    if (init.method === "GET" && prices.has(url.pathname.slice("/v1/prices/".length))) return Response.json(prices.get(url.pathname.slice("/v1/prices/".length)));
    throw new Error(`Unexpected synthetic original provider request: ${init.method} ${url.pathname}`);
  });
  return { provider: createStripePayments({ secretKey: "sk_actual_producer_fixture", webhookSecrets: ["whsec_actual_producer_fixture"], apiBase: "https://stripe.example.test", fetch: fetcher }),
    productPosts: () => productPosts, schedulePosts: () => schedulePosts };
}

describe.runIf(hasDatabase)("actual original merchant phase producer (C12.38)", { timeout: 60000 }, () => {
  let fixture: Awaited<ReturnType<typeof seedMerchantCheckout80>> | undefined;
  beforeAll(ready, 60000); beforeEach(truncateSpine);
  afterEach(() => { fixture?.cleanup(); fixture = undefined; vi.restoreAllMocks(); });
  afterAll(async () => { await stopJobs(); await closeDb(); });
  it("confirms the actual not-started phase producer from its real adapter DTO and retained original caller", async () => {
    fixture = await seedMerchantCheckout80("destination", 1);
    const { provider, productPosts, schedulePosts } = edge(); vi.spyOn(paymentAdapters, "paymentAdapter").mockReturnValue(provider);
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
    const result = await admitMerchantProviderPhases.call({ subscriptionId: accepted.subscription.id, additionalPeriods: 1, expectedHorizonDigest: horizon.horizonDigest }, { kind: "system" });
    expect(productPosts()).toBe(1); expect(schedulePosts()).toBe(1);
    const operations = await db().select().from(subscriptionProviderScheduleOperations).where(eq(subscriptionProviderScheduleOperations.subscriptionId, accepted.subscription.id)).orderBy(subscriptionProviderScheduleOperations.operationRevision);
    expect(operations).toHaveLength(2); expect(operations[1]?.positiveObserved).toBe(true);
    expect(operations[1]?.providerObservation.history).toContainEqual(expect.objectContaining({ source: "physical_caller_finished", operationId: operations[1]?.id, outcome: "returned" }));
    // Unchanged BEFORE/AFTER oracle. The fixture never manufactures version: 1
    // in an adapter result; only the core owns its retained projection version.
    expect(result.verified).toBe(true);
    const [resource] = await db().select().from(subscriptionProviderScheduleResources).where(eq(subscriptionProviderScheduleResources.subscriptionId, accepted.subscription.id));
    expect(resource).toMatchObject({ state: "active", recoveryPending: false, providerSubscriptionRef: null, providerCustomerRef: "cus_actualProducer" });
    expect(operations[1]?.providerObservation.phaseInventory).toMatchObject({ version: 1, providerScheduleRef: "sub_sched_actualProducer", providerSubscriptionRef: null, status: "not_started" });
  });
});
