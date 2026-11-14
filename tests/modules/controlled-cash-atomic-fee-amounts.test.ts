// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN: exact amount policy, not bank ownership/native qualification.
import { describe,expect,it } from "vitest";
import { controlledAtomicFeeAmounts } from "@/modules/invoicing/controlled-cash-atomic-fee-amounts";
import { proportionalFeeCarry } from "@/modules/invoicing/credit-fee-amounts";
const receipt=(receiptId:string,amountMinor:number,feeMinor:number)=>({receiptId,amountMinor,feeMinor});
const original={principalMinor:4200,feeTargetMinor:400,actualPriorCashMinor:0,actualPriorAllocatedFeeMinor:0};
describe("exact actual atomic fee endpoint",()=>{
 it.each([[1,0,4199,400],[4199,400,1,0]])("preserves actual fees in UUID execution order %i/%i then %i/%i",(amount,fee,later,laterFee)=>{
  const actual=controlledAtomicFeeAmounts({...original,receipts:[receipt("a",amount,fee),receipt("b",later,laterFee)]});
  expect(actual).toMatchObject({batchCashMinor:4200,batchFeeMinor:400,finalCashMinor:4200,finalFeeMinor:400});
  expect(actual.receipts).toEqual([{receiptId:"a",amountMinor:amount,feeMinor:fee,priorCashMinor:0,priorAllocatedFeeMinor:0},{receiptId:"b",amountMinor:later,feeMinor:laterFee,priorCashMinor:amount,priorAllocatedFeeMinor:fee}]);
 });
 it("leaves legacy intermediate floors unchanged and refuses an individually overallocated legacy prefix",()=>{
  expect(proportionalFeeCarry({principalMinor:4200,feeObligationMinor:400,allocatedPrincipalMinor:0,allocatedFeeMinor:0,takeMinor:4199})).toBe(399);
  expect(()=>proportionalFeeCarry({principalMinor:4200,feeObligationMinor:400,allocatedPrincipalMinor:4199,allocatedFeeMinor:400,takeMinor:1})).toThrow();
 });
 it("accepts separately committed genuine partial endpoints without granting the missing remainder",()=>{
  expect(controlledAtomicFeeAmounts({...original,receipts:[receipt("a",1,0)]})).toMatchObject({batchCashMinor:1,batchFeeMinor:0,finalCashMinor:1});
  expect(controlledAtomicFeeAmounts({...original,actualPriorCashMinor:1,receipts:[receipt("b",4199,400)]})).toMatchObject({batchCashMinor:4199,batchFeeMinor:400});
 });
 it.each([399,401])("refuses actual whole fee %i even when every individual charge can physically carry it",fee=>{
  expect(()=>controlledAtomicFeeAmounts({...original,receipts:[receipt("a",4199,fee),receipt("b",1,0)]})).toThrow();
 });
 it("cannot use unseen future cash to fund an overallocated single partial receipt",()=>{
  expect(()=>controlledAtomicFeeAmounts({...original,receipts:[receipt("a",4199,400)]})).toThrow();
 });
 it("refuses a previously committed overallocated epoch instead of repairing it with a later receipt",()=>{
  expect(()=>controlledAtomicFeeAmounts({...original,actualPriorCashMinor:4199,actualPriorAllocatedFeeMinor:400,receipts:[receipt("b",1,0)]})).toThrow();
 });
 it("retains the actual credit-reduced cash principal and physical fee target",()=>{
  expect(controlledAtomicFeeAmounts({principalMinor:800,feeTargetMinor:70,actualPriorCashMinor:0,actualPriorAllocatedFeeMinor:0,receipts:[receipt("a",799,70),receipt("b",1,0)]})).toMatchObject({batchCashMinor:800,batchFeeMinor:70});
 });
 it("uses BigInt at the safe-integer boundary rather than floating-point products",()=>{
  const max=Number.MAX_SAFE_INTEGER;expect(controlledAtomicFeeAmounts({principalMinor:max,feeTargetMinor:max-1,actualPriorCashMinor:0,actualPriorAllocatedFeeMinor:0,receipts:[receipt("a",max-1,max-1),receipt("b",1,0)]})).toMatchObject({finalCashMinor:max,finalFeeMinor:max-1});
 });
 it("refuses duplicate or unsorted receipt identities independently of equal amounts",()=>{
  expect(()=>controlledAtomicFeeAmounts({...original,receipts:[receipt("a",2100,200),receipt("a",2100,200)]})).toThrow();
  expect(()=>controlledAtomicFeeAmounts({...original,receipts:[receipt("b",2100,200),receipt("a",2100,200)]})).toThrow();
 });
 it("refuses overage, fee above charge, empty or unbounded batches",()=>{
  for(const receipts of [[],[receipt("a",4201,400)],[receipt("a",1,2)],Array.from({length:5001},(_,index)=>receipt(String(index).padStart(5,"0"),1,0))])expect(()=>controlledAtomicFeeAmounts({...original,receipts})).toThrow();
 });
});
