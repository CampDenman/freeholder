// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: the existing nonallocation subscription fee epoch, without fake cash.
export function recordedCommercialFeeTarget(amountMinor: number, originalFeeMinor: number, refundedMinor: number): number {
  if (![amountMinor, originalFeeMinor, refundedMinor].every(Number.isSafeInteger) || amountMinor <= 0 || originalFeeMinor < 0 || originalFeeMinor > amountMinor || refundedMinor < 0 || refundedMinor > amountMinor)
    throw new RangeError("The original recorded commercial fee and principal need reconciliation.");
  return Number(BigInt(originalFeeMinor) * BigInt(amountMinor - refundedMinor) / BigInt(amountMinor));
}
