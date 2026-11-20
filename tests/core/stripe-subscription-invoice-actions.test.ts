// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: actual factory mutations and GET-only recovery on original IDs.
import { describe, expect, it, vi } from "vitest";
import { createStripePayments } from "@/adapters/payments/stripe";
import type { MerchantProviderPhase, MerchantScheduleInvoiceActionRequest } from "@/adapters/payments";
const phase: MerchantProviderPhase & { providerPriceRef: string } = { termsId: "00000000-0000-4000-8000-000000000811", profileId: "00000000-0000-4000-8000-000000000812", profileVersion: 1, start: "2026-01-01T00:00:00.000Z", end: "2026-02-01T00:00:00.000Z", taxOccurredAt: "2026-01-01T00:00:00.000Z", currency: "CAD", interval: "month", intervalCount: 1, periodAmountMinor: 100, setupFeeMinor: 0, taxMinor: 0, totalMinor: 100, siteFeeBps: 0, applicationFeeMinor: 0, taxQuoteDigest: "a".repeat(64), phaseDigest: "b".repeat(64), providerPriceRef: "price_original" };
const request: Omit<MerchantScheduleInvoiceActionRequest, "onAcknowledged"> = { subscriptionId: "00000000-0000-4000-8000-000000000801", providerSubscriptionRef: "sub_original", providerCustomerRef: "cus_original",
  providerPlatformAccountId: "acct_originalPlatform", providerScheduleApiVersion: "2026-10-28.endive", destinationAccountId: "acct_originalSeller", settlementMerchantAccountId: "acct_originalSeller",
  providerInvoiceRef: "in_original", action: "cancel_intent", providerPaymentIntentRef: "pi_original" };
