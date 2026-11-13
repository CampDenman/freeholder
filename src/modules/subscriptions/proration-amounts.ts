// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C9.33/C12.38: preserve the declared separately-rounded unused-fraction net exactly.
import { ServiceError } from "@/core/service";
export function proratedAmounts(oldMinor: number, newMinor: number, periodStart: Date, periodEnd: Date, at: Date) {
  if (![oldMinor, newMinor].every(value => Number.isSafeInteger(value) && value >= 0)
    || ![periodStart, periodEnd, at].every(value => Number.isSafeInteger(value.getTime()))) throw new ServiceError("validation", "Proration needs exact safe minor amounts and valid original calendar instants.");
  const start = BigInt(periodStart.getTime()), end = BigInt(periodEnd.getTime()), instant = BigInt(at.getTime());
  if (end <= start) throw new ServiceError("conflict", "Restore the actual positive original billing period before calculating proration.");
  const total = end - start, remaining = instant <= start ? total : instant >= end ? 0n : end - instant;
  // Existing policy is Math.round of each nonnegative component independently.
  // BigInt retains that half-up rule without losing cents in amount*time.
  const portion = (amount: number) => Number((2n * BigInt(amount) * remaining + total) / (2n * total));
  const oldUnusedMinor = portion(oldMinor), newUnusedMinor = portion(newMinor);
  return { oldUnusedMinor, newUnusedMinor, netMinor: newUnusedMinor - oldUnusedMinor,
    originalPeriodStart: periodStart.toISOString(), originalPeriodEnd: periodEnd.toISOString(), proratedAt: at.toISOString() };
}
export function proratedDifference(oldMinor: number, newMinor: number, periodStart: Date, periodEnd: Date, at: Date) {
  return proratedAmounts(oldMinor, newMinor, periodStart, periodEnd, at).netMinor;
}
