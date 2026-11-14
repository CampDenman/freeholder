// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38/C9.33: only a real authenticated same-TX atomic stage selects this fee.
import { eq,sql } from "drizzle-orm";
import { ServiceError,type ServiceContext } from "@/core/service";
import type { invoices } from "./schema";
import { controlledCashApplicationLinks } from "./controlled-cash-application-protocol-schema";
import { CONTROLLED_CASH_ATOMIC_PROTOCOL } from "./controlled-cash-application-protocol";
import { readControlledCashApplicationStage } from "./controlled-cash-application-stage";
import { invoiceCashFeeBudget } from "./invoice-credit-cash-fee";
import { controlledAtomicFeeAmounts } from "./controlled-cash-atomic-fee-amounts";
import { CONTROLLED_CASH_BATCH_MARKER,controlledCashBatchPointer } from "@/modules/subscriptions/controlled-cash-batch-pointer";
function refuse():never{throw new ServiceError("conflict","Restore the exact authenticated atomic batch, actual earlier settled cash/fee prefix and whole original endpoint before assigning this charge's physical fee.");}
export async function controlledAtomicStageFee(ctx:ServiceContext,input:{batchId:string;collectionId:string;admissionDigest:string;receiptId:string;paymentId?:string;invoice:typeof invoices.$inferSelect;originalFeeMinor:number;priorCashMinor:number;priorAllocatedFeeMinor:number}){
 const stage=await readControlledCashApplicationStage(ctx,{batchId:input.batchId,receiptId:input.receiptId,...(input.paymentId?{paymentId:input.paymentId}:{})});
 if(stage.batch.protocol!==CONTROLLED_CASH_ATOMIC_PROTOCOL)return null;
 if(stage.batch.invoiceId!==input.invoice.id||stage.batch.currency!==input.invoice.currency||stage.batch.collectionId!==input.collectionId||stage.batch.digest!==input.admissionDigest)refuse();
 const receipts=[...stage.receipts].sort((a,b)=>a.ordinal-b.ordinal),first=receipts[0],selected=receipts.find(row=>row.receiptId===input.receiptId);
 if(!first||!selected||selected.priorCashMinor!==input.priorCashMinor||selected.priorAllocatedFeeMinor!==input.priorAllocatedFeeMinor)refuse();
 const budget=await invoiceCashFeeBudget(ctx,input.invoice,input.originalFeeMinor);
 const actual=controlledAtomicFeeAmounts({principalMinor:budget.principalMinor,feeTargetMinor:budget.physicalFeeTargetMinor,actualPriorCashMinor:stage.batch.invoiceBeforePaidMinor,actualPriorAllocatedFeeMinor:first.priorAllocatedFeeMinor,
  receipts:receipts.map(row=>({receiptId:row.receiptId,amountMinor:row.amountMinor,feeMinor:row.feeMinor}))});
 if(actual.batchCashMinor!==stage.batch.expectedCashMinor||actual.batchFeeMinor!==stage.batch.expectedFeeMinor
  ||actual.receipts.some(row=>{const proof=receipts.find(item=>item.receiptId===row.receiptId);return !proof||proof.priorCashMinor!==row.priorCashMinor||proof.priorAllocatedFeeMinor!==row.priorAllocatedFeeMinor;}))refuse();
 return selected.feeMinor;
}
/** Real after-birth assignment only: actual SQL-created link, never a supplied
 * payment UUID, pointer-only authority or matching-value historical receipt. */
export async function controlledAtomicPaymentFee(ctx:ServiceContext,input:{paymentId:string;invoice:typeof invoices.$inferSelect;originalFeeMinor:number;priorCashMinor:number;priorAllocatedFeeMinor:number}){
 const[raw]=await ctx.tx.execute<{pointer:unknown}>(sql`select nullif(current_setting(${CONTROLLED_CASH_BATCH_MARKER},true),'')::jsonb as pointer`);
 if(raw?.pointer===null)return null;
 const pointer=controlledCashBatchPointer.parse(raw?.pointer);
 const[link]=await ctx.tx.select().from(controlledCashApplicationLinks).where(eq(controlledCashApplicationLinks.paymentId,input.paymentId)).limit(1);
 if(!link||link.batchId!==pointer.batchId||link.receiptId!==pointer.receiptId)refuse();
 return controlledAtomicStageFee(ctx,{...input,...pointer});
}
