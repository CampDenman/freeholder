// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.26/C12.38: one invoice's frozen seller portions conserve exact cents.
import { describe, expect, it } from "vitest";
import { allocateMerchantAmounts, type MerchantAllocationLine } from "@/modules/invoicing/merchant-allocation-amounts";

function line(id: string, sellerUserId: string | null, subtotalMinor: number, discountMinor = 0, taxMinor = 0, requiresShipping = true): MerchantAllocationLine {
  return { id, sellerUserId, quantityMicros: 1_000_000, requiresShipping, subtotalMinor, discountMinor, taxMinor, totalMinor: subtotalMinor - discountMinor + taxMinor };
}
describe("original merchant invoice allocations (C12.26/C12.38)", () => {
  it("conserves discounted revenue, item/shipping tax, freight and per-line fees across sellers and the site", () => {
    const parts = allocateMerchantAmounts({ subtotalMinor: 3300, discountMinor: 400, shippingMinor: 370, taxMinor: 327, totalMinor: 3597 },
      [line("b", "seller-b", 2000, 300, 170), line("site", null, 300, 0, 30, false), line("a", "seller-a", 1000, 100, 90)], 1000);
    expect(parts).toEqual([
      { sellerUserId: "seller-a", lineIds: ["a"], subtotalMinor: 1000, discountMinor: 100, shippingMinor: 128, taxMinor: 103, totalMinor: 1131, revenueMinor: 900, feeMinor: 90 },
      { sellerUserId: "seller-b", lineIds: ["b"], subtotalMinor: 2000, discountMinor: 300, shippingMinor: 242, taxMinor: 194, totalMinor: 2136, revenueMinor: 1700, feeMinor: 170 },
      { sellerUserId: null, lineIds: ["site"], subtotalMinor: 300, discountMinor: 0, shippingMinor: 0, taxMinor: 30, totalMinor: 330, revenueMinor: 300, feeMinor: 0 },
    ]);
    expect(parts.reduce((sum, part) => sum + part.totalMinor, 0)).toBe(3597);
  });
  it("preserves per-line fee rounding instead of changing the original fee on grouping", () => {
    const parts = allocateMerchantAmounts({ subtotalMinor: 6, discountMinor: 0, shippingMinor: 0, taxMinor: 0, totalMinor: 6 }, [line("a", "seller", 3), line("b", "seller", 3)], 5000);
    expect(parts[0]).toMatchObject({ revenueMinor: 6, feeMinor: 2, lineIds: ["a", "b"] });
  });
  it("assigns an indivisible shipping cent deterministically even when every item is fully discounted", () => {
    const invoice = { subtotalMinor: 20, discountMinor: 20, shippingMinor: 1, taxMinor: 0, totalMinor: 1 };
    const lines = [line("b", "seller-b", 10, 10), line("a", "seller-a", 10, 10)];
    expect(allocateMerchantAmounts(invoice, lines, 5000)).toEqual(allocateMerchantAmounts(invoice, [...lines].reverse(), 5000));
    expect(allocateMerchantAmounts(invoice, lines, 5000).map(part => [part.sellerUserId, part.totalMinor, part.feeMinor])).toEqual([["seller-a", 1, 0], ["seller-b", 0, 0]]);
  });
  it("keeps products near the safe currency limit exact without floating-point multiplication", () => {
    const large = Number.MAX_SAFE_INTEGER;
    const parts = allocateMerchantAmounts({ subtotalMinor: large - 2, discountMinor: 0, shippingMinor: 2, taxMinor: 0, totalMinor: large }, [line("a", "seller-a", large - 3), line("b", "seller-b", 1)], 3333);
    expect(parts[0]?.totalMinor).toBe(large - 1);
    expect(parts[1]?.totalMinor).toBe(1);
    expect(parts[0]?.feeMinor).toBe(Number(BigInt(large - 3) * 3333n / 10000n));
  });
  it("refuses unowned shipping and inconsistent original money instead of inventing an allocation", () => {
    const invoice = { subtotalMinor: 100, discountMinor: 0, shippingMinor: 1, taxMinor: 0, totalMinor: 101 };
    expect(() => allocateMerchantAmounts(invoice, [line("a", "seller", 100, 0, 0, false)], 0)).toThrow();
    expect(() => allocateMerchantAmounts({ ...invoice, totalMinor: 100 }, [line("a", "seller", 100)], 0)).toThrow();
    expect(() => allocateMerchantAmounts({ ...invoice, shippingMinor: 0, totalMinor: 100 }, [line("a", "seller", 100), line("a", "seller", 0)], 0)).toThrow();
    expect(() => allocateMerchantAmounts({ ...invoice, shippingMinor: 0, totalMinor: 100 }, [line("a", "seller", 100)], 10001)).toThrow();
  });
  it("keeps site revenue distinct from any seller identifier", () => {
    const parts = allocateMerchantAmounts({ subtotalMinor: 2, discountMinor: 0, shippingMinor: 0, taxMinor: 0, totalMinor: 2 }, [line("a", null, 1), line("b", "site", 1)], 10000);
    expect(parts).toHaveLength(2);
    expect(parts.map(part => part.feeMinor)).toEqual([0, 1]);
  });
});
