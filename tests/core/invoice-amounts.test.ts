// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: consent and persisted invoices share exact inclusive tax arithmetic.
import {describe,expect,it} from "vitest";
import type {QuotedTaxLine} from "@/adapters/tax";
import {calculateInvoiceAmounts} from "@/modules/invoicing/invoice-amounts";
const tax=(itemId:string|undefined,taxMinor:number,inclusive=true):QuotedTaxLine=>({...(itemId?{itemId}:{}),jurisdiction:"Declared",name:"Declared tax",ratePartsPerMillion:100000,taxableMinor:0,taxMinor,inclusive,compound:false,priority:0});
describe("one consent and invoice amount calculation (C12.38)",()=>{
 it("conserves discounted tax-inclusive item and freight cents",()=>{
  const result=calculateInvoiceAmounts([{quantityMicros:1000000,unitAmountMinor:1000,discountMinor:100}],101,{lines:[tax("line:0",82),tax(undefined,9)]},{lines:[tax("line:0",91),tax(undefined,9)]});
  expect(result).toMatchObject({subtotalMinor:909,discountMinor:91,shippingMinor:92,shippingTaxMinor:9,taxMinor:91,totalMinor:1001});
  expect(result.calculatedLines[0]).toMatchObject({subtotalMinor:909,discountMinor:91,taxMinor:82,totalMinor:900});
 });
 it("keeps global original item keys when a business owns a noncontiguous subset",()=>{
  const result=calculateInvoiceAmounts([{quantityMicros:1000000,unitAmountMinor:1000,discountMinor:0},{quantityMicros:1000000,unitAmountMinor:2000,discountMinor:0}],0,{lines:[tax("line:1",100,false),tax("line:3",200,false)]},undefined,["line:1","line:3"]);
  expect(result.totalMinor).toBe(3300);expect(result.calculatedLines.map(line=>line.taxMinor)).toEqual([100,200]);
 });
 it("refuses unrelated tax lines, duplicate keys and discounts exceeding the actual item",()=>{
  const line={quantityMicros:1000000,unitAmountMinor:100,discountMinor:0};
  expect(()=>calculateInvoiceAmounts([line],0,{lines:[tax("line:9",1)]})).toThrow(/unrelated/);
  expect(()=>calculateInvoiceAmounts([line,line],0,{lines:[]},undefined,["line:0","line:0"])).toThrow(/one original/);
  expect(()=>calculateInvoiceAmounts([{...line,discountMinor:101}],0,{lines:[]})).toThrow(/exceeds/);
 });
});
