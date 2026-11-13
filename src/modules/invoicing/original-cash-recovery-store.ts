// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: exact source-owned private evidence, bounded and authenticated.
import { asc, eq, inArray, or } from "drizzle-orm";
import { env } from "@/core/env";
import { ServiceError, type Tx } from "@/core/service";
import { originalCashRecoveries, originalCashRecoveryOperations, originalCashRecoveryFacts, originalCashRecoveryClosures } from "./original-cash-recovery-schema";
import { cashNamespaceKey, verifyOriginalCashRecovery } from "./original-cash-recovery-proof";
import type { MerchantRefundCashOrigin } from "./merchant-refund-origin";
import { merchantTaxDigest } from "./merchant-tax-store";
export function originalCashEvidenceKeys() { const e = env(); return [...new Set([e.CREDENTIAL_KEY, e.CREDENTIAL_KEY_PREVIOUS, e.SESSION_SECRET].filter((key): key is string => Boolean(key)))]; }
export function originalCashSigningKey() { const e = env(), key = e.CREDENTIAL_KEY ?? e.SESSION_SECRET; if (!key) throw new ServiceError("conflict", "Restore the original financial evidence key."); return key; }
export function recoveryOwnerBody(row: typeof originalCashRecoveries.$inferSelect) { return { namespaceKey: row.namespaceKey, paymentId: row.paymentId, subscriptionChargeReceiptId: row.subscriptionChargeReceiptId, owner: row.owner }; }
export function recoveryOperationBody(row: typeof originalCashRecoveryOperations.$inferSelect) { return { recoveryId: row.recoveryId, kind: row.kind, request: row.request, caller: row.caller, nonceHash: row.nonceHash }; }
export function recoveryFactBody(row: typeof originalCashRecoveryFacts.$inferSelect) { return { recoveryId: row.recoveryId, operationId: row.operationId, sequence: row.sequence, kind: row.kind, evidence: row.evidence }; }
export function recoveryClosureBody(row: typeof originalCashRecoveryClosures.$inferSelect) { return { recoveryId: row.recoveryId, operationId: row.operationId, revision: row.revision, unappliedReturnReceiptId: row.unappliedReturnReceiptId }; }
export async function originalCashRecoveryFinancialWitness(tx: Tx, paymentIds: readonly string[], receiptIds: readonly string[]) {
  const payment = [...new Set(paymentIds)].sort(), receipts = [...new Set(receiptIds)].sort();
  if (payment.length + receipts.length > 5000) throw new ServiceError("conflict", "Restore a bounded exact original cash-owner inventory.");
  const owners = payment.length || receipts.length ? await tx.select().from(originalCashRecoveries).where(or(
    ...(payment.length ? [inArray(originalCashRecoveries.paymentId, payment)] : []), ...(receipts.length ? [inArray(originalCashRecoveries.subscriptionChargeReceiptId, receipts)] : []))).orderBy(asc(originalCashRecoveries.id)).limit(5001) : [];
  const ids = owners.map(row => row.id);
  const operations = ids.length ? await tx.select().from(originalCashRecoveryOperations).where(inArray(originalCashRecoveryOperations.recoveryId, ids)).orderBy(asc(originalCashRecoveryOperations.id)).limit(5001) : [];
  const facts = ids.length ? await tx.select().from(originalCashRecoveryFacts).where(inArray(originalCashRecoveryFacts.recoveryId, ids)).orderBy(asc(originalCashRecoveryFacts.id)).limit(5001) : [];
  const closures = ids.length ? await tx.select().from(originalCashRecoveryClosures).where(inArray(originalCashRecoveryClosures.recoveryId, ids)).orderBy(asc(originalCashRecoveryClosures.id)).limit(5001) : [];
  if (owners.length + operations.length + facts.length + closures.length > 5000) throw new ServiceError("conflict", "Retain recovery debt; a truncated original cash-return inventory cannot authorize financial undo or export.");
  const keys = originalCashEvidenceKeys();
  if (owners.some(row => !verifyOriginalCashRecovery("owner", row, recoveryOwnerBody(row), keys) || row.namespaceKey !== cashNamespaceKey(row.owner.cash))
    || operations.some(row => !verifyOriginalCashRecovery("operation", row, recoveryOperationBody(row), keys))
    || facts.some(row => !verifyOriginalCashRecovery("fact", row, recoveryFactBody(row), keys))
    || closures.some(row => !verifyOriginalCashRecovery("closure", row, recoveryClosureBody(row), keys))) throw new ServiceError("conflict", "Restore the authentic original cash-return evidence; never rewrite or re-sign corrupt history.");
  return { owners, operations, facts, closures };
}
export async function originalCashRecoveryCashWitness(tx: Tx, cash: MerchantRefundCashOrigin, excludeOperationId?: string) {
  const [owner] = await tx.select().from(originalCashRecoveries).where(eq(originalCashRecoveries.namespaceKey, cashNamespaceKey(cash)));
  if (!owner) return { owners: [], operations: [], facts: [], closures: [] } as Awaited<ReturnType<typeof originalCashRecoveryFinancialWitness>>;
  const witness = await originalCashRecoveryFinancialWitness(tx, owner.paymentId ? [owner.paymentId] : [], owner.subscriptionChargeReceiptId ? [owner.subscriptionChargeReceiptId] : []);
  return { owners: witness.owners.filter(row => row.id === owner.id), operations: witness.operations.filter(row => row.recoveryId === owner.id && row.id !== excludeOperationId),
    facts: witness.facts.filter(row => row.recoveryId === owner.id && row.operationId !== excludeOperationId), closures: witness.closures.filter(row => row.recoveryId === owner.id) };
}
export function originalCashCallersFinished(witness: Pick<Awaited<ReturnType<typeof originalCashRecoveryFinancialWitness>>, "operations" | "facts">) {
  return witness.operations.every(operation => witness.facts.some(fact => fact.operationId === operation.id && (fact.kind === "finish"
    && fact.evidence.callerInstanceId === operation.caller.id || fact.kind === "stop" && fact.evidence.operationDigest === operation.digest)));
}
export async function originalCashHistoricalFeesQuiesced(tx: Tx, cash: MerchantRefundCashOrigin, fees: readonly { id: string }[]) {
  if (!fees.length) return true;
  const witness = await originalCashRecoveryCashWitness(tx, cash);
  return fees.every(fee => witness.facts.some(fact => fact.kind === "legacy_fee_stop" && fact.evidence.originalFeeOperationId === fee.id && fact.evidence.originalFeeDigest === merchantTaxDigest(fee)));
}
export async function originalCashRecoveryOwner(tx: Tx, id: string) {
  const [row] = await tx.select().from(originalCashRecoveries).where(eq(originalCashRecoveries.id, id));
  if (!row || !verifyOriginalCashRecovery("owner", row, recoveryOwnerBody(row), originalCashEvidenceKeys())) throw new ServiceError("conflict", "Restore this exact authentic original cash-return owner.");
  return row;
}
export async function originalCashRecoveryOperation(tx: Tx, id: string) {
  const [row] = await tx.select().from(originalCashRecoveryOperations).where(eq(originalCashRecoveryOperations.id, id));
  if (!row || !verifyOriginalCashRecovery("operation", row, recoveryOperationBody(row), originalCashEvidenceKeys())) throw new ServiceError("conflict", "Restore this exact original physical cash-return admission.");
  return row;
}
export async function originalCashOperationFacts(tx: Tx, operationId: string) {
  const rows = await tx.select().from(originalCashRecoveryFacts).where(eq(originalCashRecoveryFacts.operationId, operationId)).orderBy(asc(originalCashRecoveryFacts.sequence)).limit(5001);
  if (rows.length > 5000 || rows.some(row => !verifyOriginalCashRecovery("fact", row, recoveryFactBody(row), originalCashEvidenceKeys()))) throw new ServiceError("conflict", "Restore the complete authentic original physical caller facts.");
  return rows;
}
