// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Reading the spine row that accompanies a bus event (MASTER.md §4.1, §11).
//
// This mechanism arrived with loyalty (C9.11) and lives in core from C9.10,
// when referrals became the second module to need it. The reason it moved
// rather than being copied is the reason its original file gave for existing
// at all: "one honest mapping, in one file, rather than the knowledge
// scattered across six handlers." Two copies in two modules is that same
// scattering with a longer stride.
//
// The gap it closes is easy to miss and expensive to get wrong. A module that
// wants to react to "an order was paid" needs the contact and the money, and
// the *bus* event carries neither: `catalog.orderPaid` is `{ orderId }` and
// nothing else. There are two ways out and they are not equally good:
//
//   - Import the emitting module's service to look the order up. That makes
//     the listener require catalog, so a business with no shop has a module
//     that will not boot, and it inverts §4.13's rule — commerce would not
//     know loyalty exists, but loyalty would know all about commerce.
//   - Read the spine row the same transaction wrote. `emitTimeline` runs
//     inside the mutation and `queueEvent` publishes only after it commits, so
//     by the time a listener runs the row is there, and the listener depends
//     on core and nothing else.
//
// This is the second. What stays with each module is *which* events are worth
// reacting to — a business decision that a shared rule guessing at it would
// get wrong — so every caller passes its own source table.
import { and, desc, eq } from "drizzle-orm";
import type { Tx } from "@/core/service";
import { timelineEvents } from "@/core/contacts/schema";

export type SpineSource = {
  /** The `timeline_events.event_type` the emitting mutation wrote. */
  eventType: string;
  /** Which key of the bus payload carries the subject's id. */
  idKey: string;
  /** The `timeline_events.subject_type` to match, or null for the contact. */
  subjectType: string | null;
  /**
   * What arriving here means to the module listening.
   *
   * Kept as an open string rather than an enum: loyalty reads it as
   * earn/reverse and referrals as convert/reverse, and a shared enum would
   * have to grow a member every time a module found a third meaning.
   */
  direction: string;
};

export type SpineFact = {
  contactId: string;
  eventType: string;
  subjectType: string;
  subjectId: string;
  /** Minor units, when the event was about money. Zero when it was not. */
  amountMinor: number;
  currency: string | null;
  /** The whole spine payload, for a caller that needs more than the money. */
  payload: unknown;
};

/** Ids on this platform are uuids; anything else is not ours to match. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function subjectIdFrom(payload: unknown, idKey: string): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const value = (payload as Record<string, unknown>)[idKey];
  if (typeof value !== "string") return null;
  // Checked rather than assumed. `contact_id` is a uuid column, so a bus
  // event carrying anything else made the query *throw* — which turned
  // somebody else's ordinary mutation into a dead-lettered event. Declining
  // is the behaviour the rest of this file already promises.
  return UUID.test(value) ? value : null;
}

/** Money lives under different names on different events; take the first. */
export function amountFrom(payload: unknown): { amountMinor: number; currency: string | null } {
  if (typeof payload !== "object" || payload === null) {
    return { amountMinor: 0, currency: null };
  }
  const bag = payload as Record<string, unknown>;
  for (const key of ["totalMinor", "amountMinor", "subtotalMinor"]) {
    const value = bag[key];
    if (typeof value === "number") {
      return {
        amountMinor: value,
        currency: typeof bag.currency === "string" ? bag.currency : null,
      };
    }
  }
  return { amountMinor: 0, currency: typeof bag.currency === "string" ? bag.currency : null };
}

/**
 * Find the spine row that accompanies a bus event.
 *
 * Returns null rather than throwing when there is no such row. That is not
 * defensive padding: an event can legitimately arrive with no timeline row
 * behind it — an order paid by somebody who is not a contact, a module that
 * queues an event without writing history — and a listener that threw would
 * turn somebody else's ordinary mutation into a dead-lettered event.
 */
export async function spineFactFor(
  tx: Tx,
  sources: Readonly<Record<string, SpineSource>>,
  topic: string,
  payload: unknown,
): Promise<SpineFact | null> {
  const source = sources[topic];
  if (!source) return null;
  const subjectId = subjectIdFrom(payload, source.idKey);
  if (!subjectId) return null;

  const [row] = await tx
    .select()
    .from(timelineEvents)
    .where(
      and(
        eq(timelineEvents.eventType, source.eventType),
        source.subjectType === "contact"
          ? eq(timelineEvents.contactId, subjectId)
          : eq(timelineEvents.subjectId, subjectId),
      ),
    )
    // The newest, because an order can be paid, refunded and paid again, and
    // what is owed is for the payment that just happened.
    .orderBy(desc(timelineEvents.occurredAt))
    .limit(1);

  if (!row?.contactId) return null;
  const money = amountFrom(row.payload);
  return {
    contactId: row.contactId,
    eventType: source.eventType,
    subjectType: source.subjectType ?? "contact",
    subjectId,
    amountMinor: money.amountMinor,
    currency: money.currency,
    payload: row.payload,
  };
}
