// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: exact partial closure fact/current resources, never whole principal.
import {eq,inArray} from "drizzle-orm";
import type {ServiceContext} from "@/core/service";
import {boundOriginalCashRecovery} from "./original-cash-recovery-current";
import {readOriginalInventoryPartialClosureContext,originalInventoryCausalRefusal} from "./original-cash-inventory-causal-proof";
import {merchantRefundCashHistoryForOriginalInventory} from "./merchant-refund-history";
import {originalInventoryPreimagesEqual} from "./original-cash-inventory-preimage";
import {merchantTaxDigest} from "./merchant-tax-store";
import {merchantReturnedCashEvidenceSchema} from "./merchant-returned-cash-contract";
import {merchantReturnedCashProof} from "./merchant-returned-cash-proof";
import {originalPartialCashSource} from "./original-cash-partial-source";
import {completeOriginalRefundInventory,originalPartialCashTargets,originalPartialTargetKey} from "./original-cash-partial-amounts";
import {merchantPaymentObservations} from "./merchant-collection-schema";
import {refunds} from "./schema";
import {originalCashRecoveryCashWitness,originalCashRecoveryOperation} from "./original-cash-recovery-store";
import {exactCashResourceRefs} from "./original-cash-recovery-proof";
import {legacyBankFeedbackMatchesInventory} from "./legacy-bank-feedback-proof";

