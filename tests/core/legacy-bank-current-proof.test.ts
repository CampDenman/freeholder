// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.19/C12.38: adversarial original-resource and actual-caller policy boundaries.
import { describe, expect, it } from "vitest";
import { legacyBankCurrentVerdict } from "@/modules/invoicing/legacy-bank-current-proof";
function actual() {
  const original = { refundId: "00000000-0000-4000-8000-000000000001", paymentId: "00000000-0000-4000-8000-000000000002", invoiceId: "00000000-0000-4000-8000-000000000003",
    provider: "stripe" as const, originalRefundRef: "pyr_original", originalPaymentRef: "pi_original", originalChargeAccountId: null,
    originalCreatePlatformAccountId: null, originalCreateProtocolVersion: null, amountMinor: 400, originalCashAmountMinor: 1000, currency: "CAD", originalHistoryDigest: "a".repeat(64) };
  const read = { readProviderPlatformAccountId: "acct_actualReadOnly", readProtocolVersion: "2026-02-25.clover", chargeAccountId: null,
    originalCreatePlatformAccountId: null, originalCreateProtocolVersion: null };
  const refund = { ...read, requestedRefundRef: "pyr_original", observedRefundRef: "pyr_original", observedPaymentRef: "pi_original", observedChargeRef: "ch_original",
    amountMinor: 400, currency: "CAD", originalBindingVerified: true, rawProviderStatus: "failed" as string | null };
  const own = { providerRef: "pyr_original", paymentProviderRef: "pi_original", chargeRef: "ch_original", amountMinor: 400, currency: "CAD", status: "failed" as string | null };
  const cash = { providerPlatformAccountId: "acct_actualReadOnly", providerApiVersion: "2026-02-25.clover", chargeAccountId: null, paymentProviderRef: "pi_original", providerChargeRef: "ch_original", amountMinor: 1000, currency: "CAD", chargePaymentProviderRef: "pi_original",
    chargeAmountMinor: 1000, chargeCurrency: "CAD", paymentIntentStatus: "succeeded", amountCapturableMinor: 0, paid: true, captured: true,
    refundsComplete: true, disputesComplete: true, feeFieldObserved: true, transferFieldObserved: true, refunds: [own], disputes: [], fee: null, transfer: null, amountRefundedMinor: 0 };
  const facts = [{ sequence: 1, kind: "exact_refund", evidence: refund }, { sequence: 2, kind: "primary_cash", evidence: { ...read, actual: { providerPlatformAccountId: "acct_actualReadOnly", providerApiVersion: "2026-02-25.clover", providerRef: "pi_original", providerChargeRef: "ch_original", status: "succeeded", amountMinor: 1000, currency: "CAD" } } },
    { sequence: 3, kind: "cash_inventory", evidence: { ...read, actual: cash } }];
  const input = { original, authenticOriginal: true, preparedRevision: "b".repeat(64), currentPriorRevision: "b".repeat(64), wrapperReturned: true, exactCallerFinished: true, factCount: 3, facts };
  return { input, refund, own, cash };
}
describe("authentic legacy bank current proof", () => {
  it("keeps an exact returned bank failure verified but its original promise owed", () => {
    const { input } = actual(); expect(legacyBankCurrentVerdict(input)).toMatchObject({ state: "verified", status: "failed", requiresReview: true });
  });
  it("recognizes only exact original success without inventing create platform metadata", () => {
    const { input, refund, own, cash } = actual(); refund.rawProviderStatus = own.status = "succeeded"; cash.amountRefundedMinor = 400;
    expect(legacyBankCurrentVerdict(input)).toEqual({ state: "verified", status: "succeeded", rawStatus: "succeeded", requiresReview: false });
    expect(input.original.originalCreatePlatformAccountId).toBeNull();
  });
  it.each([null, "unknown_future_bank_status"])("keeps raw nullable or unknown status as review: %s", status => {
    const { input, refund, own } = actual(); refund.rawProviderStatus = status; own.status = null;
    expect(legacyBankCurrentVerdict(input)).toMatchObject({ state: "verified", status: null, rawStatus: status, requiresReview: true });
  });
  it.each(["authenticOriginal", "wrapperReturned", "exactCallerFinished"] as const)("refuses current proof when %s is absent", field => {
    const { input } = actual(); input[field] = false; expect(legacyBankCurrentVerdict(input).state).toBe("review");
  });
  it("retains a successful GET as debt when newer original facts changed its prepared revision", () => {
    const { input } = actual(); input.currentPriorRevision = "c".repeat(64); expect(legacyBankCurrentVerdict(input)).toMatchObject({ state: "review", reason: "stale_original_revision" });
  });
  it("does not use an equal unrelated refund as original binding", () => {
    const { input, own } = actual(); own.providerRef = "pyr_equal_unrelated"; expect(legacyBankCurrentVerdict(input).state).toBe("review");
  });
  it("refuses contradictory exact and aggregate resource states", () => {
    const { input, refund } = actual(); refund.rawProviderStatus = "succeeded"; expect(legacyBankCurrentVerdict(input)).toMatchObject({ state: "review", reason: "contradictory_current_reads" });
  });
  it("requires the complete actual callback inventory rather than a truncated tail", () => {
    const { input } = actual(); input.factCount++; expect(legacyBankCurrentVerdict(input).state).toBe("review");
  });
  it("refuses a changed read namespace without assigning it as the original create account", () => {
    const { input } = actual(); input.facts[1]!.evidence.readProviderPlatformAccountId = "acct_otherRead"; expect(legacyBankCurrentVerdict(input).state).toBe("review");
  });
  it("keeps incomplete cash pages from authorizing projection", () => {
    const { input, cash } = actual(); cash.refundsComplete = false; expect(legacyBankCurrentVerdict(input).state).toBe("review");
  });
  it("refuses a current resource with the wrong original payment or amount", () => {
    const { input, refund } = actual(); refund.amountMinor = 401; expect(legacyBankCurrentVerdict(input).state).toBe("review");
  });
  it("refuses a nested current-cash namespace mismatch even when its outer wrapper matches", () => {
    const { input, cash } = actual(); cash.providerPlatformAccountId = "acct_otherCash"; expect(legacyBankCurrentVerdict(input).state).toBe("review");
  });
  it("refuses positive returned cash explained only by an exact failed resource", () => {
    const { input, cash } = actual(); cash.amountRefundedMinor = 400;
    expect(legacyBankCurrentVerdict(input)).toMatchObject({ state: "review", reason: "contradictory_original_cash_total" });
  });
  it("refuses successful inventory whose confirmed cash exceeds the observed original charge total", () => {
    const { input, refund, own, cash } = actual(); refund.rawProviderStatus = own.status = "succeeded"; cash.amountRefundedMinor = 399;
    expect(legacyBankCurrentVerdict(input)).toMatchObject({ state: "review", reason: "contradictory_original_cash_total" });
  });
  it("requires the primary cash callback and complete inventory to name the same actual charge", () => {
    const { input } = actual(); (input.facts[1]!.evidence.actual as { providerChargeRef: string }).providerChargeRef = "ch_foreign";
    expect(legacyBankCurrentVerdict(input)).toMatchObject({ state: "review", reason: "incomplete_original_cash" });
  });
});
