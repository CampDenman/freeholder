// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Owner-configured calculators (MASTER.md §4.18, C5.26).
//
// An affordability figure, a cost range, a rebate, a catch value: all of them
// arithmetic over numbers somebody supplied, and all of them things a visitor
// will reasonably treat as a promise. So the constants are not stored here.
// They live in `core/attestations` with their source and the moment they were
// true, and a calculator refers to them by key — which means a rate used in a
// sum cannot be a number nobody stood behind, and the same correction that
// fixes the published rate fixes every figure computed from it.
//
// `steps` and `inputs` are jsonb for the reason form fields are (§4.6): an
// owner changing a calculation is a database write, not a deploy. What they
// may contain is closed, and `formula.ts` is where that is enforced.
import { sql } from "drizzle-orm";
import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";

export const calculators = pgTable(
  "calculators",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Set = in trash (C11.14). */
    trashedAt: timestamp("trashed_at", { withTimezone: true }),
    /** Stable handle a block points at. */
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    intro: text("intro"),
    /** What the visitor is asked. See formula.ts for the schema. */
    inputs: jsonb("inputs").notNull().default([]),
    /** The calculation, as ordered named steps. Never an expression string. */
    steps: jsonb("steps").notNull().default([]),
    resultLabel: text("result_label").notNull(),
    /** "per month", "$", "hours" — shown beside the figure, never inside it. */
    resultUnit: text("result_unit"),
    /**
     * The caveats, in the owner's words, shown with every result.
     *
     * Required. A figure with no stated assumptions is the thing this feature
     * exists to stop being publishable: the arithmetic is never the claim, the
     * arithmetic *plus what it assumed* is.
     */
    assumptions: text("assumptions").notNull(),
    status: text("status", { enum: ["draft", "active", "closed"] })
      .notNull()
      .default("draft"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("calculators_slug_idx").on(t.slug),
    index("calculators_trash_idx")
      .on(t.trashedAt)
      .where(sql`${t.trashedAt} is not null`),
  ],
);