export async function currentOriginalPartialCashClosure(ctx:ServiceContext,recoveryId:string,closureFactId:string){
 const{owner,cash}=await boundOriginalCashRecovery(ctx,recoveryId),own=await readOriginalInventoryPartialClosureContext(ctx.tx,recoveryId,closureFactId);
 if(!owner.paymentId||!cash.applied)originalInventoryCausalRefusal();
 const full=await merchantRefundCashHistoryForOriginalInventory(ctx,cash);
 if(full.history.incomplete||!full.history.creatorsQuiesced||full.history.feeDebt||!full.preimageEntries.some(row=>row.table==="original_cash_recovery_facts"&&row.id===own.closure.id))originalInventoryCausalRefusal();
 const comparison=await merchantRefundCashHistoryForOriginalInventory(ctx,cash,own),closurePreInsertRevision=merchantTaxDigest({cash,history:comparison.history.digest});
 if(comparison.history.incomplete||closurePreInsertRevision!==own.closureEvidence.revision)originalInventoryCausalRefusal();
 const evidence=merchantReturnedCashEvidenceSchema.parse(own.facts.filter(row=>row.kind==="state").at(-1)?.evidence);
 const declaration=await originalCashRecoveryOperation(ctx.tx,own.target.originalInventoryOperationId),paymentId=owner.paymentId;
 const readSource=async()=>{if(declaration.request.inventoryComparison!==undefined){const{originalPartialCashSourceV2}=await import("./original-cash-partial-source-v2");const source=await originalPartialCashSourceV2(ctx,paymentId,false);return{source,currentSourceRevision:source.currentSourceRevision};}
   const source=await originalPartialCashSource(ctx,paymentId,false);return{source,currentSourceRevision:source.sourceDigest};};
 const sourceSnapshot=await readSource(),source=sourceSnapshot.source;
 const proof=merchantReturnedCashProof({original:{...cash,paymentProviderRef:cash.providerRef},evidence,creatorsQuiesced:full.history.creatorsQuiesced,inventoryStable:true});
 if(!completeOriginalRefundInventory(evidence)||proof.debt.some(debt=>!["customer_refund","commission","recipient"].includes(debt))
  ||evidence.amountRefundedMinor!==source.customerReturnedMinor||evidence.currency!==source.currency)originalInventoryCausalRefusal();
 const money=source.refundIds.length?await ctx.tx.select().from(refunds).where(inArray(refunds.id,source.refundIds)).limit(5001):[],positive=evidence.refunds.filter(row=>row.status==="succeeded");
 if(new Set(source.refundIds).size!==source.refundIds.length||money.length!==source.refundIds.length||positive.length!==money.length
  ||evidence.refunds.some(row=>!["succeeded","failed","canceled"].includes(row.status??"unknown"))
  ||positive.some(resource=>!money.some(row=>row.paymentId===owner.paymentId&&row.status==="succeeded"&&row.providerRef===resource.providerRef&&row.amountMinor===resource.amountMinor&&row.currency===resource.currency&&resource.paymentProviderRef===cash.providerRef)))originalInventoryCausalRefusal();
 if(!cash.originalObservationId)originalInventoryCausalRefusal();
 const[capture]=await ctx.tx.select().from(merchantPaymentObservations).where(eq(merchantPaymentObservations.id,cash.originalObservationId));
 const fee=evidence.fee,transfer=evidence.transfer,recipient=owner.owner.recipientAccountId;
 if(!capture||!recipient||!evidence.feeFieldObserved||!evidence.transferFieldObserved
  ||fee&&(cash.originalFeeRef!==fee.providerRef||fee.originatingChargeRef!==evidence.providerChargeRef||fee.accountId!==recipient||fee.amountMinor===null||fee.refundedMinor===null||!fee.currency||capture.observedApplicationFeeMinor!==fee.amountMinor||capture.applicationFeeCurrency!==fee.currency)
  ||transfer&&(cash.originalTransferRef!==transfer.providerRef||transfer.sourceChargeRef!==evidence.providerChargeRef||transfer.destinationAccountId!==recipient||transfer.amountMinor===null||transfer.reversedMinor===null||!transfer.currency)
  ||!fee&&source.acceptedFeeMinor!==0)originalInventoryCausalRefusal();
 // Explicit narrowing of actual nullable bank counts; no guessed zero value.
 const feeAmounts=fee?(()=>{if(fee.amountMinor===null||fee.refundedMinor===null||fee.currency===null)originalInventoryCausalRefusal();return{originalMinor:fee.amountMinor,returnedMinor:fee.refundedMinor,currency:fee.currency};})():null;
 const transferAmounts=transfer?(()=>{if(transfer.amountMinor===null||transfer.reversedMinor===null||transfer.currency===null)originalInventoryCausalRefusal();return{originalMinor:transfer.amountMinor,returnedMinor:transfer.reversedMinor,currency:transfer.currency};})():null;
 const targets=originalPartialCashTargets({principalMinor:source.originalPrincipalMinor,principalCurrency:source.currency,customerReturnedMinor:source.customerReturnedMinor,acceptedFeeMinor:source.acceptedFeeMinor,acceptedFeeRetainedMinor:source.acceptedFeeRetainedMinor,fee:feeAmounts,recipient:transferAmounts});
 if(targets.fee.overReturnedMinor||targets.recipient.overReturnedMinor||targets.fee.remainingMinor||targets.recipient.remainingMinor)originalInventoryCausalRefusal();
 const descriptor={protocol:"freeholder.original-cash-partial-target.v1" as const,sourceDigest:source.sourceDigest,originalPrincipalMinor:source.originalPrincipalMinor,customerReturnedMinor:source.customerReturnedMinor,principalCurrency:source.currency,
  acceptedFeeMinor:source.acceptedFeeMinor,acceptedFeeRetainedMinor:source.acceptedFeeRetainedMinor,
  fee:fee&&feeAmounts?{providerRef:fee.providerRef,originalMinor:feeAmounts.originalMinor,currency:feeAmounts.currency,accountId:recipient,chargeRef:evidence.providerChargeRef}:null,
  recipient:transfer&&transferAmounts?{providerRef:transfer.providerRef,originalMinor:transferAmounts.originalMinor,currency:transferAmounts.currency,accountId:recipient,chargeRef:evidence.providerChargeRef}:null,
  feeTargetMinor:targets.fee.targetMinor,recipientTargetMinor:targets.recipient.targetMinor,paymentId:owner.paymentId,invoiceId:source.invoiceId,originalCreditIds:source.notes.map(note=>note.id)};
 const{targetKey,originalInventoryOperationId,authorizedBy,...frozenDescriptor}=own.target;
 // These original identities remain in the actual signed target; descriptor
 // equality deliberately compares its original stable economic fields.
 if(!originalInventoryOperationId||!authorizedBy||targetKey!==originalPartialTargetKey(descriptor)||merchantTaxDigest(frozenDescriptor)!==merchantTaxDigest(descriptor)
  ||own.closureEvidence.sourceDigest!==source.sourceDigest||own.closureEvidence.customerReturnedMinor!==source.customerReturnedMinor
  ||own.closureEvidence.feeTargetMinor!==targets.fee.targetMinor||own.closureEvidence.recipientTargetMinor!==targets.recipient.targetMinor)originalInventoryCausalRefusal();
 const witness=await originalCashRecoveryCashWitness(ctx.tx,cash);
 // Same existing exact auxiliary ACK/resource/FIN policy, without importing
 // the service-registration module into an ordinary current evidence reader.
 if(!witness.operations.filter(operation=>operation.kind!=="inspection").every(operation=>{
  const facts=witness.facts.filter(fact=>fact.operationId===operation.id||fact.evidence.auxiliaryOperationId===operation.id),refs=exactCashResourceRefs(facts),resources=facts.filter(fact=>fact.kind==="resource");
  return refs?.length===1&&resources.some(fact=>fact.evidence.bindingVerified===true&&fact.evidence.providerRef===refs[0]&&fact.evidence.operationId===operation.id&&fact.evidence.parentRef===operation.request.parentRef&&fact.evidence.amountMinor===operation.request.amountMinor&&fact.evidence.currency===operation.request.currency)
   &&resources.every(fact=>fact.evidence.providerRef===refs[0]&&(fact.evidence.operationId===null||fact.evidence.operationId===operation.id)&&(fact.evidence.parentRef===null||fact.evidence.parentRef===operation.request.parentRef)&&(fact.evidence.amountMinor===null||fact.evidence.amountMinor===operation.request.amountMinor)&&(fact.evidence.currency===null||fact.evidence.currency===operation.request.currency));
 }))originalInventoryCausalRefusal();
 if(witness.feedback.some(row=>!legacyBankFeedbackMatchesInventory(row.feedback.evidence,{originalPaymentRef:cash.providerRef,originalChargeAccountId:cash.chargeAccountId,readPlatformAccountId:evidence.providerPlatformAccountId,cash:evidence})))originalInventoryCausalRefusal();
 const after=await merchantRefundCashHistoryForOriginalInventory(ctx,cash),currentSource=await readSource();
 if(after.history.incomplete||!after.history.creatorsQuiesced||after.history.feeDebt||after.history.digest!==full.history.digest||currentSource.source.sourceDigest!==source.sourceDigest||currentSource.currentSourceRevision!==sourceSnapshot.currentSourceRevision
  ||!originalInventoryPreimagesEqual(full.preimageEntries,after.preimageEntries)||merchantTaxDigest(full.controlledResolutionPreimages)!==merchantTaxDigest(after.controlledResolutionPreimages))originalInventoryCausalRefusal();
 return{cash,history:full.history,closure:own.closure,targetFactId:own.closureEvidence.targetFactId,target:own.target,source,currentSourceRevision:sourceSnapshot.currentSourceRevision,evidence,fullCurrentRevision:merchantTaxDigest({cash,history:full.history.digest}),closurePreInsertRevision,
  suppliesWholeReturnAuthority:false as const,suppliesPrincipalAuthority:false as const};
}
