// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: saved-card recovery uses the real original PaymentIntent namespace.
import { describe, expect, it, vi } from "vitest";
import { createStripePayments } from "@/adapters/payments/stripe";
import type { MerchantIntentRecoveryRequest } from "@/adapters/payments/types";

const original: MerchantIntentRecoveryRequest = { providerPlatformAccountId: "acct_platform", destinationAccountId: "acct_seller", settlementMerchantAccountId: "acct_seller",
  paymentAttemptId: "34cbbd41-75db-4c78-a0c5-5f2fd342d921", invoiceId: "b29a005b-aef5-4c99-94e0-c98630870854", contactId: "a028eff0-638d-447c-bdc1-585052b66157",
  amountMinor: 1200, currency: "CAD", createdAt: "2026-11-01T00:00:00.000Z", idempotencyKey: "original-saved-method" };
const metadata = { freeholder_payment_id: original.paymentAttemptId, freeholder_platform_account_id: original.providerPlatformAccountId, freeholder_invoice_id: original.invoiceId, freeholder_contact_id: original.contactId };
function intent(changes: Record<string, unknown> = {}) {
  return { id: "pi_original", created: Date.parse(original.createdAt) / 1000, metadata, amount: 1200, amount_received: 0, currency: "cad", status: "requires_action",
    application_fee_amount: 100, transfer_data: { destination: "acct_seller" }, on_behalf_of: "acct_seller", ...changes };
}
function provider(response: (url: URL, init: RequestInit) => unknown, platform = "acct_platform") {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const result = url.pathname === "/v1/account" ? { id: platform } : response(url, init);
    return result instanceof Response ? result : Response.json(result);
  });
  const adapter = createStripePayments({ secretKey: "sk_saved_recovery_fixture", webhookSecrets: ["whsec_saved_recovery_fixture"], apiBase: "https://stripe.example.test", fetch: fetcher });
  if (!adapter.recoverMerchantIntent || !adapter.retireMerchantIntent) throw new Error("Original saved-card recovery is required.");
  return { fetcher, recover: adapter.recoverMerchantIntent.bind(adapter), retire: adapter.retireMerchantIntent.bind(adapter) };
}
describe("original saved-card PaymentIntent recovery (C12.38)", () => {
  it("does not infer no charge from an empty complete list or create another payment", async () => {
    const p = provider(() => ({ data: [], has_more: false }));
    expect(await p.retire(original)).toEqual({ state: "unresolved" });
    expect(p.fetcher.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });
  it.each(["direct", "destination"])("cancels only the exact original %s intent and retains its ACK before a failing final read", async kind => {
    let canceled = false;
    const ack = vi.fn(async () => undefined), scope = kind === "direct" ? { ...original, destinationAccountId: undefined, settlementMerchantAccountId: undefined, providerAccountId: "acct_seller" } : original;
    const originalRoute = kind === "direct" ? { transfer_data: null, on_behalf_of: null } : {};
    const p = provider((url, init) => {
      if (url.pathname.endsWith("/cancel")) {
        expect(new Headers(init.headers).get("idempotency-key")).toBe(`${original.idempotencyKey}:cancel`);
        canceled = true; return intent({ ...originalRoute, status: "canceled" });
      }
      if (canceled) return new Response(JSON.stringify({ error: { code: "temporary_failure" } }), { status: 503 });
      return intent(originalRoute);
    });
    await expect(p.retire({ ...scope, paymentRef: "pi_original", onRetirementAcknowledged: ack })).rejects.toMatchObject({ code: "provider_failure" });
    expect(ack).toHaveBeenCalledWith({ paymentRef: "pi_original", kind: "intent_canceled" });
    for (const [input, init] of p.fetcher.mock.calls) {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      expect(new Headers(init?.headers).get("stripe-account")).toBe(url.pathname === "/v1/account" || kind === "destination" ? null : "acct_seller");
    }
    expect(p.fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });
  it("accepts exact original canceled zero money, without another cancellation", async () => {
    const p = provider(() => intent({ status: "canceled" }));
    expect(await p.retire({ ...original, paymentRef: "pi_original" })).toEqual({ state: "not_paid", paymentRef: "pi_original", intentStatus: "canceled", amountReceivedMinor: 0 });
    expect(p.fetcher.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });
  it.each(["freeholder_contact_id", "freeholder_invoice_id"])("does not turn contradictory original %s into terminal absence", async field => {
    const p = provider(() => intent({ status: "canceled", metadata: { ...metadata, [field]: "00000000-0000-4000-8000-000000000999" } }));
    await expect(p.recover({ ...original, paymentRef: "pi_original" })).rejects.toMatchObject({ code: "provider_failure" });
  });
  it("preserves actual overpayment and contradictory customer binding as paid review debt", async () => {
    const observed = vi.fn(async () => undefined), p = provider(() => intent({ status: "succeeded", amount_received: 1300, currency: "usd", metadata: { ...metadata, freeholder_contact_id: "00000000-0000-4000-8000-000000000999" } }));
    expect(await p.retire({ ...original, paymentRef: "pi_original", onPaymentObserved: observed })).toMatchObject({ state: "paid", evidence: { amountMinor: 1300, currency: "USD", customerChargeVerified: false } });
    expect(observed).toHaveBeenCalledWith(expect.objectContaining({ amountMinor: 1300, currency: "USD", status: "succeeded" }));
    expect(p.fetcher.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });
  it("retains partial captured money while leaving its unfinished authorization unretired", async () => {
    const observed = vi.fn(async () => undefined), p = provider(() => intent({ status: "requires_capture", amount_received: 400 }));
    expect(await p.retire({ ...original, paymentRef: "pi_original", onPaymentObserved: observed })).toMatchObject({ state: "paid", evidence: { amountMinor: 400, customerChargeVerified: false, merchantRouteVerified: false, merchantSettlementVerified: false } });
    expect(observed).toHaveBeenCalledOnce();
    expect(p.fetcher.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });
  it("does not project a still-open authorization as complete even when its captured amount equals this invoice attempt", async () => {
    const observed = vi.fn(async () => undefined), p = provider(() => intent({ status: "requires_capture", amount: 1600, amount_received: original.amountMinor, amount_capturable: 400 }));
    expect(await p.recover({ ...original, paymentRef: "pi_original", onPaymentObserved: observed })).toMatchObject({ state: "paid", evidence: { amountMinor: original.amountMinor, customerChargeVerified: false } });
    expect(observed).toHaveBeenCalledWith(expect.objectContaining({ status: "succeeded", amountMinor: original.amountMinor, customerChargeVerified: false }));
  });
  it("commits positive page evidence before a later page fails", async () => {
    const observed = vi.fn(async () => undefined), p = provider(url => url.searchParams.has("starting_after")
      ? new Response(JSON.stringify({ error: { code: "temporary_failure" } }), { status: 503 })
      : { data: [intent({ status: "succeeded", amount_received: 1200 })], has_more: true });
    await expect(p.recover({ ...original, onPaymentObserved: observed })).rejects.toMatchObject({ code: "provider_failure" });
    expect(observed).toHaveBeenCalledWith(expect.objectContaining({ status: "succeeded", amountMinor: 1200 }));
  });
  it("retains all matching positive resources and reports ambiguity rather than choosing one", async () => {
    const observed = vi.fn(async () => undefined), p = provider(() => ({ data: [intent({ status: "succeeded", amount_received: 1200 }), intent({ id: "pi_other", status: "succeeded", amount_received: 1200 })], has_more: false }));
    expect(await p.recover({ ...original, onPaymentObserved: observed })).toEqual({ state: "ambiguous", paymentRefs: ["pi_original", "pi_other"] });
    expect(observed).toHaveBeenCalledTimes(2);
  });
  it("rejects another platform before reading or canceling its PaymentIntent", async () => {
    const p = provider(() => intent(), "acct_anotherplatform");
    await expect(p.retire({ ...original, paymentRef: "pi_original" })).rejects.toMatchObject({ code: "authentication" });
    expect(p.fetcher).toHaveBeenCalledOnce();
  });
});
