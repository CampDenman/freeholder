// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: original quote-time freight cents survive mixed business ownership.
import {describe,expect,it} from "vitest";
import {allocateMerchantGrossFreight} from "@/modules/invoicing/merchant-tax-freight";
const physical=(sellerUserId:string|null,unitAmountMinor:number,quantityMicros=1000000)=>({sellerUserId,unitAmountMinor,quantityMicros,discountMinor:0,requiresShipping:true});
describe("original per-business quote freight (C12.38)",()=>{
 it("distributes actual freight over discounted physical items and preserves global positions",()=>{
  const result=allocateMerchantGrossFreight([{...physical("a",2000),discountMinor:1000},{...physical("b",999999),requiresShipping:false},physical(null,1000),physical("a",1000)],101);
  expect(result).toEqual([{sellerUserId:"a",linePositions:[0,3],shippingMinor:67},{sellerUserId:"b",linePositions:[1],shippingMinor:0},{sellerUserId:null,linePositions:[2],shippingMinor:34}]);
 });
 it("uses original quantities for free physical goods and exact cent ties",()=>{
  expect(allocateMerchantGrossFreight([physical(null,0),physical("a",0,2000000)],5).map(row=>row.shippingMinor)).toEqual([2,3]);
  expect(allocateMerchantGrossFreight([physical(null,0),physical("a",0)],1).map(row=>row.shippingMinor)).toEqual([1,0]);
 });
 it("conserves the largest safe amount without floating-point multiplication",()=>{
  const rows=allocateMerchantGrossFreight([physical(null,Number.MAX_SAFE_INTEGER),physical("a",Number.MAX_SAFE_INTEGER)],Number.MAX_SAFE_INTEGER);
  expect(rows.map(row=>row.shippingMinor)).toEqual([4503599627370496,4503599627370495]);
 });
 it("refuses positive freight without a physical owner and invalid discount weights",()=>{
  expect(()=>allocateMerchantGrossFreight([{...physical(null,10),requiresShipping:false}],1)).toThrow(/no physical/);
  expect(()=>allocateMerchantGrossFreight([{...physical(null,10),discountMinor:11}],1)).toThrow(/discount/);
 });
});
