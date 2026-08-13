// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// First-party analytics (MASTER.md §4.7, §36).
//
// The event ledger plus its campaign-attribution projection. §4.7 says the
// funnel *is* the ledger joined to the money tables through `contact_id`, so the
// shape that matters is: every event carries who, when, and where, and the
// "who" becomes a real Contact the moment the visitor identifies themselves.
//
// What is deliberately absent is as important as what is here. No IP address,
// no user-agent string, no fingerprint, no third-party identifier. §36 puts
// third-party pixels on the anti-roadmap, and a first-party replacement that
// quietly rebuilt the same surveillance would be worse than the thing it
// replaced.
import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgTable,
  uniqueIndex,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { contacts } from "@/core/contacts/schema";

export const analyticsEvents = pgTable(
  "analytics_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Client-generated idempotency key for metrics that may retry on unload. */
    eventKey: text("event_key"),
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
    /** Owner correction without destroying the classifier's original verdict. */
    classificationOverride: text("classification_override", {
      enum: ["human", "bot", "suspected"],
    }),
    classificationNote: text("classification_note"),
    props: jsonb("props").notNull().default({}),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("analytics_at_idx").on(t.at),
    index("analytics_name_at_idx").on(t.name, t.at),
    index("analytics_anon_idx").on(t.anonId),
    index("analytics_contact_idx").on(t.contactId),
    uniqueIndex("analytics_event_key_idx")
      .on(t.eventKey)
      .where(sql`${t.eventKey} is not null`),
    // Every reporting query filters on this, so it leads the index that
    // serves them.
    index("analytics_kind_at_idx").on(t.visitorKind, t.name, t.at),
    index("analytics_effective_kind_at_idx").on(
      sql`coalesce(${t.classificationOverride}, ${t.visitorKind})`,
      t.name,
      t.at,
    ),
    check(
      "analytics_classification_override_valid",
      sql`${t.classificationOverride} is null or ${t.classificationOverride} in ('human', 'bot', 'suspected')`,
    ),
  ],
);

/**
 * First and latest campaign touch per first-party visitor.
 *
 * Events retain the normalized touch in `props`; this row is the indexed
 * projection reporting needs, so first/last attribution is one lookup rather
 * than a window function over the entire event history.
 */
export const analyticsAttributions = pgTable(
  "analytics_attributions",
  {
    anonId: text("anon_id").primaryKey(),
    firstSource: text("first_source").notNull(),
    firstMedium: text("first_medium"),
    firstCampaign: text("first_campaign"),
    firstTerm: text("first_term"),
    firstContent: text("first_content"),
    firstPath: text("first_path").notNull(),
    firstReferrer: text("first_referrer"),
    firstAt: timestamp("first_at", { withTimezone: true }).notNull().defaultNow(),
    lastSource: text("last_source").notNull(),
    lastMedium: text("last_medium"),
    lastCampaign: text("last_campaign"),
    lastTerm: text("last_term"),
    lastContent: text("last_content"),
    lastPath: text("last_path").notNull(),
    lastReferrer: text("last_referrer"),
    lastAt: timestamp("last_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("analytics_attribution_last_at_idx").on(t.lastAt),
    index("analytics_attribution_first_campaign_idx").on(
      t.firstSource,
      t.firstMedium,
      t.firstCampaign,
    ),
    index("analytics_attribution_last_campaign_idx").on(
      t.lastSource,
      t.lastMedium,
      t.lastCampaign,
    ),
  ],
);
