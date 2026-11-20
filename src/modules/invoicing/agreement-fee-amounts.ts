// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C9.33: a retained credit still supplies consideration after a cash refund.
import { ServiceError } from "@/core/service";

export function plannedAgreementFee(input: { totalMinor: number; targetFeeMinor: number; creditedMinor: number; carriedFeeMinor: number }) {
  if (!Object.values(input).every(value => Number.isSafeInteger(value) && value >= 0)
    || input.totalMinor <= 0 || input.targetFeeMinor > input.totalMinor || input.creditedMinor > input.totalMinor || input.carriedFeeMinor > input.creditedMinor)
    throw new ServiceError("conflict", "Restore the exact original gross target and its accepted noncash fee assignments.");
  const cashPrincipalMinor = input.totalMinor - input.creditedMinor, newDutyMinor = Math.max(0, input.targetFeeMinor - input.carriedFeeMinor);
  return { cashPrincipalMinor, cashFeeTargetMinor: Math.min(cashPrincipalMinor, newDutyMinor),
    expectedReceivableMinor: Math.max(0, newDutyMinor - cashPrincipalMinor), originalOverTargetMinor: Math.max(0, input.carriedFeeMinor - input.targetFeeMinor) };
}

/** Epochs are immutable. R contains actual remaining cash AND noncash. K and Q
 * are the corresponding retained original duties, not collected commission.
 * Missing/recovering source disposition must be resolved by the caller; it
 * must never arrive here as a fabricated zero consideration or zero duty. */
export function retainedAgreementFee(input: { totalMinor: number; targetFeeMinor: number; retainedCashMinor: number; retainedCreditMinor: number;
  retainedCarriedDutyMinor: number; retainedCashDutyMinor: number }) {
  if (!Object.values(input).every(value => Number.isSafeInteger(value) && value >= 0) || input.totalMinor <= 0
    || input.targetFeeMinor > input.totalMinor || BigInt(input.retainedCashMinor) + BigInt(input.retainedCreditMinor) > BigInt(input.totalMinor)
    || input.retainedCarriedDutyMinor > input.retainedCreditMinor || input.retainedCashDutyMinor > input.retainedCashMinor)
    throw new ServiceError("conflict", "Retain the complete actual target consideration and each original fee epoch before reconciling the merchant receivable.");
  const retained = BigInt(input.retainedCashMinor) + BigInt(input.retainedCreditMinor);
  const target = BigInt(input.targetFeeMinor) * retained / BigInt(input.totalMinor);
  const assigned = BigInt(input.retainedCarriedDutyMinor) + BigInt(input.retainedCashDutyMinor);
  return { retainedConsiderationMinor: Number(retained), retainedTargetFeeMinor: Number(target),
    receivableOwedMinor: Number(target > assigned ? target - assigned : 0n), originalSourceExcessMinor: Number(assigned > target ? assigned - target : 0n) };
}
