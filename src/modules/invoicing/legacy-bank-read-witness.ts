// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.08/C12.38: exact original refund children, never another seller's reads.
import { asc, inArray } from "drizzle-orm";
import { ServiceError, type Tx } from "@/core/service";
import { legacyBankReads, legacyBankReadFacts, legacyBankReadFinishes } from "./legacy-bank-read-schema";

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
  if (facts.length > 5000 || finishes.length > 5000) throw new ServiceError("conflict", "The original legacy read callback inventory is incomplete; retain recovery debt.");
  return { reads, facts, finishes };
}
