// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38 native source fixture: real ordinary producers and Stripe HTTP adapter.
// Only fictional identity/bank attachment and provider HTTP responses are synthetic.
import { createHash, createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, vi } from "vitest";
import * as paymentAdapters from "@/adapters/payments";
import { createStripePayments } from "@/adapters/payments/stripe";
import { db } from "@/core/db";
import { setModuleEnabled } from "@/core/settings/service";
import { cartItems, productVariants } from "@/modules/catalog/schema";
import { recordOfflinePayment,listSavedPaymentMethods, processPaymentProviderEvents } from "@/modules/invoicing/payment-provider-service";
import { recordCommercialFee } from "@/modules/invoicing/commercial-attestations";
import { quoteNewAgreement } from "@/modules/subscriptions/merchant-terms-quote";
import { createMerchantPhaseProduct } from "@/modules/subscriptions/provider-phase-products";
import { admitMerchantProviderPhases } from "@/modules/subscriptions/provider-phase-dispatch";
import { quoteMerchantProviderHorizon } from "@/modules/subscriptions/provider-phase-quote";
import { subscriptionProviderScheduleOperations } from "@/modules/subscriptions/provider-schedule-schema";
import { savePlan, subscribe } from "@/modules/subscriptions/service";
import { seedMerchantCheckout80 } from "./merchant-checkout80";
import { OWNER } from "./spine";

function metadata(form: URLSearchParams, prefix: string) {
  return Object.fromEntries([...form].filter(([key]) => key.startsWith(`${prefix}[`) && key.endsWith("]")).map(([key, value]) => [key.slice(prefix.length + 1, -1), value]));
}
function originalForm(init: RequestInit) {
  if (typeof init.body !== "string" && !(init.body instanceof URLSearchParams)) throw new Error("Missing actual original form");
  return new URLSearchParams(init.body);
}
export function merchantPhaseEdge80(options: { failFirstPrice?: boolean; loseCancelReply?: boolean; unpaidInvoice?: boolean; extra?: (url: URL, init: RequestInit) => Promise<Response | null> } = {}) {
  let product: Record<string, unknown> | undefined, schedule: Record<string, unknown> | undefined;
  const schedules = new Map<string, Record<string, unknown>>();
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
        const key = `phases[${index}]`, priceKey = `price_actualProducer${schedulePosts}p${index}`, end = Number(form.get(`${key}[end_date]`));
        prices.set(priceKey, { id: priceKey, object: "price", product: form.get(`${key}[items][0][price_data][product]`), currency: form.get(`${key}[items][0][price_data][currency]`),
          unit_amount: Number(form.get(`${key}[items][0][price_data][unit_amount]`)), billing_scheme: "per_unit", type: "recurring", tax_behavior: form.get(`${key}[items][0][price_data][tax_behavior]`), transform_quantity: null,
          recurring: { interval: form.get(`${key}[items][0][price_data][recurring][interval]`), interval_count: Number(form.get(`${key}[items][0][price_data][recurring][interval_count]`)), usage_type: "licensed" } });
        phases.push({ start_date: start, end_date: end, currency: form.get(`${key}[currency]`), collection_method: form.get(`${key}[collection_method]`),
          default_payment_method: form.get(`${key}[default_payment_method]`), application_fee_percent: Number(form.get(`${key}[application_fee_percent]`)), ...route(key), automatic_tax: { enabled: false },
          default_tax_rates: [], add_invoice_items: [], discounts: [], billing_thresholds: null, trial_end: null, proration_behavior: form.get(`${key}[proration_behavior]`), billing_cycle_anchor: form.get(`${key}[billing_cycle_anchor]`),
          metadata: metadata(form, `${key}[metadata]`), items: [{ price: priceKey, quantity: 1, tax_rates: [], discounts: [], billing_thresholds: null }] });
        start = end;
      }
      schedule = { id: `sub_sched_actualProducer${schedulePosts}`, object: "subscription_schedule", customer: form.get("customer"), subscription: null, released_subscription: null,
        created: Math.floor(Date.now() / 1000), canceled_at: null, billing_mode: { type: form.get("billing_mode[type]") }, status: "not_started", end_behavior: form.get("end_behavior"), metadata: metadata(form, "metadata"), pause_schedules: [], current_phase: null,
        default_settings: { collection_method: form.get("default_settings[collection_method]"), default_payment_method: form.get("default_settings[default_payment_method]"), automatic_tax: { enabled: false }, ...route("default_settings") }, phases };
      schedules.set(String(schedule.id), schedule); return Response.json(schedule);
    }
    if (/^\/v1\/subscription_schedules\/sub_sched_actualProducer[0-9]+\/cancel$/.test(url.pathname) && init.method === "POST" && schedule) {
      cancelPosts++; const original = schedules.get(url.pathname.split("/")[3]!); if (!original) throw new Error("Unknown admitted original schedule"); schedule = { ...original, status: "canceled", canceled_at: Math.floor(Date.now() / 1000), current_phase: null };
      schedules.set(String(schedule.id), schedule);
      if (options.loseCancelReply) throw new Error("Synthetic original cancellation reply lost after acceptance");
      return Response.json(schedule);
    }
    const firstPhase = schedule && Array.isArray(schedule.phases) ? schedule.phases[0] as Record<string, unknown> : undefined;
    const firstPrice = prices.get("price_actualProducer1p0"), amount = firstPrice?.unit_amount;
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
    if (url.pathname.startsWith("/v1/subscription_schedules/") && init.method === "GET" && schedules.has(url.pathname.split("/")[3]!)) return Response.json(schedules.get(url.pathname.split("/")[3]!));
    if (url.pathname === "/v1/subscriptions" && init.method === "GET") return Response.json({ data: [], has_more: false });
    if (url.pathname === "/v1/invoices" && init.method === "GET" && !options.unpaidInvoice) return Response.json({ data: [], has_more: false });
    if (init.method === "GET" && prices.has(url.pathname.slice("/v1/prices/".length))) { if (failPrice) { failPrice = false; throw new Error("Synthetic original price read unavailable once"); } return Response.json(prices.get(url.pathname.slice("/v1/prices/".length))); }
    const extra = await options.extra?.(url, init); if (extra) return extra;
    throw new Error(`Unexpected synthetic original provider request: ${init.method} ${url.pathname}`);
  });
  return { provider: createStripePayments({ secretKey: "sk_actual_producer_fixture", webhookSecrets: ["whsec_actual_producer_fixture"], apiBase: "https://stripe.example.test", fetch: fetcher }),
    schedule: () => schedule, prices: () => prices,
    productPosts: () => productPosts, schedulePosts: () => schedulePosts, cancelPosts: () => cancelPosts, linkedDeletes: () => linkedDeletes, intentPosts: () => intentPosts, voidPosts: () => voidPosts,
    activate: () => {
      if (!schedule || !Array.isArray(schedule.phases)) throw new Error("Create the actual original schedule before its first phase starts");
      const phase = schedule.phases[0] as Record<string, unknown>;
      vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Number(phase.start_date) * 1000);
      schedule = { ...schedule, status: "active", subscription: "sub_actualProducer", current_phase: { start_date: phase.start_date, end_date: phase.end_date } };
      schedules.set(String(schedule.id), schedule);
    } };
}

