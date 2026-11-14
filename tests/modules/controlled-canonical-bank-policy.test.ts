// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38/C9.33. PREPARED/UNRUN: route/ancillary separation and physical union.
import { describe, expect, it } from "vitest";
import { merchantReturnedCashEvidenceSchema } from "@/modules/invoicing/merchant-returned-cash-contract";
import { controlledCanonicalBankReview, controlledPrincipalPhysicalUnion } from "@/modules/invoicing/controlled-canonical-bank-policy";
function evidence() { return merchantReturnedCashEvidenceSchema.parse({ providerPlatformAccountId: "acct_platform", chargeAccountId: null, providerApiVersion: "2026-10-28.endive",
  paymentProviderRef: "pi_original", providerChargeRef: "ch_original", amountMinor: 4200, currency: "CAD", paymentIntentStatus: "succeeded", amountCapturableMinor: 0,
  chargePaymentProviderRef: "pi_original", chargeAmountMinor: 4200, chargeCurrency: "CAD", paid: true, captured: true, refunded: false, amountRefundedMinor: 0, refundsComplete: true, refunds: [],
  feeFieldObserved: true, fee: { providerRef: "fee_original", originatingChargeRef: "ch_original", accountId: "acct_merchant", amountMinor: 84, refundedMinor: 0, currency: "CAD" },
  transferFieldObserved: true, transfer: { providerRef: "tr_original", sourceChargeRef: "ch_original", destinationAccountId: "acct_merchant", amountMinor: 4200, reversedMinor: 0, currency: "CAD", reversed: false },
  disputesComplete: true, disputes: [] }); }
const original = { amountMinor: 4200, currency: "CAD", refundedMinor: 0, applicationFeeMinor: 84, retainedFeeMinor: 84,
  collectionKind: "destination" as const, recipientAccountId: "acct_merchant", chargeRef: "ch_original", originalFeeRef: "fee_original", originalTransferRef: "tr_original" };
describe("current controlled original fee and route policy", () => {
  it("keeps original actual fee epochs even when the application used a whole-batch allocation", () => {
    expect(controlledCanonicalBankReview(original, evidence())).toEqual({ routeMatches: true, ancillaryDebtPending: false });
    const bank = evidence(); if (!bank.fee) throw Error("Original fee fixture required."); bank.fee.amountMinor = 83;
    expect(controlledCanonicalBankReview(original, bank)).toEqual({ routeMatches: true, ancillaryDebtPending: true });
  });
  it("keeps unknown ancillary reads as debt while preserving actual original route proof", () => {
    const bank = evidence(); bank.feeFieldObserved = false; bank.transferFieldObserved = false; bank.fee = null; bank.transfer = null;
    expect(controlledCanonicalBankReview(original, bank)).toEqual({ routeMatches: true, ancillaryDebtPending: true });
  });
  it.each(["destinationAccountId", "sourceChargeRef", "providerRef"] as const)("refuses a positively observed foreign %s", key => {
    const bank = evidence(); if (!bank.transfer) throw Error("Real transfer-shaped fixture required."); bank.transfer[key] = "foreign";
    expect(controlledCanonicalBankReview(original, bank).routeMatches).toBe(false);
  });
  it("uses the shared retained original fee target to reconcile actual returned commission instead of repricing Fi", () => {
    const bank = evidence(); if (!bank.fee || !bank.transfer) throw Error("Original auxiliary facts required.");
    bank.fee.refundedMinor = 42; bank.transfer.reversedMinor = 2100;
    expect(controlledCanonicalBankReview({ ...original, refundedMinor: 2100, retainedFeeMinor: 42 }, bank)).toEqual({ routeMatches: true, ancillaryDebtPending: false });
    expect(controlledCanonicalBankReview({ ...original, refundedMinor: 2100, retainedFeeMinor: null }, bank).ancillaryDebtPending).toBe(true);
  });
  it("does not permit a destination transfer for an original direct charge", () => {
    expect(controlledCanonicalBankReview({ ...original, collectionKind: "direct" }, evidence()).routeMatches).toBe(false);
  });
  it("deduplicates exact full PG identities and retains the same UUID in different physical tables", () => {
    const row = { table: "payments", id: "same", fingerprint: "a".repeat(64) };
    expect(controlledPrincipalPhysicalUnion([[row], [row, { ...row, table: "merchant_payment_observations" }]])).toHaveLength(2);
    expect(() => controlledPrincipalPhysicalUnion([[row], [{ ...row, fingerprint: "b".repeat(64) }]])).toThrow();
  });
  it("uses one aggregate 5000-row bound across disjoint namespace and parent graphs", () => {
    const rows = Array.from({ length: 5000 }, (_, n) => ({ table: "original_cash_recovery_facts", id: String(n), fingerprint: "a".repeat(64) }));
    expect(controlledPrincipalPhysicalUnion([rows, rows])).toHaveLength(5000);
    expect(() => controlledPrincipalPhysicalUnion([rows, [{ table: "payments", id: "additional", fingerprint: "b".repeat(64) }]])).toThrow();
  });
});
