// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The seam between a bus topic and the spine row it accompanies
// (MASTER.md §4.1, §4.13, C9.11).
//
// This file exists because of a gap that is easy to miss and expensive to get
// wrong. §4.13 says earning is "a listener on spine events" and that
// `EarnRule.event_match` selects "from what the platform already emits
// (§4.1)" — and §4.1's TimelineEvent is the thing that carries the contact and
// the money. The *bus* event does not: `catalog.orderPaid` is
// `{ orderId }` and nothing else.
//
// So a handler cannot earn from the bus payload alone, and the two ways out of
// that are not equally good:
//
//   - Import the emitting module's service to look the order up. That makes
//     loyalty require catalog, and then a business with no shop has a loyalty
//     module that will not boot. It also inverts §4.13's rule: commerce would
//     not know loyalty exists, but loyalty would know all about commerce.
//   - Read the spine row the same transaction wrote. `emitTimeline` runs
//     inside the mutation and `queueEvent` publishes only after it commits, so
//     by the time a listener runs the row is there. Loyalty depends on core
//     and on nothing else.
//
// The second is what this does. The cost is this table: one honest mapping,
// in one file, rather than the knowledge scattered across six handlers.
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
   * Whether arriving here means points are owed or owed back. §4.13: "A refund
   * reverses the earn. Reversal writes a negative row citing the original; it
   * never deletes history."
   */
  direction: "earn" | "reverse";
};

/**
 * Every topic this module listens to, and how to find what it is about.
 *
 * Adding an earning moment is a row here plus a line in the manifest. It is
 * deliberately not derived from anything: which of a platform's events are
 * worth points is a business decision, and a rule that guessed would pay for
 * events nobody meant to reward.
 */
export const SPINE_SOURCES: Readonly<Record<string, SpineSource>> = {
  "catalog.orderPaid": {
    eventType: "order.paid",
    idKey: "orderId",
    subjectType: "order",
    direction: "earn",
  },
  "quote.accepted": {
    eventType: "quote.accepted",
    idKey: "quoteId",
    subjectType: "quote",
    direction: "earn",
  },
  "project.completed": {
    eventType: "project.completed",
    idKey: "projectId",
    subjectType: "project",
    direction: "earn",
  },
  "contact.created": {
    eventType: "contact.created",
    idKey: "contactId",
    subjectType: "contact",
    direction: "earn",
  },
  "catalog.orderCancelled": {
    eventType: "order.cancelled",
    idKey: "orderId",
    subjectType: "order",
    direction: "reverse",
  },
  "invoice.refunded": {
    eventType: "invoice.refunded",
    idKey: "invoiceId",
    subjectType: "invoice",
    direction: "reverse",
  },
};

export type SpineFact = {
  contactId: string;
  eventType: string;
  subjectType: string;
  subjectId: string;
  /** Minor units, when the event was about money. Zero when it was not. */
  amountMinor: number;
  currency: string | null;
};

function subjectIdFrom(payload: unknown, idKey: string): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const value = (payload as Record<string, unknown>)[idKey];
  return typeof value === "string" ? value : null;
}

/** Money lives under different names on different events; take the first. */
function amountFrom(payload: unknown): { amountMinor: number; currency: string | null } {
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
 * queues an event without writing history — and a loyalty programme that threw
 * would turn somebody else's ordinary mutation into a dead-lettered event.
 */
export async function spineFactFor(
  tx: Tx,
  topic: string,
  payload: unknown,
): Promise<SpineFact | null> {
  const source = SPINE_SOURCES[topic];
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
    // the points owed are for the payment that just happened.
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
  };
}
