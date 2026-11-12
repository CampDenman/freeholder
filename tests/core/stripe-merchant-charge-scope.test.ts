// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.26/C12.38: provider charge namespace is independent of its destination.
import { describe, expect, it, vi } from "vitest";
import { createStripePayments } from "@/adapters/payments/stripe";
import type { InvoiceForCharge, MerchantChargeScope } from "@/adapters/payments/types";

const platform = { providerPlatformAccountId: "acct_platform" };
const direct: MerchantChargeScope = { ...platform, providerAccountId: "acct_seller" };
const destination: MerchantChargeScope = { ...platform, destinationAccountId: "acct_seller", settlementMerchantAccountId: "acct_seller" };
const invoice: InvoiceForCharge = {
  invoiceId: "invoice-original", invoiceNumber: "INV-1", contactId: "contact-original", currency: "CAD", amountMinor: 1200,
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
  return { id: "pi_original", status: "succeeded", currency: "cad", amount_received: 1200, amount: 1200, application_fee_amount: 100,
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

  it("refuses replacement platform credentials before creating or reading a charge", async () => {
    const p = provider([{ id: "acct_replacement" }]);
    await expect(p.adapter.createCheckout({ ...invoice, ...destination })).rejects.toMatchObject({ code: "authentication" });
    expect(p.fetcher).toHaveBeenCalledOnce();
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
    const p = provider([{ id: "acct_platform" }, { id: "cs_original", payment_status: "paid", currency: "cad", amount_total: 1200, payment_intent: intent(scope) }]);
    const result = await p.adapter.captureCheckout({ ...scope, checkoutRef: "cs_original", idempotencyKey: "read-original" });
    expect(result).toMatchObject({ ...scope, providerRef: "pi_original", status: "succeeded", amountMinor: 1200, applicationFeeMinor: 100 });
    expect(new Headers(p.fetcher.mock.calls[1]![1]?.headers).get("stripe-account")).toBe(scope.providerAccountId ?? null);
  });

  it.each([
    { transfer_data: { destination: "acct_replacement" } },
    { transfer_data: { destination: "acct_seller", amount: 1100 } },
    { on_behalf_of: "acct_replacement" },
    { amount_received: 1199 },
    { status: "processing" },
    { application_fee_amount: undefined },
  ])("keeps incomplete or mismatched settlement evidence unresolved: %j", async change => {
    const p = provider([{ id: "acct_platform" }, { id: "cs_original", payment_status: "paid", currency: "cad", amount_total: 1200, payment_intent: { ...intent(destination), ...change } }]);
    await expect(p.adapter.captureCheckout({ ...destination, checkoutRef: "cs_original", idempotencyKey: "read-original" })).rejects.toMatchObject({ code: "provider_failure" });
  });

  it("refunds a destination charge on the platform and reverses its original transfer", async () => {
    const p = provider([{ id: "acct_platform" }, intent(destination), { id: "acct_platform" }, { id: "re_original", status: "succeeded", payment_intent: "pi_original", amount: 300, currency: "cad" }]);
    const result = await p.adapter.refund({ ...destination, paymentId: "payment-original", providerRef: "pi_original", amountMinor: 300, currency: "CAD", reverseTransfer: true, idempotencyKey: "original-refund" });
    expect(result).toMatchObject({ ...destination, status: "succeeded", providerRef: "re_original" });
    for (const [, init] of p.fetcher.mock.calls) expect(new Headers(init?.headers).has("stripe-account")).toBe(false);
    const [, init] = p.fetcher.mock.calls[3]!;
    expect(form(init).get("reverse_transfer")).toBe("true");
    expect(form(init).has("refund_application_fee")).toBe(false); // Exact frozen line fee is a separate operation.
    expect(new Headers(init?.headers).get("idempotency-key")).toBe("original-refund");
  });

  it("refuses changed destination evidence before refund dispatch", async () => {
    const p = provider([{ id: "acct_platform" }, { ...intent(destination), transfer_data: { destination: "acct_other" } }]);
    await expect(p.adapter.refund({ ...destination, paymentId: "payment-original", providerRef: "pi_original", amountMinor: 300, currency: "CAD", reverseTransfer: true, idempotencyKey: "original-refund" })).rejects.toMatchObject({ code: "provider_failure" });
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
    const result = await p.adapter.chargeSavedMethod({ ...scope, methodRef: "pm_original", customerRef: "cus_original", invoiceId: invoice.invoiceId, contactId: invoice.contactId, currency: "CAD", amountMinor: 1200, applicationFeeMinor: 100, description: invoice.description, idempotencyKey: "original-saved-charge" });
    expect(result).toMatchObject({ ...scope, providerRef: "pi_original", status: "succeeded", applicationFeeMinor: 100 });
    const [, init] = p.fetcher.mock.calls[1]!;
    expect(new Headers(init?.headers).get("stripe-account")).toBe(scope.providerAccountId ?? null);
    expect(form(init).get("transfer_data[destination]")).toBe(scope.destinationAccountId ?? null);
    expect(form(init).get("on_behalf_of")).toBe(scope.settlementMerchantAccountId ?? null);
  });

  it("refuses a destination proportional-fee refund without its required transfer reversal before I/O", async () => {
    const p = provider([]);
    await expect(p.adapter.refund({ ...destination, paymentId: "payment-original", providerRef: "pi_original", amountMinor: 300, currency: "CAD", refundApplicationFee: true, idempotencyKey: "original-refund" })).rejects.toMatchObject({ code: "invalid_request" });
    expect(p.fetcher).not.toHaveBeenCalled();
  });
});
