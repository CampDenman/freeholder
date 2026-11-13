// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.26/C12.38: provider charge namespace is independent of its destination.
import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createStripePayments } from "@/adapters/payments/stripe";
import type { InvoiceForCharge, MerchantChargeScope } from "@/adapters/payments/types";

const paymentAttemptId = "34cbbd41-75db-4c78-a0c5-5f2fd342d921";
const metadata = { freeholder_payment_id: paymentAttemptId, freeholder_platform_account_id: "acct_platform" };
const platform = { providerPlatformAccountId: "acct_platform" };
const direct: MerchantChargeScope = { ...platform, providerAccountId: "acct_seller" };
const destination: MerchantChargeScope = { ...platform, destinationAccountId: "acct_seller", settlementMerchantAccountId: "acct_seller" };
const invoice: InvoiceForCharge = {
  paymentAttemptId, invoiceId: "invoice-original", invoiceNumber: "INV-1", contactId: "contact-original", currency: "CAD", amountMinor: 1200,
  description: "Seller portion", customer: { email: "buyer@example.test" }, successUrl: "https://site.example.test/paid",
  cancelUrl: "https://site.example.test/invoice", idempotencyKey: "original-portion-attempt", applicationFeeMinor: 100,
};
function provider(responses: unknown[]) {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => {
    const response = responses.shift();
    if (response === undefined) throw new Error("Unexpected provider I/O");
    return response instanceof Response ? response : Response.json(response);
  });
  return { fetcher, adapter: createStripePayments({ secretKey: "sk_merchant_scope_fixture", webhookSecrets: ["whsec_merchant_scope_fixture"], apiBase: "https://stripe.example.test", fetch: fetcher }) };
}
function intent(scope: MerchantChargeScope) {
  return { id: "pi_original", latest_charge: "ch_original", metadata, status: "succeeded", currency: "cad", amount_received: 1200, amount: 1200, application_fee_amount: 100,
    transfer_data: scope.destinationAccountId ? { destination: scope.destinationAccountId } : null, on_behalf_of: scope.settlementMerchantAccountId ?? null };
}
function form(init?: RequestInit) {
  if (!(init?.body instanceof URLSearchParams)) throw new Error("Expected the provider's form body.");
  return init.body;
}

