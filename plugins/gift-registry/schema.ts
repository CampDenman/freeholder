// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Gift registry tables (C3.13). Money still converges on invoicing.
import { index, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { contacts } from "@/core/contacts/schema";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";

export const giftRegistries = pgTable(
  "gift_registries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("gift_registries_slug_idx").on(t.slug),
    index("gift_registries_contact_idx").on(t.contactId),
  ],
);

export const giftRegistryItems = pgTable(
  "gift_registry_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    registryId: uuid("registry_id")
      .notNull()
      .references(() => giftRegistries.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    url: text("url"),
    amountCents: integer("amount_cents").notNull().default(0),
    currency: text("currency").notNull().default("USD"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [index("gift_registry_items_registry_idx").on(t.registryId)],
);
