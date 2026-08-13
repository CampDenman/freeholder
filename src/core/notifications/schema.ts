// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Durable notification facts (MASTER.md §43 C1.15).
//
// A notification is the human-facing fact. Channel deliveries are separate:
// reading an inbox item must never erase evidence that an email was attempted,
// and retrying a provider must never create another inbox item.
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recipientUserId: uuid("recipient_user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    recipientContactId: uuid("recipient_contact_id").references(() => contacts.id, {
      onDelete: "cascade",
    }),
    /** An address-only recipient, used by form notification lists. */
    externalRecipient: text("external_recipient"),
    topic: text("topic").notNull(),
    priority: text("priority", {
      enum: ["information", "warning", "critical"],
    })
      .notNull()
      .default("information"),
    /** Recipient locale snapshotted when the human-facing fact is created. */
    locale: text("locale").notNull().default("en"),
    title: text("title").notNull(),
    body: text("body").notNull(),
    href: text("href"),
    replyTo: text("reply_to"),
    sourceEventId: text("source_event_id"),
    sourceEventName: text("source_event_name"),
    /** Stable receipt for an event/recipient pair. */
    idempotencyKey: text("idempotency_key").notNull(),
    /** A live condition may coalesce even when it came from distinct events. */
    dedupeKey: text("dedupe_key"),
    occurrenceCount: integer("occurrence_count").notNull().default(1),
    firstOccurredAt: timestamp("first_occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastOccurredAt: timestamp("last_occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    readAt: timestamp("read_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    escalateAt: timestamp("escalate_at", { withTimezone: true }),
    escalatedAt: timestamp("escalated_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("notifications_idempotency_idx").on(t.idempotencyKey),
    index("notifications_user_inbox_idx").on(
      t.recipientUserId,
      t.archivedAt,
      t.readAt,
      t.lastOccurredAt,
    ),
    index("notifications_contact_inbox_idx").on(
      t.recipientContactId,
      t.archivedAt,
      t.readAt,
      t.lastOccurredAt,
    ),
    index("notifications_escalation_idx").on(t.escalateAt, t.escalatedAt),
    index("notifications_user_dedupe_idx").on(
      t.recipientUserId,
      t.dedupeKey,
      t.archivedAt,
    ),
    index("notifications_contact_dedupe_idx").on(
      t.recipientContactId,
      t.dedupeKey,
      t.archivedAt,
    ),
    index("notifications_external_dedupe_idx").on(
      t.externalRecipient,
      t.dedupeKey,
      t.archivedAt,
    ),
    check(
      "notifications_one_recipient",
      sql`num_nonnulls(${t.recipientUserId}, ${t.recipientContactId}, ${t.externalRecipient}) = 1`,
    ),
    check(
      "notifications_priority_allowed",
      sql`${t.priority} in ('information', 'warning', 'critical')`,
    ),
    check("notifications_topic_bounded", sql`length(${t.topic}) between 1 and 100`),
    check("notifications_title_bounded", sql`length(${t.title}) between 1 and 240`),
    check("notifications_body_bounded", sql`length(${t.body}) between 1 and 4000`),
    check(
      "notifications_href_internal",
      sql`${t.href} is null or (${t.href} ~ '^/' and length(${t.href}) <= 1000)`,
    ),
    check(
      "notifications_external_lower",
      sql`${t.externalRecipient} is null or ${t.externalRecipient} = lower(${t.externalRecipient})`,
    ),
    check(
      "notifications_occurrences_positive",
      sql`${t.occurrenceCount} >= 1`,
    ),
    check(
      "notifications_occurrence_order",
      sql`${t.lastOccurredAt} >= ${t.firstOccurredAt}`,
    ),
    check(
      "notifications_escalation_consistent",
      sql`${t.escalatedAt} is null or ${t.escalateAt} is not null`,
    ),
  ],
);

/** Every accepted caller/event key, including keys coalesced into an older item. */
export const notificationReceipts = pgTable(
  "notification_receipts",
  {
    idempotencyKey: text("idempotency_key").primaryKey(),
    notificationId: uuid("notification_id")
      .notNull()
      .references(() => notifications.id, { onDelete: "cascade" }),
    createdAt: createdAtColumn(),
  },
  (t) => [index("notification_receipts_notification_idx").on(t.notificationId)],
);

export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, {
      onDelete: "cascade",
    }),
    /** Exact topic or `*` fallback. */
    topic: text("topic").notNull(),
    channel: text("channel", {
      enum: ["in_app", "email", "sms", "push"],
    }).notNull(),
    mode: text("mode", { enum: ["immediate", "digest", "off"] })
      .notNull()
      .default("immediate"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("notification_preferences_user_idx")
      .on(t.userId, t.topic, t.channel)
      .where(sql`${t.userId} is not null`),
    uniqueIndex("notification_preferences_contact_idx")
      .on(t.contactId, t.topic, t.channel)
      .where(sql`${t.contactId} is not null`),
    check(
      "notification_preferences_one_recipient",
      sql`num_nonnulls(${t.userId}, ${t.contactId}) = 1`,
    ),
    check(
      "notification_preferences_channel_allowed",
      sql`${t.channel} in ('in_app', 'email', 'sms', 'push')`,
    ),
    check(
      "notification_preferences_mode_allowed",
      sql`${t.mode} in ('immediate', 'digest', 'off')`,
    ),
    check(
      "notification_preferences_in_app_immediate",
      sql`${t.channel} <> 'in_app' or ${t.mode} in ('immediate', 'off')`,
    ),
    check(
      "notification_preferences_digest_email_only",
      sql`${t.mode} <> 'digest' or ${t.channel} = 'email'`,
    ),
    check("notification_preferences_topic_bounded", sql`length(${t.topic}) between 1 and 100`),
  ],
);

