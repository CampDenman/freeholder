// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";

/** One site's saved public desk card. Its portable identifier is independent of the CRM. */
export const findMeStillDesks = pgTable("findmestill_desks", {
  identity: text("identity").primaryKey(),
  compactJws: text("compact_jws").notNull(),
  publishedDocument: text("published_document"),
});

/** A local grant covers one desk's metadata. Private conversations have their own authority. */
export const findMeStillDeskGrants = pgTable("findmestill_desk_grants", {
  identity: text("identity").notNull().references(() => findMeStillDesks.identity, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
}, (table) => [primaryKey({ columns: [table.identity, table.userId] })]);

/** Private, explicitly adopted association with the ordinary CRM contact. */
export const findMeStillCustomerLinks = pgTable("findmestill_customer_links", {
  identity: text("identity").primaryKey().references(() => findMeStillDesks.identity, { onDelete: "cascade" }),
  contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
});
