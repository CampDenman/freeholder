// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// Rate-limit counters (MASTER.md §36: security hardening is a v1.0 gate, not a
// feature — "shipped, not sold").
//
// In the database rather than in process memory, per §2 principle 12, and for a
// practical reason too: an in-memory limiter resets on every deploy and counts
// separately in each replica, so the protection quietly weakens exactly on the
// targets that scale out. One counter row per subject, shared by every process.
import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const rateLimitCounters = pgTable("rate_limit_counters", {
  /** "<service>:<subject>" — see rateLimitKey() in rate-limit.ts. */
  key: text("key").primaryKey(),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  attempts: integer("attempts").notNull().default(1),
});
