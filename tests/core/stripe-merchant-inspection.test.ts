// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { inspectStripeMerchantPayment } from "@/adapters/payments/stripe-merchant-inspection";
import type { CheckoutCaptureResult, PaymentAccountScope } from "@/adapters/payments/types";

const request = { providerPlatformAccountId: "acct_platform", destinationAccountId: "acct_seller", settlementMerchantAccountId: "acct_seller", paymentAttemptId: "34cbbd41-75db-4c78-a0c5-5f2fd342d921", providerRef: "pi_original" };
const intent = { id: "pi_original", status: "succeeded", amount_received: 1200, currency: "cad", application_fee_amount: 100, latest_charge: "ch_original", transfer_data: { destination: "acct_seller" }, on_behalf_of: "acct_seller", metadata: { freeholder_payment_id: request.paymentAttemptId, freeholder_platform_account_id: "acct_platform" } };
const charge = { id: "ch_original", payment_intent: "pi_original", paid: true, captured: true, status: "succeeded", amount_captured: 1200, currency: "cad", application_fee: "fee_original", transfer: "tr_original" };
const fee = { id: "fee_original", account: "acct_seller", charge: "py_destination", originating_transaction: "ch_original", amount: 100, amount_refunded: 0, currency: "cad" };
const transfer = { id: "tr_original", source_transaction: "ch_original", destination: "acct_seller", amount: 1200, currency: "cad", amount_reversed: 0, reversed: false };
function reads(responses: (Record<string, unknown> | Error)[]) {
  const calls: { path: string; scope: PaymentAccountScope }[] = [];
  const read = async (path: string, scope: PaymentAccountScope) => {
    calls.push({ path, scope });
    const result = responses.shift();
    if (result instanceof Error) throw result;
    if (!result) throw new Error("Unexpected provider read");
    return result;
  };
  return { calls, read };
}

describe("original charge and actual settlement inspection", () => {
  it("commits paid evidence before independently verifying destination charge, fee and transfer", async () => {
    const provider = reads([intent, charge, fee, transfer]);
    const observations: CheckoutCaptureResult[] = [];
    const result = await inspectStripeMerchantPayment({ ...request, onPaymentObserved: async evidence => { observations.push(evidence); } }, provider.read);
    expect(result).toMatchObject({ status: "succeeded", amountMinor: 1200, providerChargeRef: "ch_original", applicationFeeRef: "fee_original", observedApplicationFeeMinor: 100, observedFeeRefundedMinor: 0, applicationFeeCurrency: "CAD", transferRef: "tr_original", merchantSettlementVerified: true });
    expect(observations[0]).toMatchObject({ customerChargeVerified: true, merchantSettlementVerified: false });
    expect(provider.calls).toHaveLength(4);
    expect(provider.calls.every(call => !call.scope.providerAccountId)).toBe(true);
  });
  it("keeps a positive physical charge committed if its later fee read fails", async () => {
    const provider = reads([intent, charge, new Error("Fee lookup temporarily unavailable")]);
    const observations: CheckoutCaptureResult[] = [];
    await expect(inspectStripeMerchantPayment({ ...request, onPaymentObserved: async evidence => { observations.push(evidence); } }, provider.read)).rejects.toThrow("Fee lookup");
    expect(observations).toHaveLength(2);
    expect(observations[0]).toMatchObject({ status: "succeeded", amountMinor: 1200, customerChargeVerified: true });
  });
  it("keeps settlement pending when the actual fee currency differs", async () => {
    const provider = reads([intent, charge, { ...fee, currency: "usd", amount: 74 }, transfer]);
    expect(await inspectStripeMerchantPayment(request, provider.read)).toMatchObject({ status: "succeeded", observedApplicationFeeMinor: 74, applicationFeeCurrency: "USD", merchantSettlementVerified: false });
  });
  it("does not infer a destination transfer from the successful PaymentIntent", async () => {
    const provider = reads([intent, { ...charge, transfer: null }, fee]);
    expect(await inspectStripeMerchantPayment(request, provider.read)).toMatchObject({ status: "succeeded", merchantSettlementVerified: false });
    expect(provider.calls).toHaveLength(3);
  });
  it("refuses a transfer from another charge as settlement proof", async () => {
    const provider = reads([intent, charge, fee, { ...transfer, source_transaction: "ch_other" }]);
    expect(await inspectStripeMerchantPayment(request, provider.read)).toMatchObject({ status: "succeeded", merchantSettlementVerified: false });
  });
  it("does not adopt another connected charge's fee for a destination charge", async () => {
    const provider = reads([intent, charge, { ...fee, originating_transaction: "ch_other" }, transfer]);
    const result = await inspectStripeMerchantPayment(request, provider.read);
    expect(result).toMatchObject({ status: "succeeded", merchantSettlementVerified: false });
    expect(result.observedApplicationFeeMinor).toBeUndefined();
  });
  it("keeps a foreign-metadata positive intent visible without applying its customer balance", async () => {
    const provider = reads([{ ...intent, metadata: { ...intent.metadata, freeholder_payment_id: "519dc3fc-d567-4f17-b098-ff908ee22861" } }]);
    const observations: CheckoutCaptureResult[] = [];
    expect(await inspectStripeMerchantPayment({ ...request, onPaymentObserved: async evidence => { observations.push(evidence); } }, provider.read)).toMatchObject({ status: "succeeded", customerChargeVerified: false, merchantSettlementVerified: false });
    expect(observations).toHaveLength(1);
    expect(provider.calls).toHaveLength(1);
  });
  it("proves an actual scheduled invoice relation without invented payment-attempt metadata", async () => {
    const provider = reads([{ id: "in_original", subscription: "sub_original", payment_intent: "pi_original" }, { ...intent, metadata: {} }, charge, fee, transfer]);
    const { paymentAttemptId: _attempt, ...scheduled } = request;
    expect(await inspectStripeMerchantPayment({ ...scheduled, subscriptionOrigin: { providerSubscriptionRef: "sub_original", providerInvoiceRef: "in_original", providerPaymentIntentRef: "pi_original" } }, provider.read)).toMatchObject({ status: "succeeded", customerChargeVerified: true, merchantSettlementVerified: true });
    expect(provider.calls[0]?.path).toBe("/v1/invoices/in_original");
  });
  it("refuses contradictory scheduled and payment-attempt origins before provider I/O", async () => {
    const provider = reads([]);
    await expect(inspectStripeMerchantPayment({ ...request, subscriptionOrigin: { providerSubscriptionRef: "sub_original", providerInvoiceRef: "in_original", providerPaymentIntentRef: "pi_original" } }, provider.read)).rejects.toMatchObject({ code: "invalid_request" });
    expect(provider.calls).toHaveLength(0);
  });
  it("reads direct charges on the original connected account and fees on its platform", async () => {
    const direct = { providerPlatformAccountId: "acct_platform", providerAccountId: "acct_seller", paymentAttemptId: request.paymentAttemptId, providerRef: "pi_original" };
    const provider = reads([{ ...intent, transfer_data: null, on_behalf_of: null }, { ...charge, transfer: null }, { ...fee, charge: "ch_original", originating_transaction: null }]);
    expect(await inspectStripeMerchantPayment(direct, provider.read)).toMatchObject({ merchantSettlementVerified: true });
    expect(provider.calls.map(call => call.scope.providerAccountId ?? null)).toEqual(["acct_seller", "acct_seller", null]);
  });
});