describe("original direct and destination charge accounts (C12.26/C12.38)", () => {
  it.each([direct, destination])("creates the charge on its actual account and freezes settlement separately: %j", async scope => {
    const p = provider([{ id: "acct_platform" }, { id: "cs_original", url: "https://checkout.stripe.com/original" }]);
    const result = await p.adapter.createCheckout({ ...invoice, ...scope });
    expect(result).toMatchObject(scope);
    expect(p.fetcher.mock.calls[0]![0]).toBe("https://stripe.example.test/v1/account");
    expect(new Headers(p.fetcher.mock.calls[0]![1]?.headers).has("stripe-account")).toBe(false);
    const [, init] = p.fetcher.mock.calls[1]!;
    expect(new Headers(init?.headers).get("stripe-account")).toBe(scope.providerAccountId ?? null);
    expect(form(init).get("payment_intent_data[transfer_data][destination]")).toBe(scope.destinationAccountId ?? null);
    expect(form(init).get("payment_intent_data[on_behalf_of]")).toBe(scope.settlementMerchantAccountId ?? null);
    expect(form(init).get("payment_intent_data[application_fee_amount]")).toBe("100");
    expect(new Headers(init?.headers).get("idempotency-key")).toBe(invoice.idempotencyKey);
  });

  function webhook(value: Record<string, unknown>, type = "payment_intent.succeeded", account?: string) {
    const at = 1_700_000_000;
    const body = JSON.stringify({ id: "evt_original", type, created: at, ...(account ? { account } : {}), data: { object: value } });
    const signature = createHmac("sha256", "whsec_merchant_scope_fixture").update(`${at}.${body}`).digest("hex");
    return { body: new TextEncoder().encode(body), headers: { "stripe-signature": `t=${at},v1=${signature}` }, receivedAt: new Date(at * 1000).toISOString() };
  }

  it.each([direct, destination])("authenticates the platform and preserves actual paid webhook routing: %j", async scope => {
    const p = provider([{ id: "acct_platform" }]);
    const events = await p.adapter.verifyWebhook(webhook(intent(scope), "payment_intent.succeeded", scope.providerAccountId));
    expect(events).toEqual([expect.objectContaining({ ...scope, kind: "payment_succeeded", providerRef: "pi_original", paymentAttemptId,
      amountMinor: 1200, applicationFeeMinor: 100, providerChargeRef: "ch_original", customerChargeVerified: true, merchantRouteVerified: true })]);
    expect(new Headers(p.fetcher.mock.calls[0]![1]?.headers).has("stripe-account")).toBe(false);
  });

  it("refuses replacement-platform webhook credentials after signature verification", async () => {
    const p = provider([{ id: "acct_replacement" }]);
    await expect(p.adapter.verifyWebhook(webhook(intent(destination)))).rejects.toMatchObject({ code: "authentication" });
    expect(p.fetcher).toHaveBeenCalledOnce();
  });

  it("retains a paid Session as positive unverified money until original intent evidence arrives", async () => {
    const p = provider([{ id: "acct_platform" }]);
    const [event] = await p.adapter.verifyWebhook(webhook({ id: "cs_original", metadata, mode: "payment", payment_status: "paid", amount_total: 1200, currency: "cad", payment_intent: "pi_original" }, "checkout.session.completed"));
    expect(event).toMatchObject({ kind: "payment_succeeded", paymentAttemptId, providerPlatformAccountId: "acct_platform", amountMinor: 1200, customerChargeVerified: false, merchantRouteVerified: false });
  });

  it("keeps actual webhook recipient disagreement and overpayment for independent review", async () => {
    const p = provider([{ id: "acct_platform" }]);
    const [event] = await p.adapter.verifyWebhook(webhook({ ...intent(destination), amount_received: 1300, transfer_data: { destination: "acct_other" } }));
    expect(event).toMatchObject({ kind: "payment_succeeded", amountMinor: 1300, destinationAccountId: "acct_other", customerChargeVerified: true });
  });

  it("retains a partial destination transfer as a settlement disagreement", async () => {
    const p = provider([{ id: "acct_platform" }]);
    const [event] = await p.adapter.verifyWebhook(webhook({ ...intent(destination), transfer_data: { destination: "acct_seller", amount: 1100 } }));
    expect(event).toMatchObject({ kind: "payment_succeeded", amountMinor: 1200, customerChargeVerified: true, merchantRouteVerified: false });
  });

  it("does not call the provider for a forged merchant webhook", async () => {
    const p = provider([]);
    const request = webhook(intent(destination));
    await expect(p.adapter.verifyWebhook({ ...request, body: new TextEncoder().encode("{}") })).rejects.toMatchObject({ code: "authentication" });
    expect(p.fetcher).not.toHaveBeenCalled();
  });

  it("refuses replacement platform credentials before creating or reading a charge", async () => {
    const p = provider([{ id: "acct_replacement" }]);
    await expect(p.adapter.createCheckout({ ...invoice, ...destination })).rejects.toMatchObject({ code: "authentication" });
    expect(p.fetcher).toHaveBeenCalledOnce();
  });

  it("requires the committed original attempt before any new merchant charge I/O", async () => {
    const p = provider([]);
    await expect(p.adapter.createCheckout({ ...invoice, ...destination, paymentAttemptId: undefined })).rejects.toMatchObject({ code: "invalid_request" });
    expect(p.fetcher).not.toHaveBeenCalled();
  });

  it("preserves an exact final commission cent even when it is the whole final instalment", async () => {
    const p = provider([{ id: "acct_platform" }, { id: "cs_original", url: "https://checkout.stripe.com/original" }]);
    await p.adapter.createCheckout({ ...invoice, ...destination, amountMinor: 1, applicationFeeMinor: 1 });
    expect(form(p.fetcher.mock.calls[1]![1]).get("payment_intent_data[application_fee_amount]")).toBe("1");
  });

  it.each(["session", "intent"] as const)("refuses another payment attempt's %s evidence", async kind => {
    const replacement = { ...metadata, freeholder_payment_id: "519dc3fc-d567-4f17-b098-ff908ee22861" };
    const p = provider([{ id: "acct_platform" }, { id: "cs_original", metadata: kind === "session" ? replacement : metadata, payment_status: "paid", currency: "cad", amount_total: 1200, payment_intent: { ...intent(destination), metadata: kind === "intent" ? replacement : metadata } }]);
    const read = p.adapter.captureCheckout({ ...destination, paymentAttemptId, checkoutRef: "cs_original", idempotencyKey: "read-original" });
    if (kind === "session") await expect(read).rejects.toMatchObject({ code: "provider_failure" });
    else expect(await read).toMatchObject({ status: "succeeded", customerChargeVerified: false, merchantRouteVerified: false });
  });

  it.each([
    { destinationAccountId: "acct_seller", settlementMerchantAccountId: "acct_seller" },
    { ...destination, providerAccountId: "acct_seller" },
    { ...destination, settlementMerchantAccountId: "acct_other" },
    { ...destination, destinationAccountId: "acct_platform", settlementMerchantAccountId: "acct_platform" },
    { ...direct, providerAccountId: "acct_platform" },
    { ...platform, settlementMerchantAccountId: "acct_seller" },
  ])("refuses contradictory account facts without I/O: %j", async scope => {
    const p = provider([]);
    await expect(p.adapter.createCheckout({ ...invoice, ...scope })).rejects.toMatchObject({ code: "invalid_request" });
    expect(p.fetcher).not.toHaveBeenCalled();
  });

  it.each([direct, destination])("reads the actual PaymentIntent route before settling: %j", async scope => {
    const p = provider([{ id: "acct_platform" }, { id: "cs_original", metadata, payment_status: "paid", currency: "cad", amount_total: 1200, payment_intent: intent(scope) }]);
    const result = await p.adapter.captureCheckout({ ...scope, paymentAttemptId, checkoutRef: "cs_original", idempotencyKey: "read-original" });
    expect(result).toMatchObject({ ...scope, providerRef: "pi_original", status: "succeeded", amountMinor: 1200, applicationFeeMinor: 100 });
    expect(new Headers(p.fetcher.mock.calls[1]![1]?.headers).get("stripe-account")).toBe(scope.providerAccountId ?? null);
  });

  it.each([
    { transfer_data: { destination: "acct_replacement" } },
    { transfer_data: { destination: "acct_seller", amount: 1100 } },
    { on_behalf_of: "acct_replacement" },
    { transfer_data: null, on_behalf_of: null },
    { application_fee_amount: undefined },
  ])("retains actual paid money while flagging a separate settlement disagreement: %j", async change => {
    const p = provider([{ id: "acct_platform" }, { id: "cs_original", metadata, payment_status: "paid", currency: "cad", amount_total: 1200, payment_intent: { ...intent(destination), ...change } }]);
    const result = await p.adapter.captureCheckout({ ...destination, paymentAttemptId, checkoutRef: "cs_original", idempotencyKey: "read-original" });
    expect(result).toMatchObject({ status: "succeeded", amountMinor: 1200, providerRef: "pi_original", merchantRouteVerified: false });
    if ("transfer_data" in change) expect(result.destinationAccountId).toBe(change.transfer_data?.destination);
  });

  it.each([
    { amount_received: 1199 },
    { amount_received: 1201 },
  ])("retains actual paid amount disagreement for unapplied-money review: %j", async change => {
    const p = provider([{ id: "acct_platform" }, { id: "cs_original", metadata, payment_status: "paid", currency: "cad", amount_total: 1200, payment_intent: { ...intent(destination), ...change } }]);
    expect(await p.adapter.captureCheckout({ ...destination, paymentAttemptId, checkoutRef: "cs_original", idempotencyKey: "read-original" })).toMatchObject({ status: "succeeded", amountMinor: change.amount_received, customerChargeVerified: true, merchantRouteVerified: false });
  });

  it("keeps a positive Session with contradictory intent state as observed money awaiting original charge proof", async () => {
    const p = provider([{ id: "acct_platform" }, { id: "cs_original", metadata, payment_status: "paid", currency: "cad", amount_total: 1200, payment_intent: { ...intent(destination), status: "processing" } }]);
    expect(await p.adapter.captureCheckout({ ...destination, paymentAttemptId, checkoutRef: "cs_original", idempotencyKey: "read-original" })).toMatchObject({ status: "succeeded", amountMinor: 1200, customerChargeVerified: false, merchantRouteVerified: false });
  });

  it("refunds a destination charge on the platform and reverses its original transfer", async () => {
    const p = provider([{ id: "acct_platform" }, intent(destination), { id: "acct_platform" }, { id: "re_original", status: "succeeded", payment_intent: "pi_original", amount: 300, currency: "cad" }]);
    const result = await p.adapter.refund({ ...destination, paymentId: paymentAttemptId, providerRef: "pi_original", amountMinor: 300, currency: "CAD", reverseTransfer: true, idempotencyKey: "original-refund" });
    expect(result).toMatchObject({ ...destination, status: "succeeded", providerRef: "re_original" });
    for (const [, init] of p.fetcher.mock.calls) expect(new Headers(init?.headers).has("stripe-account")).toBe(false);
    const [, init] = p.fetcher.mock.calls[3]!;
    expect(form(init).get("reverse_transfer")).toBe("true");
    expect(form(init).has("refund_application_fee")).toBe(false); // Exact frozen line fee is a separate operation.
    expect(new Headers(init?.headers).get("idempotency-key")).toBe("original-refund");
  });

  it.each([direct, destination])("refunds an original scheduled charge without fabricating attempt metadata: %j", async scope => {
    const p = provider([{ id: "acct_platform" }, { id: "in_original", subscription: "sub_original", payment_intent: "pi_original" }, { id: "acct_platform" }, { ...intent(scope), metadata: {} }, { id: "acct_platform" }, { id: "re_original", status: "succeeded", payment_intent: "pi_original", amount: 300, currency: "cad" }]);
    expect(await p.adapter.refund({ ...scope, paymentId: paymentAttemptId, providerRef: "pi_original", amountMinor: 300, currency: "CAD", reverseTransfer: Boolean(scope.destinationAccountId), idempotencyKey: "original-scheduled-refund", subscriptionOrigin: { providerApiVersion: "2026-10-28.endive", providerSubscriptionRef: "sub_original", providerInvoiceRef: "in_original", providerPaymentIntentRef: "pi_original" } })).toMatchObject({ status: "succeeded", providerRef: "re_original" });
    for (const [, init] of p.fetcher.mock.calls) expect(new Headers(init?.headers).get("stripe-version")).toBe("2026-10-28.endive");
    const transport = p.fetcher.mock.calls.filter(([url]) => !(typeof url === "string" ? url : url instanceof URL ? url.href : url.url).endsWith("/v1/account"));
    expect(transport).toHaveLength(3);
    for (const [, init] of transport) expect(new Headers(init?.headers).get("stripe-account")).toBe(scope.providerAccountId ?? null);
  });

  it("refuses changed destination evidence before refund dispatch", async () => {
    const p = provider([{ id: "acct_platform" }, { ...intent(destination), transfer_data: { destination: "acct_other" } }]);
    await expect(p.adapter.refund({ ...destination, paymentId: paymentAttemptId, providerRef: "pi_original", amountMinor: 300, currency: "CAD", reverseTransfer: true, idempotencyKey: "original-refund" })).rejects.toMatchObject({ code: "provider_failure" });
    expect(p.fetcher.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });

  it("retains historical direct scope without manufacturing a platform identity", async () => {
    const p = provider([{ id: "cs_original", url: "https://checkout.stripe.com/original" }]);
    const result = await p.adapter.createCheckout({ ...invoice, providerAccountId: "acct_original" });
    expect(result.providerAccountId).toBe("acct_original");
    expect(result.providerPlatformAccountId).toBeUndefined();
    expect(p.fetcher).toHaveBeenCalledOnce();
  });

  it.each([direct, destination])("keeps a saved-method charge on its own frozen route: %j", async scope => {
    const p = provider([{ id: "acct_platform" }, intent(scope)]);
    const result = await p.adapter.chargeSavedMethod({ ...scope, paymentAttemptId, methodRef: "pm_original", customerRef: "cus_original", invoiceId: invoice.invoiceId, contactId: invoice.contactId, currency: "CAD", amountMinor: 1200, applicationFeeMinor: 100, description: invoice.description, idempotencyKey: "original-saved-charge" });
    expect(result).toMatchObject({ ...scope, providerRef: "pi_original", status: "succeeded", applicationFeeMinor: 100 });
    const [, init] = p.fetcher.mock.calls[1]!;
    expect(new Headers(init?.headers).get("stripe-account")).toBe(scope.providerAccountId ?? null);
    expect(form(init).get("transfer_data[destination]")).toBe(scope.destinationAccountId ?? null);
    expect(form(init).get("on_behalf_of")).toBe(scope.settlementMerchantAccountId ?? null);
  });

  it("refuses a destination proportional-fee refund without its required transfer reversal before I/O", async () => {
    const p = provider([]);
    await expect(p.adapter.refund({ ...destination, paymentId: paymentAttemptId, providerRef: "pi_original", amountMinor: 300, currency: "CAD", refundApplicationFee: true, idempotencyKey: "original-refund" })).rejects.toMatchObject({ code: "invalid_request" });
    expect(p.fetcher).not.toHaveBeenCalled();
  });
});
