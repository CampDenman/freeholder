// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN: prospective arithmetic, not a bank/DB authority fixture.
import { describe,expect,it } from "vitest";
import { controlledCashApplicationCapacity } from "@/modules/invoicing/controlled-provider-cash-application-parent";
const invoice={totalMinor:12600,creditedMinor:4200,paidMinor:4200,refundedMinor:0,status:"partially_paid" as const};
describe("controlled prospective cash application capacity",()=>{
 it("requires the exact remaining cash after actual cash and independently issued credit",()=>{
  expect(controlledCashApplicationCapacity(invoice,4200)).toBe(4200);
  expect(()=>controlledCashApplicationCapacity(invoice,8400)).toThrow();
  expect(()=>controlledCashApplicationCapacity({...invoice,paidMinor:8400},4200)).toThrow();
 });
 it("preserves the exact single-cent residual at the safe-integer boundary",()=>{
  const maximum=Number.MAX_SAFE_INTEGER;
  expect(controlledCashApplicationCapacity({...invoice,totalMinor:maximum,creditedMinor:maximum-2,paidMinor:1},1)).toBe(1);
  expect(()=>controlledCashApplicationCapacity({...invoice,totalMinor:maximum,creditedMinor:maximum,paidMinor:1},1)).toThrow();
 });
 it.each([0,4199,4201,-1,0.5,Number.NaN,Number.POSITIVE_INFINITY,Number.MAX_SAFE_INTEGER+1])("does not clip or coerce receipt amount %s into the real remainder",amount=>{
  expect(()=>controlledCashApplicationCapacity(invoice,amount)).toThrow();
 });
 it("does not reopen paid capacity when original cash was refunded",()=>{
  expect(()=>controlledCashApplicationCapacity({...invoice,refundedMinor:4200},4200)).toThrow();
  expect(()=>controlledCashApplicationCapacity({...invoice,paidMinor:8400,refundedMinor:4200},4200)).toThrow();
 });
 it.each(["draft","paid","refunded","void"] as const)("does not apply new prospective cash to a %s invoice",status=>{
  expect(()=>controlledCashApplicationCapacity({...invoice,status},4200)).toThrow();
 });
});
