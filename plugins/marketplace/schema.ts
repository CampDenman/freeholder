// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { contacts } from "@/core/contacts/schema";
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
    syncCursor: text("sync_cursor"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [uniqueIndex("marketplace_channels_provider_idx").on(t.provider)],
);

export const marketplaceOrders = pgTable(
  "marketplace_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => marketplaceChannels.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    invoiceId: uuid("invoice_id").notNull(),
    externalRef: text("external_ref").notNull(),
    description: text("description").notNull(),
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("marketplace_orders_channel_external_idx").on(t.channelId, t.externalRef),
    index("marketplace_orders_channel_idx").on(t.channelId),
    index("marketplace_orders_contact_idx").on(t.contactId),
  ],
);
