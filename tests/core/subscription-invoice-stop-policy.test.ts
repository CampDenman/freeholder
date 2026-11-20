// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: actual unpaid obligations remain distinct from money recovery.
import { describe, expect, it } from "vitest";
import { invoiceStopAction, originalProviderInvoice } from "@/modules/subscriptions/provider-invoice-action-contract";
const original = originalProviderInvoice.parse({ providerInvoiceRef: "in_original", state: "open", currency: "CAD", totalMinor: 100, paidMinor: 0, remainingMinor: 100, complete: true, periodStart: "2027-01-01T00:00:00.000Z",
  paymentIntents: [{ providerPaymentIntentRef: "pi_original", state: "requires_payment_method", amountMinor: 100, receivedMinor: 0, currency: "CAD" }] });
describe("original invoice stop policy", () => {
  it("cancels the actual unpaid PI before permitting a finalized invoice void", () => {
    expect(invoiceStopAction(original)).toEqual({ action: "cancel_intent", providerPaymentIntentRef: "pi_original" });
    expect(invoiceStopAction({ ...original, paymentIntents: [{ ...original.paymentIntents[0]!, state: "canceled" }] })).toEqual({ action: "void_invoice" });
  });
  it("leaves processing, partially received or contradictory money to original cash recovery", () => {
    for (const intent of [{ ...original.paymentIntents[0]!, state: "processing" }, { ...original.paymentIntents[0]!, receivedMinor: 20 }, { ...original.paymentIntents[0]!, currency: "USD" }]) expect(invoiceStopAction({ ...original, paymentIntents: [intent] })).toBeNull();
    expect(invoiceStopAction({ ...original, totalMinor: 101 })).toBeNull();
  });
  it("does not invent invoice-payment absence, duplicate a PI or delete subscription drafts", () => {
    expect(invoiceStopAction({ ...original, paymentIntents: [original.paymentIntents[0]!, original.paymentIntents[0]!] })).toBeNull();
    expect(invoiceStopAction({ ...original, state: "draft" })).toEqual({ action: "cancel_intent", providerPaymentIntentRef: "pi_original" });
    expect(invoiceStopAction({ ...original, state: "draft", paymentIntents: [] })).toEqual({ action: "finalize_draft" });
    expect(invoiceStopAction({ ...original, paymentIntents: [{ ...original.paymentIntents[0]!, state: "succeeded" }] })).toBeNull();
  });
});
