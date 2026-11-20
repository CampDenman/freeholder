// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// A gross-based provider fee and the frozen merchandise commission are distinct.
import { ServiceError } from "@/core/service";

type FeeOperation = { amountMinor: number; status: "reserved" | "dispatching" | "accepted" | "unknown" | "refused" };
export type MerchantFeeTarget =
  | { state: "ready"; amountMinor: number }
  | { state: "pending" | "under_collected" | "over_refunded"; amountMinor: 0 };

/** All prior fee refunds count, including an earlier scheduled excess correction. */
export function remainingMerchantFeeRefund(input: {
  observedOriginalFeeMinor: number;
  targetRetainedFeeMinor: number;
  operations: readonly FeeOperation[];
}): MerchantFeeTarget {
  for (const amount of [input.observedOriginalFeeMinor, input.targetRetainedFeeMinor, ...input.operations.map(operation => operation.amountMinor)]) {
    if (!Number.isSafeInteger(amount) || amount < 0) throw new ServiceError("conflict", "The original fee reconciliation amounts need review.");
  }
  const original = BigInt(input.observedOriginalFeeMinor), target = BigInt(input.targetRetainedFeeMinor);
  const returned = input.operations.filter(operation => operation.status === "accepted").reduce((sum, operation) => sum + BigInt(operation.amountMinor), 0n);
  if (returned > original) throw new ServiceError("conflict", "Recorded fee refunds exceed the original actual provider fee.");
  // A timeout never authorizes another physical fee-refund operation.
  if (input.operations.some(operation => ["reserved", "dispatching", "unknown"].includes(operation.status))) return { state: "pending", amountMinor: 0 };
  if (original < target) return { state: "under_collected", amountMinor: 0 };
  const due = original - target - returned;
  if (due < 0n) return { state: "over_refunded", amountMinor: 0 };
  return { state: "ready", amountMinor: Number(due) };
}
