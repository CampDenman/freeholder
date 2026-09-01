// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Saved views (MASTER.md §4.7, §43 C9.08).
//
// One table, and deliberately no results in it. A saved view is a *question* —
// "revenue by service, last quarter" — not an answer, so nothing here is a
// cached figure. Storing the numbers would mean a report that quietly
// disagrees with the invoices it came from the moment a payment lands, and a
// business cannot use two different revenue figures.
import { index, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "@/core/auth/schema";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";

/** Which report a view is of. */
export const REPORT_KEYS = ["revenue", "revenueBy", "cohort", "funnel"] as const;

export const reportViews = pgTable(
  "report_views",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** What the owner called it. Theirs, so it is what the list is sorted by. */
    name: text("name").notNull(),
    key: text("key", { enum: REPORT_KEYS }).notNull(),
    /**
     * The question's parameters — period, dimension, currency.
     *
     * `jsonb` because each report asks for different things and a column per
     * parameter would be a migration every time a report gains an option. The
     * service validates them against the report's own input schema before
     * saving, so what is stored is what that report accepts rather than
     * whatever was posted.
     */
    params: jsonb("params").notNull().default({}),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    // One deploy is one business (§2), so a view is the business's rather than
    // a private bookmark: two people saving "Last quarter" mean the same
    // report, and the second one should edit the first rather than create a
    // near-duplicate nobody can tell apart in a list.
    uniqueIndex("report_views_name_idx").on(t.name),
    index("report_views_key_idx").on(t.key),
  ],
);
