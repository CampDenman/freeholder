// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The one definition of "who" (MASTER.md §4.14, C7.04).
//
// §4.14: "The same saved query drives a campaign's audience, a price list's
// eligibility, an automation's entry condition and a report's cohort. A
// platform with four incompatible ways to say 'customers in Ontario who bought
// twice' is four places to be wrong."
//
// Two decisions the columns encode.
//
// **Dynamic and static are different questions, not a setting.** A dynamic
// segment is "everybody who currently matches" and is evaluated when it is
// read; a static one is "the people this actually went to", frozen. A campaign
// needs the second the moment it sends, because "who received the March email"
// must not change in April when somebody's lifecycle stage moves — and a
// business that cannot answer that question has no way to explain an email
// somebody is complaining about.
//
// **The cached count is a convenience and says when it was taken.** A number
// with no timestamp beside it is a number people start trusting; one that says
// "as of Tuesday" is one they re-run.
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { contacts } from "@/core/contacts/schema";
import { users } from "@/core/auth/schema";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";

export const SEGMENT_KINDS = ["dynamic", "static"] as const;

export const segments = pgTable(
  "segments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    /** Stable, so a price list or a campaign can name a segment in a config. */
    slug: text("slug").notNull(),
    description: text("description"),
    kind: text("kind", { enum: SEGMENT_KINDS }).notNull().default("dynamic"),
    /**
     * The query itself: `{ match: "all" | "any", rules: [...] }`.
     *
     * Stored rather than compiled, so it stays inspectable — an owner can be
     * shown what a segment asks, and C7.04's explainability can re-run one rule
     * at a time to say why somebody is in it. A compiled string would make both
     * impossible.
     */
    definition: jsonb("definition")
      .notNull()
      .$type<{ match: "all" | "any"; rules: Array<Record<string, unknown>> }>(),
    /** Last count, with the moment it was taken sitting beside it. */
    memberCountCached: integer("member_count_cached"),
    lastEvaluatedAt: timestamp("last_evaluated_at", { withTimezone: true }),
    /** When a static segment was frozen, which is the only date it has. */
    capturedAt: timestamp("captured_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("segments_slug_idx").on(t.slug),
    index("segments_kind_idx").on(t.kind),
    check("segments_name", sql`char_length(${t.name}) between 1 and 120`),
    check("segments_slug_shape", sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    // A static segment is only static once it has been captured; before that it
    // is a definition with no answer, and letting a campaign send to it would
    // send to nobody without saying so.
    check(
      "segments_static_captured",
      sql`${t.kind} <> 'static' or ${t.capturedAt} is not null`,
    ),
  ],
);

/**
 * Who was in a static segment when it was frozen (§4.14, C7.04).
 *
 * Only static segments have rows here. A dynamic segment deliberately has no
 * membership table: storing one would be a second answer to the question its
 * definition already answers, and the two would disagree within a day.
 */
export const segmentMembers = pgTable(
  "segment_members",
  {
    segmentId: uuid("segment_id")
      .notNull()
      .references(() => segments.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.segmentId, t.contactId] }),
    index("segment_members_contact_idx").on(t.contactId),
  ],
);
