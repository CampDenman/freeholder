// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: allocate frozen merchandise commission, independently of sales tax.
import { ServiceError } from "@/core/service";
function minor(value: number): bigint {
  if (!Number.isSafeInteger(value) || value < 0) throw new ServiceError("conflict", "Restore the exact original line commission amounts.");
  return BigInt(value);
}
export function creditedOriginalLineFee(feeMinor: number, originalQuantityMicros: number, creditedQuantityMicros: number): number {
  const fee = minor(feeMinor), original = minor(originalQuantityMicros), credited = minor(creditedQuantityMicros);
  if (!original || credited > original) throw new ServiceError("conflict", "Credited units exceed their original commission line.");
  // Cumulative shares leave the final original unit every rounding remainder.
  return Number(fee * credited / original);
}
export function originalFeeResourceTargets(creditMinor: number, resources: readonly { paymentId: string; feeMinor: number }[]): Map<string, number> {
  let credit = minor(creditMinor);
  const targets = new Map<string, number>();
  for (const resource of resources) {
    if (targets.has(resource.paymentId)) throw new ServiceError("conflict", "An original fee resource was repeated.");
    const fee = minor(resource.feeMinor), applied = credit < fee ? credit : fee;
    targets.set(resource.paymentId, Number(fee - applied)); credit -= applied;
  }
  if (credit) throw new ServiceError("conflict", "The frozen line credit exceeds the original charge fee capacities.");
  return targets;
}
