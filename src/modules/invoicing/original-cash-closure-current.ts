// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: only a closure's own immutable birth is absent from its prior state.
import type { ServiceContext, Tx } from "@/core/service";
import { boundOriginalCashRecovery } from "./original-cash-recovery-current";
import { merchantRefundCashHistoryForOriginalInventory } from "./merchant-refund-history";
import { readOriginalInventoryClosureContext, originalInventoryCausalRefusal } from "./original-cash-inventory-causal-proof";
import { merchantTaxDigest } from "./merchant-tax-store";
import { originalInventoryPreimagesEqual } from "./original-cash-inventory-preimage";
import { merchantReturnedCashEvidenceSchema } from "./merchant-returned-cash-contract";
import { merchantReturnedCashProof } from "./merchant-returned-cash-proof";
import { originalCashRecoveryCashWitness } from "./original-cash-recovery-store";
import { legacyBankFeedbackMatchesInventory } from "./legacy-bank-feedback-proof";
import type { controlledCashFinancialHistory } from "./controlled-provider-financial-witness";
import type { ControlledJournalComposition } from "@/modules/subscriptions/controlled-provider-journal-composition";
export async function currentOriginalCashClosure(ctx:ServiceContext,recoveryId:string,closureId:string){
  const {cash,owner}=await boundOriginalCashRecovery(ctx,recoveryId),own=await readOriginalInventoryClosureContext(ctx.tx,recoveryId,closureId);
  const[full,comparison]=await Promise.all([merchantRefundCashHistoryForOriginalInventory(ctx,cash),merchantRefundCashHistoryForOriginalInventory(ctx,cash,own)]);
  if(full.history.incomplete||!full.history.creatorsQuiesced||full.history.feeDebt||!full.preimageEntries.some(row=>row.table==="original_cash_recovery_closures"&&row.id===own.closure.id))originalInventoryCausalRefusal();
  const causalRevision=merchantTaxDigest({cash,history:comparison.history.digest});
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
export type OriginalPrincipalInvocationShare = {
  closures: Map<string, Promise<Awaited<ReturnType<typeof currentOriginalCashClosure>>>>;
  originalMerchantRefundDebt: Map<string, Promise<boolean>>;
  controlledCashFinancialHistory: Array<{ tx: Tx; key: string; composition?: ControlledJournalComposition; promise: Promise<unknown> }>;
  currentControlled: Map<string, Awaited<ReturnType<typeof controlledCashFinancialHistory>>>;
};
export type OriginalCashClosureShare = OriginalPrincipalInvocationShare;
export function createOriginalCashClosureShare(): OriginalCashClosureShare {
  return { closures: new Map(), originalMerchantRefundDebt: new Map(), controlledCashFinancialHistory: [], currentControlled: new Map() };
}
export async function currentOriginalCashClosureShared(ctx: ServiceContext, recoveryId: string, closureId: string, share?: OriginalCashClosureShare) {
  if (!share) return currentOriginalCashClosure(ctx, recoveryId, closureId);
  const key = JSON.stringify([recoveryId, closureId]), existing = share.closures.get(key);
  if (existing) return existing;
  const current = currentOriginalCashClosure(ctx, recoveryId, closureId);
  share.closures.set(key, current);
  return current;
}
