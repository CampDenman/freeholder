// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38: genuine same-owner GET/admission/POST/FIN phases, no old-fee bypass.
import {paymentAdapter} from "@/adapters/payments";
import {actorString,ServiceError,type Actor} from "@/core/service";
import type {z} from "zod";
import type {paymentRouting} from "./merchant-charge";
import {inspectOriginalCashInventory,recoverOriginalCashAuxiliary} from "./original-cash-recovery";
import {flushOriginalCashRecovery,originalCashRecoveryPhase,performOriginalCashRecovery} from "./original-cash-recovery-service";
import {retainAtomicAuxiliaryFeeTarget,claimAtomicAuxiliaryFeeReturn,finalizeAtomicAuxiliaryFeeReturn} from "./atomic-auxiliary-fee-service";
import {inspectControlledCashReceipt} from "./controlled-cash-inspection-service";
type Source={routing:z.infer<typeof paymentRouting>;atomicAuxiliaryOwner:{recoveryId:string;collectionId:string;receiptId:string;auxiliaryIds:string[]}};
/** Called only by the existing orchestrated reconciliation service, outside a
 * service transaction. Each private phase independently rechecks actual rows. */
export async function reconcileAtomicAuxiliaryFeeReturn(source:Source,caller:Actor){
 const system={kind:"system",request:caller.request} as const,owner=source.atomicAuxiliaryOwner;
 await flushOriginalCashRecovery(owner.recoveryId);
 for(const operationId of owner.auxiliaryIds)await recoverOriginalCashAuxiliary(owner.recoveryId,operationId,caller);
 // Both journals retain their actual reads. A source GET cannot stand in for
 // the genuine latest controlled returned bank/lineage proof.
 await inspectControlledCashReceipt.call({collectionId:owner.collectionId,receiptId:owner.receiptId},caller);
 let operationId=await inspectOriginalCashInventory(owner.recoveryId,caller);
 const selected={recoveryId:owner.recoveryId,operationId,requestedBy:actorString(caller)};
 const target=await retainAtomicAuxiliaryFeeTarget.call(selected,system);
 if(!target.targetFactId){for(const targetFactId of target.pendingTargetFactIds)await finalizeAtomicAuxiliaryFeeReturn.call({...selected,targetFactId},system);return{state:"satisfied" as const,operation:null,routing:source.routing};}
 // The new target remains in the FULL historical source digest. Its birth
 // invalidates the preceding read, so perform a genuine NEW GET/FIN rather
 // than subtracting declaration kinds or reusing its old opaque revision.
 operationId=await inspectOriginalCashInventory(owner.recoveryId,caller);
 const targetFactId=target.targetFactId;
 const claim=await claimAtomicAuxiliaryFeeReturn.call({...selected,phase:"admit",operationId,targetFactId:target.targetFactId},system);
 if(!claim)throw new ServiceError("conflict","Recover the retained original fee caller by GET; a repeated target cannot create another POST.");
 const phase=await originalCashRecoveryPhase.call({recoveryId:owner.recoveryId,auxiliaryOperationId:claim.operationId},system),adapter=paymentAdapter("stripe");
 if(!phase.auxiliaryRequest||!adapter.createMerchantCashAuxiliary)throw new ServiceError("conflict","Restore the exact original fee auxiliary request and provider adapter.");
 const request=phase.auxiliaryRequest,create=adapter.createMerchantCashAuxiliary.bind(adapter);
 await performOriginalCashRecovery(claim,observe=>create({...request,onParentObserved:async evidence=>{await observe("parent",evidence);await claimAtomicAuxiliaryFeeReturn.call({...selected,phase:"before_post",operationId,actualOperationId:claim.operationId,nonce:claim.nonce,targetFactId},system);},onResourceAcknowledged:providerRef=>observe("ack",{providerRef}),onResourceObserved:evidence=>observe("resource",evidence)}));
 await inspectControlledCashReceipt.call({collectionId:owner.collectionId,receiptId:owner.receiptId},caller);
 operationId=await inspectOriginalCashInventory(owner.recoveryId,caller);
 await finalizeAtomicAuxiliaryFeeReturn.call({...selected,operationId,targetFactId:target.targetFactId},system);
 // The actual auxiliary UUID is retained in its original journal. No
 // merchant_fee_refunds operation is fabricated for this other protocol.
 return{state:"accepted" as const,operation:null,routing:source.routing};
}
