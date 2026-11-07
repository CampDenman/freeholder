// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Public reader comments are separate from private editorial annotations (C2.29).
import { sql } from "drizzle-orm";
import { check, index, pgTable, text, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";
import { contacts } from "@/core/contacts/schema";
import { pages } from "./schema";
export const blogReaderComments = pgTable("blog_reader_comments", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Changing a page's kind hides its thread, without deleting rollback history.
  pageId: uuid("page_id").notNull().references(() => pages.id, { onDelete: "cascade" }),
  parentId: uuid("parent_id").references((): AnyPgColumn => blogReaderComments.id, { onDelete: "set null" }),
  contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
  authorName: text("author_name").notNull(),
  body: text("body").notNull(),
  status: text("status", { enum: ["pending", "approved", "spam", "trash"] }).notNull().default("pending"),
  source: text("source").notNull().default("reader"),
  externalId: text("external_id"),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
}, t => [
  check("blog_reader_comments_status_allowed", sql`${t.status} in ('pending','approved','spam','trash')`),
  index("blog_reader_comments_page_status_idx").on(t.pageId, t.status, t.createdAt),
  index("blog_reader_comments_contact_idx").on(t.contactId),
  uniqueIndex("blog_reader_comments_source_external_idx").on(t.source, t.externalId).where(sql`${t.externalId} is not null`),
]);
