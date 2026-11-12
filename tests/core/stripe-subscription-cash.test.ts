// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: real adapter/HMAC ordering with intercepted HTTP, no provider account.
import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createStripePayments } from "@/adapters/payments/stripe";
import type { MerchantScheduleWebhookScope, PaymentProviderEvent, PaymentWebhookRequest } from "@/adapters/payments";

const subscriptionId = "00000000-0000-4000-8000-000000000080", operationId = "00000000-0000-4000-8000-000000000081";
const metadata = { freeholder_subscription_scope_version: "1", freeholder_subscription_operation_id: operationId, freeholder_subscription_id: subscriptionId,
  freeholder_platform_account_id: "acct_originalPlatform", freeholder_schedule_api_version: "2026-10-28.endive" };
const epoch = Math.floor(Date.now() / 1000);
const invoice = () => ({ id: "in_original", status: "paid", total: 1100, amount_paid: 1100, currency: "usd", customer: "cus_original", paid_out_of_band: false,
  parent: { type: "subscription_details", subscription_details: { subscription: "sub_original", metadata } },
  lines: { has_more: false, data: [{ type: "subscription", period: { start: epoch - 100, end: epoch + 86400 } }] } });
const payment = (id = "inpay_first", intent = "pi_first") => ({ id, invoice: "in_original", status: "paid", amount_paid: 1100, amount_requested: 1100, currency: "usd", payment: { type: "payment_intent", payment_intent: intent } });
function fixture(direct = false) {
  const scope: MerchantScheduleWebhookScope = { subscriptionId, providerSubscriptionRef: "sub_original", providerScheduleOperationId: operationId, providerCustomerRef: "cus_original",
    providerPlatformAccountId: "acct_originalPlatform", providerScheduleApiVersion: "2026-10-28.endive",
    ...(direct ? { providerAccountId: "acct_originalSeller" } : { destinationAccountId: "acct_originalSeller", settlementMerchantAccountId: "acct_originalSeller" }) };
  const retained: PaymentProviderEvent[] = [], paths: string[] = [];
  let readInvoice = invoice(), laterPageError = false, laterIntentError = false, charge: string | null = "ch_original", actualDestination = "acct_originalSeller";
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url), headers = new Headers(init?.headers);
    paths.push(url.pathname);
    expect(init?.method).toBe("GET");
    if (url.pathname === "/v1/account") { expect(headers.has("stripe-account")).toBe(false); return Response.json({ id: "acct_originalPlatform" }); }
    expect(headers.get("stripe-version")).toBe("2026-10-28.endive");
    expect(headers.get("stripe-account")).toBe(direct ? "acct_originalSeller" : null);
    if (url.pathname === "/v1/invoices/in_original") return Response.json(readInvoice);
    if (url.pathname === "/v1/invoice_payments") {
      if (url.searchParams.has("starting_after")) { expect(retained).toHaveLength(1); throw new Error("Fictional later invoice-payment page unavailable"); }
      return Response.json({ data: laterIntentError ? [payment(), payment("inpay_second", "pi_second")] : [payment()], has_more: laterPageError });
    }
    if (url.pathname === "/v1/payment_intents/pi_second") { expect(retained).toHaveLength(1); throw new Error("Fictional later intent unavailable"); }
    if (url.pathname === "/v1/payment_intents/pi_first") return Response.json({ id: "pi_first", status: "succeeded", amount_received: 1100, currency: "usd", customer: "cus_original", latest_charge: charge,
      application_fee_amount: 55, transfer_data: direct ? null : { destination: actualDestination }, on_behalf_of: direct ? null : actualDestination });
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
    wrongDestination: () => { actualDestination = "acct_otherSeller"; }, zero: () => { readInvoice = { ...readInvoice, total: 0, amount_paid: 0 }; },
    incompleteLines: () => { readInvoice = { ...readInvoice, lines: { ...readInvoice.lines, has_more: true } }; },
    wrongMetadata: () => { readInvoice = { ...readInvoice, parent: { ...readInvoice.parent, subscription_details: { ...readInvoice.parent.subscription_details, metadata: { ...metadata, freeholder_subscription_operation_id: subscriptionId } } } }; } };
}

describe("new subscription cash before auxiliary work", () => {
  it.each([false, true])("commits actual original cash on its frozen destination/direct namespace (%s)", async direct => {
    const value = fixture(direct);
    const events = await value.adapter.verifyWebhook(value.request());
    expect(value.resolver).toHaveBeenCalledOnce(); expect(value.observer).toHaveBeenCalledOnce();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "subscription_period_paid", subscriptionId, providerScheduleOperationId: operationId,
      providerRef: "sub_original", paymentProviderRef: "pi_first", providerChargeRef: "ch_original", amountMinor: 1100, currency: "USD", customerChargeVerified: true });
    expect(value.paths.some(path => /charges|application_fees|transfers/.test(path))).toBe(false);
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
    const events = await value.adapter.verifyWebhook(value.request());
    expect(value.retained).toHaveLength(1); expect(value.retained[0]).toMatchObject({ paymentProviderRef: "pi_first", amountMinor: 1100 });
    expect(events[0]).not.toHaveProperty("periodStart", expect.any(String));
    expect(events[0]).not.toHaveProperty("periodEnd", expect.any(String));
  });
  it("requires the authenticated original invoice snapshot for create-ACK-lost lineage", async () => {
    const value = fixture(); value.wrongMetadata();
    await expect(value.adapter.verifyWebhook(value.request())).rejects.toThrow();
    expect(value.observer).not.toHaveBeenCalled(); expect(value.paths).not.toContain("/v1/payment_intents/pi_first");
  });
  it("emits no cash or payment for an actual zero-total invoice", async () => {
    const value = fixture(); value.zero();
    expect(await value.adapter.verifyWebhook(value.request())).toEqual([]);
    expect(value.observer).not.toHaveBeenCalled(); expect(value.paths).not.toContain("/v1/invoice_payments");
  });
});
