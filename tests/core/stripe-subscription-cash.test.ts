// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: real adapter/HMAC ordering with intercepted HTTP, no provider account.
import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createStripePayments } from "@/adapters/payments/stripe";
import type { MerchantScheduleWebhookScope, PaymentProviderEvent, PaymentWebhookRequest } from "@/adapters/payments";

const subscriptionId = "00000000-0000-4000-8000-000000000080", operationId = "00000000-0000-4000-8000-000000000081";
const metadata = { freeholder_subscription_scope_version: "1", freeholder_subscription_operation_id: operationId, freeholder_subscription_id: subscriptionId,
  freeholder_subscription_terms_id: "00000000-0000-4000-8000-000000000082", freeholder_phase_digest: "a".repeat(64), freeholder_platform_account_id: "acct_originalPlatform", freeholder_schedule_api_version: "2026-10-28.endive" };
const epoch = Math.floor(Date.now() / 1000);
const invoice = () => ({ id: "in_original", status: "paid", subtotal: 1100, total: 1100, amount_paid: 1100, amount_remaining: 0, collection_method: "charge_automatically", automatic_tax: { enabled: false }, total_taxes: [], total_discount_amounts: [], discounts: [], starting_balance: 0, ending_balance: 0, amount_shipping: 0, pre_payment_credit_notes_amount: 0, post_payment_credit_notes_amount: 0, currency: "usd", customer: "cus_original", paid_out_of_band: false,
  parent: { type: "subscription_details", subscription_details: { subscription: "sub_original", metadata } },
  lines: { has_more: false, data: [{ type: "subscription", period: { start: epoch - 100, end: epoch + 86400 } }] } });
