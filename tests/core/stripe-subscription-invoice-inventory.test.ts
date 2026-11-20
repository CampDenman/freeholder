// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: actual adapter reads retain original positive PIs before later debt checks.
import { describe, expect, it, vi } from "vitest";
import { createStripePayments } from "@/adapters/payments/stripe";
import type { MerchantScheduleResource } from "@/adapters/payments";
const resource: MerchantScheduleResource = { subscriptionId: "00000000-0000-4000-8000-000000000501", providerSubscriptionRef: "sub_original", providerCustomerRef: "cus_original",
  providerPlatformAccountId: "acct_originalPlatform", providerScheduleApiVersion: "2026-10-28.endive", destinationAccountId: "acct_originalSeller", settlementMerchantAccountId: "acct_originalSeller" };
function edge(options: { pages?: boolean; failLaterPage?: boolean; badHasMore?: boolean; foreignCustomer?: boolean; badInvoiceCurrency?: boolean; processingPositive?: boolean } = {}) {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url), headers = new Headers(init.headers);
    expect(init.method).toBe("GET"); expect(headers.has("stripe-account")).toBe(false);
    if (url.pathname === "/v1/account") return Response.json({ id: "acct_originalPlatform" });
    expect(headers.get("stripe-version")).toBe("2026-10-28.endive");
    if (url.pathname === "/v1/subscriptions/sub_original") return Response.json({ id: "sub_original", customer: "cus_original", billing_mode: { type: "flexible" }, schedule: null,
      collection_method: "charge_automatically", status: "canceled", pending_update: null, metadata: { freeholder_subscription_id: resource.subscriptionId, freeholder_platform_account_id: resource.providerPlatformAccountId },
      transfer_data: { destination: "acct_originalSeller" }, on_behalf_of: "acct_originalSeller" });
    if (url.pathname === "/v1/invoices") return Response.json({ data: [{ id: "in_original", subscription: "sub_original", customer: "cus_original", status: "paid",
      currency: options.badInvoiceCurrency ? "usd" : "cad", total: 100, amount_paid: 100, amount_remaining: 0, period_start: 1767225600 }], has_more: false });
    if (url.pathname === "/v1/invoice_payments") {
      expect(url.searchParams.get("invoice")).toBe("in_original");
      if (url.searchParams.has("starting_after")) {
        expect(url.searchParams.get("starting_after")).toBe("inpay_paid");
        if (options.failLaterPage) throw new Error("Synthetic later invoice-payment page unavailable");
        return Response.json({ data: [{ id: "inpay_cancelled", invoice: "in_original", currency: "cad", amount_paid: 0, amount_requested: 80, status: "canceled",
          payment: { type: "payment_intent", payment_intent: "pi_cancelled" } }], has_more: false });
      }
      return Response.json({ data: [{ id: "inpay_paid", invoice: "in_original", currency: "cad", amount_paid: 100, amount_requested: 100, status: "paid",
        payment: { type: "payment_intent", payment_intent: "pi_original" } }], ...(options.badHasMore ? {} : { has_more: !!options.pages || !!options.failLaterPage }) });
    }
    if (url.pathname === "/v1/payment_intents/pi_cancelled") return Response.json({ id: "pi_cancelled", customer: "cus_original", amount: 80, amount_received: 0, currency: "cad", status: "canceled" });
    if (url.pathname === "/v1/payment_intents/pi_original") return Response.json({ id: "pi_original", customer: options.foreignCustomer ? "cus_otherBuyer" : "cus_original", amount: 100, amount_received: 100,
      currency: "cad", status: options.processingPositive ? "processing" : "succeeded", latest_charge: "ch_original", transfer_data: { destination: "acct_originalSeller" }, on_behalf_of: "acct_originalSeller" });
    throw new Error(`Unexpected actual provider read ${url.pathname}`);
  });
  return { fetcher, provider: createStripePayments({ secretKey: "sk_original_inventory_fixture", apiBase: "https://stripe.example.test", fetch: fetcher }) };
}
describe("original stopped invoice/PI inventory", () => {
  it("enumerates every invoice-payment page and actual paid or canceled PI without another mutation", async () => {
    const { provider, fetcher } = edge({ pages: true }), onPaidIntentObserved = vi.fn().mockResolvedValue(undefined);
    const result = await provider.inspectMerchantScheduleInvoices!({ ...resource, onPaidIntentObserved });
    expect(result).toMatchObject({ state: "cancelled", invoices: [{ providerInvoiceRef: "in_original", complete: true, totalMinor: 100, paidMinor: 100, remainingMinor: 0,
      paymentIntents: [{ providerPaymentIntentRef: "pi_original", state: "succeeded", receivedMinor: 100 }, { providerPaymentIntentRef: "pi_cancelled", state: "canceled", receivedMinor: 0 }] }] });
    expect(onPaidIntentObserved).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ providerInvoiceRef: "in_original", providerPaymentIntentRef: "pi_original", amountMinor: 100, currency: "CAD", customerChargeVerified: true }));
    expect(fetcher.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });
  it("keeps the actual paid PI when a later page fails", async () => {
    const { provider } = edge({ failLaterPage: true }), onPaidIntentObserved = vi.fn().mockResolvedValue(undefined);
    await expect(provider.inspectMerchantScheduleInvoices!({ ...resource, onPaidIntentObserved })).rejects.toMatchObject({ code: "provider_failure" });
    expect(onPaidIntentObserved).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ providerPaymentIntentRef: "pi_original", amountMinor: 100 }));
  });
  it("retains positive cash before rejecting missing pagination evidence", async () => {
    const { provider } = edge({ badHasMore: true }), onPaidIntentObserved = vi.fn().mockResolvedValue(undefined);
    await expect(provider.inspectMerchantScheduleInvoices!({ ...resource, onPaidIntentObserved })).rejects.toMatchObject({ code: "provider_failure" });
    expect(onPaidIntentObserved).toHaveBeenCalledOnce();
  });
  it("retains positive cash before rejecting a different invoice currency", async () => {
    const { provider } = edge({ badInvoiceCurrency: true }), onPaidIntentObserved = vi.fn().mockResolvedValue(undefined);
    await expect(provider.inspectMerchantScheduleInvoices!({ ...resource, onPaidIntentObserved })).rejects.toMatchObject({ code: "provider_failure" });
    expect(onPaidIntentObserved).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ currency: "CAD", amountMinor: 100 }));
  });
  it("refuses to adopt another customer's PI into the original agreement", async () => {
    const { provider } = edge({ foreignCustomer: true }), onPaidIntentObserved = vi.fn().mockResolvedValue(undefined);
    await expect(provider.inspectMerchantScheduleInvoices!({ ...resource, onPaidIntentObserved })).rejects.toMatchObject({ code: "provider_failure" });
    expect(onPaidIntentObserved).not.toHaveBeenCalled();
  });
  it("preserves a positive amount with explicit uncertainty when the PI is not terminal", async () => {
    const { provider } = edge({ processingPositive: true }), onPaidIntentObserved = vi.fn().mockResolvedValue(undefined);
    const result = await provider.inspectMerchantScheduleInvoices!({ ...resource, onPaidIntentObserved });
    expect(result.invoices[0]!.paymentIntents[0]).toMatchObject({ state: "processing", receivedMinor: 100 });
    expect(onPaidIntentObserved).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ customerChargeVerified: false, amountMinor: 100 }));
  });
  it("refuses completion when the caller has no real positive-cash retention phase", async () => {
    const { provider } = edge(); await expect(provider.inspectMerchantScheduleInvoices!(resource)).rejects.toMatchObject({ code: "provider_failure" });
  });
});
