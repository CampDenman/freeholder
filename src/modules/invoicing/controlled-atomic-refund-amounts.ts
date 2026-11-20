// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38: exact original physical fee epochs survive a whole-target refund.
import { ServiceError } from "@/core/service";
export type AtomicRefundResource={receiptId:string;paymentId:string;amountMinor:number;refundedMinor:number;feeMinor:number;feeReturnedMinor:number};
/** Identity/ownership and actual resolved refunds are authenticated by the
 * caller. Receipt UUID order assigns a residual ONLY among these real fee
 * resources; it never discovers an owner or guesses capture chronology. */
export function controlledAtomicRefundAmounts(input:{principalMinor:number;feeMinor:number;resources:readonly AtomicRefundResource[]}){
 const fail=():never=>{throw new ServiceError("conflict","Restore every exact committed atomic receipt, original fee epoch and resolved principal refund before a commission return.");};
 if(!Number.isSafeInteger(input.principalMinor)||input.principalMinor<=0||!Number.isSafeInteger(input.feeMinor)||input.feeMinor<0||input.feeMinor>input.principalMinor
  ||!input.resources.length||input.resources.length>5000||new Set(input.resources.map(row=>row.receiptId)).size!==input.resources.length||new Set(input.resources.map(row=>row.paymentId)).size!==input.resources.length)fail();
 const ordered=[...input.resources].sort((a,b)=>a.receiptId.localeCompare(b.receiptId));
 let originalCash=0n,originalFee=0n,remainingCash=0n,retainedFee=0n;
 const resources=ordered.map(row=>{
  if(!row.receiptId||!row.paymentId||![row.amountMinor,row.refundedMinor,row.feeMinor,row.feeReturnedMinor].every(value=>Number.isSafeInteger(value)&&value>=0)||row.amountMinor<=0||row.refundedMinor>row.amountMinor||row.feeMinor>row.amountMinor||row.feeReturnedMinor>row.feeMinor)fail();
  originalCash+=BigInt(row.amountMinor);originalFee+=BigInt(row.feeMinor);remainingCash+=BigInt(row.amountMinor-row.refundedMinor);
  const originalRetainedFeeMinor=Number(BigInt(row.feeMinor)*BigInt(row.amountMinor-row.refundedMinor)/BigInt(row.amountMinor));
  // A genuine already returned cent cannot be made collectable again by the
  // next rounding boundary. Missing duty remains explicit, never invented fee.
  const available=Math.min(originalRetainedFeeMinor,row.feeMinor-row.feeReturnedMinor);retainedFee+=BigInt(available);
  return{...row,originalRetainedFeeMinor,targetRetainedFeeMinor:available,residualReturnMinor:0};
 });
 const principal=BigInt(input.principalMinor),fee=BigInt(input.feeMinor);
 if(originalCash>principal||originalFee!==fee*originalCash/principal)fail();
 const wholeTarget=fee*remainingCash/principal;
 let residual=retainedFee>wholeTarget?retainedFee-wholeTarget:0n;
 const residualMinor=Number(residual);
 for(const row of resources){const take=residual<BigInt(row.targetRetainedFeeMinor)?residual:BigInt(row.targetRetainedFeeMinor);row.residualReturnMinor=Number(take);row.targetRetainedFeeMinor-=Number(take);residual-=take;}
 if(residual!==0n)fail();
 return{resources,remainingCashMinor:Number(remainingCash),wholeTargetFeeMinor:Number(wholeTarget),residualMinor,unassignedDutyMinor:Number(wholeTarget>retainedFee?wholeTarget-retainedFee:0n)};
}
