// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: provider-scheduled renewals have actual invoice linkage, not an order attempt UUID.
import { describe, expect, it, vi } from "vitest";
import { proveStripeSubscriptionPayment, type StripeSubscriptionRead } from "@/adapters/payments/stripe-subscription-origin";
import type { MerchantChargeScope } from "@/adapters/payments";
const origin = { providerSubscriptionRef: "sub_original", providerInvoiceRef: "in_original", providerPaymentIntentRef: "pi_original" };
const scope: MerchantChargeScope = { providerPlatformAccountId: "acct_originalPlatform", destinationAccountId: "acct_originalSeller", settlementMerchantAccountId: "acct_originalSeller" };
const invoice = { id: "in_original", parent: { subscription_details: { subscription: "sub_original" } } };
const link = { id: "inpay_original", invoice: "in_original", payment: { type: "payment_intent", payment_intent: "pi_original" }, status: "paid" };
const paid = { id: "pi_original", status: "succeeded", amount_received: 1100, currency: "cad", latest_charge: "ch_original" };
function apiWith(options: { invoice?: Record<string, unknown>; pages?: Record<string, unknown>[]; intent?: Record<string, unknown> } = {}) {
  let page = 0;
  return vi.fn<StripeSubscriptionRead>(async path => {
    if (path === "/v1/invoices/in_original") return options.invoice ?? invoice;
    if (path.startsWith("/v1/invoice_payments?")) return options.pages?.[page++] ?? { data: [link], has_more: false };
    if (path === "/v1/payment_intents/pi_original") return options.intent ?? paid;
    throw new Error("Unexpected original-provider fixture request");
  });
}
describe("original scheduled Stripe invoice payment (C12.38)", () => {
  it("proves actual platform InvoicePayment linkage without payment-attempt metadata", async () => {
    const api = apiWith(); expect(await proveStripeSubscriptionPayment(api, scope, origin)).toBe(paid);
    for (const [, init, actual] of api.mock.calls) { expect(init.method).toBe("GET"); expect(actual).toEqual(scope); }
  });
  it("uses the original connected namespace for a direct agreement", async () => {
    const direct = { providerPlatformAccountId: "acct_originalPlatform", providerAccountId: "acct_originalSeller" }, api = apiWith();
    await proveStripeSubscriptionPayment(api, direct, origin); expect(api.mock.calls.every(call => call[2] === direct)).toBe(true);
  });
  it("accepts an authenticated older invoice's direct payment relation", async () => {
    const api = apiWith({ invoice: { id: "in_original", subscription: "sub_original", payment_intent: "pi_original" } });
    expect(await proveStripeSubscriptionPayment(api, scope, origin)).toBe(paid); expect(api).toHaveBeenCalledTimes(2);
  });
  it("does not hide positive money behind mismatched recipient or fee facts", async () => {
    const actual = { ...paid, transfer_data: { destination: "acct_otherSeller" }, application_fee_amount: 999 };
    expect(await proveStripeSubscriptionPayment(apiWith({ intent: actual }), scope, origin)).toBe(actual);
  });
  it("does not infer the subscription from editable metadata", async () => {
    const api = apiWith({ invoice: { ...invoice, parent: null, metadata: { freeholder_subscription_id: "sub_original" } } });
    await expect(proveStripeSubscriptionPayment(api, scope, origin)).rejects.toThrow(/did not prove/); expect(api).toHaveBeenCalledTimes(1);
  });
  it.each([
    { invoice: { ...invoice, id: "in_other" } },
    { invoice: { ...invoice, subscription: "sub_original", parent: { subscription_details: { subscription: "sub_other" } } } },
    { invoice: { id: "in_original", subscription: "sub_other", payment_intent: "pi_original" } },
    { invoice: { id: "in_original", subscription: "sub_original", payment_intent: "pi_other" } },
    { pages: [{ data: [{ ...link, invoice: "in_other" }], has_more: false }] },
    { pages: [{ data: [{ ...link, payment: { type: "payment_intent", payment_intent: "pi_other" } }], has_more: false }] },
    { pages: [{ data: [link, { ...link, id: "inpay_duplicate" }], has_more: false }] },
    { pages: [{ data: [], has_more: false }] },
    { pages: [{ data: [link] }] },
    { intent: { ...paid, id: "pi_other" } },
  ])("refuses contradictory or missing original linkage %j", async options => {
    await expect(proveStripeSubscriptionPayment(apiWith(options), scope, origin)).rejects.toThrow(/did not prove/);
  });
  it("requires a complete bounded inventory and preserves the original scope on pagination", async () => {
    const api = apiWith({ pages: [{ data: [{ ...link, id: "inpay_first", payment: { type: "payment_intent", payment_intent: "pi_other" } }], has_more: true }, { data: [link], has_more: false }] });
    expect(await proveStripeSubscriptionPayment(api, scope, origin)).toBe(paid); expect(api.mock.calls[2]![0]).toContain("starting_after=inpay_first");
    const loop = apiWith({ pages: Array.from({ length: 20 }, () => ({ data: [link], has_more: true })) });
    await expect(proveStripeSubscriptionPayment(loop, scope, origin)).rejects.toThrow(/did not prove/);
  });
  it("refuses an unbound platform or destination-as-charge namespace before reading", async () => {
    const api = apiWith();
    await expect(proveStripeSubscriptionPayment(api, { providerAccountId: "acct_originalSeller" }, origin)).rejects.toThrow();
    await expect(proveStripeSubscriptionPayment(api, { ...scope, providerAccountId: "acct_originalSeller" }, origin)).rejects.toThrow();
    expect(api).not.toHaveBeenCalled();
  });
});
