// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Newsletters, issues, and subscription state (MASTER.md C9.04, C2.21).

import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";
import { contacts } from "@/core/contacts/schema";

export const NEWSLETTER_STATUSES = ["active", "paused"] as const;
export const ISSUE_STATUSES = ["draft", "published"] as const;
export const SUBSCRIPTION_STATUSES = ["pending", "confirmed", "unsubscribed"] as const;

export interface NewsletterSeo {
  title?: string;
  description?: string;
}

export const newsletters = pgTable(
  "newsletters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    status: text("status", { enum: NEWSLETTER_STATUSES }).notNull().default("active"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("newsletters_slug_idx").on(t.slug),
    check(
      "newsletters_slug_valid",
      sql`char_length(${t.slug}) between 1 and 180 and ${t.slug} ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'`,
    ),
    check("newsletters_name_valid", sql`char_length(${t.name}) between 1 and 200`),
    check("newsletters_status_valid", sql`${t.status} in ('active','paused')`),
  ],
);

export const newsletterIssues = pgTable(
  "newsletter_issues",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    newsletterId: uuid("newsletter_id")
      .notNull()
      .references(() => newsletters.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    excerpt: text("excerpt"),
    body: text("body").notNull().default(""),
    status: text("status", { enum: ISSUE_STATUSES }).notNull().default("draft"),
    seo: jsonb("seo").$type<NewsletterSeo>().notNull().default({}),
    version: integer("version").notNull().default(1),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("newsletter_issues_slug_idx").on(t.slug),
    index("newsletter_issues_newsletter_idx").on(t.newsletterId, t.publishedAt),
    check(
      "newsletter_issues_slug_valid",
      sql`char_length(${t.slug}) between 1 and 180 and ${t.slug} ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'`,
    ),
    check("newsletter_issues_title_valid", sql`char_length(${t.title}) between 1 and 240`),
    check("newsletter_issues_status_valid", sql`${t.status} in ('draft','published')`),
    check("newsletter_issues_version_positive", sql`${t.version} > 0`),
  ],
);

export const newsletterSubscriptions = pgTable(
  "newsletter_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    newsletterId: uuid("newsletter_id")
      .notNull()
      .references(() => newsletters.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "restrict" }),
    status: text("status", { enum: SUBSCRIPTION_STATUSES }).notNull().default("pending"),
    confirmToken: text("confirm_token").notNull(),
    unsubscribeToken: text("unsubscribe_token").notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    unsubscribedAt: timestamp("unsubscribed_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("newsletter_subscriptions_newsletter_contact_idx").on(t.newsletterId, t.contactId),
    uniqueIndex("newsletter_subscriptions_confirm_token_idx").on(t.confirmToken),
    uniqueIndex("newsletter_subscriptions_unsubscribe_token_idx").on(t.unsubscribeToken),
    index("newsletter_subscriptions_contact_idx").on(t.contactId),
    check(
      "newsletter_subscriptions_status_valid",
      sql`${t.status} in ('pending','confirmed','unsubscribed')`,
    ),
  ],
);
