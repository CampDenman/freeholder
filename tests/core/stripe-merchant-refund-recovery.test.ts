// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: actual adapter HTTP scope and independently retained refund evidence.
import { describe, expect, it, vi } from "vitest";
import { createStripePayments } from "@/adapters/payments/stripe";
import { stripeMerchantRefundBody } from "@/adapters/payments/stripe-merchant-refund-body";
import type { MerchantRefundRecoveryRequest } from "@/adapters/payments";

const original = { providerPlatformAccountId: "acct_originalPlatform", destinationAccountId: "acct_originalSeller", settlementMerchantAccountId: "acct_originalSeller",
  refundAttemptId: "00000000-0000-4000-8000-000000000031", paymentId: "00000000-0000-4000-8000-000000000032", paymentProviderRef: "pi_original", amountMinor: 400, currency: "CAD" };
const metadata = { freeholder_refund_id: original.refundAttemptId, freeholder_payment_id: original.paymentId, freeholder_platform_account_id: original.providerPlatformAccountId };
function refund(overrides: Record<string, unknown> = {}) {
  return { id: "re_original", payment_intent: "pi_original", charge: "ch_original", amount: 400, currency: "cad", status: "succeeded", transfer_reversal: "trr_original", metadata, ...overrides };
}
function provider(response: (url: URL, init: RequestInit) => Record<string, unknown> | Response, platform = original.providerPlatformAccountId) {
  const fetcher = vi.fn<typeof fetch>(async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const value = url.pathname === "/v1/account" ? { id: platform } : response(url, init);
    return value instanceof Response ? value : Response.json(value);
  });
  const adapter = createStripePayments({ secretKey: "sk_refund_recovery_fixture", webhookSecrets: ["whsec_refund_recovery_fixture"], apiBase: "https://stripe.example.test", fetch: fetcher });
  if (!adapter.recoverMerchantRefund) throw new Error("Original merchant refund recovery is required.");
  const observed = vi.fn(async () => undefined);
  const recover = (request: Partial<MerchantRefundRecoveryRequest> = {}) => adapter.recoverMerchantRefund!({ ...original, onRefundObserved: observed, ...request });
  return { recover, observed, fetcher, adapter };
}
describe("original merchant refund recovery (C12.38)", () => {
  it("reads a documented local-payment refund reference through the same exact original resource path", async () => {
    const p = provider(() => refund({ id: "pyr_originalBank", status: "requires_action" }));
    expect(await p.recover({ originalRefundRef: "pyr_originalBank" })).toMatchObject({ state: "observed", evidence: {
      providerRef: "pyr_originalBank", providerStatus: "requires_action", status: "pending", bindingVerified: true } });
    expect(p.observed).toHaveBeenCalledOnce();
    expect(p.fetcher.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });
  it("leaves a complete empty original lookup unresolved without any POST", async () => {
    const p = provider(() => ({ data: [], has_more: false }));
    expect(await p.recover()).toEqual({ state: "unresolved" });
    expect(p.observed).not.toHaveBeenCalled();
    expect(p.fetcher.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });
  it.each(["direct", "destination"] as const)("reads an original %s refund only in its original charge namespace", async kind => {
    const p = provider(() => refund());
    const route = kind === "direct" ? { providerAccountId: "acct_originalSeller", destinationAccountId: undefined, settlementMerchantAccountId: undefined } : {};
    expect(await p.recover({ ...route, originalRefundRef: "re_original" })).toMatchObject({ state: "observed", evidence: { providerRef: "re_original", amountMinor: 400, currency: "CAD", bindingVerified: true, transferReversalRef: "trr_original" } });
    for (const [input, init] of p.fetcher.mock.calls) {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      expect(new Headers(init?.headers).get("stripe-account")).toBe(url.pathname === "/v1/account" || kind === "destination" ? null : "acct_originalSeller");
    }
  });
  it("preserves cash refund evidence before a later inventory page fails", async () => {
    const p = provider(url => url.searchParams.has("starting_after") ? new Response(JSON.stringify({ error: { code: "temporary_failure" } }), { status: 503 }) : { data: [refund()], has_more: true });
    await expect(p.recover()).rejects.toMatchObject({ code: "provider_failure" });
    expect(p.observed).toHaveBeenCalledWith(expect.objectContaining({ providerRef: "re_original", status: "succeeded", amountMinor: 400 }));
  });
  it("retains contradictory actual money without applying it to the expected refund", async () => {
    const p = provider(() => ({ data: [refund({ payment_intent: "pi_contradictory", amount: 450, currency: "usd" })], has_more: false }));
    expect(await p.recover()).toMatchObject({ state: "observed", evidence: { paymentProviderRef: "pi_contradictory", amountMinor: 450, currency: "USD", status: "succeeded", bindingVerified: false } });
    expect(p.observed).toHaveBeenCalledOnce();
  });
  it("retains every original matching refund and refuses to choose between duplicate effects", async () => {
    const p = provider(() => ({ data: [refund(), refund({ id: "re_extra" })], has_more: false }));
    expect(await p.recover()).toEqual({ state: "ambiguous", refundRefs: ["re_original", "re_extra"] });
    expect(p.observed).toHaveBeenCalledTimes(2);
  });
  it("uses an immutable original ACK even if resource metadata was later removed", async () => {
    const p = provider(() => refund({ metadata: {} }));
    expect(await p.recover({ originalRefundRef: "re_original" })).toMatchObject({ state: "observed", evidence: { bindingVerified: true } });
    await expect(p.recover({ candidateRefundRef: "re_original" })).rejects.toMatchObject({ code: "provider_failure" });
  });
  it("keeps failed and canceled actual refund outcomes distinct from a missing reply", async () => {
    const p = provider(() => refund({ status: "canceled" }));
    expect(await p.recover({ candidateRefundRef: "re_original" })).toMatchObject({ state: "observed", evidence: { status: "failed", failureCode: "provider_cancelled", bindingVerified: true } });
    expect(p.observed).toHaveBeenCalledOnce();
  });
  it("does not lose primary cash facts when an auxiliary reversal reference is unavailable", async () => {
    const p = provider(() => refund({ charge: {}, transfer_reversal: {} }));
    expect(await p.recover({ originalRefundRef: "re_original" })).toMatchObject({ state: "observed", evidence: { status: "succeeded", bindingVerified: true } });
    expect(p.observed).toHaveBeenCalledOnce();
  });
  it("refuses another platform before reading any refund", async () => {
    const p = provider(() => refund(), "acct_otherPlatform");
    await expect(p.recover({ originalRefundRef: "re_original" })).rejects.toMatchObject({ code: "authentication" });
    expect(p.fetcher).toHaveBeenCalledOnce();
  });
  it("preserves the scheduled payment's original protocol for every recovery read", async () => {
    const p = provider(() => refund());
    await p.recover({ originalRefundRef: "re_original", providerApiVersion: "2026-10-28.endive" });
    expect(p.fetcher.mock.calls.every(([, init]) => new Headers(init?.headers).get("stripe-version") === "2026-10-28.endive")).toBe(true);
  });
  it("recovers actual scheduled cash without creating a local payment identity", async () => {
    const receiptId = "00000000-0000-4000-8000-000000000033";
    const p = provider(() => ({ data: [refund({ metadata: { freeholder_refund_id: original.refundAttemptId,
      freeholder_subscription_charge_receipt_id: receiptId, freeholder_platform_account_id: original.providerPlatformAccountId } })], has_more: false }));
    expect(await p.recover({ paymentId: undefined, subscriptionChargeReceiptId: receiptId, providerApiVersion: "2026-10-28.endive" }))
      .toMatchObject({ state: "observed", evidence: { bindingVerified: true, providerStatus: "succeeded" } });
    expect(p.fetcher.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });
  it("retains nullable linkage and raw status without guessing successful binding", async () => {
    const p = provider(() => refund({ payment_intent: null, status: null }));
    expect(await p.recover({ originalRefundRef: "re_original" })).toMatchObject({ state: "observed", evidence: {
      paymentProviderRef: null, status: "pending", providerStatus: null, bindingVerified: false } });
    expect(p.observed).toHaveBeenCalledOnce();
  });
  it("retains raw customer-action and bank-return evidence independently of normalized status", async () => {
    const p = provider(() => refund({ status: "requires_action", failure_reason: "expired_or_canceled_card", failure_balance_transaction: "txn_return" }));
    expect(await p.recover({ originalRefundRef: "re_original" })).toMatchObject({ evidence: {
      status: "pending", providerStatus: "requires_action", failureReason: "expired_or_canceled_card", failureBalanceTransactionRef: "txn_return" } });
  });
  it("retains original-account dashboard refunds without assigning mutable metadata to our request", async () => {
    const p = provider(() => ({ data: [refund({ metadata: {} })], has_more: false }));
    expect(await p.recover()).toEqual({ state: "unresolved" });
    expect(p.observed).toHaveBeenCalledWith(expect.objectContaining({ providerRef: "re_original", bindingVerified: false, amountMinor: 400 }));
  });
  it("requires one actual cash owner before the first provider read", async () => {
    const p = provider(() => refund());
    await expect(p.recover({ paymentId: undefined })).rejects.toMatchObject({ code: "provider_failure" });
    await expect(p.recover({ subscriptionChargeReceiptId: "00000000-0000-4000-8000-000000000033" })).rejects.toMatchObject({ code: "provider_failure" });
    expect(p.fetcher).not.toHaveBeenCalled();
  });

  it.each(["direct", "destination"] as const)("creates one original %s customer refund with fee/reversal work separate", async kind => {
    const stages: string[] = [];
    const p = provider((url, init) => {
      expect(url.pathname).toBe("/v1/refunds");
      expect(init.method).toBe("POST");
      if (typeof init.body !== "string") throw new Error("Use the exact admitted encoded refund body.");
      const form = new URLSearchParams(init.body);
      expect(form.get("payment_intent")).toBe(original.paymentProviderRef);
      expect(form.get("amount")).toBe("400");
      expect(form.get("metadata[freeholder_refund_id]")).toBe(original.refundAttemptId);
      expect(form.get("metadata[freeholder_payment_id]")).toBe(original.paymentId);
      expect(form.has("refund_application_fee")).toBe(false);
      expect(form.has("reverse_transfer")).toBe(false);
      expect(new Headers(init.headers).get("idempotency-key")).toBe("original-refund-key");
      expect(new Headers(init.headers).get("stripe-account")).toBe(kind === "direct" ? "acct_originalSeller" : null);
      stages.push("POST");
      return refund({ metadata: {} });
    });
    if (!p.adapter.createMerchantRefund) throw new Error("Original cash refund creation is required.");
    const route = kind === "direct" ? { providerAccountId: "acct_originalSeller", destinationAccountId: undefined, settlementMerchantAccountId: undefined } : {};
    expect(await p.adapter.createMerchantRefund({ ...original, ...route, idempotencyKey: "original-refund-key", frozenBody: stripeMerchantRefundBody({ ...original, ...route }),
      onRefundResourceAcknowledged: async ref => { expect(ref).toBe("re_original"); stages.push("ACK"); },
      onRefundObserved: async actual => { expect(actual.bindingVerified).toBe(true); stages.push("cash"); } }))
      .toMatchObject({ providerRef: "re_original", providerStatus: "succeeded" });
    expect(stages).toEqual(["POST", "ACK", "cash"]);
    expect(p.fetcher.mock.calls).toHaveLength(2); // Original platform identity plus exactly one POST.
  });
  it("commits the returned physical resource before malformed money can fail application", async () => {
    const p = provider(() => refund({ amount: null })), acknowledged: string[] = [];
    if (!p.adapter.createMerchantRefund) throw new Error("Original refund creation is required.");
    await expect(p.adapter.createMerchantRefund({ ...original, idempotencyKey: "original-refund-key", frozenBody: stripeMerchantRefundBody(original), onRefundObserved: p.observed,
      onRefundResourceAcknowledged: async ref => { acknowledged.push(ref); } })).rejects.toMatchObject({ code: "provider_failure" });
    expect(acknowledged).toEqual(["re_original"]);
    expect(p.observed).not.toHaveBeenCalled();
    expect(p.fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });
  it("creates a scheduled-cash return with the real receipt and no invented payment metadata", async () => {
    const receiptId = "00000000-0000-4000-8000-000000000033";
    const p = provider((_url, init) => {
      if (typeof init.body !== "string") throw new Error("Use the exact admitted encoded refund body.");
      const form = new URLSearchParams(init.body);
      expect(form.has("metadata[freeholder_payment_id]")).toBe(false);
      expect(form.get("metadata[freeholder_subscription_charge_receipt_id]")).toBe(receiptId);
      expect(new Headers(init.headers).get("stripe-version")).toBe("2026-10-28.endive");
      return refund();
    });
    if (!p.adapter.createMerchantRefund) throw new Error("Original refund creation is required.");
    await p.adapter.createMerchantRefund({ ...original, paymentId: undefined, subscriptionChargeReceiptId: receiptId,
      providerApiVersion: "2026-10-28.endive", idempotencyKey: "original-refund-key", frozenBody: stripeMerchantRefundBody({ ...original, paymentId: undefined, subscriptionChargeReceiptId: receiptId }), onRefundObserved: p.observed,
      onRefundResourceAcknowledged: async () => undefined });
    expect(p.observed).toHaveBeenCalledOnce();
  });
  it("refuses a changed platform before any physical refund POST", async () => {
    const p = provider(() => refund(), "acct_changedPlatform");
    if (!p.adapter.createMerchantRefund) throw new Error("Original refund creation is required.");
    await expect(p.adapter.createMerchantRefund({ ...original, idempotencyKey: "original-refund-key", frozenBody: stripeMerchantRefundBody(original), onRefundObserved: p.observed,
      onRefundResourceAcknowledged: async () => undefined })).rejects.toMatchObject({ code: "authentication" });
    expect(p.fetcher.mock.calls).toHaveLength(1);
    expect(p.fetcher.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });

  it("refuses changed transport parameters before any provider call", async () => {
    const p = provider(() => refund());
    if (!p.adapter.createMerchantRefund) throw new Error("Original refund creation is required.");
    await expect(p.adapter.createMerchantRefund({ ...original, idempotencyKey: "original-refund-key", frozenBody: "payment_intent=pi_changed&amount=400",
      onRefundObserved: p.observed, onRefundResourceAcknowledged: async () => undefined })).rejects.toMatchObject({ code: "invalid_request" });
    expect(p.fetcher).not.toHaveBeenCalled();
  });

});
