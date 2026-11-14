// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38: original fee epochs and current canonical refunds, NOT returned-fee
// cash counters, define the separately versioned partial economic target.
import {controlledAtomicRefundAmounts,type AtomicRefundResource} from "./controlled-atomic-refund-amounts";
export function originalPartialAtomicEconomicTargets(input:{principalMinor:number;feeMinor:number;resources:readonly AtomicRefundResource[]}){
 const actual=controlledAtomicRefundAmounts(input);
 return{principalMinor:input.principalMinor,feeMinor:input.feeMinor,remainingCashMinor:actual.remainingCashMinor,wholeTargetFeeMinor:actual.wholeTargetFeeMinor,
  unassignedDutyMinor:actual.unassignedDutyMinor,resources:actual.resources.map(row=>({receiptId:row.receiptId,paymentId:row.paymentId,amountMinor:row.amountMinor,refundedMinor:row.refundedMinor,
   feeMinor:row.feeMinor,originalRetainedFeeMinor:row.originalRetainedFeeMinor,targetRetainedFeeMinor:row.targetRetainedFeeMinor}))};
}
