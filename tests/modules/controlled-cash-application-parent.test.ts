// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN: prospective arithmetic, not a bank/DB authority fixture.
import { describe,expect,it } from "vitest";
import { controlledCashApplicationCapacity,controlledCashApplicationBatchCapacity } from "@/modules/invoicing/controlled-provider-cash-application-parent";
import { randomUUID } from "node:crypto";
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
describe("exact retained receipt batch capacity arithmetic",()=>{
 const original={...invoice,currency:"CAD"};
 const receipt=(amountMinor:number)=>({receiptId:randomUUID(),amountMinor,currency:"CAD"});
 it("preserves a genuine one-cent receipt and every unpaid cent without promising access",()=>{
  const one=receipt(1),actual=controlledCashApplicationBatchCapacity(original,[one]);
  expect(actual).toEqual({receiptIds:[one.receiptId],appliedMinor:1,outstandingBeforeMinor:4200,outstandingAfterMinor:4199});
  expect(JSON.stringify(actual)).not.toMatch(/allowed|access|principalSafe|paidAt/);
 });
 it("retains distinct equal-valued receipt identities when their exact batch settles the remainder",()=>{
  const receipts=[receipt(2100),receipt(2100)],actual=controlledCashApplicationBatchCapacity(original,receipts);
  expect(actual.receiptIds).toEqual(receipts.map(row=>row.receiptId));expect(actual.outstandingAfterMinor).toBe(0);expect(actual.appliedMinor).toBe(4200);
 });
 it("does not reuse one receipt twice even when its duplicated amount fits the remainder",()=>{
  const one=receipt(2100);expect(()=>controlledCashApplicationBatchCapacity(original,[one,one])).toThrow();
 });
 it("retains a partial batch's exact remainder after independent prior cash and credit",()=>{
  const actual=controlledCashApplicationBatchCapacity({...original,totalMinor:12600,creditedMinor:4200,paidMinor:2100},[receipt(2100),receipt(2100)]);
  expect(actual.outstandingBeforeMinor).toBe(6300);expect(actual.outstandingAfterMinor).toBe(2100);
 });
 it("refuses the entire real overage without shrinking any receipt",()=>{
  const receipts=[receipt(4200),receipt(1)],before=JSON.stringify(receipts);
  expect(()=>controlledCashApplicationBatchCapacity(original,receipts)).toThrow();expect(JSON.stringify(receipts)).toBe(before);
 });
 it("cannot exchange a foreign-currency receipt by value",()=>{
  expect(()=>controlledCashApplicationBatchCapacity(original,[{...receipt(4200),currency:"USD"}])).toThrow();
 });
 it("keeps bounded exact receipt membership rather than accepting arbitrary IDs or an empty set",()=>{
  expect(()=>controlledCashApplicationBatchCapacity(original,[])).toThrow();
  expect(()=>controlledCashApplicationBatchCapacity(original,[{...receipt(4200),receiptId:"same-amount-owner"}])).toThrow();
  expect(()=>controlledCashApplicationBatchCapacity({...original,totalMinor:10000,creditedMinor:0,paidMinor:0},Array.from({length:5001},()=>receipt(1)))).toThrow();
 });
});
