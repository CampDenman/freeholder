// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: bounded immutable children for original buyer/merchant merge proofs.
import { eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/core/service";
import { subscriptionProviderReadFinishes, subscriptionProviderReadStops, subscriptionProviderReadTickets } from "./provider-read-ownership-schema";
export async function subscriptionProviderReadWitnesses(tx: Tx, subscriptionIds: string[]) {
  if (!subscriptionIds.length) return { tickets: [], finishes: [], stops: [], incomplete: false };
  const tickets = await tx.select({ id: subscriptionProviderReadTickets.readId, subscriptionId: subscriptionProviderReadTickets.subscriptionId,
    fingerprint: sql<string>`encode(sha256(convert_to(to_jsonb(${subscriptionProviderReadTickets})::text,'UTF8')),'hex')` })
    .from(subscriptionProviderReadTickets).where(inArray(subscriptionProviderReadTickets.subscriptionId, subscriptionIds)).orderBy(subscriptionProviderReadTickets.readId).limit(5001);
  const finishes = await tx.select({ id: subscriptionProviderReadFinishes.readId, subscriptionId: subscriptionProviderReadTickets.subscriptionId,
    fingerprint: sql<string>`encode(sha256(convert_to(to_jsonb(${subscriptionProviderReadFinishes})::text,'UTF8')),'hex')` })
    .from(subscriptionProviderReadFinishes).innerJoin(subscriptionProviderReadTickets, eq(subscriptionProviderReadTickets.readId, subscriptionProviderReadFinishes.readId))
    .where(inArray(subscriptionProviderReadTickets.subscriptionId, subscriptionIds)).orderBy(subscriptionProviderReadFinishes.readId).limit(5001);
  const stops = await tx.select({ id: subscriptionProviderReadStops.readId, subscriptionId: subscriptionProviderReadStops.subscriptionId,
    fingerprint: sql<string>`encode(sha256(convert_to(to_jsonb(${subscriptionProviderReadStops})::text,'UTF8')),'hex')` })
    .from(subscriptionProviderReadStops).where(inArray(subscriptionProviderReadStops.subscriptionId, subscriptionIds)).orderBy(subscriptionProviderReadStops.readId).limit(5001);
  return { tickets, finishes, stops, incomplete: tickets.length + finishes.length + stops.length > 5000 };
}
