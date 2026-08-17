// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Integer coupon arithmetic (C5.23).

import { describe, expect, it } from "vitest";
import { allocateDiscount, percentOffMinor, quoteCoupon } from "@/modules/catalog/promo-quote";

describe("coupon quotes", () => {
  it("takes a percent off in minor units without floating point", () => {
    expect(percentOffMinor(10_000, 100_000)).toBe(1_000);
    expect(percentOffMinor(99, 100_000)).toBe(9);
    expect(allocateDiscount([6000, 4000], 1000)).toEqual([600, 400]);
    expect(allocateDiscount([1, 1, 1], 2)).toEqual([0, 0, 2]);
  });

  it("quotes percent, fixed and free shipping", () => {
    expect(
      quoteCoupon({
        kind: "percent",
        percentOffPpm: 250_000,
        amountMinor: null,
        currency: null,
        minSubtotalMinor: 0,
        cartCurrency: "CAD",
        subtotalMinor: 8_000,
      }),
    ).toEqual({ discountMinor: 2_000, freeShipping: false });
    expect(
      quoteCoupon({
        kind: "fixed",
        percentOffPpm: null,
        amountMinor: 5_000,
        currency: "CAD",
        minSubtotalMinor: 0,
        cartCurrency: "CAD",
        subtotalMinor: 3_000,
      }),
    ).toEqual({ discountMinor: 3_000, freeShipping: false });
    expect(
      quoteCoupon({
        kind: "free_shipping",
        percentOffPpm: null,
        amountMinor: null,
        currency: null,
        minSubtotalMinor: 0,
        cartCurrency: "CAD",
        subtotalMinor: 2_000,
      }),
    ).toEqual({ discountMinor: 0, freeShipping: true });
  });
});