function edge(options: { canceled?: boolean; voided?: boolean; draft?: boolean; processingCash?: boolean; cashAfterCancel?: boolean; loseReply?: boolean; foreignInvoice?: boolean; collectionAfterFinalize?: boolean; wrongPrice?: boolean } = {}) {
  let canceled = !!options.canceled, voided = !!options.voided, finalized = false, posts = 0;
  const events: string[] = [];
  const intent = () => ({ id: "pi_original", object: "payment_intent", customer: "cus_original", status: options.processingCash ? "processing" : canceled ? "canceled" : "requires_payment_method",
    currency: "cad", amount: 100, amount_received: options.processingCash || canceled && options.cashAfterCancel ? 20 : 0, amount_capturable: 0,
    latest_charge: "ch_original", transfer_data: { destination: "acct_originalSeller" }, on_behalf_of: "acct_originalSeller" });
  const invoice = () => ({ id: "in_original", object: "invoice", customer: options.foreignInvoice ? "cus_someoneElse" : "cus_original", subscription: "sub_original", status: options.draft && !finalized ? "draft" : voided ? "void" : "open", auto_advance: options.collectionAfterFinalize && finalized ? true : false,
    currency: "cad", total: 100, amount_paid: options.processingCash ? 20 : 0, amount_remaining: options.processingCash ? 80 : voided ? 0 : 100, period_start: 1767225600, lines: { has_more: false, data: [{ id: "il_original", quantity: 1, amount: 100, currency: "cad", pricing: { price_details: { price: options.wrongPrice ? "price_foreign" : "price_original" } }, parent: { subscription_item_details: { proration: false } }, period: { start: Date.parse(phase.start) / 1000, end: Date.parse(phase.end) / 1000 } }] } });
  const fetcher = vi.fn<typeof fetch>(async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url), headers = new Headers(init.headers);
    expect(headers.has("stripe-account")).toBe(false);
    if (url.pathname === "/v1/account") return Response.json({ id: "acct_originalPlatform" });
    expect(headers.get("stripe-version")).toBe("2026-10-28.endive");
    if (init.method === "POST") {
      posts++; events.push(url.pathname);
      if (url.pathname === "/v1/payment_intents/pi_original/cancel") canceled = true;
      else if (url.pathname === "/v1/invoices/in_original/void") voided = true;
      else if (url.pathname === "/v1/invoices/in_original/finalize") { finalized = true;
        if (typeof init.body !== "string" && !(init.body instanceof URLSearchParams)) throw new Error("Missing actual finalize body");
        expect(Object.fromEntries(new URLSearchParams(init.body))).toEqual({ auto_advance: "false" });
      }
      else throw new Error("Unexpected original provider mutation");
      if (options.loseReply) throw new Error("Synthetic original stop response lost");
      return Response.json(url.pathname.endsWith("/cancel") ? intent() : invoice());
    }
    expect(init.method).toBe("GET");
    if (url.pathname === "/v1/subscriptions/sub_original") return Response.json({ id: "sub_original", customer: "cus_original", billing_mode: { type: "flexible" }, schedule: null, collection_method: "charge_automatically",
      transfer_data: { destination: "acct_originalSeller" }, on_behalf_of: "acct_originalSeller", metadata: { freeholder_subscription_id: request.subscriptionId, freeholder_platform_account_id: request.providerPlatformAccountId }, status: "canceled", pending_update: null });
    if (url.pathname === "/v1/invoices/in_original") return Response.json(invoice());
    if (url.pathname === "/v1/invoice_payments") return Response.json({ data: [{ id: "inpay_original", invoice: "in_original", currency: "cad", amount_requested: 100, amount_paid: options.processingCash ? 20 : 0,
      status: canceled ? "canceled" : "open", payment: { type: "payment_intent", payment_intent: "pi_original" } }], has_more: false });
    if (url.pathname === "/v1/payment_intents/pi_original") return Response.json(intent());
    throw new Error(`Unexpected original read ${url.pathname}`);
  });
  return { provider: createStripePayments({ secretKey: "sk_invoice_stop_fixture", apiBase: "https://stripe.example.test", fetch: fetcher }), fetcher, events, posts: () => posts };
}
describe("original invoice and PaymentIntent stop adapter", () => {
  it("sends exactly one PI cancellation and retains its terminal ACK", async () => {
    const { provider, posts } = edge(), onAcknowledged = vi.fn().mockResolvedValue(undefined);
    await provider.stopMerchantScheduleInvoice!({ ...request, onAcknowledged }); expect(posts()).toBe(1);
    expect(onAcknowledged).toHaveBeenCalledExactlyOnceWith({ action: "cancel_intent", providerInvoiceRef: "in_original", providerPaymentIntentRef: "pi_original", state: "canceled" });
  });
  it("never turns a recovery GET into another cancellation while the original PI is still active", async () => {
    const { provider, posts } = edge(), onAcknowledged = vi.fn();
    await expect(provider.inspectMerchantScheduleInvoiceStop!({ ...request, onAcknowledged })).rejects.toMatchObject({ code: "provider_failure" }); expect(posts()).toBe(0); expect(onAcknowledged).not.toHaveBeenCalled();
  });
  it("recovers an actual canceled PI with GETs only", async () => {
    const { provider, posts } = edge({ canceled: true }), onAcknowledged = vi.fn().mockResolvedValue(undefined);
    await provider.inspectMerchantScheduleInvoiceStop!({ ...request, onAcknowledged }); expect(posts()).toBe(0); expect(onAcknowledged).toHaveBeenCalledOnce();
  });
  it("leaves a lost cancellation response as one original mutation for separately admitted recovery", async () => {
    const { provider, posts } = edge({ loseReply: true }), onAcknowledged = vi.fn();
    await expect(provider.stopMerchantScheduleInvoice!({ ...request, onAcknowledged })).rejects.toMatchObject({ code: "provider_failure" }); expect(posts()).toBe(1); expect(onAcknowledged).not.toHaveBeenCalled();
  });
  it("preserves actual terminal ACK then positive money when a cancel response contradicts zero-received closure", async () => {
    const { provider, events } = edge({ cashAfterCancel: true });
    await expect(provider.stopMerchantScheduleInvoice!({ ...request, onAcknowledged: async () => { events.push("ack"); }, onPaidIntentObserved: async () => { events.push("cash"); } })).rejects.toMatchObject({ code: "provider_failure" });
    expect(events).toEqual(["/v1/payment_intents/pi_original/cancel", "ack", "cash"]);
  });
  it("retains processing positive money before refusing an unpaid stop", async () => {
    const { provider, posts } = edge({ processingCash: true }), onPaidIntentObserved = vi.fn().mockResolvedValue(undefined);
    await expect(provider.stopMerchantScheduleInvoice!({ ...request, onAcknowledged: vi.fn(), onPaidIntentObserved })).rejects.toMatchObject({ code: "provider_failure" });
    expect(posts()).toBe(0); expect(onPaidIntentObserved).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ amountMinor: 20, customerChargeVerified: false }));
  });
  it("voids a finalized unpaid invoice only after all original PIs are actually canceled", async () => {
    const { provider, posts } = edge({ canceled: true }), onAcknowledged = vi.fn().mockResolvedValue(undefined);
    await provider.stopMerchantScheduleInvoice!({ ...request, action: "void_invoice", providerPaymentIntentRef: undefined, onAcknowledged }); expect(posts()).toBe(1);
    expect(onAcknowledged).toHaveBeenCalledExactlyOnceWith({ action: "void_invoice", providerInvoiceRef: "in_original", state: "void" });
  });
  it("does not void an invoice that still owns an uncanceled PI", async () => {
    const { provider, posts } = edge();
    await expect(provider.stopMerchantScheduleInvoice!({ ...request, action: "void_invoice", providerPaymentIntentRef: undefined, onAcknowledged: vi.fn() })).rejects.toMatchObject({ code: "provider_failure" }); expect(posts()).toBe(0);
  });
  it("recovers a void invoice using only GETs and never replays a void POST", async () => {
    const { provider, posts } = edge({ canceled: true, voided: true }), onAcknowledged = vi.fn().mockResolvedValue(undefined);
    await provider.inspectMerchantScheduleInvoiceStop!({ ...request, action: "void_invoice", providerPaymentIntentRef: undefined, onAcknowledged }); expect(posts()).toBe(0); expect(onAcknowledged).toHaveBeenCalledOnce();
  });
  it("refuses subscription drafts and another customer's invoice before any mutation", async () => {
    for (const options of [{ canceled: true, draft: true }, { foreignInvoice: true }]) {
      const { provider, posts } = edge(options);
      await expect(provider.stopMerchantScheduleInvoice!({ ...request, action: "void_invoice", providerPaymentIntentRef: undefined, onAcknowledged: vi.fn() })).rejects.toMatchObject({ code: "provider_failure" }); expect(posts()).toBe(0);
    }
  });
  it("finalizes an exactly admitted subscription draft once with automatic collection disabled", async () => {
    const { provider, posts } = edge({ draft: true, canceled: true }), onAcknowledged = vi.fn().mockResolvedValue(undefined);
    await provider.stopMerchantScheduleInvoice!({ ...request, action: "finalize_draft", providerPaymentIntentRef: undefined, admittedPhase: phase, onAcknowledged });
    expect(posts()).toBe(1); expect(onAcknowledged).toHaveBeenCalledExactlyOnceWith({ action: "finalize_draft", providerInvoiceRef: "in_original", state: "open", autoAdvance: false });
  });
  it("does not finalize a draft from an unaccepted price or an absent phase proof", async () => {
    for (const input of [{ phase: undefined, wrongPrice: false }, { phase, wrongPrice: true }]) {
      const { provider, posts } = edge({ draft: true, canceled: true, wrongPrice: input.wrongPrice });
      await expect(provider.stopMerchantScheduleInvoice!({ ...request, action: "finalize_draft", providerPaymentIntentRef: undefined, admittedPhase: input.phase, onAcknowledged: vi.fn() })).rejects.toMatchObject({ code: "provider_failure" }); expect(posts()).toBe(0);
    }
  });
  it("never replays finalization from a GET recovery when the original draft remains unresolved", async () => {
    const { provider, posts } = edge({ draft: true, canceled: true });
    await expect(provider.inspectMerchantScheduleInvoiceStop!({ ...request, action: "finalize_draft", providerPaymentIntentRef: undefined, admittedPhase: phase, onAcknowledged: vi.fn() })).rejects.toMatchObject({ code: "provider_failure" }); expect(posts()).toBe(0);
  });
  it("refuses a finalization response that enables collection", async () => {
    const { provider, posts } = edge({ draft: true, canceled: true, collectionAfterFinalize: true }), onAcknowledged = vi.fn();
    await expect(provider.stopMerchantScheduleInvoice!({ ...request, action: "finalize_draft", providerPaymentIntentRef: undefined, admittedPhase: phase, onAcknowledged })).rejects.toMatchObject({ code: "provider_failure" }); expect(posts()).toBe(1); expect(onAcknowledged).not.toHaveBeenCalled();
  });

});
