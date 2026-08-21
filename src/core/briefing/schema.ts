// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The daily briefing (MASTER.md §42, C4.15).
//
// One screen, on sign-in, answering: what is today, what changed, what needs
// me. It is assembled *before* the owner arrives, which is why these are
// tables rather than a function the page calls: a briefing produced on demand
// would be either a slow screen or an empty one, and the agent work behind a
// section has to have already run.
import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "@/core/auth/schema";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";

/** One person's briefing for one day. */
export const briefings = pgTable(
  "briefings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /**
     * The business's calendar date, not the server's. A briefing is "Tuesday's
     * briefing" to the person reading it, and in Auckland that is a different
     * instant from the one it is in Lisbon.
     */
    onDate: date("on_date").notNull(),
    status: text("status", { enum: ["assembling", "ready", "failed"] })
      .notNull()
      .default("assembling"),
    assembledAt: timestamp("assembled_at", { withTimezone: true }),
    /**
     * When the person opened it. Null is "not read yet", which is what the
     * sign-in screen and the reminder both key off.
     */
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    // One briefing per person per day. Re-assembly replaces its sections
    // rather than producing a second Tuesday.
    uniqueIndex("briefings_person_day_idx").on(t.userId, t.onDate),
    index("briefings_unread_idx").on(t.userId, t.readAt),
  ],
);

/**
 * One section, and where it came from.
 *
 * Stored rather than recomputed on read, because a section is a statement
 * about a moment: "three invoices were overdue this morning" stays true even
 * after one is paid, and a briefing that quietly rewrote itself as the day
 * went on would be a briefing nobody could act on.
 */
export const briefingContributions = pgTable(
  "briefing_contributions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    briefingId: uuid("briefing_id")
      .notNull()
      .references(() => briefings.id, { onDelete: "cascade" }),
    /** Which contributor produced this, and what a preference switches off. */
    key: text("key").notNull(),
    source: text("source", { enum: ["core", "module", "playbook"] })
      .notNull()
      .default("core"),
    title: text("title").notNull(),
    body: text("body"),
    /** The rows under the heading: label, optional link, optional detail. */
    items: jsonb("items").notNull().default(sql`'[]'::jsonb`),
    /**
     * What makes the ordering needs-me-first. `attention` is something the
     * person has to do, `today` is what is coming, `changed` is what happened
     * while they were away.
     */
    severity: text("severity", { enum: ["attention", "today", "changed"] })
      .notNull()
      .default("changed"),
    /** Set when a playbook produced this section, so the run is reachable. */
    playbookRunId: uuid("playbook_run_id"),
    /** Ties within a severity, so a briefing reads the same way every day. */
    position: integer("position").notNull().default(0),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex("briefing_contributions_key_idx").on(t.briefingId, t.key),
    index("briefing_contributions_briefing_idx").on(t.briefingId),
  ],
);

/**
 * A person turning a section off.
 *
 * Deliberately not a delete: switching off "overdue invoices" must not stop
 * invoices being chased, and switching it back on must not need the work
 * rebuilding. The preference hides a section; it never disables its source.
 */
export const briefingPreferences = pgTable(
  "briefing_preferences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [uniqueIndex("briefing_preferences_idx").on(t.userId, t.key)],
);
