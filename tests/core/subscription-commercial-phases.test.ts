// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: disclose the first period and setup once, including deferred card trials.
import { describe, expect, it } from "vitest";
import { initialMerchantInvoiceAmounts, type SubscriptionCommercialSnapshot } from "@/modules/subscriptions/merchant-terms-contract";

const accepted: SubscriptionCommercialSnapshot = { version: 1, name: "Original membership", description: null,
  productVariantId: "00000000-0000-4000-8000-000000000080", taxCategoryCode: "standard", requiresShipping: false,
  currency: "CAD", periodAmountMinor: 2000, setupFeeMinor: 500, interval: "month", intervalCount: 1,
  trialDays: 0, trialRequiresCard: false, cancelBehaviour: "period_end", proration: "none", billingMode: "provider" };
describe("accepted merchant subscription billing phases", () => {
  it("puts the one-time setup on the initial paid period, not on a second recurring period", () => {
    const initial = initialMerchantInvoiceAmounts(accepted, { deferFirstPayment: true, hasSavedMethod: false });
    expect(initial).toMatchObject({ periodAmountMinor: 2000, setupFeeMinor: 500, firstPaidSetupFeeMinor: 0, trialing: false, awaitingCard: false });
  });
  it("quotes only setup before a card-required trial while preserving the recurring price", () => {
    const initial = initialMerchantInvoiceAmounts({ ...accepted, trialDays: 14, trialRequiresCard: true }, { deferFirstPayment: true, hasSavedMethod: false });
    expect(initial).toMatchObject({ periodAmountMinor: 0, setupFeeMinor: 500, firstPaidSetupFeeMinor: 0, trialing: false, awaitingCard: true });
    expect(accepted.periodAmountMinor).toBe(2000);
  });
  it("does not lose the original setup obligation when a free trial raises no initial invoice", () => {
    expect(initialMerchantInvoiceAmounts({ ...accepted, trialDays: 14 }, { deferFirstPayment: true, hasSavedMethod: false }))
      .toMatchObject({ periodAmountMinor: 0, setupFeeMinor: 0, firstPaidSetupFeeMinor: 500, trialing: true, awaitingCard: false });
  });
  it("does not treat a previously saved card as payment of the setup fee", () => {
    expect(initialMerchantInvoiceAmounts({ ...accepted, trialDays: 14, trialRequiresCard: true }, { deferFirstPayment: true, hasSavedMethod: true }))
      .toMatchObject({ periodAmountMinor: 0, setupFeeMinor: 0, firstPaidSetupFeeMinor: 500, trialing: true, awaitingCard: false });
  });
  it("does not manufacture a payment or setup obligation when both accepted amounts are zero", () => {
    expect(initialMerchantInvoiceAmounts({ ...accepted, periodAmountMinor: 0, setupFeeMinor: 0, trialDays: 14 }, { deferFirstPayment: true, hasSavedMethod: false }))
      .toMatchObject({ periodAmountMinor: 0, setupFeeMinor: 0, firstPaidSetupFeeMinor: 0 });
  });
});
