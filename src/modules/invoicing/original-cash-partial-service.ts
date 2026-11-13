// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: exact cumulative targets, current raw money and original credit locks.
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { defineService, ServiceError, type ServiceContext } from "@/core/service";
import { originalCashRecoveryOwner, originalCashRecoveryCashWitness } from "./original-cash-recovery-store";
import { currentOriginalCashInventory, appendOriginalCashFact, admitOriginalCashOperation, auxiliaryFactsResolved } from "./original-cash-recovery-service";
import { originalCashRecoveryRevision } from "./original-cash-recovery-current";
import { originalPartialCashSource } from "./original-cash-partial-source";
import { completeOriginalRefundInventory, originalPartialCashTargets, originalPartialTargetKey } from "./original-cash-partial-amounts";
import { merchantPaymentObservations } from "./merchant-collection-schema";
import { refunds } from "./schema";
import { merchantCashAuxiliaryBody } from "@/adapters/payments/stripe-cash-auxiliary";
import { originalPartialTarget, originalPartialTargetBasis } from "./original-cash-partial-contract";
const id = z.object({ recoveryId: z.uuid(), operationId: z.uuid() }).strict();
async function targetBasis(ctx: ServiceContext, recoveryId: string, operationId: string) {
  const owner = await originalCashRecoveryOwner(ctx.tx, recoveryId);
  if (!owner.paymentId || !owner.owner.cash.applied) throw new ServiceError("conflict", "Cumulative returned-part targets require an actual original applied payment; raw cash uses its separate original remainder flow.");
  // Establish canonical payment/invoice/credit locks BEFORE cash namespace.
  const source = await originalPartialCashSource(ctx, owner.paymentId), current = await currentOriginalCashInventory(ctx, recoveryId, operationId);
  if (!current.history.creatorsQuiesced || current.history.feeDebt || !completeOriginalRefundInventory(current.evidence) || current.proof.debt.some(debt => !["customer_refund", "commission", "recipient"].includes(debt))
    || current.evidence.amountRefundedMinor !== source.customerReturnedMinor || current.evidence.currency !== source.currency) throw new ServiceError("conflict", "Restore the complete current original customer cash and finished callers before partial auxiliary money.");
  const refundIds = source.refundIds;
  const money = refundIds.length ? await ctx.tx.select().from(refunds).where(inArray(refunds.id, refundIds)).limit(5001) : [];
  const positive = current.evidence.refunds.filter(resource => resource.status === "succeeded");
  if (new Set(refundIds).size !== refundIds.length || money.length !== refundIds.length || positive.length !== money.length
    || current.evidence.refunds.some(resource => !["succeeded", "failed", "canceled"].includes(resource.status ?? "unknown"))
    || positive.some(resource => !money.some(row => row.paymentId === owner.paymentId && row.status === "succeeded" && row.providerRef === resource.providerRef
      && row.amountMinor === resource.amountMinor && row.currency === resource.currency && resource.paymentProviderRef === current.cash.providerRef))) throw new ServiceError("conflict", "Only exact original returned allocation resources can own this target; an unrelated equal refund or action state cannot substitute.");
  const [capture] = await ctx.tx.select().from(merchantPaymentObservations).where(eq(merchantPaymentObservations.id, current.cash.originalObservationId!));
  const fee = current.evidence.fee, transfer = current.evidence.transfer, recipient = owner.owner.recipientAccountId;
  if (!capture || !recipient || !current.evidence.feeFieldObserved || !current.evidence.transferFieldObserved
    || fee && (current.cash.originalFeeRef !== fee.providerRef || fee.originatingChargeRef !== current.evidence.providerChargeRef || fee.accountId !== recipient
      || fee.amountMinor === null || fee.refundedMinor === null || !fee.currency || capture.observedApplicationFeeMinor !== fee.amountMinor || capture.applicationFeeCurrency !== fee.currency)
    || transfer && (current.cash.originalTransferRef !== transfer.providerRef || transfer.sourceChargeRef !== current.evidence.providerChargeRef || transfer.destinationAccountId !== recipient
      || transfer.amountMinor === null || transfer.reversedMinor === null || !transfer.currency)
    || !fee && source.acceptedFeeMinor !== 0) throw new ServiceError("conflict", "Restore actual original fee/transfer IDs, observed currencies and recipient; do not invent historical resource ownership or conversion.");
  const target = originalPartialCashTargets({ principalMinor: source.originalPrincipalMinor, principalCurrency: source.currency, customerReturnedMinor: source.customerReturnedMinor,
    acceptedFeeMinor: source.acceptedFeeMinor, acceptedFeeRetainedMinor: source.acceptedFeeRetainedMinor,
    fee: fee ? { originalMinor: fee.amountMinor!, returnedMinor: fee.refundedMinor!, currency: fee.currency! } : null,
    recipient: transfer ? { originalMinor: transfer.amountMinor!, returnedMinor: transfer.reversedMinor!, currency: transfer.currency! } : null });
  if (target.fee.overReturnedMinor || target.recipient.overReturnedMinor) throw new ServiceError("conflict", "The actual auxiliary return exceeds this exact accepted cumulative target. Preserve the excess for review; never clamp it into closure.");
  const descriptor = { protocol: "freeholder.original-cash-partial-target.v1" as const, sourceDigest: source.sourceDigest, originalPrincipalMinor: source.originalPrincipalMinor,
    customerReturnedMinor: source.customerReturnedMinor, principalCurrency: source.currency, acceptedFeeMinor: source.acceptedFeeMinor, acceptedFeeRetainedMinor: source.acceptedFeeRetainedMinor,
    fee: fee ? { providerRef: fee.providerRef, originalMinor: fee.amountMinor!, currency: fee.currency!, accountId: recipient, chargeRef: current.evidence.providerChargeRef } : null,
    recipient: transfer ? { providerRef: transfer.providerRef, originalMinor: transfer.amountMinor!, currency: transfer.currency!, accountId: recipient, chargeRef: current.evidence.providerChargeRef } : null,
    feeTargetMinor: target.fee.targetMinor, recipientTargetMinor: target.recipient.targetMinor, paymentId: owner.paymentId, invoiceId: source.invoiceId, originalCreditIds: source.notes.map(note => note.id) };
  const body = { ...descriptor, targetKey: originalPartialTargetKey(descriptor), originalInventoryOperationId: operationId };
  return { owner, source, current, target, body: originalPartialTargetBasis.parse(body) };
}
export const retainOriginalPartialCashTarget = defineService({
  name: "invoicing.retainOriginalPartialCashTarget", summary: "Freeze one exact cumulative original returned-part/credit policy and actual original auxiliary resource target.",
  kind: "mutation", permission: "system", external: false, writeClass: "money", input: id.extend({ authorizedBy: z.string().regex(/^user:[0-9a-f-]{36}$/) }), output: z.object({ targetFactId: z.uuid() }),
  handler: async ({ recoveryId, operationId, authorizedBy }, ctx) => {
    const basis = await targetBasis(ctx, recoveryId, operationId), witness = await originalCashRecoveryCashWitness(ctx.tx, basis.current.cash);
    const existing = witness.facts.find(fact => fact.kind === "partial_target" && fact.evidence.targetKey === basis.body.targetKey);
    if (existing) return { targetFactId: existing.id };
    const targetFactId = randomUUID(); await appendOriginalCashFact(ctx, recoveryId, null, "partial_target", originalPartialTarget.parse({ ...basis.body, authorizedBy }), targetFactId); return { targetFactId };
  },
});
export const claimOriginalPartialCashAuxiliary = defineService({
  name: "invoicing.claimOriginalPartialCashAuxiliary", summary: "Admit only the remaining exact cumulative fee or recipient amount under original credit, cash and target-generation locks.",
  kind: "mutation", permission: "system", external: false, writeClass: "money", input: id.extend({ targetFactId: z.uuid(), kind: z.enum(["fee", "recipient"]) }),
  output: z.object({ recoveryId: z.uuid(), operationId: z.uuid(), nonce: z.string(), request: z.record(z.string(), z.unknown()) }).nullable(),
  handler: async ({ recoveryId, operationId, targetFactId, kind }, ctx) => {
    const basis = await targetBasis(ctx, recoveryId, operationId), witness = await originalCashRecoveryCashWitness(ctx.tx, basis.current.cash);
    const actual = witness.facts.find(fact => fact.id === targetFactId && fact.kind === "partial_target");
    if (!actual || originalPartialTarget.parse(actual.evidence).targetKey !== basis.body.targetKey || !auxiliaryFactsResolved(witness)) throw new ServiceError("conflict", "Restore the same exact original target and resolve every older actual auxiliary caller before another generation.");
    if (witness.operations.some(operation => operation.kind === kind && operation.request.targetFactId === targetFactId)) return null;
    const parent = kind === "fee" ? basis.body.fee : basis.body.recipient, amountMinor = basis.target[kind].remainingMinor;
    if (!parent || !amountMinor) return null;
    const auxiliaryId = randomUUID(), totalTargetMinor = kind === "fee" ? basis.body.feeTargetMinor : basis.body.recipientTargetMinor;
    return admitOriginalCashOperation(ctx, recoveryId, kind, { kind, operationId: auxiliaryId, targetFactId,
      providerPlatformAccountId: basis.current.cash.providerPlatformAccountId, providerApiVersion: basis.current.cash.providerApiVersion,
      originalChargeRef: parent.chargeRef, originalAccountId: parent.accountId, parentRef: parent.providerRef,
      originalAmountMinor: parent.originalMinor, alreadyReturnedMinor: totalTargetMinor - amountMinor, amountMinor, currency: parent.currency,
      idempotencyKey: `original-cash-partial:${targetFactId}:${kind}`, frozenBody: merchantCashAuxiliaryBody(auxiliaryId, amountMinor) }, auxiliaryId);
  },
});
export const finalizeOriginalPartialCashTarget = defineService({
  name: "invoicing.finalizeOriginalPartialCashTarget", summary: "Confirm only the actual cumulative original returned-part target, preserving unreturned principal and its independent obligations.",
  kind: "mutation", permission: "system", external: false, writeClass: "money", input: id.extend({ targetFactId: z.uuid() }), output: z.object({ closureFactId: z.uuid() }),
  handler: async ({ recoveryId, operationId, targetFactId }, ctx) => {
    const basis = await targetBasis(ctx, recoveryId, operationId), witness = await originalCashRecoveryCashWitness(ctx.tx, basis.current.cash);
    const target = witness.facts.find(fact => fact.id === targetFactId && fact.kind === "partial_target");
    if (!target || originalPartialTarget.parse(target.evidence).targetKey !== basis.body.targetKey || basis.target.fee.remainingMinor || basis.target.recipient.remainingMinor
      || !auxiliaryFactsResolved(witness)) throw new ServiceError("conflict", "Keep partial financial debt until exact current original fee and recipient totals reach their accepted cumulative targets.");
    const revision = (await originalCashRecoveryRevision(ctx, recoveryId)).revision;
    const existing = witness.facts.find(fact => fact.kind === "partial_closure" && fact.evidence.targetFactId === targetFactId && fact.evidence.revision === revision);
    if (existing) return { closureFactId: existing.id };
    const closureFactId = randomUUID(); await appendOriginalCashFact(ctx, recoveryId, null, "partial_closure", { targetFactId, targetKey: basis.body.targetKey,
      sourceDigest: basis.body.sourceDigest, revision, originalInventoryOperationId: operationId, customerReturnedMinor: basis.body.customerReturnedMinor,
      feeTargetMinor: basis.body.feeTargetMinor, recipientTargetMinor: basis.body.recipientTargetMinor }, closureFactId);
    return { closureFactId };
  },
});
export default [retainOriginalPartialCashTarget, claimOriginalPartialCashAuxiliary, finalizeOriginalPartialCashTarget];
