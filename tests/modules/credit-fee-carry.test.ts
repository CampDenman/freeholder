// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C9.33/C12.38: fixed independent examples for original fee epochs and residuals.
// PREPARED/UNRUN: these controls supply no native ledger or provider acceptance.
import { describe, expect, it } from "vitest";
import { compareCreditSources, proportionalFeeCarry, remainingCashFeeBudget } from "@/modules/invoicing/credit-fee-amounts";

describe("original fee carry without repricing or fictional collection", () => {
  it("keeps the original 17% duty across three allocations and gives the rounding residual to the final original principal", () => {
    expect(proportionalFeeCarry({ principalMinor: 101, feeObligationMinor: 17, allocatedPrincipalMinor: 0, allocatedFeeMinor: 0, takeMinor: 33 })).toBe(5);
    expect(proportionalFeeCarry({ principalMinor: 101, feeObligationMinor: 17, allocatedPrincipalMinor: 33, allocatedFeeMinor: 5, takeMinor: 33 })).toBe(6);
    expect(proportionalFeeCarry({ principalMinor: 101, feeObligationMinor: 17, allocatedPrincipalMinor: 66, allocatedFeeMinor: 11, takeMinor: 35 })).toBe(6);
  });
  it("refuses an earlier missing or repriced fee allocation instead of hiding its duty in the next customer payment", () => {
    expect(() => proportionalFeeCarry({ principalMinor: 101, feeObligationMinor: 17, allocatedPrincipalMinor: 33, allocatedFeeMinor: 6, takeMinor: 33 })).toThrow();
  });
  it("bounds cumulative principal by its exact original capacity", () => {
    expect(() => proportionalFeeCarry({ principalMinor: 101, feeObligationMinor: 17, allocatedPrincipalMinor: 100, allocatedFeeMinor: 16, takeMinor: 2 })).toThrow();
  });
  it("handles safe-integer principal whose intermediate multiplication exceeds Number precision", () => {
    expect(proportionalFeeCarry({ principalMinor: 9007199254740991, feeObligationMinor: 9007199254740990, allocatedPrincipalMinor: 0, allocatedFeeMinor: 0, takeMinor: 9007199254740990 })).toBe(9007199254740989);
  });
  it("does not charge again for the duty actually assigned to applied original credit", () => {
    expect(remainingCashFeeBudget(5250, 500, 2100, 200)).toEqual({ principalMinor: 3150, feeObligationMinor: 300, originalOverTargetMinor: 0 });
  });
  it("leaves a duty larger than the remaining physical charge explicit for the required separate receivable", () => {
    expect(remainingCashFeeBudget(1500, 300, 1499, 260)).toEqual({ principalMinor: 1, feeObligationMinor: 40, originalOverTargetMinor: 0 });
  });
  it("keeps excess old duty on its original source without negative fee or automatic refund", () => {
    expect(remainingCashFeeBudget(1000, 50, 1000, 70)).toEqual({ principalMinor: 0, feeObligationMinor: 0, originalOverTargetMinor: 20 });
  });
  it("rejects a credited projection beyond the actual target principal", () => {
    expect(() => remainingCashFeeBudget(100, 10, 101, 10)).toThrow();
  });
  it("orders actual original cash before inherited applications using original identities rather than newly minted funding IDs", () => {
    const sources = [
      { sourcePaymentId: "b", sourceApplicationId: "a" }, { sourcePaymentId: "b", sourceApplicationId: null },
      { sourcePaymentId: "a", sourceApplicationId: "z" }, { sourcePaymentId: "a", sourceApplicationId: null },
    ];
    expect(sources.sort(compareCreditSources)).toEqual([
      { sourcePaymentId: "a", sourceApplicationId: null }, { sourcePaymentId: "b", sourceApplicationId: null },
      { sourcePaymentId: "a", sourceApplicationId: "z" }, { sourcePaymentId: "b", sourceApplicationId: "a" },
    ]);
  });
});
