// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38: NEW typed economic domain; old physical source/domain stays intact.
import {ServiceError,type ServiceContext} from "@/core/service";
import {originalPartialCashSource} from "./original-cash-partial-source";
import {controlledAtomicRefundTarget} from "./controlled-atomic-refund-target";
import {originalPartialAtomicEconomicTargets} from "./original-cash-partial-source-v2-policy";
import {merchantTaxDigest} from "./merchant-tax-store";
export async function originalPartialCashSourceV2(ctx:ServiceContext,paymentId:string,lock=true){
 const source=await originalPartialCashSource(ctx,paymentId,lock),atomic=await controlledAtomicRefundTarget(ctx,paymentId);
 if(!atomic)return{...source,currentSourceRevision:source.sourceDigest,sourceProtocol:"freeholder.original-cash-partial-source.v1" as const,economicDescriptor:null};
 if(atomic.target===null||atomic.revision===null||atomic.unassignedDutyMinor===null)throw new ServiceError("conflict","Retain the actual complete original atomic epochs and current refunds before a v2 partial source.");
 const{sourceDigest:currentSourceRevision,...physicalSource}=source;
 const{atomicRefundRevision,...acceptedPolicy}=source.invoiceFeePolicy;
 if(atomicRefundRevision!==atomic.revision)throw new ServiceError("conflict","The actual atomic source changed during its current economic review.");
 const targets=originalPartialAtomicEconomicTargets({principalMinor:acceptedPolicy.segmentPrincipalMinor,feeMinor:acceptedPolicy.segmentFeeMinor,resources:atomic.resources});
 const selected=targets.resources.find(row=>row.paymentId===paymentId);
 if(!selected||selected.targetRetainedFeeMinor!==source.acceptedFeeRetainedMinor||targets.unassignedDutyMinor!==atomic.unassignedDutyMinor)throw new ServiceError("conflict","Restore exact original fee targets and every still-owed unassigned unit; no per-receipt repricing is permitted.");
 // Exact field map: all original invoice/policy/line/credit/refund/source
 // ancestry remains; only the old combined actual-return revision is absent
 // from this separately tagged ECONOMIC descriptor. Actual cash/fee counters
 // and their full revision remain in source/currentSourceRevision/parent.
 const economicDescriptor={protocol:"freeholder.original-cash-partial-source.v2" as const,
  source:{...physicalSource,invoiceFeePolicy:acceptedPolicy},atomicFeeEpoch:targets};
 return{...source,sourceDigest:merchantTaxDigest(economicDescriptor),currentSourceRevision,sourceProtocol:"freeholder.original-cash-partial-source.v2" as const,economicDescriptor};
}
