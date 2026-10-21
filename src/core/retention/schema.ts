// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Per-kind retention clocks for user-owned stores (C11.14). Not a deleted_at
// column on every table, and not a TTL on legal or audit rows.
import { sql } from "drizzle-orm";
import {
  check,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";

export const retentionPolicies = pgTable(
  "retention_policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Registry kind, e.g. `notes` or `community_posts`. */
    kind: text("kind").notNull(),
    ttlDays: integer("ttl_days").notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("retention_policies_kind_idx").on(t.kind),
    check(
      "retention_policies_kind_length",
      sql`char_length(${t.kind}) between 1 and 80`,
    ),
    check("retention_policies_ttl_days_positive", sql`${t.ttlDays} > 0`),
  ],
);
