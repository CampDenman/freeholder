// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";

export const marketplaceChannels = pgTable(
  "marketplace_channels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    provider: text("provider").notNull(),
    status: text("status").notNull().default("disconnected"),
    config: jsonb("config").notNull().default({}),
    externalRef: text("external_ref"),
    lastError: text("last_error"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [uniqueIndex("marketplace_channels_provider_idx").on(t.provider)],
);
