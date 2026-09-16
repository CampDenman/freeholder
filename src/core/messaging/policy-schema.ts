// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Recipient-local quiet hours and frequency policy (MASTER.md §4.14, C7.13).
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  time,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { contacts } from "@/core/contacts/schema";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";
import { segments } from "@/core/segments/schema";

export const MESSAGING_WINDOW_SCOPES = ["global", "segment", "contact"] as const;
export const MESSAGING_WINDOW_TIMEZONE_SOURCES = ["contact", "business"] as const;
export const MESSAGING_WINDOW_PURPOSES = ["marketing", "transactional", "all"] as const;

export const messagingWindows = pgTable(
  "messaging_windows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Stable for shipped defaults; owner-created rules receive their own code. */
    code: text("code").notNull(),
    name: text("name").notNull(),
    scope: text("scope", { enum: MESSAGING_WINDOW_SCOPES }).notNull(),
    contactId: uuid("contact_id").references(() => contacts.id, {
      onDelete: "cascade",
    }),
    segmentId: uuid("segment_id").references(() => segments.id, {
      onDelete: "cascade",
    }),
    /** Either half may be NULL only when this is a cap-only rule. */
    quietFrom: time("quiet_from", { withTimezone: false }),
    quietTo: time("quiet_to", { withTimezone: false }),
    timezoneSource: text("timezone_source", {
      enum: MESSAGING_WINDOW_TIMEZONE_SOURCES,
    })
      .notNull()
      .default("contact"),
    maxPerDay: integer("max_per_day"),
    maxPerWeek: integer("max_per_week"),
    appliesTo: text("applies_to", { enum: MESSAGING_WINDOW_PURPOSES })
      .notNull()
      .default("all"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("messaging_windows_code_idx").on(t.code),
    index("messaging_windows_scope_idx").on(t.scope, t.active),
    index("messaging_windows_contact_idx").on(t.contactId, t.active),
    index("messaging_windows_segment_idx").on(t.segmentId, t.active),
    check(
      "messaging_windows_scope_target",
      sql`(${t.scope} = 'global' and ${t.contactId} is null and ${t.segmentId} is null)
        or (${t.scope} = 'contact' and ${t.contactId} is not null and ${t.segmentId} is null)
        or (${t.scope} = 'segment' and ${t.segmentId} is not null and ${t.contactId} is null)`,
    ),
    check(
      "messaging_windows_quiet_pair",
      sql`(${t.quietFrom} is null and ${t.quietTo} is null)
        or (${t.quietFrom} is not null and ${t.quietTo} is not null and ${t.quietFrom} <> ${t.quietTo})`,
    ),
    check(
      "messaging_windows_has_policy",
      sql`${t.quietFrom} is not null or ${t.maxPerDay} is not null or ${t.maxPerWeek} is not null`,
    ),
    check(
      "messaging_windows_daily_cap",
      sql`${t.maxPerDay} is null or ${t.maxPerDay} > 0`,
    ),
    check(
      "messaging_windows_weekly_cap",
      sql`${t.maxPerWeek} is null or ${t.maxPerWeek} > 0`,
    ),
  ],
);