export async function seedActualProviderSubscription80(options: Parameters<typeof merchantPhaseEdge80>[0] & {
  /** Explicit actual shared-money test variant; default historical trial unchanged. */
  paidProrationDay?:true;
} = {}) {
    const fixture = await seedMerchantCheckout80("destination", 1);
    try {
    const remote = merchantPhaseEdge80(options), { provider } = remote; vi.spyOn(paymentAdapters, "paymentAdapter").mockReturnValue(provider);
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
    const plan = await savePlan.call({ productId: item.variant.productId, name: options.paidProrationDay?"Actual original provider paid day":"Actual original provider trial", interval: options.paidProrationDay?"day":"month", trialDays: options.paidProrationDay?0:7, trialRequiresCard: !options.paidProrationDay, setupFeeMinor: options.paidProrationDay?0:500,
      billingMode: "provider", cancelBehaviour: "period_end", proration: options.paidProrationDay?"create_prorations":"none", status: "active" }, OWNER);
    const input = { planId: plan.id, productVariantId: item.variant.id, contactId: fixture.buyer.id, paymentMethodId: saved[0].id, currency: "CAD", taxDestination: { country: "CA", region: "BC" } };
    const quote = await quoteNewAgreement.call(input, OWNER); if (!quote) throw new Error("The real provider quote unexpectedly selected legacy terms.");
    const accepted = await subscribe.call({ ...input, commercialTerms: { quoteDigest: quote.quoteDigest, locale: "en", source: "owner_subscription" } }, OWNER);
    if(options.paidProrationDay){
      if(!accepted.invoiceId)throw new Error("The actual original paid provider period needs its ordinary issued invoice.");
      const payment=await recordOfflinePayment.call({invoiceId:accepted.invoiceId,method:"bank_transfer",amountMinor:4200,reference:"fictional-controlled-original-principal",evidence:"Explicit fictional external original principal attestation; never bank verification",idempotencyKey:"controlled-original-principal"},OWNER);
      await recordCommercialFee.call({paymentId:payment.id,amountMinor:400,reference:"fictional-controlled-original-fee",evidence:"Explicit fictional external original fee remittance attestation",idempotencyKey:"controlled-original-fee"},OWNER);
      expect(accepted.subscription.status).toBe("active");
    }else{expect(accepted.invoiceId).toBeNull(); expect(accepted.subscription.status).toBe("trialing");}
    await createMerchantPhaseProduct.call({ subscriptionId: accepted.subscription.id }, { kind: "system" });
    const horizon = await quoteMerchantProviderHorizon.call({ subscriptionId: accepted.subscription.id, additionalPeriods: 1 }, { kind: "system" });
    const create = () => admitMerchantProviderPhases.call({ subscriptionId: accepted.subscription.id, additionalPeriods: 1, expectedHorizonDigest: horizon.horizonDigest }, { kind: "system" });
    const operations = () => db().select().from(subscriptionProviderScheduleOperations).where(eq(subscriptionProviderScheduleOperations.subscriptionId, accepted.subscription.id)).orderBy(subscriptionProviderScheduleOperations.operationRevision);
    return { fixture, plan, input, remote, accepted, create, operations };
    } catch (error) { fixture.cleanup(); throw error; }
  }
