// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN. Arithmetic does not supply ownership, ACK or bank authority.
import {describe,expect,it} from "vitest";
import {controlledAtomicRefundAmounts,type AtomicRefundResource} from "@/modules/invoicing/controlled-atomic-refund-amounts";
const big:AtomicRefundResource={receiptId:"00000000-0000-4000-8000-000000000001",paymentId:"00000000-0000-4000-8000-000000000011",amountMinor:4199,refundedMinor:0,feeMinor:400,feeReturnedMinor:0};
const tiny:AtomicRefundResource={receiptId:"00000000-0000-4000-8000-000000000002",paymentId:"00000000-0000-4000-8000-000000000012",amountMinor:1,refundedMinor:1,feeMinor:0,feeReturnedMinor:0};
const input={principalMinor:4200,feeMinor:400,resources:[big,tiny]};
describe("exact committed atomic refund residual arithmetic",()=>{
 it("retains immutable400/zero epochs and assigns the one-cent whole-target return to its real original fee resource",()=>{
  const before=structuredClone(input),actual=controlledAtomicRefundAmounts(input);
  expect(actual).toMatchObject({remainingCashMinor:4199,wholeTargetFeeMinor:399,residualMinor:1,unassignedDutyMinor:0});
  expect(actual.resources).toMatchObject([{...big,originalRetainedFeeMinor:400,targetRetainedFeeMinor:399,residualReturnMinor:1},{...tiny,targetRetainedFeeMinor:0,residualReturnMinor:0}]);expect(input).toEqual(before);
 });
 it("does not assign ownership from supplied order or equal amounts",()=>{
  expect(controlledAtomicRefundAmounts({...input,resources:[tiny,big]})).toEqual(controlledAtomicRefundAmounts(input));
  expect(()=>controlledAtomicRefundAmounts({...input,resources:[big,{...tiny,paymentId:big.paymentId}]})).toThrow();
  expect(()=>controlledAtomicRefundAmounts({...input,resources:[big,{...tiny,receiptId:big.receiptId}]})).toThrow();
 });
 it("does not plan the same return again after its actual accepted ACK",()=>{
  const actual=controlledAtomicRefundAmounts({...input,resources:[{...big,feeReturnedMinor:1},tiny]});expect(actual.residualMinor).toBe(0);expect(actual.resources[0]?.targetRetainedFeeMinor).toBe(399);
 });
 it("does not resurrect the returned cent at a later principal rounding boundary",()=>{
  const actual=controlledAtomicRefundAmounts({...input,resources:[{...big,refundedMinor:1,feeReturnedMinor:1},tiny]});
  expect(actual).toMatchObject({wholeTargetFeeMinor:399,residualMinor:0,unassignedDutyMinor:0});expect(actual.resources[0]?.targetRetainedFeeMinor).toBe(399);
 });
 it("keeps an actually over-returned fee as explicit missing duty rather than inventing a fee collection",()=>{
  const actual=controlledAtomicRefundAmounts({...input,resources:[{...big,feeReturnedMinor:2},tiny]});expect(actual).toMatchObject({residualMinor:0,unassignedDutyMinor:1});expect(actual.resources[0]?.targetRetainedFeeMinor).toBe(398);
 });
 it("targets all original fee cash only after all original principal is genuinely returned",()=>{
  const actual=controlledAtomicRefundAmounts({...input,resources:[{...big,refundedMinor:4199},tiny]});expect(actual).toMatchObject({remainingCashMinor:0,wholeTargetFeeMinor:0});expect(actual.resources.every(row=>row.targetRetainedFeeMinor===0)).toBe(true);
 });
 it.each([-1,0.1,Number.NaN,Number.MAX_SAFE_INTEGER+1])("refuses malformed principal/refund/fee value %s without clipping",value=>{
  expect(()=>controlledAtomicRefundAmounts({...input,resources:[{...big,refundedMinor:value},tiny]})).toThrow();
  expect(()=>controlledAtomicRefundAmounts({...input,resources:[{...big,feeReturnedMinor:value},tiny]})).toThrow();
 });
 it("refuses missing endpoint money and fabricated original fee epochs",()=>{
  expect(()=>controlledAtomicRefundAmounts({...input,resources:[big]})).toThrow();
  expect(()=>controlledAtomicRefundAmounts({...input,resources:[{...big,feeMinor:399},tiny]})).toThrow();
  expect(()=>controlledAtomicRefundAmounts({...input,resources:[{...big,feeReturnedMinor:401},tiny]})).toThrow();
  expect(()=>controlledAtomicRefundAmounts({...input,resources:[]})).toThrow();
 });
 it("never accepts a truncated or duplicate5001-resource inventory",()=>{
  expect(()=>controlledAtomicRefundAmounts({...input,resources:Array.from({length:5001},()=>big)})).toThrow();
 });
});
