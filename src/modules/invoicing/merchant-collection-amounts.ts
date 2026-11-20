// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.26/C12.38: one invoice, separately collected original merchant portions.
import { ServiceError } from "@/core/service";

export interface MerchantCollectionAmount {
  allocationId: string;
  totalMinor: number;
  feeMinor: number;
}
export interface MerchantCollectedAmount {
  allocationId: string;
  amountMinor: number;
  applicationFeeMinor: number;
  status: "created" | "processing" | "succeeded" | "failed" | "cancelled";
}
const invalid = () => new ServiceError("conflict", "The original merchant collection amounts need reconciliation.");
function exact(value: number): bigint {
  if (!Number.isSafeInteger(value) || value < 0) throw invalid();
  return BigInt(value);
}

/**
 * The invoice's existing payment plan determines dueMinor. This only partitions
 * that permitted amount; it cannot make a future instalment or milestone due.
 * Gross paid money remains gross paid after a refund: a refund is not consent
 * to collect the same portion again.
 */
export function nextMerchantCollectionAmount(input: {
  invoiceTotalMinor: number;
  invoicePaidMinor: number;
  dueMinor: number;
  allocations: readonly MerchantCollectionAmount[];
  payments: readonly MerchantCollectedAmount[];
  allocationId?: string;
}): { allocationId: string; amountMinor: number; applicationFeeMinor: number } | null {
  const total = exact(input.invoiceTotalMinor), paid = exact(input.invoicePaidMinor), due = exact(input.dueMinor);
  if (paid > total || due > total - paid) throw invalid();
  const amounts = new Map<string, { total: bigint; fee: bigint; paid: bigint; chargedFee: bigint }>();
  let allocated = 0n, collected = 0n;
  for (const part of input.allocations) {
    const partTotal = exact(part.totalMinor), fee = exact(part.feeMinor);
    if (!part.allocationId || amounts.has(part.allocationId) || fee > partTotal) throw invalid();
    amounts.set(part.allocationId, { total: partTotal, fee, paid: 0n, chargedFee: 0n });
    allocated += partTotal;
  }
  if (allocated !== total || !amounts.size) throw invalid();
  for (const payment of input.payments) {
    const part = amounts.get(payment.allocationId);
    const amount = exact(payment.amountMinor), fee = exact(payment.applicationFeeMinor);
    if (!part || amount === 0n || fee > amount) throw invalid();
    if (payment.status === "created" || payment.status === "processing") throw new ServiceError("conflict", "Reconcile the existing merchant payment before collecting another portion.");
    if (payment.status !== "succeeded") continue;
    part.paid += amount; part.chargedFee += fee; collected += amount;
  }
  if (collected !== paid) throw invalid();
  for (const part of amounts.values()) {
    if (part.paid > part.total || part.chargedFee > part.fee || (part.total === 0n ? part.chargedFee !== 0n : part.chargedFee !== part.fee * part.paid / part.total)) throw invalid();
  }
  if (input.allocationId && !amounts.has(input.allocationId)) throw invalid();
  if (due === 0n) return null;
  const selected = input.allocationId
    ? [input.allocationId, amounts.get(input.allocationId)!] as const
    : [...amounts].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).find(([, part]) => part.paid < part.total);
  if (!selected) return null;
  const [allocationId, part] = selected;
  const outstanding = part.total - part.paid;
  if (outstanding === 0n) return null;
  const amount = outstanding < due ? outstanding : due;
  const fee = part.fee * (part.paid + amount) / part.total - part.chargedFee;
  if (fee < 0n || fee > amount) throw invalid();
  return { allocationId, amountMinor: Number(amount), applicationFeeMinor: Number(fee) };
}
