// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Which events are conversions, and what they were worth
// (MASTER.md §4.3, §4.13, C9.10).
//
// The mechanism for resolving a bus event to the spine row that carries the
// contact and the money lives in `core/spine/facts.ts`. What lives here is the
// part that is this module's own business: which events mean somebody's
// referral turned into something.
//
// **`invoice.paid` is the money conversion, and it is the only one.** §4.3
// makes the invoice "the single money object" and says paywalls, tips and
// commissions all obey the convergence rule — "no parallel money paths". An
// order, a booking, an accepted quote and a subscription cycle all settle
// through an invoice, so listening to the invoice catches every one of them
// exactly once. Listening to `catalog.orderPaid` *as well* would pay twice for
// one sale, because an order and the invoice that settles it are different
// subjects and the duplicate guard is per subject.
//
// `contact.created` is the exception, and §4.3 states why: "signups have no
// invoice". A signup conversion is worth whatever a fixed commission says it
// is, and nothing when the programme pays a percentage of zero.
import type { Tx } from "@/core/service";
import { type SpineFact, type SpineSource, spineFactFor } from "@/core/spine/facts";

export type { SpineFact };

/**
 * Every topic this module listens to, and what arriving there means.
 *
 * `direction` is "convert" or "reverse". There is no "cancel": an order
 * cancelled before payment never produced an invoice, so it never earned a
 * commission and there is nothing to undo. Only money that arrived can go
 * back, which is why the reversal list is one line long.
 */
export const SPINE_SOURCES: Readonly<Record<string, SpineSource>> = {
  "invoice.paid": {
    eventType: "invoice.paid",
    idKey: "invoiceId",
    subjectType: "invoice",
    direction: "convert",
  },
  "contact.created": {
    eventType: "contact.created",
    idKey: "contactId",
    subjectType: "contact",
    direction: "convert",
  },
  // §4.13: "a refund or chargeback inside it reverses automatically, and
  // reversing after payout produces a negative line on the next batch rather
  // than an argument."
  "invoice.refunded": {
    eventType: "invoice.refunded",
    idKey: "invoiceId",
    subjectType: "invoice",
    direction: "reverse",
  },
};

/** The conversion types §4.3 gives an `AffiliateProgram`. */
export type ConversionType = "signup" | "subscription" | "order" | "booking" | "custom";

/**
 * What kind of conversion an invoice represents.
 *
 * Read from `sourceType` on the spine payload, which invoicing writes for this
 * purpose. Everything the enum does not name maps to `custom` rather than to a
 * guess: a deposit, a tip or a late fee is a real payment that a programme may
 * or may not want to pay commission on, and `custom` is the honest label for
 * "the owner decides", where `order` would have been a claim about something
 * that was never an order.
 */
export function conversionTypeFrom(payload: unknown): ConversionType {
  if (typeof payload !== "object" || payload === null) return "custom";
  const sourceType = (payload as Record<string, unknown>).sourceType;
  if (sourceType === "order") return "order";
  if (sourceType === "booking") return "booking";
  if (sourceType === "subscription") return "subscription";
  return "custom";
}

/** Find the spine row behind one of *these* topics. */
export function spineFact(tx: Tx, topic: string, payload: unknown): Promise<SpineFact | null> {
  return spineFactFor(tx, SPINE_SOURCES, topic, payload);
}

/** Whether arriving at this topic means money owed, or money owed back. */
export function directionOf(topic: string): "convert" | "reverse" | null {
  const source = SPINE_SOURCES[topic];
  if (!source) return null;
  return source.direction === "reverse" ? "reverse" : "convert";
}