const payment = (id = "inpay_first", intent = "pi_first") => ({ id, invoice: "in_original", status: "paid", amount_paid: 1100, amount_requested: 1100, currency: "usd", payment: { type: "payment_intent", payment_intent: intent } });
function fixture(direct = false) {
  const scope: MerchantScheduleWebhookScope = { subscriptionId, providerSubscriptionRef: "sub_original", providerScheduleOperationId: operationId, providerCustomerRef: "cus_original",
    providerPlatformAccountId: "acct_originalPlatform", providerScheduleApiVersion: "2026-10-28.endive",
    ...(direct ? { providerAccountId: "acct_originalSeller" } : { destinationAccountId: "acct_originalSeller", settlementMerchantAccountId: "acct_originalSeller" }) };
  const retained: PaymentProviderEvent[] = [], paths: string[] = [];
  let readInvoice = invoice(), laterPageError = false, laterIntentError = false, charge: string | null = "ch_original", actualDestination = "acct_originalSeller", incompleteLines = false, failPrice = false;
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url), headers = new Headers(init?.headers);
    paths.push(url.pathname);
    expect(init?.method).toBe("GET");
    if (url.pathname === "/v1/account") { expect(headers.has("stripe-account")).toBe(false); return Response.json({ id: "acct_originalPlatform" }); }
    expect(headers.get("stripe-version")).toBe("2026-10-28.endive");
    expect(headers.get("stripe-account")).toBe(direct && !/application_fees|transfers/.test(url.pathname) ? "acct_originalSeller" : null);
    if (url.pathname === "/v1/invoices/in_original") return Response.json(readInvoice);
    if (url.pathname === "/v1/invoice_payments") {
      if (url.searchParams.has("starting_after")) { expect(retained).toHaveLength(1); throw new Error("Fictional later invoice-payment page unavailable"); }
      return Response.json({ data: readInvoice.total === 0 ? [] : laterIntentError ? [payment(), payment("inpay_second", "pi_second")] : [payment()], has_more: laterPageError });
    }
    if (url.pathname === "/v1/payment_intents/pi_second") { expect(retained).toHaveLength(1); throw new Error("Fictional later intent unavailable"); }
    if (url.pathname === "/v1/payment_intents/pi_first") return Response.json({ id: "pi_first", status: "succeeded", amount_received: 1100, currency: "usd", customer: "cus_original", latest_charge: charge,
      application_fee_amount: 55, transfer_data: direct ? null : { destination: actualDestination }, on_behalf_of: direct ? null : actualDestination });
    if (url.pathname === "/v1/charges/ch_original") { expect(retained[0]).toMatchObject({ amountMinor: 1100, paymentProviderRef: "pi_first" }); return Response.json({ id: "ch_original", payment_intent: "pi_first", paid: true, captured: true, status: "succeeded", amount_captured: 1100, currency: "usd", application_fee: "fee_original", transfer: direct ? null : "tr_original" }); }
    if (url.pathname === "/v1/application_fees/fee_original") return Response.json({ id: "fee_original", account: "acct_originalSeller", charge: "ch_original", originating_transaction: "ch_original", amount: 55, currency: "usd", amount_refunded: 0 });
    if (url.pathname === "/v1/transfers/tr_original") return Response.json({ id: "tr_original", destination: "acct_originalSeller", source_transaction: "ch_original", amount: 1100, currency: "usd", amount_reversed: 0, reversed: false });
    if (url.pathname === "/v1/invoices/in_original/lines") {
      if (incompleteLines) throw new Error("Fictional full invoice lines unavailable after committed cash");
      return Response.json({ data: [{ id: "il_original", invoice: "in_original", amount: readInvoice.total, currency: "usd", quantity: 1, quantity_decimal: "1", period: { start: epoch - 100, end: epoch + 86400 }, parent: { type: "subscription_item_details", subscription_item_details: { proration: false } }, pricing: { price_details: { price: "price_original" } }, discount_amounts: [], discounts: [], taxes: [], pretax_credit_amounts: [] }], has_more: false });
    }
    if (url.pathname === "/v1/prices/price_original") {
      if (failPrice) throw new Error("Fictional price lookup failed after committed cash");
      return Response.json({ id: "price_original", object: "price", product: "prod_original", unit_amount: readInvoice.total, currency: "usd", billing_scheme: "per_unit", tax_behavior: "inclusive", transform_quantity: null, recurring: { interval: "day", interval_count: 1, usage_type: "licensed" } });
    }
    throw new Error(`Unexpected synthetic request: ${url.pathname}`);
  });
  const adapter = createStripePayments({ secretKey: "sk_fictional", webhookSecrets: ["whsec_fictional"], apiBase: "https://stripe.example.test", fetch: fetcher });
  const resolver = vi.fn<NonNullable<PaymentWebhookRequest["resolveSubscriptionScope"]>>().mockResolvedValue(scope);
  const observer = vi.fn<NonNullable<PaymentWebhookRequest["onSubscriptionChargeObserved"]>>().mockImplementation(async event => { retained.push(event); return event; });
  const request = (type = "invoice.paid"): PaymentWebhookRequest => {
    const body = Buffer.from(JSON.stringify({ id: "evt_original", type, created: epoch, ...(direct ? { account: "acct_originalSeller" } : {}), data: { object: invoice() } }));
    const signature = createHmac("sha256", "whsec_fictional").update(`${epoch}.`).update(body).digest("hex");
    return { body, headers: { "stripe-signature": `t=${epoch},v1=${signature}` }, receivedAt: new Date(epoch * 1000).toISOString(), resolveSubscriptionScope: resolver, onSubscriptionChargeObserved: observer };
  };
  return { scope, adapter, resolver, observer, retained, paths, fetcher, request,
    laterPage: () => { laterPageError = true; }, laterIntent: () => { laterIntentError = true; }, noCharge: () => { charge = null; },
    wrongDestination: () => { actualDestination = "acct_otherSeller"; }, zero: () => { readInvoice = { ...readInvoice, subtotal: 0, total: 0, amount_paid: 0 }; },
    failPrice: () => { failPrice = true; },
    incompleteLines: () => { incompleteLines = true; readInvoice = { ...readInvoice, lines: { ...readInvoice.lines, has_more: true } }; },
    wrongMetadata: () => { readInvoice = { ...readInvoice, parent: { ...readInvoice.parent, subscription_details: { ...readInvoice.parent.subscription_details, metadata: { ...metadata, freeholder_subscription_operation_id: subscriptionId } } } }; } };
}

