// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38/C9.33: same actual original owner, fresh full graph and fee-only duty.
import {eq} from "drizzle-orm";
import {ServiceError,type ServiceContext} from "@/core/service";
import {merchantAgreementPaymentRoutes} from "./merchant-agreement-schema";
import {originalCashRecoveryOwner} from "./original-cash-recovery-store";
import {currentOriginalCashInventory} from "./original-cash-inventory-current";
import {controlledAtomicRefundTarget,lockControlledAtomicRefundEvidence} from "./controlled-atomic-refund-target";
import {readAtomicFeeReturnResources} from "./atomic-fee-return-resources";
import {merchantTaxDigest} from "./merchant-tax-store";
import {ATOMIC_AUXILIARY_FEE_TARGET,atomicAuxiliaryFeeTarget} from "./atomic-auxiliary-fee-contract";
function refuse():never{throw new ServiceError("conflict","Restore the exact original atomic fee-only target, resolved customer refunds, original auxiliary owner, current bank inventory and every real caller before another fee return.");}
export async function atomicAuxiliaryFeeBasis(ctx:ServiceContext,input:{recoveryId:string;operationId:string;requestedBy:string}){
 const recovery=await originalCashRecoveryOwner(ctx.tx,input.recoveryId);
 const aliases=recovery.subscriptionChargeReceiptId?await ctx.tx.select().from(merchantAgreementPaymentRoutes).where(eq(merchantAgreementPaymentRoutes.originalChargeReceiptId,recovery.subscriptionChargeReceiptId)).limit(2):[];
 if(aliases.length>1)refuse();const paymentId=recovery.paymentId??aliases[0]?.paymentId;
 if(!paymentId||!recovery.owner.cash.applied||recovery.paymentId&&aliases.some(row=>row.paymentId!==recovery.paymentId))refuse();
 // Discover actual FK parents before acquiring the established complete prefix.
 const locked=await lockControlledAtomicRefundEvidence(ctx,paymentId);if(!locked||locked.coverage.unfinishedCallers.length)refuse();
 const union=await readAtomicFeeReturnResources(ctx,paymentId);if(!union||union.unfinishedIds.length||union.pendingOperationIds.length)refuse();
 const required=[...union.original.owners.map(row=>`original_cash_recoveries:${row.id}`),...union.original.operations.map(row=>`original_cash_recovery_operations:${row.id}`),...union.original.facts.map(row=>`original_cash_recovery_facts:${row.id}`),...union.original.closures.map(row=>`original_cash_recovery_closures:${row.id}`)];
 if(required.some(key=>!locked.coverage.entries.some(row=>row.key===key)))refuse();
 if(union.owner.receiptId!==recovery.subscriptionChargeReceiptId&&recovery.paymentId!==paymentId)refuse();
 const current=await currentOriginalCashInventory(ctx,recovery.id,input.operationId),fee=current.evidence.fee;
 const target=await controlledAtomicRefundTarget(ctx,paymentId);
 if(!target||target.target===null||target.unassignedDutyMinor!==0||!fee||!union.owner.applicationFeeRef||!current.history.creatorsQuiesced||current.history.feeDebt
  ||current.proof.debt.some(reason=>!["commission","recipient","customer_refund"].includes(reason))
  ||current.evidence.amountRefundedMinor!==union.binding.payment.refundedMinor||current.evidence.providerPlatformAccountId!==union.binding.receipt.providerPlatformAccountId
  ||current.evidence.paymentProviderRef!==union.binding.receipt.providerPaymentIntentRef||current.evidence.providerChargeRef!==union.binding.receipt.providerChargeRef
  ||current.evidence.chargeAccountId!==union.binding.receipt.chargeAccountId||current.evidence.currency!==union.binding.payment.currency
  ||fee.providerRef!==union.owner.applicationFeeRef||fee.originatingChargeRef!==union.binding.receipt.providerChargeRef||fee.accountId!==union.binding.route.recipientAccountId
  ||fee.amountMinor!==union.binding.route.applicationFeeMinor||fee.refundedMinor!==union.returnedMinor||fee.currency!==union.binding.payment.currency)refuse();
 const amount=BigInt(union.binding.route.applicationFeeMinor)-BigInt(target.target)-BigInt(union.returnedMinor);if(amount<0n||amount>BigInt(Number.MAX_SAFE_INTEGER))refuse();
 const economic={recoveryId:recovery.id,paymentId,receiptId:union.owner.receiptId,invoiceId:union.owner.invoiceId,collectionId:union.owner.collectionId,batchId:union.owner.batchId,receiptProofId:union.owner.proofId,
  namespaceKey:union.owner.namespaceKey,platform:union.binding.receipt.providerPlatformAccountId,account:union.binding.route.recipientAccountId,paymentRef:union.binding.receipt.providerPaymentIntentRef,chargeRef:union.binding.receipt.providerChargeRef,feeRef:union.owner.applicationFeeRef,currency:union.binding.payment.currency,
  originalFeeMinor:union.binding.route.applicationFeeMinor,targetRetainedFeeMinor:target.target,resources:target.resources.map(row=>({paymentId:row.paymentId,receiptId:row.receiptId,amountMinor:row.amountMinor,refundedMinor:row.refundedMinor,feeMinor:row.feeMinor}))};
 const{resources,...originalEconomics}=economic;
 const economicRevision=merchantTaxDigest({...originalEconomics,resources}),targetKey=merchantTaxDigest({protocol:ATOMIC_AUXILIARY_FEE_TARGET,economicRevision});
 const body=Number(amount)>0?atomicAuxiliaryFeeTarget.parse({protocol:ATOMIC_AUXILIARY_FEE_TARGET,targetKey,...originalEconomics,priorReturnedMinor:union.returnedMinor,amountMinor:Number(amount),originalInventoryOperationId:input.operationId,economicRevision,sourceRevision:locked.coverage.revision,unionRevision:union.revision,requestedBy:input.requestedBy}):null;
 return{recovery,locked,union,current,target,economicRevision,targetKey,amountMinor:Number(amount),body};
}
