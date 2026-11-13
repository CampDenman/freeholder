// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: original current bank inventory is ordinary authority, not a registry.
import { ServiceError, type ServiceContext } from "@/core/service";
import { originalCashOperationFacts, originalCashRecoveryCashWitness, originalCashRecoveryOperation } from "./original-cash-recovery-store";
import { originalCashRecoveryRevision } from "./original-cash-recovery-current";
import { merchantReturnedCashEvidenceSchema } from "./merchant-returned-cash-contract";
import { merchantReturnedCashProof } from "./merchant-returned-cash-proof";
import { legacyBankFeedbackMatchesInventory } from "./legacy-bank-feedback-proof";

export async function currentOriginalCashInventory(ctx: ServiceContext, recoveryId: string, operationId: string) {
  const operation = await originalCashRecoveryOperation(ctx.tx, operationId);
  if (operation.recoveryId !== recoveryId || operation.kind !== "inspection" || operation.request.auxiliaryOperationId) throw new ServiceError("conflict", "Use the exact finished original cash-inventory GET.");
  const facts = await originalCashOperationFacts(ctx.tx, operation.id), finish = facts.find(fact => fact.kind === "finish");
  if (finish?.evidence.outcome !== "returned" || finish.evidence.callerInstanceId !== operation.caller.id) throw new ServiceError("conflict", "Retain the actual returned complete original inventory; a hosting stop is not a returned bank snapshot.");
  const current = await originalCashRecoveryRevision(ctx, recoveryId, operationId);
  if (current.revision !== operation.request.sourceRevision) throw new ServiceError("conflict", "The original cash inventory changed during this GET. Retain its facts and inspect it again.");
  const evidence = merchantReturnedCashEvidenceSchema.parse(facts.filter(fact => fact.kind === "state").at(-1)?.evidence);
  const feedback=await originalCashRecoveryCashWitness(ctx.tx,current.cash);
  if(feedback.feedback.some(entry=>!legacyBankFeedbackMatchesInventory(entry.feedback.evidence,{originalPaymentRef:current.cash.providerRef,originalChargeAccountId:current.cash.chargeAccountId,readPlatformAccountId:evidence.providerPlatformAccountId,cash:evidence})))throw new ServiceError("conflict","Retain contradictory or not-yet-inventoried authentic cash feedback; a fresh namespace or equal amount cannot discard its original resource.");
  const proof = merchantReturnedCashProof({ original: { ...current.cash, paymentProviderRef: current.cash.providerRef }, evidence,
    creatorsQuiesced: current.history.creatorsQuiesced, inventoryStable: true });
  return { ...current, evidence, proof };
}
