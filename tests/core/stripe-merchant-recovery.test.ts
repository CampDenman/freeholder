// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.26/C12.38: original Checkout recovery never manufactures no-effect proof.
import { describe, expect, it, vi } from "vitest";
import { createStripePayments } from "@/adapters/payments/stripe";
import type { MerchantPaymentRecoveryRequest } from "@/adapters/payments/types";

const request: MerchantPaymentRecoveryRequest = {
  providerPlatformAccountId: "acct_platform", destinationAccountId: "acct_seller", settlementMerchantAccountId: "acct_seller",
  paymentAttemptId: "34cbbd41-75db-4c78-a0c5-5f2fd342d921", invoiceId: "b29a005b-aef5-4c99-94e0-c98630870854", contactId: "a028eff0-638d-447c-bdc1-585052b66157",
  amountMinor: 1200, currency: "CAD", createdAt: "2026-11-01T00:00:00.000Z", idempotencyKey: "recovery-original",
};
const metadata = { freeholder_payment_id: request.paymentAttemptId, freeholder_platform_account_id: request.providerPlatformAccountId, freeholder_contact_id: request.contactId, freeholder_invoice_id: request.invoiceId };
function session(changes: Record<string, unknown> = {}) {
  return { id: "cs_original", mode: "payment", metadata, client_reference_id: request.invoiceId, created: Date.parse(request.createdAt) / 1000,
    amount_total: 1200, currency: "cad", status: "open", payment_status: "unpaid", payment_intent: null,
    url: "https://checkout.stripe.com/original", expires_at: Date.parse("2026-11-02T00:00:00.000Z") / 1000, ...changes };
}
function intent(changes: Record<string, unknown> = {}) {
  return { id: "pi_original", metadata, status: "succeeded", amount: 1200, amount_received: 1200, currency: "cad", application_fee_amount: 100,
    transfer_data: { destination: "acct_seller" }, on_behalf_of: "acct_seller", ...changes };
}
function provider(respond: (url: URL, init: RequestInit) => unknown) {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const value = url.pathname === "/v1/account" ? { id: "acct_platform" } : respond(url, init);
    return value instanceof Response ? value : Response.json(value);
  });
  const adapter = createStripePayments({ secretKey: "sk_recovery_scope_fixture", webhookSecrets: ["whsec_recovery_scope_fixture"], apiBase: "https://stripe.example.test", fetch: fetcher });
  if (!adapter.recoverMerchantPayment || !adapter.retireMerchantPayment) throw new Error("Stripe must recover its original merchant requests.");
  return { fetcher, recover: adapter.recoverMerchantPayment.bind(adapter), retire: adapter.retireMerchantPayment.bind(adapter) };
}

