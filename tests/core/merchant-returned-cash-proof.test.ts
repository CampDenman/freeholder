// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { merchantReturnedCashProof, type MerchantReturnedCashEvidence } from "@/modules/invoicing/merchant-returned-cash-proof";
const original = { providerPlatformAccountId: "acct_platform", chargeAccountId: null, providerApiVersion: "2026-10-28.endive", paymentProviderRef: "pi_original", amountMinor: 1000, currency: "CAD" };
const evidence = (): MerchantReturnedCashEvidence => ({ ...original, providerChargeRef: "ch_original", paymentIntentStatus: "succeeded", amountCapturableMinor: 0, chargePaymentProviderRef: "pi_original", chargeAmountMinor: 1000, chargeCurrency: "CAD", paid: true, captured: true, refunded: true, amountRefundedMinor: 1000,
  refundsComplete: true, refunds: [{ providerRef: "re_original", paymentProviderRef: "pi_original", chargeRef: "ch_original", amountMinor: 1000, currency: "CAD", status: "succeeded" }],
  feeFieldObserved: true, fee: { providerRef: "fee_original", originatingChargeRef: "ch_original", accountId: "acct_seller", amountMinor: 100, refundedMinor: 100, currency: "CAD" },
  transferFieldObserved: true, transfer: { providerRef: "tr_original", sourceChargeRef: "ch_original", destinationAccountId: "acct_seller", amountMinor: 1000, reversedMinor: 1000, currency: "CAD", reversed: true },
  disputesComplete: true, disputes: [] });
const prove = (value = evidence(), creatorsQuiesced = true, inventoryStable = true) => merchantReturnedCashProof({ original, evidence: value, creatorsQuiesced, inventoryStable });
describe("fully returned original cash proof without a fictitious payment", () => {
  it("requires full actual customer, original fee and recipient reversal proof", () => {
    expect(prove()).toEqual({ settled: true, debt: [] });
    expect(prove({ ...evidence(), fee: { ...evidence().fee!, refundedMinor: 99 } })).toMatchObject({ settled: false, debt: ["commission"] });
    expect(prove({ ...evidence(), transfer: { ...evidence().transfer!, reversedMinor: 999 } })).toMatchObject({ settled: false, debt: ["recipient"] });
  });
  it("does not settle a refund while an original physical creator can still act", () => {
    expect(prove(evidence(), false)).toEqual({ settled: false, debt: ["unfinished_creator"] });
    expect(prove(evidence(), true, false)).toEqual({ settled: false, debt: ["changed_inventory"] });
  });
  it("rejects a foreign charge namespace or extra positive cash rather than clipping it", () => {
    expect(prove({ ...evidence(), chargeAccountId: "acct_other" })).toMatchObject({ settled: false, debt: ["original_cash"] });
    expect(prove({ ...evidence(), amountMinor: 1100 })).toMatchObject({ settled: false, debt: ["original_cash"] });
  });
  it("cannot use an empty or truncated list to replace actual successful refund resources", () => {
    expect(prove({ ...evidence(), refunds: [] })).toMatchObject({ settled: false, debt: ["customer_refund"] });
    expect(prove({ ...evidence(), refundsComplete: false })).toMatchObject({ settled: false, debt: ["customer_refund"] });
  });
  it("keeps nullable and customer-action refunds pending even with an optimistic charge projection", () => {
    for (const status of [null, "pending", "requires_action"] as const) expect(prove({ ...evidence(), refunds: [{ ...evidence().refunds[0]!, status }] })).toMatchObject({ settled: false, debt: ["customer_refund"] });
  });
  it("never double counts duplicate resources or ignores an actual wrong-currency return", () => {
    expect(prove({ ...evidence(), refunds: [...evidence().refunds, ...evidence().refunds] })).toMatchObject({ settled: false, debt: ["customer_refund"] });
    expect(prove({ ...evidence(), refunds: [{ ...evidence().refunds[0]!, currency: "USD" }] })).toMatchObject({ settled: false, debt: ["customer_refund"] });
  });
  it("distinguishes provider absence of fee/transfer from an omitted field", () => {
    expect(prove({ ...evidence(), fee: null, transfer: null })).toEqual({ settled: true, debt: [] });
    expect(prove({ ...evidence(), fee: null, feeFieldObserved: false })).toMatchObject({ settled: false, debt: ["commission"] });
    expect(prove({ ...evidence(), transfer: null, transferFieldObserved: false })).toMatchObject({ settled: false, debt: ["recipient"] });
  });
  it("retains fee or recipient identity contradictions despite complete money totals", () => {
    const value = evidence();
    expect(prove({ ...value, fee: { ...value.fee!, originatingChargeRef: "ch_foreign" } })).toMatchObject({ debt: ["commission"] });
    expect(prove({ ...value, transfer: { ...value.transfer!, sourceChargeRef: "ch_foreign" } })).toMatchObject({ debt: ["recipient"] });
  });
  it("requires final current dispute coverage and preserves lost/open recovery debt", () => {
    expect(prove({ ...evidence(), disputesComplete: false })).toMatchObject({ debt: ["dispute"] });
    for (const status of ["lost", "needs_response", "under_review"]) expect(prove({ ...evidence(), disputes: [{ providerRef: "du_original", chargeRef: "ch_original", status }] })).toMatchObject({ debt: ["dispute"] });
    expect(prove({ ...evidence(), disputes: [{ providerRef: "du_original", chargeRef: "ch_original", status: "won" }] })).toMatchObject({ settled: true });
  });
  it("does not close returned captured cash while the original PI can still capture more", () => {
    expect(prove({ ...evidence(), paymentIntentStatus: "requires_capture", amountCapturableMinor: 500 })).toMatchObject({ settled: false, debt: ["original_cash"] });
    expect(prove({ ...evidence(), amountCapturableMinor: null })).toMatchObject({ settled: false, debt: ["original_cash"] });
  });

});
