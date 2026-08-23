// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Lead scoring, transparent by construction (MASTER.md §4.14, C7.05).
//
// §4.14: "Lead scoring is transparent by construction: rules over spine events
// with visible points and stated decay, never a model. An owner must be able to
// read why someone is a 40."
//
// That last sentence is the whole schema. There is **no score column**. A score
// is the sum of the awards below, computed when somebody asks, so the number
// and the reasons for it cannot drift apart — which is exactly what a cached
// scalar guarantees within a week. The cost is a sum over a small indexed table
// per contact, and the thing bought is that "why is she a 40" is answered by
// listing rows rather than by trusting a number.
//
// Decay is per award and linear to zero over the rule's stated days. A cliff
// would be simpler to explain but produces a score that jumps overnight for no
// reason anybody witnessed; linear decay means "that page view is worth 4 of
// its original 10, with twelve days left", which is a sentence an owner can act
// on. Each award's remaining value is rounded on its own, so the displayed rows
// always add up to the displayed total.
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { contacts } from "@/core/contacts/schema";
import { LIFECYCLE_LADDER } from "@/core/contacts/lifecycle";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";

/**
 * Two kinds of rule, one table.
 *
 * An `event` rule awards points when something happens. A `threshold` rule
 * carries no points and fires when the total crosses a line — §4.14's
 * "stage actions", and the shape every business means by "a lead at 50 is worth
 * calling". Splitting them across two tables would put the same `active`,
 * `name` and `advance_to` columns in both.
 */
export const SCORING_RULE_KINDS = ["event", "threshold"] as const;

export const scoringRules = pgTable(
  "scoring_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    kind: text("kind", { enum: SCORING_RULE_KINDS }).notNull().default("event"),
    /** The spine event this listens for. Null on a threshold rule. */
    eventName: text("event_name"),
    /**
     * Extra conditions on the event's payload, as plain equality.
     *
     * Deliberately not a query language. §4.14 says the rules must be readable,
     * and "when `quote.accepted` has `source` = `site`" is readable in a way
     * that an expression tree is not. Anything richer belongs in a segment,
     * which is the thing that already does querying properly (C7.04).
     */
    matchPayload: jsonb("match_payload").notNull().default({}),
    points: integer("points").notNull().default(0),
    /**
     * How long an award is worth anything, in days. Zero means it never fades.
     *
     * "Stated decay" in §4.14's words: the number lives on the rule where an
     * owner set it, and every award carries a copy so changing the rule later
     * cannot silently rewrite the value of points already given.
     */
    decayDays: integer("decay_days").notNull().default(0),
    /**
     * How many times one contact can earn this, or null for no limit.
     *
     * "Opened 3 emails +5" needs repeats; "filled in the contact form +20"
     * usually does not, and without a cap one determined visitor becomes the
     * hottest lead in the business.
     */
    maxAwards: integer("max_awards"),
    /** The stage to move somebody to when this fires. Never backwards. */
    advanceTo: text("advance_to", { enum: LIFECYCLE_LADDER }),
    /** The score at which a threshold rule fires. Null on an event rule. */
    thresholdScore: integer("threshold_score"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("scoring_rules_event_idx").on(t.eventName, t.active),
    index("scoring_rules_kind_idx").on(t.kind, t.active),
    check("scoring_rules_name", sql`char_length(${t.name}) between 1 and 120`),
    check("scoring_rules_points", sql`${t.points} between -1000 and 1000`),
    check("scoring_rules_decay", sql`${t.decayDays} between 0 and 3650`),
    check("scoring_rules_max_awards", sql`${t.maxAwards} is null or ${t.maxAwards} between 1 and 10000`),
    // An event rule needs something to listen for; a threshold rule needs a
    // line to cross and somewhere to move people to. A row that is neither is a
    // rule that can never fire, and storing one is how a scoring model becomes
    // a thing nobody can explain.
    check(
      "scoring_rules_shape",
      sql`(${t.kind} = 'event' and ${t.eventName} is not null and ${t.thresholdScore} is null)
          or (${t.kind} = 'threshold' and ${t.thresholdScore} is not null and ${t.advanceTo} is not null)`,
    ),
  ],
);

/**
 * One award: this person earned these points, for this, at this moment.
 *
 * The ledger §4.14's transparency rule requires. `points` and `decay_days` are
 * copied from the rule at award time rather than read through it, because an
 * owner who lowers a rule from 20 to 10 in March has changed what *future*
 * behaviour is worth — not what somebody did in January.
 */
export const contactScoreAwards = pgTable(
  "contact_score_awards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    ruleId: uuid("rule_id").references(() => scoringRules.id, { onDelete: "set null" }),
    /** What the rule was called when it fired, so a deleted rule still reads. */
    ruleName: text("rule_name").notNull(),
    eventName: text("event_name").notNull(),
    points: integer("points").notNull(),
    decayDays: integer("decay_days").notNull().default(0),
    /** The outbox event id, so one event awards once however often it arrives. */
    sourceEventId: text("source_event_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAtColumn(),
  },
  (t) => [
    index("contact_score_awards_contact_idx").on(t.contactId, t.occurredAt),
    index("contact_score_awards_rule_idx").on(t.ruleId),
    // One award per rule per delivery of one event. The bus retries, and a
    // retry that doubled somebody's score would make the number meaningless in
    // exactly the way §4.14 forbids.
    uniqueIndex("contact_score_awards_once_idx")
      .on(t.ruleId, t.contactId, t.sourceEventId)
      .where(sql`source_event_id is not null`),
  ],
);
