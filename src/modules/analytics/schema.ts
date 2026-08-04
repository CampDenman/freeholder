// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// First-party analytics (MASTER.md §4.7, §36).
//
// One table. §4.7 says the funnel *is* this table joined to the money tables
// through `contact_id` — "visit → lead → quote → paid, one query" — so the
// shape that matters is: every event carries who, when, and where, and the
// "who" becomes a real Contact the moment the visitor identifies themselves.
//
// What is deliberately absent is as important as what is here. No IP address,
// no user-agent string, no fingerprint, no third-party identifier. §36 puts
// third-party pixels on the anti-roadmap, and a first-party replacement that
// quietly rebuilt the same surveillance would be worse than the thing it
// replaced.
import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { contacts } from "@/core/contacts/schema";

export const analyticsEvents = pgTable(
  "analytics_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * The visitor, as far as this site is concerned. A random value in a
     * first-party cookie — meaningless anywhere else, and readable by nobody
     * else.
     */
    anonId: text("anon_id").notNull(),
    /** One visit. Rolls over after 30 minutes of quiet. */
    sessionId: text("session_id").notNull(),
    /**
     * Filled in the moment a visitor identifies themselves — and backfilled
     * across everything that visitor did before, which is what makes the
     * funnel a funnel rather than two disconnected numbers.
     */
    contactId: uuid("contact_id").references(() => contacts.id, {
      onDelete: "set null",
    }),
    /** Dotted, past tense, like every other event name in the platform. */
    name: text("name").notNull(),
    path: text("path").notNull(),
    /** Where they came from. Host only — the full URL is somebody's history. */
    referrer: text("referrer"),
    locale: text("locale"),
    /**
     * What we think this was: human, bot, or suspected (see classify.ts).
     *
     * Recorded rather than dropped, so an owner can change their mind. The
     * first version filtered bots at write time, which meant the decision was
     * made once, invisibly, by the platform — and a wrong call could never be
     * seen or undone. Keeping the row and filtering at read time is the same
     * choice §36's spam quarantine makes, for the same reason.
     */
    visitorKind: text("visitor_kind", { enum: ["human", "bot", "suspected"] })
      .notNull()
      .default("human"),
    /** Why it was classified that way, for an owner weighing the verdict. */
    botReasons: text("bot_reasons").array().notNull().default([]),
    props: jsonb("props").notNull().default({}),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("analytics_at_idx").on(t.at),
    index("analytics_name_at_idx").on(t.name, t.at),
    index("analytics_anon_idx").on(t.anonId),
    index("analytics_contact_idx").on(t.contactId),
    // Every reporting query filters on this, so it leads the index that
    // serves them.
    index("analytics_kind_at_idx").on(t.visitorKind, t.name, t.at),
  ],
);