export const notificationSettings = pgTable(
  "notification_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, {
      onDelete: "cascade",
    }),
    digestCadence: text("digest_cadence", { enum: ["daily", "weekly"] })
      .notNull()
      .default("daily"),
    /** Minute after local midnight. */
    digestMinute: integer("digest_minute").notNull().default(480),
    /** ISO weekday, Monday=1 through Sunday=7. */
    digestWeekday: integer("digest_weekday").notNull().default(1),
    timezone: text("timezone"),
    escalationMinutes: integer("escalation_minutes").notNull().default(60),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("notification_settings_user_idx")
      .on(t.userId)
      .where(sql`${t.userId} is not null`),
    uniqueIndex("notification_settings_contact_idx")
      .on(t.contactId)
      .where(sql`${t.contactId} is not null`),
    check(
      "notification_settings_one_recipient",
      sql`num_nonnulls(${t.userId}, ${t.contactId}) = 1`,
    ),
    check(
      "notification_settings_cadence_allowed",
      sql`${t.digestCadence} in ('daily', 'weekly')`,
    ),
    check(
      "notification_settings_minute_allowed",
      sql`${t.digestMinute} between 0 and 1439`,
    ),
    check(
      "notification_settings_weekday_allowed",
      sql`${t.digestWeekday} between 1 and 7`,
    ),
    check(
      "notification_settings_escalation_allowed",
      sql`${t.escalationMinutes} between 5 and 10080`,
    ),
  ],
);

export const notificationDigests = pgTable(
  "notification_digests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recipientUserId: uuid("recipient_user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    recipientContactId: uuid("recipient_contact_id").references(() => contacts.id, {
      onDelete: "cascade",
    }),
    recipient: text("recipient").notNull(),
    /** All wrapper copy in this digest is rendered in this locale. */
    locale: text("locale").notNull().default("en"),
    channel: text("channel", { enum: ["email"] }).notNull().default("email"),
    status: text("status", {
      enum: ["processing", "delivered", "skipped", "failed"],
    })
      .notNull()
      .default("processing"),
    idempotencyKey: text("idempotency_key").notNull(),
    itemCount: integer("item_count").notNull(),
    provider: text("provider"),
    providerRef: text("provider_ref"),
    lastError: text("last_error"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("notification_digests_idempotency_idx").on(t.idempotencyKey),
    index("notification_digests_recipient_idx").on(t.recipient, t.createdAt),
    check(
      "notification_digests_one_recipient",
      sql`num_nonnulls(${t.recipientUserId}, ${t.recipientContactId}) = 1`,
    ),
    check("notification_digests_recipient_lower", sql`${t.recipient} = lower(${t.recipient})`),
    check("notification_digests_items_positive", sql`${t.itemCount} >= 1`),
    check(
      "notification_digests_status_allowed",
      sql`${t.status} in ('processing', 'delivered', 'skipped', 'failed')`,
    ),
  ],
);

export const notificationDeliveries = pgTable(
  "notification_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    notificationId: uuid("notification_id")
      .notNull()
      .references(() => notifications.id, { onDelete: "cascade" }),
    digestId: uuid("digest_id").references(() => notificationDigests.id, {
      onDelete: "set null",
    }),
    channel: text("channel", {
      enum: ["in_app", "email", "sms", "push"],
    }).notNull(),
    kind: text("kind", { enum: ["immediate", "digest", "escalation"] })
      .notNull()
      .default("immediate"),
    status: text("status", {
      enum: ["pending", "deferred", "processing", "delivered", "skipped", "failed"],
    }).notNull(),
    availableAt: timestamp("available_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    attempts: integer("attempts").notNull().default(0),
    provider: text("provider"),
    providerRef: text("provider_ref"),
    lastError: text("last_error"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("notification_deliveries_once_idx").on(
      t.notificationId,
      t.channel,
      t.kind,
    ),
    index("notification_deliveries_due_idx").on(t.status, t.availableAt),
    index("notification_deliveries_digest_idx").on(t.digestId),
    check(
      "notification_deliveries_channel_allowed",
      sql`${t.channel} in ('in_app', 'email', 'sms', 'push')`,
    ),
    check(
      "notification_deliveries_kind_allowed",
      sql`${t.kind} in ('immediate', 'digest', 'escalation')`,
    ),
    check(
      "notification_deliveries_status_allowed",
      sql`${t.status} in ('pending', 'deferred', 'processing', 'delivered', 'skipped', 'failed')`,
    ),
    check("notification_deliveries_attempts_nonnegative", sql`${t.attempts} >= 0`),
    check(
      "notification_deliveries_terminal_consistent",
      sql`${t.status} <> 'delivered' or ${t.deliveredAt} is not null`,
    ),
    check(
      "notification_deliveries_digest_consistent",
      sql`(${t.kind} = 'digest' and ${t.status} in ('deferred', 'processing', 'delivered', 'skipped', 'failed')) or (${t.kind} <> 'digest' and ${t.digestId} is null)`,
    ),
  ],
);
