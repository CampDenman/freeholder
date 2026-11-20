// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.08/C12.38: exact original owner children and immutable database fingerprints.
import { inArray, sql } from "drizzle-orm";
import { ServiceError, type Tx } from "@/core/service";
import { agreementFeeCashAssignments, agreementFeeCreditAssignments, agreementFeeDuties, agreementFeeEligibility, agreementFeeRemittances } from "./agreement-fee-schema";
export async function agreementFeeWitnesses(tx: Tx, invoiceIds: readonly string[]) {
  const empty = { duties: [], creditAssignments: [], cashAssignments: [], eligibility: [], remittances: [], incomplete: false };
  if (!invoiceIds.length) return empty;
  if (invoiceIds.length > 5000) return { ...empty, incomplete: true };
  const hash = (row: unknown) => sql<string>`encode(sha256(convert_to(to_jsonb(${row})::text,'UTF8')),'hex')`;
  const duties = await tx.select({ id: agreementFeeDuties.invoiceId, acceptanceId: agreementFeeDuties.acceptanceId, profileId: agreementFeeDuties.merchantProfileId, fingerprint: hash(agreementFeeDuties) })
    .from(agreementFeeDuties).where(inArray(agreementFeeDuties.invoiceId, [...invoiceIds])).orderBy(agreementFeeDuties.invoiceId).limit(5001);
  const ids = duties.map(row => row.id);
  const creditAssignments = ids.length ? await tx.select({ id: agreementFeeCreditAssignments.applicationId, invoiceId: agreementFeeCreditAssignments.invoiceId, fingerprint: hash(agreementFeeCreditAssignments) })
    .from(agreementFeeCreditAssignments).where(inArray(agreementFeeCreditAssignments.invoiceId, ids)).orderBy(agreementFeeCreditAssignments.applicationId).limit(5001) : [];
  const cashAssignments = ids.length ? await tx.select({ id: agreementFeeCashAssignments.paymentId, invoiceId: agreementFeeCashAssignments.invoiceId, fingerprint: hash(agreementFeeCashAssignments) })
    .from(agreementFeeCashAssignments).where(inArray(agreementFeeCashAssignments.invoiceId, ids)).orderBy(agreementFeeCashAssignments.paymentId).limit(5001) : [];
  const eligibility = ids.length ? await tx.select({ id: agreementFeeEligibility.invoiceId, fingerprint: hash(agreementFeeEligibility) }).from(agreementFeeEligibility)
    .where(inArray(agreementFeeEligibility.invoiceId, ids)).orderBy(agreementFeeEligibility.invoiceId).limit(5001) : [];
  const remittances = ids.length ? await tx.select({ id: agreementFeeRemittances.id, invoiceId: agreementFeeRemittances.invoiceId, originalRemittanceId: agreementFeeRemittances.originalRemittanceId, fingerprint: hash(agreementFeeRemittances) })
    .from(agreementFeeRemittances).where(inArray(agreementFeeRemittances.invoiceId, ids)).orderBy(agreementFeeRemittances.id).limit(5001) : [];
  return { duties, creditAssignments, cashAssignments, eligibility, remittances,
    incomplete: duties.length + creditAssignments.length + cashAssignments.length + eligibility.length + remittances.length > 5000 };
}

/** Buyer subject export preserves associated original receipt identities and
 * consideration. Private merchant commission rates/evidence and staff actors
 * stay out of this customer projection. Merchant export uses its own authority. */
export async function exportAgreementFeeHistory(tx: Tx, invoiceIds: readonly string[]) {
  const original = await agreementFeeWitnesses(tx, invoiceIds);
  if (original.incomplete) throw new ServiceError("conflict", "Restore the bounded complete original commission-assignment history before subject export.");
  const ids = original.duties.map(row => row.id);
  if (!ids.length) return { duties: [], creditAssignments: [], cashAssignments: [], eligibility: [], remittances: [] };
  return {
    duties: await tx.select({ invoiceId: agreementFeeDuties.invoiceId, acceptanceId: agreementFeeDuties.acceptanceId, createdAt: agreementFeeDuties.createdAt }).from(agreementFeeDuties).where(inArray(agreementFeeDuties.invoiceId, ids)),
    creditAssignments: await tx.select({ applicationId: agreementFeeCreditAssignments.applicationId, invoiceId: agreementFeeCreditAssignments.invoiceId, amountMinor: agreementFeeCreditAssignments.amountMinor, createdAt: agreementFeeCreditAssignments.createdAt })
      .from(agreementFeeCreditAssignments).where(inArray(agreementFeeCreditAssignments.invoiceId, ids)),
    cashAssignments: await tx.select({ paymentId: agreementFeeCashAssignments.paymentId, invoiceId: agreementFeeCashAssignments.invoiceId, amountMinor: agreementFeeCashAssignments.amountMinor,
      origin: agreementFeeCashAssignments.origin, createdAt: agreementFeeCashAssignments.createdAt }).from(agreementFeeCashAssignments).where(inArray(agreementFeeCashAssignments.invoiceId, ids)),
    eligibility: await tx.select({ invoiceId: agreementFeeEligibility.invoiceId, paidAt: agreementFeeEligibility.paidAt, createdAt: agreementFeeEligibility.createdAt }).from(agreementFeeEligibility).where(inArray(agreementFeeEligibility.invoiceId, ids)),
    remittances: await tx.select({ receiptId: agreementFeeRemittances.id, invoiceId: agreementFeeRemittances.invoiceId, direction: agreementFeeRemittances.direction,
      originalRemittanceId: agreementFeeRemittances.originalRemittanceId, recordedAt: agreementFeeRemittances.createdAt }).from(agreementFeeRemittances).where(inArray(agreementFeeRemittances.invoiceId, ids)),
  };
}
