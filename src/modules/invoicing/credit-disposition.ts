// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C9.33/C12.38: exact-note capacity, never a second benefit from an RMA refund promise.
import { eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { defineService, ServiceError, type Tx } from "@/core/service";
import { merchantTaxDigest } from "./merchant-tax-store";
import { invoiceCreditApplications, invoiceCreditFunding, invoiceCreditReleases, invoiceCreditReservations } from "./credit-application-schema";
const amount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const creditNoteDispositionResult = z.object({ reservedForReturns: z.boolean(), appliedMinor: amount, reservedMinor: amount, availableMinor: amount,
  reviewRequired: z.boolean(), revision: z.string().regex(/^[a-f0-9]{64}$/), receiptFingerprints: z.array(z.object({ kind: z.enum(["funding", "reservation", "application", "release"]), id: z.uuid(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/) })).max(5000) });
/** Read-only snapshot. Mutating callers hold sorted original payment locks,
 * sorted invoice locks, then sorted credit-note locks before revalidating it. */
export async function creditNoteDisposition(tx: Tx, creditNoteId: string): Promise<z.infer<typeof creditNoteDispositionResult>> {
  const [original] = await tx.execute<{ invoiceId: string; status: string; totalMinor: number; fingerprint: string; reservedForReturns: boolean }>(sql`
    select c.invoice_id::text as "invoiceId",c.status,c.total_minor::float8 as "totalMinor",encode(sha256(convert_to(to_jsonb(c)::text,'UTF8')),'hex') as fingerprint,
      exists(select 1 from return_requests r where r.credit_note_id=c.id) as "reservedForReturns" from credit_notes c where c.id=${creditNoteId}::uuid`);
  if (!original) throw new ServiceError("not_found", "The original credit note is unavailable.");
  if (original.reservedForReturns) return { reservedForReturns: true, appliedMinor: 0, reservedMinor: original.totalMinor, availableMinor: 0,
    reviewRequired: false, revision: merchantTaxDigest(original), receiptFingerprints: [] };
  const funding = await tx.select({ row: invoiceCreditFunding, fingerprint: sql<string>`encode(sha256(convert_to(to_jsonb(${invoiceCreditFunding})::text,'UTF8')),'hex')` })
    .from(invoiceCreditFunding).where(eq(invoiceCreditFunding.creditNoteId, creditNoteId)).orderBy(invoiceCreditFunding.id).limit(5001);
  const fundingIds = funding.map(value => value.row.id);
  const reservations = fundingIds.length ? await tx.select({ row: invoiceCreditReservations, fingerprint: sql<string>`encode(sha256(convert_to(to_jsonb(${invoiceCreditReservations})::text,'UTF8')),'hex')` })
    .from(invoiceCreditReservations).where(inArray(invoiceCreditReservations.fundingId, fundingIds)).orderBy(invoiceCreditReservations.id).limit(5001) : [];
  const ids = reservations.map(value => value.row.id);
  const applications = ids.length ? await tx.select({ row: invoiceCreditApplications, fingerprint: sql<string>`encode(sha256(convert_to(to_jsonb(${invoiceCreditApplications})::text,'UTF8')),'hex')` })
    .from(invoiceCreditApplications).where(inArray(invoiceCreditApplications.reservationId, ids)).orderBy(invoiceCreditApplications.reservationId).limit(5001) : [];
  const releases = ids.length ? await tx.select({ row: invoiceCreditReleases, fingerprint: sql<string>`encode(sha256(convert_to(to_jsonb(${invoiceCreditReleases})::text,'UTF8')),'hex')` })
    .from(invoiceCreditReleases).where(inArray(invoiceCreditReleases.reservationId, ids)).orderBy(invoiceCreditReleases.reservationId).limit(5001) : [];
  const receiptFingerprints: z.infer<typeof creditNoteDispositionResult>["receiptFingerprints"] = [
    ...funding.map(value => ({ kind: "funding" as const, id: value.row.id, fingerprint: value.fingerprint })),
    ...reservations.map(value => ({ kind: "reservation" as const, id: value.row.id, fingerprint: value.fingerprint })),
    ...applications.map(value => ({ kind: "application" as const, id: value.row.reservationId, fingerprint: value.fingerprint })),
    ...releases.map(value => ({ kind: "release" as const, id: value.row.reservationId, fingerprint: value.fingerprint })),
  ];
  const revision = merchantTaxDigest({ original, receiptFingerprints });
  if (receiptFingerprints.length > 5000) return { reservedForReturns: false, appliedMinor: 0, reservedMinor: 0, availableMinor: 0, reviewRequired: true, revision, receiptFingerprints: [] };
  const applied = new Set(applications.map(value => value.row.reservationId)), released = new Set(releases.map(value => value.row.reservationId));
  const funded = funding.reduce((sum, value) => sum + BigInt(value.row.amountMinor), 0n), appliedMinor = reservations.filter(value => applied.has(value.row.id)).reduce((sum, value) => sum + BigInt(value.row.amountMinor), 0n);
  const reservedMinor = reservations.filter(value => !applied.has(value.row.id) && !released.has(value.row.id)).reduce((sum, value) => sum + BigInt(value.row.amountMinor), 0n);
  const invalid = funded !== BigInt(original.totalMinor) || original.status !== "issued" || appliedMinor + reservedMinor > funded || [...applied].some(id => released.has(id));
  return creditNoteDispositionResult.parse({ reservedForReturns: false, appliedMinor: Number(appliedMinor), reservedMinor: Number(reservedMinor), availableMinor: invalid ? 0 : Number(funded - appliedMinor - reservedMinor),
    reviewRequired: invalid, revision, receiptFingerprints });
}
export const queryCreditNoteDisposition = defineService({ name: "invoicing.creditNoteDisposition", summary: "Read exact original issued-credit noncash disposition without consuming RMA refund promises.",
  kind: "query", permission: "system", external: false, input: z.object({ creditNoteId: z.uuid() }), output: creditNoteDispositionResult,
  handler: (input, ctx) => creditNoteDisposition(ctx.tx, input.creditNoteId) });
export default [queryCreditNoteDisposition];
