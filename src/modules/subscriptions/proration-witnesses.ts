// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.08/C9.33/C12.38: original accepted promises and exact child inventories.
import { inArray, sql } from "drizzle-orm";
import type { Tx } from "@/core/service";
import { subscriptionProrationCreditUses, subscriptionProrationPrincipal, subscriptionProrations } from "./proration-schema";

/** Add these full-row fingerprints to the owning agreement witness. Personal
 * destinations, private actor/hosting evidence and retained queue bodies stay
 * in PostgreSQL; a projection must never stand in for an immutable row hash. */
export async function subscriptionProrationWitnesses(tx: Tx, subscriptionIds: readonly string[]) {
  const empty = { prorations: [], principal: [], creditUses: [], incomplete: false };
  if (!subscriptionIds.length) return empty;
  if (subscriptionIds.length > 5000) return { ...empty, incomplete: true };
  const hash = (row: unknown) => sql<string>`encode(sha256(convert_to(to_jsonb(${row})::text,'UTF8')),'hex')`;
  const prorations = await tx.select({ id: subscriptionProrations.id, subscriptionId: subscriptionProrations.subscriptionId,
    fingerprint: hash(subscriptionProrations) }).from(subscriptionProrations).where(inArray(subscriptionProrations.subscriptionId, [...subscriptionIds]))
    .orderBy(subscriptionProrations.id).limit(5001);
  const ids = prorations.map(row => row.id);
  const principal = ids.length ? await tx.select({ id: subscriptionProrationPrincipal.id, prorationId: subscriptionProrationPrincipal.prorationId,
    sourcePaymentId: subscriptionProrationPrincipal.sourcePaymentId, sourceApplicationId: subscriptionProrationPrincipal.sourceApplicationId,
    fingerprint: hash(subscriptionProrationPrincipal) }).from(subscriptionProrationPrincipal).where(inArray(subscriptionProrationPrincipal.prorationId, ids))
    .orderBy(subscriptionProrationPrincipal.id).limit(5001) : [];
  const creditUses = ids.length ? await tx.select({ id: subscriptionProrationCreditUses.id, prorationId: subscriptionProrationCreditUses.prorationId,
    creditNoteId: subscriptionProrationCreditUses.creditNoteId, fingerprint: hash(subscriptionProrationCreditUses) })
    .from(subscriptionProrationCreditUses).where(inArray(subscriptionProrationCreditUses.prorationId, ids)).orderBy(subscriptionProrationCreditUses.id).limit(5001) : [];
  return { prorations, principal, creditUses, incomplete: prorations.length + principal.length + creditUses.length > 5000 };
}
