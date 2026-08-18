// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Tables the proof plugin owns (C2.23).
import { boolean, index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";

export const proofNotices = pgTable(
  "proof_notices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    published: boolean("published").notNull().default(false),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    uniqueIndex("proof_notices_slug_idx").on(table.slug),
    index("proof_notices_published_idx").on(table.published),
  ],
);
