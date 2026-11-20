// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN: explicit mock projections, no claimed DB/caller authority.
import { randomUUID } from "node:crypto";
import { describe,expect,it } from "vitest";
import { planControlledReceiptBatch,type ControlledReceiptCandidate } from "@/modules/invoicing/controlled-receipt-batch-plan";
function vector(amounts:number[]=[5000]){
 const collectionId=randomUUID(),resourceId=randomUUID(),subscriptionId=randomUUID(),invoice:Parameters<typeof planControlledReceiptBatch>[0]["invoice"]={id:randomUUID(),status:"sent",currency:"CAD",totalMinor:10000,paidMinor:0,creditedMinor:0,refundedMinor:0};
 const candidates:ControlledReceiptCandidate[]=amounts.map((amountMinor,index)=>({receipt:{id:randomUUID(),subscriptionId,providerApiVersion:"2026-10-28.endive",providerPlatformAccountId:"acct_original",chargeAccountId:"acct_originalSeller",
  providerSubscriptionRef:"sub_original",providerInvoiceRef:"in_original",providerPaymentIntentRef:`pi_original${index}`,providerChargeRef:`ch_original${index}`,amountMinor,currency:"CAD",customerChargeVerified:true,merchantRouteVerified:true},
  origin:{receiptId:"",resourceId,operationId:randomUUID(),callId:randomUUID(),factId:randomUUID()},payment:null,route:null}));
 for(const row of candidates)if(row.origin)row.origin.receiptId=row.receipt.id;
 const input={collectionId,resourceId,subscriptionId,providerInvoiceRef:"in_original",providerSubscriptionRef:"sub_original",platform:"acct_original",account:"acct_originalSeller",invoice,receiptIds:candidates.map(row=>row.receipt.id),candidates};
 function applied(index:number){const row=candidates[index]!,r=row.receipt,paymentId=randomUUID();
  row.payment={id:paymentId,invoiceId:invoice.id,provider:"stripe",method:"provider_schedule",providerRef:r.providerPaymentIntentRef,status:"succeeded",amountMinor:r.amountMinor,currency:r.currency};
  row.route={paymentId,subscriptionId,originalChargeReceiptId:r.id,originKind:"provider_schedule",providerPlatformAccountId:r.providerPlatformAccountId,chargeAccountId:r.chargeAccountId,
   providerInvoiceRef:r.providerInvoiceRef,providerPaymentIntentRef:r.providerPaymentIntentRef,providerChargeRef:r.providerChargeRef,providerApiVersion:"2026-10-28.endive"};
 }
 return{input,candidates,applied};
}
describe("exact controlled receipt canonical batch plan",()=>{
 it("keeps the unpaid remainder for genuine partial and tiny receipts without a paid/access result",()=>{
  const v=vector([1,4999]),plan=planControlledReceiptBatch(v.input);
  expect(plan.pending.map(row=>row.amountMinor).sort((a,b)=>a-b)).toEqual([1,4999]);expect(plan.capacity?.outstandingAfterMinor).toBe(5000);
  expect(JSON.stringify(plan)).not.toMatch(/allowed|paidAt|access|principalSafe/);
 });
 it("preserves distinct same-value receipt identity and deterministic receipt-bound keys",()=>{
  const v=vector([5000,5000]),plan=planControlledReceiptBatch(v.input);
  expect(plan.pending.map(row=>row.receiptId)).toEqual([...v.input.receiptIds].sort());expect(new Set(plan.pending.map(row=>row.idempotencyKey)).size).toBe(2);
  for(const row of plan.pending)expect(row.idempotencyKey).toBe(`controlled-receipt:${v.input.collectionId}:${row.receiptId}`);
  expect(plan.capacity?.outstandingAfterMinor).toBe(0);
 });
 it("recognizes an actual route/payment by original receipt FK and applies only the independent remainder",()=>{
  const v=vector([5000,5000]);v.applied(0);v.input.invoice.paidMinor=5000;
  const plan=planControlledReceiptBatch(v.input);expect(plan.applied).toEqual([{receiptId:v.candidates[0]!.receipt.id,paymentId:v.candidates[0]!.payment!.id}]);
  expect(plan.pending.map(row=>row.receiptId)).toEqual([v.candidates[1]!.receipt.id]);expect(plan.capacity?.outstandingAfterMinor).toBe(0);
 });
 it("does not create another application for an already canonical batch",()=>{
  const v=vector([5000,5000]);v.applied(0);v.applied(1);v.input.invoice.paidMinor=10000;v.input.invoice.status="paid";
  const plan=planControlledReceiptBatch(v.input);expect(plan.pending).toEqual([]);expect(plan.applied).toHaveLength(2);expect(plan.capacity).toBeNull();
 });
 it.each(["foreign-origin","foreign-subscription","foreign-bank-invoice","foreign-platform","foreign-currency","missing-origin","missing-receipt"] as const)("refuses %s before producing any write plan despite equal values",kind=>{
  const v=vector([5000,5000]),row=v.candidates[1]!;
  if(kind==="foreign-origin")row.origin!.resourceId=randomUUID();
  if(kind==="foreign-subscription")row.receipt.subscriptionId=randomUUID();
  if(kind==="foreign-bank-invoice")row.receipt.providerInvoiceRef="in_foreign";
  if(kind==="foreign-platform")row.receipt.providerPlatformAccountId="acct_foreign";
  if(kind==="foreign-currency")row.receipt.currency="USD";
  if(kind==="missing-origin")row.origin=null;
  if(kind==="missing-receipt")v.input.receiptIds[1]=randomUUID();
  expect(()=>planControlledReceiptBatch(v.input)).toThrow();
 });
 it.each(["receipt","intent","charge"] as const)("never spends a duplicated original %s twice",kind=>{
  const v=vector([5000,5000]);
  if(kind==="receipt")v.input.receiptIds[1]=v.input.receiptIds[0]!;
  if(kind==="intent")v.candidates[1]!.receipt.providerPaymentIntentRef=v.candidates[0]!.receipt.providerPaymentIntentRef;
  if(kind==="charge")v.candidates[1]!.receipt.providerChargeRef=v.candidates[0]!.receipt.providerChargeRef;
  expect(()=>planControlledReceiptBatch(v.input)).toThrow();
 });
 it("does not treat a real unresolved reserved route as an applied payment",()=>{
  const v=vector();v.applied(0);v.candidates[0]!.payment!.status="processing";expect(()=>planControlledReceiptBatch(v.input)).toThrow();
 });
 it("retains the complete overage and refuses the whole plan instead of clipping one receipt",()=>{
  const v=vector([5000,5001]),before=JSON.stringify(v.input);expect(()=>planControlledReceiptBatch(v.input)).toThrow();expect(JSON.stringify(v.input)).toBe(before);
 });
 it("cannot borrow a same-value payment or route attached to a foreign canonical invoice/receipt",()=>{
  const v=vector();v.applied(0);v.candidates[0]!.payment!.invoiceId=randomUUID();expect(()=>planControlledReceiptBatch(v.input)).toThrow();
  v.candidates[0]!.payment!.invoiceId=v.input.invoice.id;v.candidates[0]!.route!.originalChargeReceiptId=randomUUID();expect(()=>planControlledReceiptBatch(v.input)).toThrow();
 });
});
