// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.08/C5.19/C12.38: exact old namespace owns review; amount never chooses an owner.
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { ServiceError, type Tx } from "@/core/service";
import { env } from "@/core/env";
import { payments, refunds } from "./schema";
import { legacyBankFeedback } from "./legacy-bank-feedback-schema";
import { originalLegacyBankAdmissionNamespace } from "./legacy-refund-dispatch";
import { verifyLegacyBankFeedback } from "./legacy-bank-feedback-proof";
export function legacyFeedbackVerificationKeys() { const e = env(); return [...new Set([e.CREDENTIAL_KEY, e.CREDENTIAL_KEY_PREVIOUS, e.SESSION_SECRET].filter((key): key is string => Boolean(key)))]; }
export async function legacyBankFeedbackReviewOwned(tx: Tx, refundId: string) {
  const [row] = await tx.execute<{ owned: boolean }>(sql`select freeholder_legacy_bank_feedback_review(${refundId}::uuid) owned`);
  return row?.owned === true;
}
export async function legacyBankFeedbackFinancialWitness(tx: Tx, refundIds: readonly string[]) {
  const ids = [...new Set(refundIds)].sort();
  if (ids.length > 5000) throw new ServiceError("conflict", "Restore a bounded original refund namespace inventory before financial feedback review.");
  const actual = ids.length ? await tx.select().from(refunds).where(inArray(refunds.id, ids)).orderBy(asc(refunds.id)).limit(5001) : [];
  if (actual.length !== ids.length) throw new ServiceError("conflict", "Restore the actual original refund owners before financial feedback reconciliation.");
  const output: Array<{ refundId: string; namespace: NonNullable<Awaited<ReturnType<typeof originalLegacyBankAdmissionNamespace>>>; feedback: typeof legacyBankFeedback.$inferSelect }> = [];
  for (const refund of actual) {
    const namespace = await originalLegacyBankAdmissionNamespace(tx, refund);
    if (!namespace) {
      if (await legacyBankFeedbackReviewOwned(tx, refund.id)) throw new ServiceError("conflict", "Restore the authentic original admission for this review-owned bank feedback; never adopt today's account or an equal amount.");
      continue;
    }
    const rows = await tx.select().from(legacyBankFeedback).where(and(
      sql`${legacyBankFeedback.evidence}->>'observedChargeAccountId' is not distinct from ${namespace.originalChargeAccountId}`,
      sql`(${legacyBankFeedback.evidence}->>'observedPaymentRef'=${namespace.originalPaymentRef}
        or (${namespace.originalRefundRef}::text is not null and ${legacyBankFeedback.evidence}->>'observedRefundRef'=${namespace.originalRefundRef}))`,
    )).orderBy(asc(legacyBankFeedback.id)).limit(5001);
    if (rows.length + output.length > 5000) throw new ServiceError("conflict", "The original feedback callback inventory exceeds its complete review bound.");
    for (const feedback of rows) {
      if (!verifyLegacyBankFeedback(feedback, legacyFeedbackVerificationKeys())) throw new ServiceError("conflict", "Retain the corrupt original feedback receipt and restore its actual authentication before current money or financial undo.");
      output.push({ refundId: refund.id, namespace, feedback });
    }
  }
  return output;
}
export async function legacyBankFeedbackPaymentOwner(tx: Tx, feedback: typeof legacyBankFeedback.$inferSelect) {
  const evidence = verifyLegacyBankFeedback(feedback, legacyFeedbackVerificationKeys());
  if (!evidence) throw new ServiceError("conflict", "Restore the original authentic raw feedback receipt before financial privacy repair.");
  const rows = await tx.select({ refund: refunds }).from(refunds).innerJoin(payments, eq(payments.id, refunds.paymentId)).where(and(eq(refunds.provider, "stripe"),
    evidence.observedPaymentRef ? or(eq(refunds.providerRef, evidence.observedRefundRef), eq(payments.providerRef, evidence.observedPaymentRef)) : eq(refunds.providerRef, evidence.observedRefundRef))).limit(5001);
  const candidates = rows.map(row => row.refund);
  if (candidates.length > 5000) throw new ServiceError("conflict", "Restore a bounded exact original feedback owner inventory before privacy repair.");
  const owners = new Set<string>();
  for (const refund of candidates) {
    const namespace = await originalLegacyBankAdmissionNamespace(tx, refund);
    if (namespace && namespace.originalChargeAccountId === evidence.observedChargeAccountId
      && (namespace.originalPaymentRef === evidence.observedPaymentRef || namespace.originalRefundRef !== null && namespace.originalRefundRef === evidence.observedRefundRef)) owners.add(namespace.paymentId);
  }
  if (owners.size !== 1) throw new ServiceError("conflict", "This authentic feedback remains unassigned or has ambiguous original ownership; never manufacture a payment or first scope.");
  return [...owners][0]!;
}
