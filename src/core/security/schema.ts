// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Rate-limit counters (MASTER.md §36: security hardening is a v1.0 gate, not a
// feature — "shipped, not sold").
//
// In the database rather than in process memory, per §2 principle 12, and for a
// practical reason too: an in-memory limiter resets on every deploy and counts
// separately in each replica, so the protection quietly weakens exactly on the
// targets that scale out. One counter row per subject, shared by every process.
import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const rateLimitCounters = pgTable("rate_limit_counters", {
  /** "<service>:<subject>" — see rateLimitKey() in rate-limit.ts. */
  key: text("key").primaryKey(),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  attempts: integer("attempts").notNull().default(1),
});

/**
 * Deduplicated CSP evidence, deliberately free of request identity.
 *
 * Browsers put full URLs, referrers, samples and user-agent strings in raw
 * reports. The collector discards those before this table is reachable and
 * stores only redacted paths/origins needed to fix a policy regression.
 */
export const cspViolations = pgTable(
  "csp_violations",
  {
    fingerprint: text("fingerprint").primaryKey(),
    documentPath: text("document_path").notNull(),
    effectiveDirective: text("effective_directive").notNull(),
    blockedSource: text("blocked_source").notNull(),
    sourcePath: text("source_path"),
    disposition: text("disposition", { enum: ["enforce", "report"] })
      .notNull()
      .default("enforce"),
    statusCode: integer("status_code"),
    lineNumber: integer("line_number"),
    columnNumber: integer("column_number"),
    occurrences: integer("occurrences").notNull().default(1),
    firstAt: timestamp("first_at", { withTimezone: true }).notNull().defaultNow(),
    lastAt: timestamp("last_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '30 days'`),
  },
  (t) => [
    index("csp_violations_last_at_idx").on(t.lastAt),
    index("csp_violations_expires_at_idx").on(t.expiresAt),
    index("csp_violations_directive_idx").on(t.effectiveDirective, t.lastAt),
    check("csp_violations_occurrences_positive", sql`${t.occurrences} > 0`),
    check(
      "csp_violations_disposition_valid",
      sql`${t.disposition} in ('enforce', 'report')`,
    ),
  ],
);
