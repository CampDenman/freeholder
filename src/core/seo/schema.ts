// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// Redirects (MASTER.md §5: "301 management via the `Redirect` entity with
// automatic redirect creation on slug change — slugs never silently break").
//
// The point is the parenthesis. An owner renaming a page is a normal editorial
// act; every link anyone ever shared to the old address breaking is not, and
// the platform is the only party in a position to notice the rename happened.
// So a redirect is written by the service that changed the slug, not by an
// owner remembering to.
import { index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";

export const redirects = pgTable(
  "redirects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The path that used to work. No leading slash, like a page's slug. */
    fromPath: text("from_path").notNull(),
    /** Where it goes now. Also a slug, so a chain can be followed. */
    toPath: text("to_path").notNull(),
    /**
     * 301 by default: a rename is permanent, and telling a crawler otherwise
     * throws away the standing the old address had earned.
     */
    status: text("status", { enum: ["301", "302"] })
      .notNull()
      .default("301"),
    locale: text("locale").notNull().default("en"),
    /** "slug-change" when the platform wrote it, "manual" when a human did. */
    source: text("source").notNull().default("manual"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    // One answer per path. A second redirect from the same address is an
    // ambiguity nobody can resolve at request time.
    uniqueIndex("redirects_from_locale_idx").on(t.fromPath, t.locale),
    index("redirects_to_idx").on(t.toPath),
  ],
);
