// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.08/C12.38: exact original target and actual caller children, never account/amount matches.
import { eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/core/service";
import { payments } from "@/modules/invoicing/schema";
import { subscriptionProrationPaymentProtocols as protocolsTable, subscriptionProrationCardMandates as mandatesTable,
  subscriptionProrationCardAttempts as attemptsTable, subscriptionProrationCardJobs as jobsTable, subscriptionProrationCardReads as readsTable,
  subscriptionProrationCardReadFinishes as finishesTable, subscriptionProrationCardReadStops as stopsTable } from "./proration-card-schema";
const empty = () => ({ protocols: [], mandates: [], attempts: [], jobs: [], reads: [], finishes: [], stops: [], incomplete: false });
/** Every fingerprint hashes the whole physical PostgreSQL row, including private
 * immutable bodies. Only exact invoice/payment/FK ancestry selects a child. */
export async function subscriptionProrationCardWitnesses(tx: Tx, invoiceIds: readonly string[]) {
  if (!invoiceIds.length) return empty();
  if (invoiceIds.length > 5000) return { ...empty(), incomplete: true };
  const hash = (row: unknown) => sql<string>`encode(sha256(convert_to(to_jsonb(${row})::text,'UTF8')),'hex')`;
  const protocols = await tx.select({ id: protocolsTable.paymentId, invoiceId: protocolsTable.invoiceId, prorationId: protocolsTable.prorationId,
    fingerprint: hash(protocolsTable) }).from(protocolsTable).where(inArray(protocolsTable.invoiceId, [...invoiceIds])).orderBy(protocolsTable.paymentId).limit(5001);
  const mandates = await tx.select({ id: mandatesTable.prorationId, invoiceId: mandatesTable.invoiceId, paymentMethodId: mandatesTable.paymentMethodId,
    fingerprint: hash(mandatesTable) }).from(mandatesTable).where(inArray(mandatesTable.invoiceId, [...invoiceIds])).orderBy(mandatesTable.prorationId).limit(5001);
  const attempts = await tx.select({ id: attemptsTable.paymentId, invoiceId: attemptsTable.invoiceId, prorationId: attemptsTable.prorationId,
    fingerprint: hash(attemptsTable) }).from(attemptsTable).where(inArray(attemptsTable.invoiceId, [...invoiceIds])).orderBy(attemptsTable.paymentId).limit(5001);
  const jobs = await tx.select({ id: jobsTable.jobId, invoiceId: mandatesTable.invoiceId, prorationId: jobsTable.prorationId, fingerprint: hash(jobsTable) })
    .from(jobsTable).innerJoin(mandatesTable, eq(mandatesTable.prorationId, jobsTable.prorationId)).where(inArray(mandatesTable.invoiceId, [...invoiceIds])).orderBy(jobsTable.jobId).limit(5001);
  const reads = await tx.select({ id: readsTable.id, invoiceId: payments.invoiceId, paymentId: readsTable.paymentId, fingerprint: hash(readsTable) })
    .from(readsTable).innerJoin(payments, eq(payments.id, readsTable.paymentId)).where(inArray(payments.invoiceId, [...invoiceIds])).orderBy(readsTable.id).limit(5001);
  const finishes = await tx.select({ id: finishesTable.readId, invoiceId: payments.invoiceId, paymentId: readsTable.paymentId, fingerprint: hash(finishesTable) })
    .from(finishesTable).innerJoin(readsTable, eq(readsTable.id, finishesTable.readId)).innerJoin(payments, eq(payments.id, readsTable.paymentId))
    .where(inArray(payments.invoiceId, [...invoiceIds])).orderBy(finishesTable.readId).limit(5001);
  const stops = await tx.select({ id: stopsTable.readId, invoiceId: payments.invoiceId, paymentId: readsTable.paymentId, fingerprint: hash(stopsTable) })
    .from(stopsTable).innerJoin(readsTable, eq(readsTable.id, stopsTable.readId)).innerJoin(payments, eq(payments.id, readsTable.paymentId))
    .where(inArray(payments.invoiceId, [...invoiceIds])).orderBy(stopsTable.readId).limit(5001);
  return { protocols, mandates, attempts, jobs, reads, finishes, stops,
    incomplete: protocols.length + mandates.length + attempts.length + jobs.length + reads.length + finishes.length + stops.length > 5000 };
}
/** The buyer receives their exact target/attempt/read identities and outcomes.
 * No provider method/customer tokens, original queued bodies, caller births,
 * nonce digests, signatures, reviewer identities or hosting evidence escape. */
export function exportProrationCardHistory(witness: Awaited<ReturnType<typeof subscriptionProrationCardWitnesses>>) {
  return {
    protocols: witness.protocols.map(({ id, invoiceId, prorationId }) => ({ paymentId: id, invoiceId, prorationId })),
    mandates: witness.mandates.map(({ id, invoiceId, paymentMethodId }) => ({ prorationId: id, invoiceId, paymentMethodId })),
    attempts: witness.attempts.map(({ id, invoiceId, prorationId }) => ({ paymentId: id, invoiceId, prorationId })),
    jobs: witness.jobs.map(({ id, invoiceId, prorationId }) => ({ jobId: id, invoiceId, prorationId })),
    reads: witness.reads.map(({ id, invoiceId, paymentId }) => ({ readId: id, invoiceId, paymentId })),
    finishes: witness.finishes.map(({ id, invoiceId, paymentId }) => ({ readId: id, invoiceId, paymentId, actualCallerFinished: true })),
    stops: witness.stops.map(({ id, invoiceId, paymentId }) => ({ readId: id, invoiceId, paymentId, independentRuntimeStopReviewed: true })),
  };
}
