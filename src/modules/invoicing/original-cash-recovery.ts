// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: shared human authorization, short mutations around actual I/O.
import { z } from "zod";
import { paymentAdapter } from "@/adapters/payments";
import { defineOrchestratedService, ServiceError, type Actor } from "@/core/service";
import { merchantRefundSource } from "./merchant-refund-origin";
import { ORIGINAL_CASH_RETURN_CONFIRMATION } from "./original-cash-recovery-proof";
import { claimOriginalCashRecovery, claimOriginalCashInspection, claimOriginalCashAuxiliary, claimOriginalUnappliedCashRefund,
  originalCashRecoveryPhase, checkOriginalCashInventory, finalizeOriginalCashRecovery, flushOriginalCashRecovery, performOriginalCashRecovery } from "./original-cash-recovery-service";
import { claimMerchantRefundDispatch, flushLocalMerchantRefundDispatchFinishes, performMerchantRefundDispatch, recordMerchantRefundResourceAcknowledgement } from "./merchant-refund-dispatch";
import { merchantRefundOperationState } from "./merchant-refund-execution";
import { recordMerchantRefundObservation } from "./merchant-refund-observations";
import { merchantPaymentEvidence } from "./merchant-payment-observations";
import { prepareMerchantCashReturnInspection, performMerchantCashReturnInspection, recordCashReturnPrimaryObservation, recordCashReturnObservation, finalizeUnappliedCashReturn } from "./merchant-cash-return-service";
const systemFor = (actor: Actor) => ({ kind: "system", request: actor.request }) as const;
async function inspect(recoveryId: string, actor: Actor) {
  const system = systemFor(actor), source = await originalCashRecoveryPhase.call({ recoveryId }, system), claim = await claimOriginalCashInspection.call({ recoveryId }, system);
  const adapter = paymentAdapter("stripe"); if (!adapter.inspectMerchantReturnedCash) throw new ServiceError("conflict", "Restore original-account cash inventory support.");
  await performOriginalCashRecovery(claim, observe => adapter.inspectMerchantReturnedCash!({ providerPlatformAccountId: source.platform, providerApiVersion: source.apiVersion,
    ...(source.account ? { providerAccountId: source.account } : {}), paymentProviderRef: source.paymentRef,
    onOriginalCashObserved: value => observe("primary", value), onRefundObserved: value => observe("refund", value), onReturnStateObserved: value => observe("state", value) }));
  await checkOriginalCashInventory.call({ recoveryId, operationId: claim.operationId }, system); return claim.operationId;
}
async function recoverAuxiliary(recoveryId: string, auxiliaryOperationId: string, actor: Actor) {
  const system = systemFor(actor), source = await originalCashRecoveryPhase.call({ recoveryId, auxiliaryOperationId }, system);
  if (!source.auxiliaryRequest) throw new ServiceError("conflict", "Restore the exact original auxiliary request before recovery.");
  const adapter = paymentAdapter("stripe"); if (!adapter.recoverMerchantCashAuxiliary) throw new ServiceError("conflict", "Restore original fee/recipient GET recovery support.");
  const claim = await claimOriginalCashInspection.call({ recoveryId, auxiliaryOperationId }, system);
  await performOriginalCashRecovery(claim, async observe => {
    const actual = await adapter.recoverMerchantCashAuxiliary!({ ...source.auxiliaryRequest!,
      onParentObserved: evidence => observe("parent", { ...evidence, auxiliaryOperationId }),
      onResourceAcknowledged: providerRef => observe("ack", { providerRef, auxiliaryOperationId }),
      onResourceObserved: evidence => observe("resource", { ...evidence, auxiliaryOperationId }) });
    if (!actual) throw new ServiceError("conflict", "The original auxiliary operation remains unknown. A missing GET cannot authorize another POST.");
    return actual;
  });
}
async function returnCustomer(recoveryId: string, operationId: string, actor: Actor) {
  const system = systemFor(actor), request = await claimOriginalUnappliedCashRefund.call({ recoveryId, operationId, authorizedBy: actor.kind === "user" ? `user:${actor.userId}` : "system" }, system);
  if (!request) return;
  await flushLocalMerchantRefundDispatchFinishes(request.id);
  const state = await merchantRefundOperationState.call({ requestId: request.id }, system);
  if (!state.creatorsQuiesced) throw new ServiceError("conflict", "The original cash-return creator remains unfinished; review its hosting before recovery.");
  const source = await originalCashRecoveryPhase.call({ recoveryId }, system), adapter = paymentAdapter("stripe");
  if (!adapter.createMerchantRefund || !adapter.recoverMerchantRefund) throw new ServiceError("conflict", "Restore the actual original customer refund and GET recovery adapter.");
  const observe: Parameters<NonNullable<typeof adapter.createMerchantRefund>>[0]["onRefundObserved"] = evidence => recordMerchantRefundObservation.call({ source: source.source,
    requestId: request.id, evidence: { ...evidence, providerApiVersion: evidence.providerApiVersion ?? null,
      status: Object.hasOwn(evidence, "providerStatus") ? evidence.providerStatus ?? null : null } }, system).then(() => undefined);
  if (state.dispatched) {
    const recovered = await adapter.recoverMerchantRefund({ ...request.originalRequest, refundAttemptId: request.id, paymentProviderRef: request.originalPaymentRef,
      ...(state.originalRefundRef ? { originalRefundRef: state.originalRefundRef } : {}), onRefundObserved: observe });
    if (recovered.state !== "observed") throw new ServiceError("conflict", "The original customer refund remains unknown or ambiguous; keep its original reservation and key.");
  } else {
    const dispatch = await claimMerchantRefundDispatch.call({ requestId: request.id }, system);
    await performMerchantRefundDispatch(dispatch, request.id, () => adapter.createMerchantRefund!({ ...request.originalRequest, refundAttemptId: request.id,
      paymentProviderRef: request.originalPaymentRef, onRefundObserved: observe,
      onRefundResourceAcknowledged: providerRef => recordMerchantRefundResourceAcknowledgement.call({ ...dispatch, providerRef }, system).then(() => undefined) }));
  }
}
async function closeUnapplied(recoveryId: string, actor: Actor) {
  const system = systemFor(actor), source = await originalCashRecoveryPhase.call({ recoveryId }, system), claim = await prepareMerchantCashReturnInspection.call({ source: source.source }, system);
  const adapter = paymentAdapter("stripe"); if (!adapter.inspectMerchantReturnedCash) throw new ServiceError("conflict", "Restore actual original cash-return inspection.");
  let observationId: string | undefined;
  await performMerchantCashReturnInspection(claim, () => adapter.inspectMerchantReturnedCash!({ providerPlatformAccountId: source.platform, providerApiVersion: source.apiVersion,
    ...(source.account ? { providerAccountId: source.account } : {}), paymentProviderRef: source.paymentRef,
    onOriginalCashObserved: async evidence => { await recordCashReturnPrimaryObservation.call({ ...claim, evidence: merchantPaymentEvidence.extend({ amountMinor: z.number().int().min(0), currency: z.string().regex(/^[A-Z]{3}$/) }).parse(evidence) }, system); },
    onRefundObserved: async evidence => { await recordMerchantRefundObservation.call({ source: source.source, inspectionId: claim.inspectionId,
      evidence: { ...evidence, providerApiVersion: evidence.providerApiVersion ?? null, status: evidence.providerStatus ?? null } }, system); },
    onReturnStateObserved: async evidence => { observationId = (await recordCashReturnObservation.call({ ...claim, evidence }, system)).observationId; } }));
  if (!observationId) throw new ServiceError("conflict", "Retain the actual complete original cash-return snapshot before canonical disposition.");
  const returned = await finalizeUnappliedCashReturn.call({ inspectionId: claim.inspectionId, observationId }, system);
  if (!returned.settled || !returned.returnReceiptId) throw new ServiceError("conflict", "Keep the original receipt pending until its complete actual return is proved.");
  return returned.returnReceiptId;
}
export const returnOriginalCash = defineOrchestratedService({
  name: "invoicing.returnOriginalCash", summary: "Return exact original unapplied receipt-owned cash and complete its actual fee/recipient obligations, preserving all cash before later policy failures.",
  kind: "mutation", permission: "scoped", stepUp: true, agentCallable: false, writeClass: "money",
  input: z.object({ source: merchantRefundSource, confirmation: z.literal(ORIGINAL_CASH_RETURN_CONFIRMATION) }).strict(), output: z.object({ recoveryId: z.uuid(), closureId: z.uuid() }),
  handler: async ({ source }, actor) => {
    if (actor.kind !== "user" || actor.keyScopes) throw new ServiceError("permission", "A freshly verified signed-in person must authorize this exact original cash return.");
    const system = systemFor(actor), { recoveryId } = await claimOriginalCashRecovery.call({ source, authorizedBy: `user:${actor.userId}` }, system);
    await flushOriginalCashRecovery(recoveryId);
    const initial = await originalCashRecoveryPhase.call({ recoveryId }, system);
    // Every previously admitted POST has GET-only recovery; no age, empty
    // lookup or error path can mint a second physical key for that admission.
    for (const operationId of initial.auxiliaryIds) await recoverAuxiliary(recoveryId, operationId, actor);
    let operationId = await inspect(recoveryId, actor);
    await returnCustomer(recoveryId, operationId, actor);
    operationId = await inspect(recoveryId, actor);
    for (const kind of ["fee", "recipient"] as const) {
      const claim = await claimOriginalCashAuxiliary.call({ recoveryId, operationId, kind }, system);
      if (claim) {
        const adapter = paymentAdapter("stripe"); if (!adapter.createMerchantCashAuxiliary) throw new ServiceError("conflict", "Restore the actual original auxiliary-money adapter.");
        const original = await originalCashRecoveryPhase.call({ recoveryId, auxiliaryOperationId: claim.operationId }, system);
        if (!original.auxiliaryRequest) throw new ServiceError("conflict", "Restore the admitted original auxiliary body.");
        await performOriginalCashRecovery(claim, observe => adapter.createMerchantCashAuxiliary!({ ...original.auxiliaryRequest!,
          onParentObserved: evidence => observe("parent", evidence),
          onResourceAcknowledged: providerRef => observe("ack", { providerRef }), onResourceObserved: evidence => observe("resource", evidence) }));
        operationId = await inspect(recoveryId, actor);
      }
    }
    const current = await checkOriginalCashInventory.call({ recoveryId, operationId }, system);
    const unappliedReturnReceiptId = current.applied ? undefined : await closeUnapplied(recoveryId, actor);
    const closed = await finalizeOriginalCashRecovery.call({ recoveryId, operationId, ...(unappliedReturnReceiptId ? { unappliedReturnReceiptId } : {}) }, system);
    return { recoveryId, ...closed };
  },
});
export const inspectOriginalCashReturn = defineOrchestratedService({
  name: "invoicing.inspectOriginalCashReturn", summary: "Inspect original retained cash and recover already admitted resources by GET without authorizing a new refund, fee or recipient POST.",
  kind: "mutation", permission: "scoped", stepUp: true, writeClass: "money", input: z.object({ recoveryId: z.uuid() }).strict(),
  output: z.object({ operationId: z.uuid(), settled: z.boolean(), feeDebt: z.boolean(), applied: z.boolean(), source: merchantRefundSource }),
  handler: async ({ recoveryId }, actor) => {
    const system = systemFor(actor); await flushOriginalCashRecovery(recoveryId);
    const phase = await originalCashRecoveryPhase.call({ recoveryId }, system);
    for (const operationId of phase.auxiliaryIds) await recoverAuxiliary(recoveryId, operationId, actor);
    const operationId = await inspect(recoveryId, actor); return { operationId, ...await checkOriginalCashInventory.call({ recoveryId, operationId }, system) };
  },
});
export default [returnOriginalCash, inspectOriginalCashReturn];
