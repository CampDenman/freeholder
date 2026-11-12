// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.26/C12.38: immutable portions conserve every original invoice cent.
import { ServiceError } from "@/core/service";
import { marketFeeMinor } from "./market-policy";

type InvoiceAmounts = { subtotalMinor: number; discountMinor: number; shippingMinor: number; taxMinor: number; totalMinor: number };
export type MerchantAllocationLine = {
  id: string; sellerUserId: string | null; quantityMicros: number; requiresShipping: boolean;
  subtotalMinor: number; discountMinor: number; taxMinor: number; totalMinor: number;
};
export type MerchantAllocationAmounts = InvoiceAmounts & { sellerUserId: string | null; lineIds: string[]; revenueMinor: number; feeMinor: number };
function checked(value: number): bigint {
  if (!Number.isSafeInteger(value) || value < 0) throw new ServiceError("conflict", "The original invoice amounts need reconciliation before merchant allocation.");
  return BigInt(value);
}
function number(value: bigint): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) throw new ServiceError("conflict", "The original merchant portion exceeds its exact currency range.");
  return Number(value);
}
/** Largest remainder, with original line ID as a stable tie-breaker. */
function distribute(amount: bigint, lines: MerchantAllocationLine[]): Map<string, bigint> {
  if (amount === 0n) return new Map();
  const physical = lines.filter(line => line.requiresShipping);
  if (!physical.length) throw new ServiceError("conflict", "The original shipping amount has no shipping line owner.");
  const revenue = physical.map(line => checked(line.subtotalMinor) - checked(line.discountMinor));
  const weights = revenue.some(value => value > 0n) ? revenue : physical.map(line => checked(line.quantityMicros));
  const total = weights.reduce((sum, weight) => sum + weight, 0n);
  if (total === 0n) throw new ServiceError("conflict", "The original shipping lines have no valid allocation weight.");
  const shares = physical.map((line, index) => ({ id: line.id, amount: amount * weights[index]! / total, remainder: amount * weights[index]! % total }));
  let left = amount - shares.reduce((sum, share) => sum + share.amount, 0n);
  shares.sort((a, b) => a.remainder === b.remainder ? a.id < b.id ? -1 : a.id > b.id ? 1 : 0 : a.remainder > b.remainder ? -1 : 1);
  for (const share of shares) { if (left === 0n) break; share.amount += 1n; left -= 1n; }
  return new Map(shares.map(share => [share.id, share.amount]));
}

export function allocateMerchantAmounts(invoice: InvoiceAmounts, lines: MerchantAllocationLine[], siteFeeBps: number): MerchantAllocationAmounts[] {
  const amounts = { subtotalMinor: checked(invoice.subtotalMinor), discountMinor: checked(invoice.discountMinor), shippingMinor: checked(invoice.shippingMinor), taxMinor: checked(invoice.taxMinor), totalMinor: checked(invoice.totalMinor) };
  if (!lines.length || amounts.subtotalMinor - amounts.discountMinor + amounts.shippingMinor + amounts.taxMinor !== amounts.totalMinor) throw new ServiceError("conflict", "The original invoice total does not reconcile.");
  const seen = new Set<string>();
  const totals = { subtotal: 0n, discount: 0n, tax: 0n };
  for (const line of lines) {
    if (typeof line.requiresShipping !== "boolean" || line.sellerUserId !== null && (typeof line.sellerUserId !== "string" || line.sellerUserId.length === 0)) throw new ServiceError("conflict", "The original invoice line owner or shipping terms are unknown.");
    if (!line.id || seen.has(line.id) || checked(line.quantityMicros) === 0n || checked(line.discountMinor) > checked(line.subtotalMinor) || checked(line.subtotalMinor) - checked(line.discountMinor) + checked(line.taxMinor) !== checked(line.totalMinor)) throw new ServiceError("conflict", "The original invoice lines do not reconcile.");
    seen.add(line.id); totals.subtotal += checked(line.subtotalMinor); totals.discount += checked(line.discountMinor); totals.tax += checked(line.taxMinor);
  }
  if (totals.subtotal !== amounts.subtotalMinor || totals.discount !== amounts.discountMinor || totals.tax > amounts.taxMinor) throw new ServiceError("conflict", "The original invoice and line amounts differ.");
  // Use the existing fee validator even for a site-only/zero-value invoice.
  marketFeeMinor(0, siteFeeBps);
  const shipping = distribute(amounts.shippingMinor, lines), shippingTax = distribute(amounts.taxMinor - totals.tax, lines);
  const groups = new Map<string, MerchantAllocationAmounts>();
  for (const line of [...lines].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
    const key = line.sellerUserId === null ? "site" : `seller:${line.sellerUserId}`;
    const group = groups.get(key) ?? { sellerUserId: line.sellerUserId, lineIds: [], subtotalMinor: 0, discountMinor: 0, shippingMinor: 0, taxMinor: 0, totalMinor: 0, revenueMinor: 0, feeMinor: 0 };
    const revenue = checked(line.subtotalMinor) - checked(line.discountMinor), freight = shipping.get(line.id) ?? 0n, tax = checked(line.taxMinor) + (shippingTax.get(line.id) ?? 0n);
    group.lineIds.push(line.id);
    group.subtotalMinor = number(checked(group.subtotalMinor) + checked(line.subtotalMinor));
    group.discountMinor = number(checked(group.discountMinor) + checked(line.discountMinor));
    group.shippingMinor = number(checked(group.shippingMinor) + freight);
    group.taxMinor = number(checked(group.taxMinor) + tax);
    group.revenueMinor = number(checked(group.revenueMinor) + revenue);
    group.totalMinor = number(checked(group.totalMinor) + revenue + freight + tax);
    group.feeMinor = number(checked(group.feeMinor) + BigInt(line.sellerUserId ? marketFeeMinor(number(revenue), siteFeeBps) : 0));
    groups.set(key, group);
  }
  const result = [...groups.values()];
  if (result.reduce((sum, part) => sum + checked(part.totalMinor), 0n) !== amounts.totalMinor) throw new ServiceError("conflict", "The original merchant portions do not conserve the invoice total.");
  return result;
}
