// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C9.33/C12.38: retain exact original fee epochs and deterministic residuals.
import { ServiceError } from "@/core/service";
export function compareCreditSources(first: { sourcePaymentId: string; sourceApplicationId: string | null }, second: { sourcePaymentId: string; sourceApplicationId: string | null }) {
  const firstKey = `${first.sourceApplicationId === null ? "0" : "1"}:${first.sourcePaymentId}:${first.sourceApplicationId ?? ""}`;
  const secondKey = `${second.sourceApplicationId === null ? "0" : "1"}:${second.sourcePaymentId}:${second.sourceApplicationId ?? ""}`;
  return firstKey < secondKey ? -1 : firstKey > secondKey ? 1 : 0;
}
export function proportionalFeeCarry(input: { principalMinor: number; feeObligationMinor: number; allocatedPrincipalMinor: number; allocatedFeeMinor: number; takeMinor: number }) {
  if (!Object.values(input).every(value => Number.isSafeInteger(value) && value >= 0) || input.principalMinor <= 0 || input.feeObligationMinor > input.principalMinor
    || BigInt(input.allocatedPrincipalMinor) + BigInt(input.takeMinor) > BigInt(input.principalMinor)) throw new ServiceError("conflict", "Restore the exact original fee and available consideration before allocating another carried duty.");
  const total = BigInt(input.principalMinor), fee = BigInt(input.feeObligationMinor), prior = BigInt(input.allocatedPrincipalMinor);
  if (BigInt(input.allocatedFeeMinor) !== fee * prior / total) throw new ServiceError("conflict", "The original cumulative fee allocation is incomplete or contradictory; do not reprice it at a later fee rate.");
  return Number(fee * (prior + BigInt(input.takeMinor)) / total - BigInt(input.allocatedFeeMinor));
}
export function remainingCashFeeBudget(totalMinor: number, originalFeeMinor: number, creditedMinor: number, carriedFeeMinor: number) {
  if (![totalMinor, originalFeeMinor, creditedMinor, carriedFeeMinor].every(value => Number.isSafeInteger(value) && value >= 0) || creditedMinor > totalMinor)
    throw new ServiceError("conflict", "Restore the actual original credit consideration and carried fee obligation before collecting cash.");
  return { principalMinor: totalMinor - creditedMinor, feeObligationMinor: Math.max(0, originalFeeMinor - carriedFeeMinor), originalOverTargetMinor: Math.max(0, carriedFeeMinor - originalFeeMinor) };
}
