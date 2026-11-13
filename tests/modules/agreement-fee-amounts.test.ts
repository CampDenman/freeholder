// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C9.33: independent original whole-consideration commission examples.
// PREPARED/UNRUN. These are not native ledger, SQL or provider acceptance.
import { describe, expect, it } from "vitest";
import { plannedAgreementFee, retainedAgreementFee } from "@/modules/invoicing/agreement-fee-amounts";
describe("bounded original target commission across cash and noncash consideration", () => {
  it("plans a physical fee1 and a separate39 duty without claiming either collected", () => {
    expect(plannedAgreementFee({ totalMinor: 1500, targetFeeMinor: 300, creditedMinor: 1499, carriedFeeMinor: 260 }))
      .toEqual({ cashPrincipalMinor: 1, cashFeeTargetMinor: 1, expectedReceivableMinor: 39, originalOverTargetMinor: 0 });
  });
  it("retains the separate39 after refunding the last cash1 while credit1499 stays valid", () => {
    expect(retainedAgreementFee({ totalMinor: 1500, targetFeeMinor: 300, retainedCashMinor: 0, retainedCreditMinor: 1499, retainedCarriedDutyMinor: 260, retainedCashDutyMinor: 0 }))
      .toEqual({ retainedConsiderationMinor: 1499, retainedTargetFeeMinor: 299, receivableOwedMinor: 39, originalSourceExcessMinor: 0 });
  });
  it("has the same original39 receivable before the legitimate cash refund", () => {
    expect(retainedAgreementFee({ totalMinor: 1500, targetFeeMinor: 300, retainedCashMinor: 1, retainedCreditMinor: 1499, retainedCarriedDutyMinor: 260, retainedCashDutyMinor: 1 }).receivableOwedMinor).toBe(39);
  });
  it("can move duty from a returned physical cash fee into the receivable under distinct frozen epochs", () => {
    expect(plannedAgreementFee({ totalMinor: 1500, targetFeeMinor: 300, creditedMinor: 749, carriedFeeMinor: 100 }).expectedReceivableMinor).toBe(0);
    expect(retainedAgreementFee({ totalMinor: 1500, targetFeeMinor: 300, retainedCashMinor: 1, retainedCreditMinor: 749, retainedCarriedDutyMinor: 100, retainedCashDutyMinor: 0 }))
      .toEqual({ retainedConsiderationMinor: 750, retainedTargetFeeMinor: 150, receivableOwedMinor: 50, originalSourceExcessMinor: 0 });
  });
  it("keeps an excess original assigned duty explicit rather than negative commission or an implicit refund", () => {
    expect(retainedAgreementFee({ totalMinor: 1000, targetFeeMinor: 50, retainedCashMinor: 0, retainedCreditMinor: 1000, retainedCarriedDutyMinor: 70, retainedCashDutyMinor: 0 }))
      .toEqual({ retainedConsiderationMinor: 1000, retainedTargetFeeMinor: 50, receivableOwedMinor: 0, originalSourceExcessMinor: 20 });
  });
  it("keeps zero residual when exact assigned duties cover the current target", () => {
    expect(retainedAgreementFee({ totalMinor: 5250, targetFeeMinor: 500, retainedCashMinor: 3150, retainedCreditMinor: 2100, retainedCarriedDutyMinor: 200, retainedCashDutyMinor: 300 }).receivableOwedMinor).toBe(0);
  });
  it("does not use floating point for maximum safe original consideration", () => {
    expect(retainedAgreementFee({ totalMinor: 9007199254740991, targetFeeMinor: 9007199254740990, retainedCashMinor: 9007199254740990,
      retainedCreditMinor: 0, retainedCarriedDutyMinor: 0, retainedCashDutyMinor: 0 }).retainedTargetFeeMinor).toBe(9007199254740989);
  });
  it("refuses over-projected actual consideration instead of selecting convenient amounts", () => {
    expect(() => retainedAgreementFee({ totalMinor: 100, targetFeeMinor: 10, retainedCashMinor: 1, retainedCreditMinor: 100, retainedCarriedDutyMinor: 10, retainedCashDutyMinor: 0 })).toThrow();
  });
  it("refuses a carried duty beyond its original noncash source", () => {
    expect(() => plannedAgreementFee({ totalMinor: 100, targetFeeMinor: 10, creditedMinor: 20, carriedFeeMinor: 21 })).toThrow();
  });
  it("has no remaining target duty only after all valid consideration is genuinely gone", () => {
    expect(retainedAgreementFee({ totalMinor: 1500, targetFeeMinor: 300, retainedCashMinor: 0, retainedCreditMinor: 0, retainedCarriedDutyMinor: 0, retainedCashDutyMinor: 0 }))
      .toEqual({ retainedConsiderationMinor: 0, retainedTargetFeeMinor: 0, receivableOwedMinor: 0, originalSourceExcessMinor: 0 });
  });
});
