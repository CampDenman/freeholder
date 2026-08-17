// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Integer-only coupon arithmetic (C5.23). Discounts never leave minor units.

export function percentOffMinor(subtotalMinor: number, percentOffPpm: number): number {
  if (subtotalMinor <= 0 || percentOffPpm <= 0) return 0;
  return Math.trunc((subtotalMinor * percentOffPpm) / 1_000_000);
}

export function allocateDiscount(lineTotals: number[], discountMinor: number): number[] {
  const subtotal = lineTotals.reduce((sum, value) => sum + value, 0);
  if (subtotal <= 0 || discountMinor <= 0) return lineTotals.map(() => 0);
  const capped = Math.min(discountMinor, subtotal);
  const shares: number[] = [];
  let remaining = capped;
  for (let index = 0; index < lineTotals.length; index += 1) {
    if (index === lineTotals.length - 1) {
      shares.push(remaining);
      break;
    }
    const share = Math.trunc((capped * lineTotals[index]!) / subtotal);
    shares.push(share);
    remaining -= share;
  }
  return shares;
}

export interface CouponQuote {
  discountMinor: number;
  freeShipping: boolean;
}

export function quoteCoupon(input: {
  kind: "percent" | "fixed" | "free_shipping";
  percentOffPpm: number | null;
  amountMinor: number | null;
  currency: string | null;
  minSubtotalMinor: number;
  cartCurrency: string;
  subtotalMinor: number;
}): CouponQuote {
  if (input.subtotalMinor < input.minSubtotalMinor) {
    return { discountMinor: 0, freeShipping: false };
  }
  if (input.kind === "free_shipping") return { discountMinor: 0, freeShipping: true };
  if (input.kind === "percent") {
    return { discountMinor: percentOffMinor(input.subtotalMinor, input.percentOffPpm ?? 0), freeShipping: false };
  }
  if (input.currency && input.currency !== input.cartCurrency) {
    return { discountMinor: 0, freeShipping: false };
  }
  return { discountMinor: Math.min(input.amountMinor ?? 0, input.subtotalMinor), freeShipping: false };
}
