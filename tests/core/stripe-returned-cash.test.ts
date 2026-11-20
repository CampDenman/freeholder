// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from "vitest";
import { createStripePayments } from "@/adapters/payments/stripe";
import type { MerchantReturnedCashEvidence } from "@/adapters/payments/merchant-returned-cash-types";
import { merchantReturnedCashProof } from "@/modules/invoicing/merchant-returned-cash-proof";
const original = { providerPlatformAccountId: "acct_platform", chargeAccountId: null, providerApiVersion: "2026-10-28.endive", paymentProviderRef: "pi_original", amountMinor: 1000, currency: "CAD" };
const refund = { id: "re_original", payment_intent: "pi_original", charge: "ch_original", amount: 1000, currency: "cad", status: "succeeded" };
function provider(kind: "direct" | "destination" = "destination", override?: (url: URL) => Record<string, unknown> | Response | undefined) {
  const cash = vi.fn(async () => undefined), refunded = vi.fn(async () => undefined), states: MerchantReturnedCashEvidence[] = [];
  const fetcher = vi.fn<typeof fetch>(async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const custom = override?.(url);
    if (custom) return custom instanceof Response ? custom : Response.json(custom);
    let value: Record<string, unknown>;
    if (url.pathname === "/v1/account") value = { id: "acct_platform" };
    else if (url.pathname.startsWith("/v1/payment_intents/")) value = { id: "pi_original", status: "succeeded", amount_capturable: 0, amount_received: 1000, currency: "cad", latest_charge: "ch_original" };
    else if (url.pathname.startsWith("/v1/charges/")) value = { id: "ch_original", payment_intent: "pi_original", amount_captured: 1000, amount_refunded: 1000,
      currency: "cad", paid: true, captured: true, refunded: true, application_fee: "fee_original", transfer: kind === "destination" ? "tr_original" : null };
    else if (url.pathname.startsWith("/v1/application_fees/")) value = { id: "fee_original", charge: kind === "direct" ? "ch_original" : "ch_destination", originating_transaction: kind === "destination" ? "ch_original" : null,
      account: "acct_seller", amount: 100, amount_refunded: 100, currency: "cad" };
    else if (url.pathname.startsWith("/v1/transfers/")) value = { id: "tr_original", source_transaction: "ch_original", destination: "acct_seller", amount: 1000, amount_reversed: 1000, reversed: true, currency: "cad" };
    else if (url.pathname === "/v1/refunds") value = { data: [refund], has_more: false };
    else if (url.pathname === "/v1/disputes") value = { data: [], has_more: false };
    else throw new Error(`Unexpected provider path: ${url.pathname}`);
    expect(init.method).toBe("GET");
    return Response.json(value);
  });
  const adapter = createStripePayments({ secretKey: "sk_return_fixture", webhookSecrets: ["whsec_return_fixture"], fetch: fetcher, apiBase: "https://stripe.example.test" });
  if (!adapter.inspectMerchantReturnedCash) throw new Error("Actual returned-cash inspection is required.");
  const inspect = () => adapter.inspectMerchantReturnedCash!({ providerPlatformAccountId: original.providerPlatformAccountId, providerApiVersion: "2026-10-28.endive",
    paymentProviderRef: original.paymentProviderRef, ...(kind === "direct" ? { providerAccountId: "acct_seller" } : {}),
    onOriginalCashObserved: cash, onRefundObserved: refunded, onReturnStateObserved: async state => { states.push(state); } });
  return { inspect, cash, refunded, states, fetcher };
}
describe("actual original-account returned cash inspection", () => {
  it.each(["direct", "destination"] as const)("proves %s customer/fee/recipient return through actual factory GETs", async kind => {
    const p = provider(kind), actual = await p.inspect();
    expect(merchantReturnedCashProof({ original: { ...original, chargeAccountId: kind === "direct" ? "acct_seller" : null }, evidence: actual, creatorsQuiesced: true, inventoryStable: true })).toEqual({ settled: true, debt: [] });
    expect(p.cash.mock.invocationCallOrder[0]).toBeLessThan(p.refunded.mock.invocationCallOrder[0]!);
    expect(p.states[0]!.refundsComplete).toBe(false);
    expect(p.states[0]!.refunds).toEqual([]);
    for (const [input, init] of p.fetcher.mock.calls) {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      expect(init?.method).toBe("GET");
      const platform = url.pathname === "/v1/account" || url.pathname.startsWith("/v1/application_fees/") || url.pathname.startsWith("/v1/transfers/");
      expect(new Headers(init?.headers).get("stripe-account")).toBe(platform || kind === "destination" ? null : "acct_seller");
      expect(new Headers(init?.headers).get("stripe-version")).toBe("2026-10-28.endive");
    }
  });
  it("retains the original primary cash before a charge/fee inspection failure", async () => {
    const p = provider("destination", url => url.pathname.startsWith("/v1/charges/") ? new Response("{}", { status: 503 }) : undefined);
    await expect(p.inspect()).rejects.toMatchObject({ code: "provider_failure" });
    expect(p.cash).toHaveBeenCalledWith(expect.objectContaining({ providerRef: "pi_original", amountMinor: 1000, status: "succeeded" }));
    expect(p.states).toEqual([]);
  });
  it("retains each original refund before a later inventory page fails", async () => {
    const p = provider("destination", url => url.pathname === "/v1/refunds" ? url.searchParams.has("starting_after") ? new Response("{}", { status: 503 }) : { data: [refund], has_more: true } : undefined);
    await expect(p.inspect()).rejects.toMatchObject({ code: "provider_failure" });
    expect(p.refunded).toHaveBeenCalledOnce();
    expect(p.states.at(-1)!.refundsComplete).toBe(false);
    expect(p.states.at(-1)!.refunds).toHaveLength(1);
  });
  it("preserves raw nullable/action refund evidence and refuses full-return proof", async () => {
    const p = provider("destination", url => url.pathname === "/v1/refunds" ? { data: [{ ...refund, payment_intent: null, status: "requires_action" }], has_more: false } : undefined);
    const actual = await p.inspect();
    expect(p.refunded).toHaveBeenCalledWith(expect.objectContaining({ paymentProviderRef: null, providerStatus: "requires_action", bindingVerified: false }));
    expect(merchantReturnedCashProof({ original, evidence: actual, creatorsQuiesced: true, inventoryStable: true })).toMatchObject({ settled: false, debt: ["customer_refund"] });
  });
  it("does not infer missing fee/transfer fields to be actual provider null", async () => {
    const p = provider("destination", url => url.pathname.startsWith("/v1/charges/") ? { id: "ch_original", payment_intent: "pi_original", amount_captured: 1000, amount_refunded: 1000,
      currency: "cad", paid: true, captured: true, refunded: true } : undefined);
    const actual = await p.inspect();
    expect(actual).toMatchObject({ feeFieldObserved: false, transferFieldObserved: false });
    expect(merchantReturnedCashProof({ original, evidence: actual, creatorsQuiesced: true, inventoryStable: true })).toMatchObject({ debt: ["commission", "recipient"] });
  });
  it("retains current lost dispute debt after otherwise successful refund and reversal", async () => {
    const p = provider("destination", url => url.pathname === "/v1/disputes" ? { data: [{ id: "du_original", charge: "ch_original", status: "lost" }], has_more: false } : undefined);
    const actual = await p.inspect();
    expect(merchantReturnedCashProof({ original, evidence: actual, creatorsQuiesced: true, inventoryStable: true })).toMatchObject({ settled: false, debt: ["dispute"] });
  });
  it("refuses a different credential platform before any original resource read", async () => {
    const p = provider("destination", url => url.pathname === "/v1/account" ? { id: "acct_foreign" } : undefined);
    await expect(p.inspect()).rejects.toMatchObject({ code: "authentication" });
    expect(p.fetcher).toHaveBeenCalledOnce();
    expect(p.cash).not.toHaveBeenCalled();
  });
});
