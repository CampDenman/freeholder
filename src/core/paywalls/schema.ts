// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The rule attached to content (MASTER.md §4.15, C9.15).
//
// A page does not carry "members only". A Paywall selects it and an
// EntitlementGrant answers for a given person at a given moment. Metered
// state is per visitor, first-party, and the same for crawlers as for humans
// — serving Google something a reader cannot get is cloaking.
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
import { contacts } from "@/core/contacts/schema";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";

export const PAYWALL_MODES = ["hard", "soft", "metered", "registration"] as const;
export const PREVIEW_STRATEGIES = ["blocks", "paragraphs", "percent"] as const;
export const SEO_POLICIES = ["flexible_sampling", "fully_gated"] as const;
export const CONTENT_KINDS = [
  "page",
  "post",
  "gallery",
  "collection",
  "tag",
  "product",
] as const;
export type ContentKind = (typeof CONTENT_KINDS)[number];
export const PAYWALL_STATUSES = ["active", "archived"] as const;

export type PaywallAppliesTo = {
  kind: (typeof CONTENT_KINDS)[number];
  /** Path/slug/id, or `*` for every item of that kind. */
  selector: string;
};

export const paywalls = pgTable(
  "paywalls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    appliesTo: jsonb("applies_to").$type<PaywallAppliesTo>().notNull(),
    mode: text("mode", { enum: PAYWALL_MODES }).notNull().default("hard"),
    meterCount: integer("meter_count").notNull().default(0),
    meterWindowDays: integer("meter_window_days").notNull().default(30),
    previewStrategy: text("preview_strategy", { enum: PREVIEW_STRATEGIES })
      .notNull()
      .default("blocks"),
    previewValue: integer("preview_value").notNull().default(1),
    requiredEntitlementIds: jsonb("required_entitlement_ids")
      .$type<string[]>()
      .notNull()
      .default([]),
    /** CMS page id. Untyped so core never imports cms. */
    upsellPageId: uuid("upsell_page_id"),
    seoPolicy: text("seo_policy", { enum: SEO_POLICIES }).notNull().default("fully_gated"),
    status: text("status", { enum: PAYWALL_STATUSES }).notNull().default("active"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("paywalls_status_idx").on(t.status),
    check("paywalls_meter_count_nonnegative", sql`${t.meterCount} >= 0`),
    check("paywalls_meter_window_positive", sql`${t.meterWindowDays} >= 1`),
    check("paywalls_preview_value_nonnegative", sql`${t.previewValue} >= 0`),
  ],
);

export const meterCounters = pgTable(
  "paywall_meter_counters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    paywallId: uuid("paywall_id")
      .notNull()
      .references(() => paywalls.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "cascade" }),
    anonId: text("anon_id"),
    windowStartsAt: timestamp("window_starts_at", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("paywall_meters_paywall_idx").on(t.paywallId),
    uniqueIndex("paywall_meters_contact_idx")
      .on(t.paywallId, t.contactId)
      .where(sql`${t.contactId} is not null`),
    uniqueIndex("paywall_meters_anon_idx")
      .on(t.paywallId, t.anonId)
      .where(sql`${t.anonId} is not null`),
    check(
      "paywall_meters_subject",
      sql`(${t.contactId} is not null and ${t.anonId} is null)
        or (${t.contactId} is null and ${t.anonId} is not null)`,
    ),
    check("paywall_meters_count_nonnegative", sql`${t.count} >= 0`),
  ],
);