describe("new subscription cash before auxiliary work", () => {
  it.each([false, true])("commits actual original cash on its frozen destination/direct namespace (%s)", async direct => {
    const value = fixture(direct);
    const events = await value.adapter.verifyWebhook(value.request());
    expect(value.resolver).toHaveBeenCalledOnce(); expect(value.observer).toHaveBeenCalled();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "subscription_period_paid", subscriptionId, providerScheduleOperationId: operationId,
      providerRef: "sub_original", paymentProviderRef: "pi_first", providerChargeRef: "ch_original", amountMinor: 1100, currency: "USD", customerChargeVerified: true });
    expect(value.paths).toContain("/v1/invoices/in_original/lines"); expect(value.paths).toContain("/v1/prices/price_original");
    expect(events[0]).toHaveProperty("subscriptionInvoiceEvidence.lines.0.priceAmountMinor", 1100);
  });
  it("never resolves source scope or reads a provider after a bad raw signature", async () => {
    const value = fixture(), request = value.request();
    await expect(value.adapter.verifyWebhook({ ...request, headers: { "stripe-signature": `t=${epoch},v1=invalid` } })).rejects.toThrow();
    expect(value.resolver).not.toHaveBeenCalled(); expect(value.fetcher).not.toHaveBeenCalled();
  });
  it("refuses a tagged source without its resolver before any financial GET", async () => {
    const value = fixture();
    await expect(value.adapter.verifyWebhook({ ...value.request(), resolveSubscriptionScope: undefined })).rejects.toThrow(/original|scope/i);
    expect(value.fetcher).not.toHaveBeenCalled();
  });
  it("refuses unresolved tagged scope and missing committed capture before any financial GET", async () => {
    const value = fixture(); value.resolver.mockResolvedValue(null);
    await expect(value.adapter.verifyWebhook(value.request())).rejects.toThrow(/original|scope/i);
    expect(value.fetcher).not.toHaveBeenCalled();
    value.resolver.mockResolvedValue(value.scope);
    await expect(value.adapter.verifyWebhook({ ...value.request(), onSubscriptionChargeObserved: undefined })).rejects.toThrow(/cash|phase/i);
    expect(value.fetcher).not.toHaveBeenCalled();
  });
  it("keeps the committed PI when a later paid-payment page fails", async () => {
    const value = fixture(); value.laterPage();
    await expect(value.adapter.verifyWebhook(value.request())).rejects.toThrow();
    expect(value.retained).toHaveLength(1); expect(value.retained[0]).toMatchObject({ paymentProviderRef: "pi_first", amountMinor: 1100 });
  });
  it("keeps the first committed PI when the next actual PI read fails", async () => {
    const value = fixture(); value.laterIntent();
    await expect(value.adapter.verifyWebhook(value.request())).rejects.toThrow();
    expect(value.retained).toHaveLength(1);
  });
  it("retains primary paid-intent money when its nullable charge reference is unknown", async () => {
    const value = fixture(); value.noCharge();
    const events = await value.adapter.verifyWebhook(value.request());
    expect(value.retained[0]).toMatchObject({ paymentProviderRef: "pi_first", amountMinor: 1100, customerChargeVerified: true });
    expect(events[0]).not.toHaveProperty("providerChargeRef", expect.any(String));
  });
  it("preserves actual recipient disagreement separately from customer payment", async () => {
    const value = fixture(); value.wrongDestination();
    const events = await value.adapter.verifyWebhook(value.request());
    expect(events[0]).toMatchObject({ destinationAccountId: "acct_otherSeller", settlementMerchantAccountId: "acct_otherSeller", merchantRouteVerified: false, customerChargeVerified: true });
  });
  it("retains money without inventing a complete period from a partial invoice-line page", async () => {
    const value = fixture(); value.incompleteLines();
    await expect(value.adapter.verifyWebhook(value.request())).rejects.toThrow();
    expect(value.retained[0]).toMatchObject({ paymentProviderRef: "pi_first", amountMinor: 1100 });
    expect(value.retained.every(event => !("subscriptionInvoiceEvidence" in event))).toBe(true);
  });
  it("requires the authenticated original invoice snapshot for create-ACK-lost lineage", async () => {
    const value = fixture(); value.wrongMetadata();
    await expect(value.adapter.verifyWebhook(value.request())).rejects.toThrow();
    expect(value.observer).not.toHaveBeenCalled(); expect(value.paths).not.toContain("/v1/payment_intents/pi_first");
  });
  it("keeps actual money and fee observations when a later actual price GET fails", async () => {
    const value = fixture(); value.failPrice(); await expect(value.adapter.verifyWebhook(value.request())).rejects.toThrow();
    expect(value.retained[0]).toMatchObject({ amountMinor: 1100, paymentProviderRef: "pi_first" });
    expect(value.retained.some(event => "observedApplicationFeeMinor" in event && event.observedApplicationFeeMinor === 55)).toBe(true);
    expect(value.retained.every(event => !("subscriptionInvoiceEvidence" in event))).toBe(true);
  });
  it("emits no cash or payment for an actual zero-total invoice", async () => {
    const value = fixture(); value.zero();
    const events = await value.adapter.verifyWebhook(value.request());
    expect(events).toHaveLength(1); expect(events[0]).toMatchObject({ kind: "subscription_period_paid", amountMinor: 0, subscriptionInvoiceEvidence: { totalMinor: 0 } });
    expect(events[0]).not.toHaveProperty("paymentProviderRef"); expect(events[0]).not.toHaveProperty("subscriptionChargeReceiptId");
    expect(value.observer).not.toHaveBeenCalled(); expect(value.paths).toContain("/v1/invoice_payments");
  });
});