describe("original merchant Checkout recovery (C12.26/C12.38)", () => {
  it.each(["freeholder_contact_id", "freeholder_invoice_id"])("refuses terminal-zero proof for contradictory original %s", async field => {
    const p = provider(() => session({ status: "expired", url: null, metadata: { ...metadata, [field]: "00000000-0000-4000-8000-000000000999" } }));
    await expect(p.recover({ ...request, checkoutRef: "cs_original" })).rejects.toMatchObject({ code: "provider_failure" });
    expect(p.fetcher.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });
  it.each(["freeholder_contact_id", "freeholder_invoice_id"])("retains positive cash but refuses customer application for contradictory original %s", async field => {
    const observed = vi.fn(async () => undefined);
    const p = provider(() => session({ status: "complete", payment_status: "paid", payment_intent: intent(), metadata: { ...metadata, [field]: "00000000-0000-4000-8000-000000000999" } }));
    expect(await p.retire({ ...request, checkoutRef: "cs_original", onPaymentObserved: observed })).toMatchObject({ state: "paid", evidence: { amountMinor: 1200, currency: "CAD", customerChargeVerified: false, merchantRouteVerified: false } });
    expect(observed).toHaveBeenCalledWith("cs_original", expect.objectContaining({ status: "succeeded", amountMinor: 1200, customerChargeVerified: false }));
    expect(p.fetcher.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });
  it("finds a lost original session across complete pages after the CREATE replay window without another CREATE", async () => {
    const p = provider(url => {
      if (url.pathname === "/v1/checkout/sessions") return url.searchParams.has("starting_after")
        ? { data: [session()], has_more: false } : { data: [session({ id: "cs_unrelated", metadata: {} })], has_more: true };
      return session();
    });
    expect(await p.recover(request)).toMatchObject({ state: "open", checkout: { providerRef: "cs_original", providerPlatformAccountId: "acct_platform", destinationAccountId: "acct_seller", settlementMerchantAccountId: "acct_seller" } });
    expect(p.fetcher.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
    for (const [, init] of p.fetcher.mock.calls) expect(new Headers(init?.headers).has("stripe-account")).toBe(false);
  });

  it("keeps an empty complete lookup unresolved, without a not-paid claim or new key", async () => {
    const p = provider(() => ({ data: [], has_more: false }));
    expect(await p.retire(request)).toEqual({ state: "unresolved" });
    expect(p.fetcher.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });

  it("commits a positive page observation before a later page can fail", async () => {
    const positive = vi.fn(async () => undefined);
    const p = provider(url => url.searchParams.has("starting_after")
      ? new Response(JSON.stringify({ error: { code: "temporary_failure" } }), { status: 503 })
      : { data: [session({ status: "complete", payment_status: "paid", payment_intent: "pi_original" })], has_more: true });
    await expect(p.recover({ ...request, onPaymentObserved: positive })).rejects.toMatchObject({ code: "provider_failure" });
    expect(positive).toHaveBeenCalledWith("cs_original", expect.objectContaining({ status: "succeeded", amountMinor: 1200, customerChargeVerified: false }));
  });

  it("retains the expiry acknowledgement before a failed follow-up read and later proves the same original session terminal", async () => {
    const acknowledgement = vi.fn(async () => undefined);
    let expired = false, failRead = true;
    const p = provider((url, init) => {
      if (url.pathname.endsWith("/expire")) { expired = true; return session({ status: "expired", url: null }); }
      if (expired && failRead) return new Response(JSON.stringify({ error: { code: "temporary_failure" } }), { status: 503 });
      expect(init.method).toBe("GET");
      return session(expired ? { status: "expired", url: null } : {});
    });
    await expect(p.retire({ ...request, checkoutRef: "cs_original", onRetirementAcknowledged: acknowledgement })).rejects.toMatchObject({ code: "provider_failure" });
    expect(acknowledgement).toHaveBeenCalledWith({ checkoutRef: "cs_original", kind: "session_expired" });
    failRead = false;
    expect(await p.recover({ ...request, checkoutRef: "cs_original" })).toEqual({ state: "not_paid", checkoutRef: "cs_original", sessionStatus: "expired", intentStatus: null, amountReceivedMinor: 0 });
    expect(p.fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });

  it("preserves paid money and refuses to expire an already completed charge", async () => {
    const observed = vi.fn(async () => undefined);
    const p = provider(() => session({ status: "complete", payment_status: "paid", payment_intent: intent() }));
    expect(await p.retire({ ...request, checkoutRef: "cs_original", onPaymentObserved: observed })).toMatchObject({ state: "paid", evidence: { providerRef: "pi_original", status: "succeeded", customerChargeVerified: true } });
    expect(observed).toHaveBeenCalledOnce();
    expect(p.fetcher.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });

  it.each(["complete", "expired"])("keeps an actual processing intent pending even when its Session is %s", async status => {
    const p = provider(() => session({ status, payment_intent: intent({ status: "processing", amount_received: 0 }) }));
    expect(await p.retire({ ...request, checkoutRef: "cs_original" })).toMatchObject({ state: "pending", evidence: { status: "pending" } });
    expect(p.fetcher.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });

  it("uses only Stripe's documented requires_capture exception and reports the actual complete Session state", async () => {
    const acknowledgement = vi.fn(async () => undefined);
    const p = provider(url => url.pathname.endsWith("/cancel")
      ? intent({ status: "canceled", amount_received: 0 })
      : session({ status: "complete", payment_intent: intent({ status: "requires_capture", amount_received: 0 }) }));
    expect(await p.retire({ ...request, checkoutRef: "cs_original", onRetirementAcknowledged: acknowledgement })).toEqual({ state: "not_paid", checkoutRef: "cs_original", paymentRef: "pi_original", sessionStatus: "complete", intentStatus: "canceled", amountReceivedMinor: 0 });
    expect(acknowledgement).toHaveBeenCalledWith({ checkoutRef: "cs_original", paymentRef: "pi_original", kind: "intent_canceled" });
    expect(p.fetcher.mock.calls.filter(([, init]) => init?.method === "POST").map(([url]) => url)).toEqual(["https://stripe.example.test/v1/payment_intents/pi_original/cancel"]);
  });

  it("retains a positive duplicate candidate and refuses to choose or cancel either resource", async () => {
    const observed = vi.fn(async () => undefined);
    const p = provider(() => ({ data: [session({ status: "complete", payment_status: "paid", payment_intent: "pi_original" }), session({ id: "cs_duplicate" })], has_more: false }));
    expect(await p.retire({ ...request, onPaymentObserved: observed })).toEqual({ state: "ambiguous", checkoutRefs: ["cs_original", "cs_duplicate"] });
    expect(observed).toHaveBeenCalledOnce();
    expect(p.fetcher.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });

  it("refuses an unrelated owner-supplied session before cancellation", async () => {
    const p = provider(() => session({ metadata: { ...metadata, freeholder_payment_id: "7a1b1578-a0c4-4ea4-89e6-90135731c93b" } }));
    await expect(p.retire({ ...request, checkoutRef: "cs_original" })).rejects.toMatchObject({ code: "provider_failure" });
    expect(p.fetcher.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });

  it("preserves original direct-charge scope through recovery and expiry", async () => {
    let expired = false;
    const p = provider(url => { if (url.pathname.endsWith("/expire")) expired = true; return session(expired ? { status: "expired", url: null } : {}); });
    expect(await p.retire({ ...request, providerAccountId: "acct_seller", destinationAccountId: undefined, settlementMerchantAccountId: undefined, checkoutRef: "cs_original" })).toMatchObject({ state: "not_paid" });
    for (const [url, init] of p.fetcher.mock.calls) {
      const address = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
      expect(new Headers(init?.headers).get("stripe-account")).toBe(address.endsWith("/v1/account") ? null : "acct_seller");
    }
  });
});
