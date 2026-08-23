// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// A filter somebody actually uses, kept (MASTER.md §4.14, C7.06).
//
// Two decisions the columns encode.
//
// **A view belongs to a person, and sharing is a copy of nothing.** `shared`
// makes a view visible to colleagues; it does not make it theirs. Only the
// owner may change or delete it, because "my saved filter" that a colleague can
// quietly redefine is worse than no saved filter at all — the next time it
// opens, it silently answers a different question.
//
// **The default is per person, not per business.** One owner opens "everything
// I owe this week" and another opens "unpaid over 30 days", and a single
// business-wide default would take one of those away. The partial unique index
// enforces one default per person per list.
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "@/core/auth/schema";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";

export const savedViews = pgTable(
  "saved_views",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Which list. A key from the view registry, not a table name. */
    entity: text("entity").notNull(),
    name: text("name").notNull(),
    /**
     * The query parameters this view stands for.
     *
     * The URL is the state (C7.06), so this is a capture of it rather than a
     * second filtering language. A parameter the list stops understanding is
     * simply ignored when the view is opened — which is the right failure, and
     * the reason this is a plain record rather than a validated shape that
     * would refuse to load an old view after a filter is renamed.
     */
    filters: jsonb("filters").notNull().default({}).$type<Record<string, string>>(),
    /** Chosen columns, where the list has any. Empty means "the usual ones". */
    columns: text("columns")
      .array()
      .notNull()
      .default(sql`'{}'`),
    sortKey: text("sort_key"),
    sortDir: text("sort_dir", { enum: ["asc", "desc"] }),
    /** Whose it is. Null only if the account is later deleted. */
    ownerUserId: uuid("owner_user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    /** Visible to colleagues. Still only editable by its owner. */
    shared: boolean("shared").notNull().default(false),
    /** Opened by default, for this person, on this list. */
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("saved_views_entity_idx").on(t.entity, t.ownerUserId),
    index("saved_views_shared_idx").on(t.entity, t.shared),
    // One default per person per list. Without this a second "make default"
    // leaves two, and which one opens becomes whichever the planner returned
    // first — a bug that looks like the software forgetting.
    uniqueIndex("saved_views_default_idx")
      .on(t.entity, t.ownerUserId)
      .where(sql`is_default`),
    check("saved_views_name", sql`char_length(${t.name}) between 1 and 120`),
    check("saved_views_entity_key", sql`char_length(${t.entity}) between 1 and 60`),
  ],
);
