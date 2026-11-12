// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.26/C12.38: exact fee refunds keep their own provider acknowledgement.
import { describe, expect, it, vi } from "vitest";
import { createStripePayments } from "@/adapters/payments/stripe";
import type { MerchantFeeRefundRequest, MerchantFeeObservation } from "@/adapters/payments/types";

const request: MerchantFeeRefundRequest = {
  providerPlatformAccountId: "acct_platform", destinationAccountId: "acct_seller", settlementMerchantAccountId: "acct_seller",
  applicationFeeRef: "fee_original", providerChargeRef: "ch_original", currency: "CAD", amountMinor: 17,
  operationId: "e459a5ca-b6ec-47f1-bbbe-c256e76bb038", idempotencyKey: "original-fee-refund:17",
};
const fee = { id: "fee_original", account: "acct_seller", charge: "py_seller", originating_transaction: "ch_original", currency: "cad", amount: 100, amount_refunded: 0 };
const refund = { id: "fr_original", fee: "fee_original", currency: "cad", amount: 17, metadata: { freeholder_fee_refund_id: request.operationId } };
function provider(responses: unknown[]) {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => {
    const response = responses.shift();
    if (response === undefined) throw new Error("Unexpected provider I/O");
    return response instanceof Response ? response : Response.json(response);
  });
  const adapter = createStripePayments({ secretKey: "sk_fee_scope_fixture", webhookSecrets: ["whsec_fee_scope_fixture"], apiBase: "https://stripe.example.test", fetch: fetcher });
  if (!adapter.refundMerchantFee || !adapter.recoverMerchantFeeRefund) throw new Error("Stripe must support exact commission refunds.");
  return { fetcher, issue: adapter.refundMerchantFee.bind(adapter), recover: adapter.recoverMerchantFeeRefund.bind(adapter) };
}
const identity = { id: "acct_platform" };

describe("exact original application-fee refunds (C12.26/C12.38)", () => {
  it("returns the exact frozen commission rather than a proportion of tax and freight", async () => {
    const p = provider([identity, fee, identity, refund]);
    expect(await p.issue(request)).toEqual({ providerRef: "fr_original", applicationFeeRef: "fee_original", currency: "CAD", amountMinor: 17 });
    for (const [, init] of p.fetcher.mock.calls) expect(new Headers(init?.headers).has("stripe-account")).toBe(false);
    const [url, init] = p.fetcher.mock.calls[3]!;
    expect(url).toBe("https://stripe.example.test/v1/application_fees/fee_original/refunds");
    if (!(init?.body instanceof URLSearchParams)) throw new Error("Expected the provider's form body.");
    expect(init.body.get("amount")).toBe("17");
    expect(new Headers(init?.headers).get("idempotency-key")).toBe(request.idempotencyKey);
  });

  it("uses the platform fee namespace for direct charges too, without changing their original charge account", async () => {
    const p = provider([identity, { ...fee, charge: "ch_original", originating_transaction: null }, identity, refund]);
    await p.issue({ ...request, providerAccountId: "acct_seller", destinationAccountId: undefined, settlementMerchantAccountId: undefined });
    for (const [, init] of p.fetcher.mock.calls) expect(new Headers(init?.headers).has("stripe-account")).toBe(false);
  });

  it.each([{ account: "acct_other" }, { originating_transaction: "ch_other" }, { currency: "usd" }, { id: "fee_other" }])("refuses another original fee before dispatch: %j", async change => {
    const p = provider([identity, { ...fee, ...change }]);
    await expect(p.issue(request)).rejects.toMatchObject({ code: "provider_failure" });
    expect(p.fetcher.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });

  it("recovers a timed-out positive refund by exact operation ID across complete pages, without another POST", async () => {
    const p = provider([identity, { ...fee, amount_refunded: 17 }, identity, { data: [{ id: "fr_other", metadata: {} }], has_more: true }, identity, { data: [refund], has_more: false }]);
    expect(await p.recover(request)).toMatchObject({ providerRef: "fr_original", amountMinor: 17 });
    expect(p.fetcher.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
    expect(p.fetcher.mock.calls[5]![0]).toEqual(expect.stringContaining("starting_after=fr_other"));
  });

  it("keeps a missing lookup unresolved instead of concluding a timed-out operation did not happen", async () => {
    const p = provider([identity, fee, identity, { data: [], has_more: false }]);
    expect(await p.recover(request)).toBeNull();
    expect(p.fetcher.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });

  it.each([
    { data: [refund, { ...refund, id: "fr_duplicate" }], has_more: false },
    { data: [{ ...refund, amount: 18 }], has_more: false },
    { data: [{ ...refund, fee: "fee_other" }], has_more: false },
    { data: [], has_more: true },
  ])("preserves ambiguous or incomplete recovery for review: %j", async result => {
    const p = provider([identity, fee, identity, result]);
    await expect(p.recover(request)).rejects.toMatchObject({ code: "provider_failure" });
  });

  it("retains a positive fee ACK with a mismatched amount before refusing logical application", async () => {
    const p = provider([identity, fee, identity, { ...refund, amount: 18 }]);
    const observed: MerchantFeeObservation[] = [];
    await expect(p.issue({ ...request, onFeeRefundObserved: async fact => { observed.push(fact); } })).rejects.toMatchObject({ code: "provider_failure", retryable: true });
    expect(observed).toEqual([{ providerRef: "fr_original", applicationFeeRef: "fee_original", amountMinor: 18, currency: "CAD", bindingVerified: false }]);
    expect(p.fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });

  it("commits an original positive recovery before another page can fail", async () => {
    const p = provider([identity, fee, identity, { data: [refund], has_more: true }, identity, new Response(JSON.stringify({ error: { code: "temporary_unavailable" } }), { status: 503 })]);
    const observed: MerchantFeeObservation[] = [];
    await expect(p.recover({ ...request, onFeeRefundObserved: async fact => { observed.push(fact); } })).rejects.toMatchObject({ code: "provider_failure" });
    expect(observed).toEqual([{ providerRef: "fr_original", applicationFeeRef: "fee_original", amountMinor: 17, currency: "CAD", bindingVerified: true }]);
    expect(p.fetcher.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });

  it("keeps an uncommitted callback unknown and never dispatches a second physical fee refund", async () => {
    const p = provider([identity, fee, identity, refund]);
    await expect(p.issue({ ...request, onFeeRefundObserved: async () => { throw new Error("Receipt database unavailable"); } })).rejects.toThrow("Receipt database");
    expect(p.fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });

  it("keeps an acknowledgement failure unknown, without sending another fee refund", async () => {
    const p = provider([identity, fee, identity, new Response(JSON.stringify({ error: { code: "temporary_unavailable" } }), { status: 503 })]);
    await expect(p.issue(request)).rejects.toMatchObject({ code: "provider_failure", retryable: true });
    expect(p.fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });
});
