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
  it("retains different original merchant shipping-tax quotes instead of reallocating them globally", () => {
    const invoice = { subtotalMinor: 2000, discountMinor: 0, shippingMinor: 300, taxMinor: 331, totalMinor: 2631 };
    const lines = [line("a", "seller-a", 1000, 0, 100), line("b", "seller-b", 1000, 0, 200)];
    const receipts = [{ sellerUserId: "seller-a", shippingMinor: 100, shippingTaxMinor: 7 }, { sellerUserId: "seller-b", shippingMinor: 200, shippingTaxMinor: 24 }];
    const parts = allocateMerchantAmounts(invoice, lines, 1000, receipts);
    expect(parts.map(part => [part.shippingMinor,part.taxMinor,part.totalMinor,part.feeMinor])).toEqual([[100,107,1207,100],[200,224,1424,100]]);
    expect(parts).toEqual(allocateMerchantAmounts(invoice,[...lines].reverse(),1000,[...receipts].reverse()));
    expect(parts.reduce((sum,part)=>sum+part.totalMinor,0)).toBe(invoice.totalMinor);
  });
  it("allocates each party's original freight only within its own physical lines", () => {
    const parts = allocateMerchantAmounts({subtotalMinor:130,discountMinor:0,shippingMinor:1,taxMinor:1,totalMinor:132},
      [line("a2","seller-a",10),line("a1","seller-a",10),line("digital","seller-a",10,0,0,false),line("b","seller-b",100)],0,
      [{sellerUserId:"seller-a",shippingMinor:1,shippingTaxMinor:1},{sellerUserId:"seller-b",shippingMinor:0,shippingTaxMinor:0}]);
    expect(parts.map(part=>[part.sellerUserId,part.shippingMinor,part.taxMinor,part.totalMinor])).toEqual([["seller-a",1,1,32],["seller-b",0,0,100]]);
  });
  it("requires complete, unique original merchant receipts and exact freight/tax conservation", () => {
    const invoice={subtotalMinor:200,discountMinor:0,shippingMinor:2,taxMinor:1,totalMinor:203}, lines=[line("a","seller-a",100),line("b","seller-b",100)];
    const a={sellerUserId:"seller-a",shippingMinor:1,shippingTaxMinor:1},b={sellerUserId:"seller-b",shippingMinor:1,shippingTaxMinor:0};
    for(const receipts of [[],[a],[a,a],[a,b,{sellerUserId:null,shippingMinor:0,shippingTaxMinor:0}],[{...a,shippingMinor:2},b],[{...a,shippingTaxMinor:0},b],[{...a,shippingMinor:-1},b],[{...a,shippingTaxMinor:0.5},b]]){
      expect(()=>allocateMerchantAmounts(invoice,lines,0,receipts)).toThrow();
    }
  });
  it("refuses freight assigned to a digital-only party and distinguishes site from a seller named site", () => {
    const invoice={subtotalMinor:200,discountMinor:0,shippingMinor:1,taxMinor:0,totalMinor:201},lines=[line("digital",null,100,0,0,false),line("physical","site",100)];
    expect(()=>allocateMerchantAmounts(invoice,lines,0,[{sellerUserId:null,shippingMinor:1,shippingTaxMinor:0},{sellerUserId:"site",shippingMinor:0,shippingTaxMinor:0}])).toThrow();
    const parts=allocateMerchantAmounts(invoice,lines,1000,[{sellerUserId:null,shippingMinor:0,shippingTaxMinor:0},{sellerUserId:"site",shippingMinor:1,shippingTaxMinor:0}]);
    expect(parts.map(part=>[part.sellerUserId,part.shippingMinor,part.feeMinor])).toEqual([[null,0,0],["site",1,10]]);
  });
});
