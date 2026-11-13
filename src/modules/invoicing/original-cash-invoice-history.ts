// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: exact original invoice ownership, including pre-GET feedback.
import { and, asc, inArray } from "drizzle-orm";
import { ServiceError, type Tx } from "@/core/service";
import { merchantAgreementPaymentRoutes } from "./merchant-agreement-schema";
import { originalCashRecoveryFinancialWitness } from "./original-cash-recovery-store";
import { payments } from "./schema";

export async function originalCashInvoiceHistory(tx: Tx, invoiceIds: readonly string[], originalPaymentIds?: readonly string[]) {
  if (invoiceIds.length > 5000 || (originalPaymentIds?.length ?? 0) > 5000) throw new ServiceError("conflict", "Restore the complete bounded original invoice cash inventory.");
  const references = invoiceIds.length ? await tx.select({ id: payments.id, invoiceId: payments.invoiceId }).from(payments)
    .where(and(inArray(payments.invoiceId, [...invoiceIds]), originalPaymentIds ? inArray(payments.id, [...originalPaymentIds]) : undefined))
    .orderBy(asc(payments.id)).limit(5001) : [];
  if (references.length > 5000) throw new ServiceError("conflict", "Original invoice payment ownership exceeds the safe financial inventory limit.");
  const receiptReferences = references.length ? await tx.select({ paymentId: merchantAgreementPaymentRoutes.paymentId, receiptId: merchantAgreementPaymentRoutes.originalChargeReceiptId })
    .from(merchantAgreementPaymentRoutes).where(inArray(merchantAgreementPaymentRoutes.paymentId, references.map(row => row.id)))
    .orderBy(asc(merchantAgreementPaymentRoutes.paymentId)).limit(5001) : [];
  if (receiptReferences.length > 5000) throw new ServiceError("conflict", "Original invoice receipt ownership exceeds the safe financial inventory limit.");
  const witness = await originalCashRecoveryFinancialWitness(tx, references.map(row => row.id), [...new Set(receiptReferences.map(row => row.receiptId).filter((id): id is string => id !== null))]);
  return { references, receiptReferences, witness };
}

export function originalCashForInvoice(history: Awaited<ReturnType<typeof originalCashInvoiceHistory>>, invoiceId: string) {
  const paymentIds = new Set(history.references.filter(row => row.invoiceId === invoiceId).map(row => row.id));
  const receiptIds = new Set(history.receiptReferences.filter(row => paymentIds.has(row.paymentId)).map(row => row.receiptId));
  const owners = history.witness.owners.filter(row => row.paymentId !== null && paymentIds.has(row.paymentId) || row.subscriptionChargeReceiptId !== null && receiptIds.has(row.subscriptionChargeReceiptId));
  const ownerIds = new Set(owners.map(row => row.id));
  return {
    owners,
    operations: history.witness.operations.filter(row => ownerIds.has(row.recoveryId)),
    facts: history.witness.facts.filter(row => ownerIds.has(row.recoveryId)),
    closures: history.witness.closures.filter(row => ownerIds.has(row.recoveryId)),
    feedback: history.witness.feedback.filter(row => row.namespace.paymentId !== null && paymentIds.has(row.namespace.paymentId)
      || row.namespace.subscriptionChargeReceiptId !== null && receiptIds.has(row.namespace.subscriptionChargeReceiptId)),
  };
}

/** Financial subject export keeps receipt identity without private call capabilities or hosting evidence. */
export function exportOriginalCashHistory(witness: Awaited<ReturnType<typeof originalCashRecoveryFinancialWitness>>) {
  return {
    owners: witness.owners.map(row => ({ id: row.id, paymentId: row.paymentId, subscriptionChargeReceiptId: row.subscriptionChargeReceiptId,
      source: row.owner.source, cash: row.owner.cash, digest: row.digest, createdAt: row.createdAt })),
    operations: witness.operations.map(row => ({ id: row.id, recoveryId: row.recoveryId, kind: row.kind, digest: row.digest, createdAt: row.createdAt })),
    facts: witness.facts.map(row => ({ id: row.id, recoveryId: row.recoveryId, operationId: row.operationId, sequence: row.sequence, kind: row.kind, digest: row.digest, createdAt: row.createdAt })),
    closures: witness.closures.map(row => ({ id: row.id, recoveryId: row.recoveryId, operationId: row.operationId, revision: row.revision,
      unappliedReturnReceiptId: row.unappliedReturnReceiptId, digest: row.digest, createdAt: row.createdAt })),
    feedback: witness.feedback.map(row => ({ namespace: row.namespace, feedback: { id: row.feedback.id, evidenceDigest: row.feedback.evidenceDigest,
      captureKey: row.feedback.captureKey, createdAt: row.feedback.createdAt } })),
  };
}
