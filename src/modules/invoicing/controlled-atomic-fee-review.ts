// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38: real normal-period and proration ancillary debt, never a cash grant.
import {eq} from "drizzle-orm";
import {z} from "zod";
import {defineOrchestratedService,defineService,ServiceError} from "@/core/service";
import {payments} from "./schema";
import {routingForPayment} from "./merchant-charge";
import {controlledAtomicFeeOwner,controlledAtomicRefundTarget,controlledAtomicRefundFeeState} from "./controlled-atomic-refund-target";
const feeRow=z.object({paymentId:z.uuid(),originalFeeMinor:z.number().int().nonnegative(),targetRetainedFeeMinor:z.number().int().nonnegative().nullable(),actualRetainedFeeMinor:z.number().int().nonnegative().nullable(),currency:z.string().regex(/^[A-Z]{3}$/),pending:z.boolean()});
export const reviewAtomicFeeReconciliation=defineService({name:"invoicing.reviewAtomicFeeReconciliation",summary:"Show original immutable fees, actual retained bank fees and still-owed exact original reconciliation on this invoice.",kind:"query",permission:"scoped",
 input:z.object({invoiceId:z.uuid()}).strict(),output:z.array(feeRow).max(5000),
 handler:async({invoiceId},ctx)=>{
  const actual=await ctx.tx.select().from(payments).where(eq(payments.invoiceId,invoiceId)).limit(5001);if(actual.length>5000)throw new ServiceError("conflict","Restore every original payment before reviewing its commission.");
  const rows:Array<z.infer<typeof feeRow>>=[];
  for(const payment of actual){const target=await controlledAtomicRefundTarget(ctx,payment.id);if(!target)continue;
   const state=await controlledAtomicRefundFeeState(ctx,payment.id,target),routing=await routingForPayment(ctx,payment.id);
   if(!state||routing.applicationFeeMinor===undefined)throw new ServiceError("conflict","Restore the actual original fee resource and current bank evidence before showing a reconciled balance.");
   rows.push({paymentId:payment.id,originalFeeMinor:routing.applicationFeeMinor,targetRetainedFeeMinor:target.target,actualRetainedFeeMinor:state.actualRetainedFeeMinor,currency:payment.currency,pending:state.pending});
  }
  ctx.setSubject("invoice",invoiceId);return rows;
 }});
export const atomicFeeBankSource=defineService({name:"invoicing.atomicFeeBankSource",summary:"Resolve only this actual applied atomic fee's original receipt and fresh-evidence debt; no public account or amount selects it.",kind:"query",permission:"system",external:false,
 input:z.object({paymentId:z.uuid()}).strict(),output:z.object({collectionId:z.uuid(),receiptId:z.uuid(),pending:z.boolean()}).nullable(),handler:async({paymentId},ctx)=>{
  const state=await controlledAtomicRefundFeeState(ctx,paymentId);if(!state)return null;
  const owner=await controlledAtomicFeeOwner(ctx,paymentId);if(!owner)throw new ServiceError("conflict","Restore the original atomic fee source before reading its bank evidence.");
  ctx.setSubject("payment",paymentId);return{collectionId:owner.collectionId,receiptId:owner.receiptId,pending:state.pending};
 }});
export const refreshAtomicFeeBankEvidence=defineOrchestratedService({name:"invoicing.refreshAtomicFeeBankEvidence",summary:"Read genuine complete original charge/refund/dispute evidence after the fee outcome; never repeat a fee POST or infer a bank result from an ACK.",kind:"mutation",permission:"scoped",writeClass:"money",
 input:z.object({paymentId:z.uuid()}).strict(),output:z.object({handled:z.boolean(),bankReadReturned:z.boolean(),feeReconciled:z.boolean().nullable()}),handler:async(input,caller)=>{
  const system={kind:"system",request:caller.request} as const,source=await atomicFeeBankSource.call(input,system);
  if(!source)return{handled:false,bankReadReturned:false,feeReconciled:null};if(!source.pending)return{handled:true,bankReadReturned:false,feeReconciled:true};
  const{inspectControlledCashReceipt}=await import("./controlled-cash-inspection-service");
  const actual=await inspectControlledCashReceipt.call({collectionId:source.collectionId,receiptId:source.receiptId},caller);
  const after=await atomicFeeBankSource.call(input,system);if(!after||after.collectionId!==source.collectionId||after.receiptId!==source.receiptId)throw new ServiceError("conflict","Retain the actual returned bank read and restore the exact original fee owner for review.");
  return{handled:true,bankReadReturned:actual.bankReadReturned,feeReconciled:!after.pending};
 }});
export default[reviewAtomicFeeReconciliation,atomicFeeBankSource,refreshAtomicFeeBankEvidence];
