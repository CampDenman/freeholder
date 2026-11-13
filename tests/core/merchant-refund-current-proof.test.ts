// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.19/C12.38: current bank states cannot inherit old positive proof.
import { describe, expect, it } from "vitest";
import { originalRefundCurrentReadVerdict, type OriginalRefundCurrentFact } from "@/modules/invoicing/merchant-refund-current-proof";

const original = { providerPlatformAccountId: "acct_originalPlatform", chargeAccountId: "acct_originalSeller",
  providerApiVersion: "2026-02-25.clover", providerRef: "re_original", paymentProviderRef: "pi_original", amountMinor: 1000, currency: "CAD" };
const proof = { original, preparedRevision: "complete-original-history", currentPriorRevision: "complete-original-history",
  incomplete: false, creatorsQuiesced: true, readReturned: true, exactCallerFinished: true };
const current = (status: OriginalRefundCurrentFact["status"]): OriginalRefundCurrentFact => ({ ...original, status, bindingVerified: true, failureBalanceTransactionRef: null });

describe("exact original bank-refund current-read proof", () => {
  it("keeps action and pending nonterminal before a fresh success even when history contains a success", () => {
    for (const status of ["requires_action", "pending"] as const) expect(originalRefundCurrentReadVerdict({ ...proof, actual: current(status) }))
      .toMatchObject({ state: "verified", status, terminal: false });
    expect(originalRefundCurrentReadVerdict({ ...proof, actual: current("succeeded") })).toMatchObject({ state: "verified", status: "succeeded", terminal: true });
  });
  it("preserves nullable provider state rather than supplying an old terminal result", () => {
    expect(originalRefundCurrentReadVerdict({ ...proof, actual: current(null) })).toEqual({ state: "verified", status: null, terminal: false, failureBalanceTransactionRef: null });
  });
  it("preserves an actual failure-balance reference without inventing one for a nullable response", () => {
    expect(originalRefundCurrentReadVerdict({ ...proof, actual: { ...current("failed"), failureBalanceTransactionRef: "txn_originalFailure" } }))
      .toMatchObject({ state: "verified", status: "failed", failureBalanceTransactionRef: "txn_originalFailure" });
    expect(originalRefundCurrentReadVerdict({ ...proof, actual: current("failed") })).toMatchObject({ state: "verified", failureBalanceTransactionRef: null });
  });
  it("rejects stale evidence even if a delayed read returns a success", () => {
    expect(originalRefundCurrentReadVerdict({ ...proof, currentPriorRevision: "concurrent-action-capture", actual: current("succeeded") }))
      .toEqual({ state: "review", reason: "stale_evidence" });
  });
  it("rejects a repeated semantic action observed through a new capture occurrence", () => {
    expect(originalRefundCurrentReadVerdict({ ...proof, currentPriorRevision: "same-fact-new-capture", actual: current("succeeded") })).toMatchObject({ state: "review", reason: "stale_evidence" });
  });
  it("requires the original creator to finish independently of a current provider terminal state", () => {
    expect(originalRefundCurrentReadVerdict({ ...proof, creatorsQuiesced: false, actual: current("failed") })).toMatchObject({ state: "review", reason: "unfinished_creator" });
  });
  it.each([{ readReturned: false }, { exactCallerFinished: false }])("does not turn a retained positive fact into completed read proof: %j", missing => {
    expect(originalRefundCurrentReadVerdict({ ...proof, ...missing, actual: current("succeeded") })).toMatchObject({ state: "review", reason: "unfinished_read" });
  });
  it.each([{ providerPlatformAccountId: "acct_foreign" }, { chargeAccountId: null }, { providerApiVersion: "2026-10-28.endive" }, { providerApiVersion: null },
    { providerRef: "re_other" }, { paymentProviderRef: null }, { amountMinor: 1001 }, { currency: "USD" }, { bindingVerified: false }])("refuses different original money or scope: %j", change => {
    expect(originalRefundCurrentReadVerdict({ ...proof, actual: { ...current("succeeded"), ...change } })).toMatchObject({ state: "review", reason: "foreign_resource" });
  });
  it("cannot close a truncated restored evidence inventory", () => {
    expect(originalRefundCurrentReadVerdict({ ...proof, incomplete: true, actual: current("succeeded") })).toMatchObject({ state: "review", reason: "incomplete" });
  });
});
