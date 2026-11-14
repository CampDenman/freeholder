// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: only a closure's own immutable birth is absent from its prior state.
import type { ServiceContext } from "@/core/service";
import { boundOriginalCashRecovery } from "./original-cash-recovery-current";
import { merchantRefundCashHistoryForOriginalInventory } from "./merchant-refund-history";
import { readOriginalInventoryClosureContext, originalInventoryCausalRefusal } from "./original-cash-inventory-causal-proof";
import { merchantTaxDigest } from "./merchant-tax-store";
import { originalInventoryPreimagesEqual } from "./original-cash-inventory-preimage";
import { merchantReturnedCashEvidenceSchema } from "./merchant-returned-cash-contract";
import { merchantReturnedCashProof } from "./merchant-returned-cash-proof";
import { originalCashRecoveryCashWitness } from "./original-cash-recovery-store";
import { legacyBankFeedbackMatchesInventory } from "./legacy-bank-feedback-proof";
export async function currentOriginalCashClosure(ctx:ServiceContext,recoveryId:string,closureId:string){
  const {cash,owner}=await boundOriginalCashRecovery(ctx,recoveryId),own=await readOriginalInventoryClosureContext(ctx.tx,recoveryId,closureId);
  const full=await merchantRefundCashHistoryForOriginalInventory(ctx,cash);
  if(full.history.incomplete||!full.history.creatorsQuiesced||full.history.feeDebt||!full.preimageEntries.some(row=>row.table==="original_cash_recovery_closures"&&row.id===own.closure.id))originalInventoryCausalRefusal();
  const comparison=await merchantRefundCashHistoryForOriginalInventory(ctx,cash,own),causalRevision=merchantTaxDigest({cash,history:comparison.history.digest});
  if(comparison.history.incomplete||causalRevision!==own.closure.revision)originalInventoryCausalRefusal();
  const evidence=merchantReturnedCashEvidenceSchema.parse(own.facts.filter(row=>row.kind==="state").at(-1)?.evidence);
  const feedback=await originalCashRecoveryCashWitness(ctx.tx,cash);
  if(feedback.feedback.some(row=>!legacyBankFeedbackMatchesInventory(row.feedback.evidence,{originalPaymentRef:cash.providerRef,originalChargeAccountId:cash.chargeAccountId,readPlatformAccountId:evidence.providerPlatformAccountId,cash:evidence})))originalInventoryCausalRefusal();
  const proof=merchantReturnedCashProof({original:{...cash,paymentProviderRef:cash.providerRef},evidence,creatorsQuiesced:full.history.creatorsQuiesced,inventoryStable:true});
  if(!proof.settled)originalInventoryCausalRefusal();
  if(!cash.applied){const {verifiedOriginalCashReturnReceipt}=await import("./merchant-cash-return-service");
    if(!own.closure.unappliedReturnReceiptId||!await verifiedOriginalCashReturnReceipt(ctx,own.closure.unappliedReturnReceiptId,owner.owner.source))originalInventoryCausalRefusal();}
  const after=await merchantRefundCashHistoryForOriginalInventory(ctx,cash);
  if(after.history.incomplete||!after.history.creatorsQuiesced||after.history.feeDebt||after.history.digest!==full.history.digest
    ||!originalInventoryPreimagesEqual(full.preimageEntries,after.preimageEntries)
    ||merchantTaxDigest(full.controlledResolutionPreimages)!==merchantTaxDigest(after.controlledResolutionPreimages))originalInventoryCausalRefusal();
  return{cash,history:full.history,closure:own.closure,operationId:own.operation.id,evidence,proof,fullCurrentRevision:merchantTaxDigest({cash,history:full.history.digest}),closurePreInsertRevision:causalRevision};
}
