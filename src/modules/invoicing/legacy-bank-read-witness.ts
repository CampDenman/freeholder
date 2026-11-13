// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.08/C12.38: exact original refund children, never another seller's reads.
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { moneyStateEvents } from "./schema";
import { LEGACY_REPLACEMENT_PROTOCOL, LEGACY_REPLACEMENT_REASON, LEGACY_REPLACEMENT_STATE } from "./legacy-bank-replacement-proof";
import { ServiceError, type Tx } from "@/core/service";
import { legacyBankReads, legacyBankReadFacts, legacyBankReadFinishes, legacyBankCurrentReceipts, legacyBankReadStops } from "./legacy-bank-read-schema";

/** Composition helper for original payment/refund financial fingerprints.
 * The caller supplies its already-scoped original refund IDs, not contacts,
 * today's account or an inferred same-amount resource. */
export async function legacyBankReadFinancialWitness(tx: Tx, refundIds: readonly string[]) {
  const ids = [...new Set(refundIds)].sort();
  if (ids.length > 5000) throw new ServiceError("conflict", "Restore a bounded original refund owner inventory before financial privacy reconciliation.");
  const reads = ids.length ? await tx.select().from(legacyBankReads).where(inArray(legacyBankReads.refundId, ids)).orderBy(asc(legacyBankReads.id)).limit(5001) : [];
  if (reads.length > 5000) throw new ServiceError("conflict", "The original legacy read inventory is incomplete; retain recovery debt.");
  const readIds = reads.map(read => read.id);
  const facts = readIds.length ? await tx.select().from(legacyBankReadFacts).where(inArray(legacyBankReadFacts.readId, readIds)).orderBy(asc(legacyBankReadFacts.id)).limit(5001) : [];
  const finishes = readIds.length ? await tx.select().from(legacyBankReadFinishes).where(inArray(legacyBankReadFinishes.readId, readIds)).orderBy(asc(legacyBankReadFinishes.readId)).limit(5001) : [];
  const current = readIds.length ? await tx.select().from(legacyBankCurrentReceipts).where(inArray(legacyBankCurrentReceipts.readId, readIds)).orderBy(asc(legacyBankCurrentReceipts.id)).limit(5001) : [];
  const stops = readIds.length ? await tx.select().from(legacyBankReadStops).where(inArray(legacyBankReadStops.readId, readIds)).orderBy(asc(legacyBankReadStops.readId)).limit(5001) : [];
  const replacements = ids.length ? await tx.select().from(moneyStateEvents).where(and(eq(moneyStateEvents.subjectType, "refund"), inArray(moneyStateEvents.subjectId, ids),
    or(eq(moneyStateEvents.reason, LEGACY_REPLACEMENT_REASON), eq(moneyStateEvents.toState, LEGACY_REPLACEMENT_STATE), sql`${moneyStateEvents.metadata}->>'protocol'=${LEGACY_REPLACEMENT_PROTOCOL}`))).orderBy(asc(moneyStateEvents.id)).limit(5001) : [];
  if (reads.length + facts.length + finishes.length + current.length + stops.length + replacements.length > 5000) throw new ServiceError("conflict", "The original legacy read callback inventory is incomplete; retain recovery debt.");
  return { reads, facts, finishes, current, stops, replacements };
}
