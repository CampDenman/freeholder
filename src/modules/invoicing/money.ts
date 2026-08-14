// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Fixed-point arithmetic shared by tax, invoicing, checkout, and reporting.

import { ServiceError } from "@/core/service";

export const QUANTITY_SCALE = 1_000_000;
export const MAX_MINOR = Number.MAX_SAFE_INTEGER;

export function assertMinor(value: number, label = "Amount"): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ServiceError(
      "validation",
      `${label} must be a non-negative integer in the currency's minor unit.`,
    );
  }
  return value;
}

export function assertPositiveMinor(value: number, label = "Amount"): number {
  assertMinor(value, label);
  if (value === 0) throw new ServiceError("validation", `${label} must be greater than zero.`);
  return value;
}

export function assertQuantity(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ServiceError(
      "validation",
      "Quantity must be a positive six-decimal fixed-point integer.",
    );
  }
  return value;
}

export function safeMinor(value: bigint, label = "Calculated amount"): number {
  if (value < 0n || value > BigInt(MAX_MINOR)) {
    throw new ServiceError("validation", `${label} is outside Freeholder's safe money range.`);
  }
  return Number(value);
}

export function roundRatio(
  numerator: bigint,
  denominator: bigint,
  mode: "half_up" | "bankers" = "half_up",
): bigint {
  if (numerator < 0n || denominator <= 0n) {
    throw new ServiceError("validation", "Money rounding received an invalid ratio.");
  }
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const doubled = remainder * 2n;
  if (doubled < denominator) return quotient;
  if (doubled > denominator) return quotient + 1n;
  return mode === "half_up" || quotient % 2n === 1n ? quotient + 1n : quotient;
}

export function extendMinor(
  unitAmountMinor: number,
  quantityMicros: number,
  mode: "half_up" | "bankers" = "half_up",
): number {
  assertMinor(unitAmountMinor, "Unit amount");
  assertQuantity(quantityMicros);
  return safeMinor(
    roundRatio(
      BigInt(unitAmountMinor) * BigInt(quantityMicros),
      BigInt(QUANTITY_SCALE),
      mode,
    ),
    "Extended line amount",
  );
}

export function sumMinor(values: readonly number[], label = "Total"): number {
  return safeMinor(
    values.reduce((total, value) => total + BigInt(assertMinor(value)), 0n),
    label,
  );
}

export function subtractMinor(minuend: number, subtrahend: number, label = "Amount"): number {
  assertMinor(minuend, label);
  assertMinor(subtrahend, label);
  if (subtrahend > minuend) throw new ServiceError("validation", `${label} cannot be negative.`);
  return minuend - subtrahend;
}
