// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38/C9.33: exact arithmetic only, never receipt ownership or authority.
import { ServiceError } from "@/core/service";
export type ControlledAtomicFeeAmounts={principalMinor:number;feeTargetMinor:number;actualPriorCashMinor:number;actualPriorAllocatedFeeMinor:number;receipts:readonly {receiptId:string;amountMinor:number;feeMinor:number}[]};
function refuse():never{throw new ServiceError("conflict","Restore the actual original fee epoch and complete atomic receipt batch; no future cash, clipped fee or arbitrary receipt order can supply missing commission.");}
/** Each fee is already independently proved at its actual original bank charge.
 * UUID order is execution order only. Every receipt must settle in one genuine
 * transaction; its deferred final guard independently enforces this endpoint. */
export function controlledAtomicFeeAmounts(input:ControlledAtomicFeeAmounts){
 const {principalMinor,feeTargetMinor,actualPriorCashMinor,actualPriorAllocatedFeeMinor,receipts}=input;
 if(![principalMinor,feeTargetMinor,actualPriorCashMinor,actualPriorAllocatedFeeMinor].every(value=>Number.isSafeInteger(value)&&value>=0)
  ||principalMinor<=0||feeTargetMinor>principalMinor||!receipts.length||receipts.length>5000||new Set(receipts.map(row=>row.receiptId)).size!==receipts.length)refuse();
 const principal=BigInt(principalMinor),target=BigInt(feeTargetMinor),priorCash=BigInt(actualPriorCashMinor),priorFee=BigInt(actualPriorAllocatedFeeMinor);
 if(priorCash>principal||priorFee!==target*priorCash/principal)refuse();
 let cash=priorCash,fee=priorFee;
 const planned=receipts.map((row,index)=>{
  const previous=index>0?receipts[index-1]:undefined;
  if(!Number.isSafeInteger(row.amountMinor)||row.amountMinor<=0||!Number.isSafeInteger(row.feeMinor)||row.feeMinor<0||row.feeMinor>row.amountMinor
   ||index>0&&(!previous||previous.receiptId>=row.receiptId))refuse();
  const result={...row,priorCashMinor:Number(cash),priorAllocatedFeeMinor:Number(fee)};cash+=BigInt(row.amountMinor);fee+=BigInt(row.feeMinor);
  if(cash>principal||fee>BigInt(Number.MAX_SAFE_INTEGER))refuse();return result;
 });
 if(fee!==target*cash/principal)refuse();
 return{receipts:planned,batchCashMinor:Number(cash-priorCash),batchFeeMinor:Number(fee-priorFee),finalCashMinor:Number(cash),finalFeeMinor:Number(fee)};
}
