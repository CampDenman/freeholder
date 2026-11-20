// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38: actual held own birth is explicit; every other row/debt stays current.
import {createHash} from "node:crypto";
import {sql} from "drizzle-orm";
import {ServiceError,type ServiceContext} from "@/core/service";
import {originalAtomicFeeCallerHeld,releaseOriginalAtomicFeeCaller} from "./original-cash-recovery-service";
import {originalCashRecoveryOperation,originalCashOperationFacts} from "./original-cash-recovery-store";
import {atomicAuxiliaryFeeTarget} from "./atomic-auxiliary-fee-contract";
import {originalCashRecoveryFacts} from "./original-cash-recovery-schema";
import {eq} from "drizzle-orm";
import {controlledAtomicRefundTarget,lockControlledAtomicRefundEvidence} from "./controlled-atomic-refund-target";
import {readAtomicFeeReturnResources} from "./atomic-fee-return-resources";
import {merchantPhysicalCaller} from "./merchant-physical-caller";
function refuse():never{throw new ServiceError("conflict","Retain actual original preflight facts; only the one real running, unstarted exact auxiliary POST with every other caller closed may continue.");}
export async function assertAtomicAuxiliaryFeeBeforePost(ctx:ServiceContext,input:{recoveryId:string;operationId:string;targetFactId:string;actualOperationId:string;nonce:string}){
 if(!originalAtomicFeeCallerHeld(input.actualOperationId,input.nonce))refuse();
 const operation=await originalCashRecoveryOperation(ctx.tx,input.actualOperationId),[fact]=await ctx.tx.select().from(originalCashRecoveryFacts).where(eq(originalCashRecoveryFacts.id,input.targetFactId));
 if(!fact||fact.kind!=="atomic_fee_target"||fact.recoveryId!==input.recoveryId)refuse();const target=atomicAuxiliaryFeeTarget.parse(fact.evidence);
 if(operation.recoveryId!==input.recoveryId||operation.kind!=="fee"||operation.request.targetFactId!==fact.id||operation.request.admissionInventoryOperationId!==input.operationId||operation.request.atomicFeeProtocol!=="freeholder.original-cash-atomic-fee-operation.v1"
  ||operation.nonceHash!==createHash("sha256").update(input.nonce).digest("hex")||operation.caller.id!==merchantPhysicalCaller().id)refuse();
 const current=await lockControlledAtomicRefundEvidence(ctx,target.paymentId);if(!current||current.coverage.unfinishedCallers.some(row=>row.kind!=="original_cash"||row.id!==operation.id))refuse();
 const union=await readAtomicFeeReturnResources(ctx,target.paymentId),economic=await controlledAtomicRefundTarget(ctx,target.paymentId),facts=await originalCashOperationFacts(ctx.tx,operation.id),parent=facts.filter(row=>row.kind==="parent");
 if(!union||union.unfinishedIds.some(id=>id!==operation.id)||union.pendingOperationIds.some(id=>id!==operation.id)||!economic||economic.target!==target.targetRetainedFeeMinor||economic.unassignedDutyMinor!==0
  ||union.returnedMinor!==target.priorReturnedMinor||parent.length!==1||facts.some(row=>["ack","resource","finish","stop"].includes(row.kind)))refuse();
 const observed=parent[0]?.evidence;if(!observed||observed.providerRef!==target.feeRef||observed.chargeRef!==target.chargeRef||observed.accountId!==target.account||observed.amountMinor!==target.originalFeeMinor||observed.returnedMinor!==target.priorReturnedMinor||observed.currency!==target.currency)refuse();
 const{parentFinancialGraphForTx}=await import("./controlled-provider-financial-parent"),{controlledCollectionCoverage}=await import("@/modules/subscriptions/controlled-provider-collection-coverage"),{controlledTargetRawClassification}=await import("./controlled-target-raw-classification");
 const graph=await parentFinancialGraphForTx(ctx.tx,current.owner.subscriptionId),coverage=await controlledCollectionCoverage(ctx.tx,{subscriptionId:current.owner.subscriptionId});
 const raw=await controlledTargetRawClassification(ctx.tx,current.owner.subscriptionId,coverage,graph);if(raw.unresolvedFactIds.length)refuse();
 await ctx.tx.execute(sql`select set_config('freeholder.original_atomic_fee_nonce',${input.nonce},true)`);
 const[valid]=await ctx.tx.execute<{valid:boolean}>(sql`select freeholder_atomic_auxiliary_fee_operation_valid(to_jsonb(actual_call)) as valid from original_cash_recovery_operations actual_call where actual_call.id=${operation.id}::uuid`);if(valid?.valid!==true)refuse();
 ctx.setSubject("payment",target.paymentId);releaseOriginalAtomicFeeCaller(operation.id,input.nonce);
}
