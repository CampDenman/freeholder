// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.08/C12.38: actual parent FK closure; no bank or application authority.
import { inArray } from "drizzle-orm";
import { ServiceError, type Tx } from "@/core/service";
import { controlledCashInspectionLineageWitness } from "@/modules/subscriptions/controlled-cash-inspection-lineage";
import { merchantAgreementPaymentRoutes } from "./merchant-agreement-schema";
import { cashInspectionStopFinancialWitness } from "./merchant-cash-inspection-stops";

/** Callers derive resource IDs from their actual owned controlled graph.
 * A receipt-only child remains owned before it acquires a local payment.
 * Shared parent admissions count once; every distinct stop/lineage counts.
 */
export async function cashInspectionFinancialWitness(tx: Tx, input: { paymentIds: readonly string[]; receiptIds: readonly string[]; resourceIds?: readonly string[] }) {
  const lineage = await controlledCashInspectionLineageWitness(tx, input);
  const receiptIds = [...new Set([...input.receiptIds, ...lineage.lineages.map(row => row.receiptId)])];
  const aliases = receiptIds.length ? await tx.select({ paymentId: merchantAgreementPaymentRoutes.paymentId, receiptId: merchantAgreementPaymentRoutes.originalChargeReceiptId })
    .from(merchantAgreementPaymentRoutes).where(inArray(merchantAgreementPaymentRoutes.originalChargeReceiptId, receiptIds)).limit(5001) : [];
  if (aliases.length > 5000) throw new ServiceError("conflict", "Restore the complete exact original receipt-to-payment aliases before inspection review.");
  const paymentIds = [...new Set([...input.paymentIds, ...aliases.map(row => row.paymentId)])];
  if (paymentIds.length + receiptIds.length > 5000) throw new ServiceError("conflict", "Restore a bounded complete original inspection ownership cohort.");
  const original = await cashInspectionStopFinancialWitness(tx, { paymentIds, receiptIds });
  const parents = new Set(original.admissions.map(row => row.id));
  const receiptByPayment = new Map(aliases.flatMap(row => row.receiptId ? [[row.paymentId, row.receiptId] as const] : []));
  const receiptInspectionOwnership = original.admissions.flatMap(row => {
    const receiptId = row.subscriptionChargeReceiptId ?? (row.paymentId ? receiptByPayment.get(row.paymentId) : undefined);
    return receiptId ? [{ inspectionId: row.id, receiptId }] : [];
  });
  if (lineage.admissions.some(row => !parents.has(row.id)) || lineage.entries.some(row => !parents.has(row.inspectionId))
    || lineage.lineages.some(row => !receiptInspectionOwnership.some(owner => owner.inspectionId === row.inspectionId && owner.receiptId === row.receiptId))
    || original.admissions.length + original.entries.length + lineage.entries.length > 5000)
    throw new ServiceError("conflict", "Restore the complete bounded original inspection, stop and admission-lineage ownership before financial review or export.");
  return { ...original, lineages: lineage.lineages, lineageEntries: lineage.entries, receiptInspectionOwnership };
}

export { exportCashInspectionStops } from "./merchant-cash-inspection-stops";
export { exportControlledCashInspectionLineages } from "@/modules/subscriptions/controlled-cash-inspection-lineage-proof";
