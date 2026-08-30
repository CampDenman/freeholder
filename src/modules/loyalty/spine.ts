// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Which events earn points, and what they are about
// (MASTER.md §4.1, §4.13, C9.11).
//
// §4.13 says earning is "a listener on spine events" and that
// `EarnRule.event_match` selects "from what the platform already emits
// (§4.1)". The bus event alone cannot serve that: `catalog.orderPaid` is
// `{ orderId }` and carries neither the contact nor the money. Resolving it
// against the spine row the emitting transaction wrote is the way out, and
// that mechanism now lives in `core/spine/facts.ts` — it moved there in C9.10
// when referrals became the second module to need it.
//
// What stays here is the part that is loyalty's own business: which of the
// platform's events are worth points. A shared rule that guessed would pay for
// events nobody meant to reward.
import type { Tx } from "@/core/service";
import { type SpineFact, type SpineSource, spineFactFor } from "@/core/spine/facts";

export type { SpineFact, SpineSource };

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
  /**
   * A referral converted (C9.10).
   *
   * §4.13 lists this as an earning moment by name, and it is how "dual-sided
   * rewards can pay in points" works without either module importing the
   * other: referrals writes the spine row against the *referrer*, and an
   * `EarnRule` matching this event decides what it is worth. The amount lives
   * in the rule, so a programme that pays only in points sets its cash
   * commission to "none" and nothing is configured twice.
   */
  "referral.converted": {
    eventType: "referral.converted",
    // The *referrer*, and `subjectType: null` so the spine row is found by
    // contact. The conversion's own subject is an invoice belonging to the
    // person who bought something, which is the wrong contact to pay.
    idKey: "referrerContactId",
    subjectType: null,
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

/**
 * Find the spine row that accompanies one of *these* topics.
 *
 * A one-line wrapper so every call site in this module keeps reading the way
 * it did before the mechanism moved to core, and so the source table cannot be
 * forgotten at a call site.
 */
export function spineFact(tx: Tx, topic: string, payload: unknown): Promise<SpineFact | null> {
  return spineFactFor(tx, SPINE_SOURCES, topic, payload);
}
