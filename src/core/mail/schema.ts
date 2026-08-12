// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Mail routing and delivery evidence (MASTER.md §12, §43 C1.14).
//
// Bodies deliberately do not live here. A delivery ledger needs to answer
// which sender tried which address, through which provider, and what happened;
// it does not need to become a second mailbox full of customer correspondence.
import { sql } from "drizzle-orm";
import {
  boolean,
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
import { users } from "@/core/auth/schema";
import { connectedAccounts } from "@/core/connections/schema";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";

export const mailSenders = pgTable(
  "mail_senders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    purpose: text("purpose", { enum: ["transactional", "bulk"] }).notNull(),
    provider: text("provider", {
      enum: [
        "gmail",
        "outlook",
        "smtp",
        "console",
        "resend",
        "postmark",
        "ses",
      ],
    }).notNull(),
    /** Required for personal OAuth senders; null for env-backed providers. */
    connectedAccountId: uuid("connected_account_id").references(
      () => connectedAccounts.id,
      { onDelete: "cascade" },
    ),
    email: text("email").notNull(),
    displayName: text("display_name"),
    /** Provider domain/signature/identity id when one is available. */
    providerIdentity: text("provider_identity"),
    verificationStatus: text("verification_status", {
      enum: ["pending", "verified", "failed"],
    })
      .notNull()
      .default("pending"),
    status: text("status", {
      enum: ["active", "paused", "needs_attention"],
    })
      .notNull()
      .default("active"),
    isDefault: boolean("is_default").notNull().default(false),
    verificationDetail: jsonb("verification_detail").notNull().default({}),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("mail_senders_identity_idx").on(
      t.purpose,
      t.provider,
      t.email,
    ),
    uniqueIndex("mail_senders_default_idx")
      .on(t.purpose)
      .where(sql`${t.isDefault} = true`),
    index("mail_senders_connection_idx").on(t.connectedAccountId),
    index("mail_senders_status_idx").on(t.purpose, t.status),
    check("mail_senders_purpose_allowed", sql`${t.purpose} in ('transactional', 'bulk')`),
    check(
      "mail_senders_provider_allowed",
      sql`${t.provider} in ('gmail', 'outlook', 'smtp', 'console', 'resend', 'postmark', 'ses')`,
    ),
    check(
      "mail_senders_verification_allowed",
      sql`${t.verificationStatus} in ('pending', 'verified', 'failed')`,
    ),
    check(
      "mail_senders_status_allowed",
      sql`${t.status} in ('active', 'paused', 'needs_attention')`,
    ),
    check("mail_senders_email_lower", sql`${t.email} = lower(${t.email})`),
    check("mail_senders_email_bounded", sql`length(${t.email}) <= 320`),
    check(
      "mail_senders_provider_purpose",
      sql`(${t.purpose} = 'transactional' and ${t.provider} in ('gmail', 'outlook', 'smtp', 'console')) or (${t.purpose} = 'bulk' and ${t.provider} in ('resend', 'postmark', 'ses'))`,
    ),
    check(
      "mail_senders_connection_consistent",
      sql`(${t.provider} in ('gmail', 'outlook') and ${t.connectedAccountId} is not null) or (${t.provider} not in ('gmail', 'outlook') and ${t.connectedAccountId} is null)`,
    ),
    check(
      "mail_senders_default_ready",
      sql`${t.isDefault} = false or (${t.status} = 'active' and ${t.verificationStatus} = 'verified' and ${t.provider} <> 'console')`,
    ),
  ],
);

/** One-time, short-lived state for a server-side mail OAuth consent flow. */
export const mailOauthStates = pgTable(
  "mail_oauth_states",
  {
    /** SHA-256 of the token returned to the browser; the bearer value is not stored. */
    tokenHash: text("token_hash").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: ["google", "microsoft"] }).notNull(),
    returnTo: text("return_to").notNull().default("/admin/settings"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
  },
  (t) => [
    index("mail_oauth_states_expiry_idx").on(t.expiresAt),
    check("mail_oauth_states_hash_format", sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check("mail_oauth_states_provider_allowed", sql`${t.provider} in ('google', 'microsoft')`),
    check("mail_oauth_states_admin_return", sql`${t.returnTo} ~ '^/admin(/|$)'`),
    check("mail_oauth_states_expiry_order", sql`${t.expiresAt} > ${t.createdAt}`),
    check(
      "mail_oauth_states_consumed_order",
      sql`${t.consumedAt} is null or ${t.consumedAt} >= ${t.createdAt}`,
    ),
  ],
);

export const mailDeliveries = pgTable(
  "mail_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    senderId: uuid("sender_id").references(() => mailSenders.id, {
      onDelete: "set null",
    }),
    purpose: text("purpose", { enum: ["transactional", "bulk"] }).notNull(),
    provider: text("provider", {
      enum: [
        "gmail",
        "outlook",
        "smtp",
        "console",
        "resend",
        "postmark",
        "ses",
        "none",
      ],
    }).notNull(),
    recipient: text("recipient").notNull(),
    subject: text("subject").notNull(),
    status: text("status", {
      enum: [
        "queued",
        "submitted",
        "delivered",
        "bounced",
        "complained",
        "failed",
        "suppressed",
      ],
    })
      .notNull()
      .default("queued"),
    providerRef: text("provider_ref"),
    /** Stable caller key. Null for one-off sends that cannot be retried safely. */
    idempotencyKey: text("idempotency_key"),
    requestedBy: text("requested_by").notNull(),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    /**
     * Provider timestamp of the last webhook transition applied to `status`.
     * Delivery webhooks are not ordered, so receipt time cannot safely decide
     * whether a late event is newer than the state already recorded.
     */
    providerStatusAt: timestamp("provider_status_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("mail_deliveries_idempotency_idx")
      .on(t.idempotencyKey)
      .where(sql`${t.idempotencyKey} is not null`),
    index("mail_deliveries_provider_ref_idx").on(t.provider, t.providerRef),
    index("mail_deliveries_recipient_idx").on(t.recipient, t.createdAt),
    index("mail_deliveries_status_idx").on(t.status, t.createdAt),
    check("mail_deliveries_purpose_allowed", sql`${t.purpose} in ('transactional', 'bulk')`),
    check(
      "mail_deliveries_provider_allowed",
      sql`${t.provider} in ('gmail', 'outlook', 'smtp', 'console', 'resend', 'postmark', 'ses', 'none')`,
    ),
    check(
      "mail_deliveries_status_allowed",
      sql`${t.status} in ('queued', 'submitted', 'delivered', 'bounced', 'complained', 'failed', 'suppressed')`,
    ),
    check(
      "mail_deliveries_provider_purpose",
      sql`(${t.purpose} = 'transactional' and ${t.provider} in ('gmail', 'outlook', 'smtp', 'console')) or (${t.purpose} = 'bulk' and ${t.provider} in ('resend', 'postmark', 'ses', 'none'))`,
    ),
    check("mail_deliveries_recipient_lower", sql`${t.recipient} = lower(${t.recipient})`),
    check("mail_deliveries_recipient_bounded", sql`length(${t.recipient}) <= 320`),
    check("mail_deliveries_subject_bounded", sql`length(${t.subject}) <= 998`),
    check("mail_deliveries_attempts_nonnegative", sql`${t.attempts} >= 0`),
    check(
      "mail_deliveries_terminal_consistent",
      sql`${t.status} <> 'delivered' or ${t.deliveredAt} is not null`,
    ),
  ],
);

/** Idempotency receipt plus the normalized provider fact, never the raw body. */
export const mailProviderEvents = pgTable(
  "mail_provider_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider", {
      enum: ["resend", "postmark", "ses"],
    }).notNull(),
    externalEventId: text("external_event_id").notNull(),
    deliveryId: uuid("delivery_id").references(() => mailDeliveries.id, {
      onDelete: "set null",
    }),
    providerRef: text("provider_ref"),
    recipient: text("recipient").notNull(),
    eventType: text("event_type", {
      enum: [
        "submitted",
        "delivered",
        "delayed",
        "soft_bounce",
        "hard_bounce",
        "complaint",
        "suppressed",
        "failed",
      ],
    }).notNull(),
    detail: text("detail"),
    /** SHA-256 only: proves which payload was processed without retaining it. */
    rawDigest: text("raw_digest").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex("mail_provider_events_external_idx").on(
      t.provider,
      t.externalEventId,
    ),
    index("mail_provider_events_delivery_idx").on(t.deliveryId, t.occurredAt),
    index("mail_provider_events_recipient_idx").on(t.recipient, t.occurredAt),
    check(
      "mail_provider_events_provider_allowed",
      sql`${t.provider} in ('resend', 'postmark', 'ses')`,
    ),
    check(
      "mail_provider_events_type_allowed",
      sql`${t.eventType} in ('submitted', 'delivered', 'delayed', 'soft_bounce', 'hard_bounce', 'complaint', 'suppressed', 'failed')`,
    ),
    check("mail_provider_events_recipient_lower", sql`${t.recipient} = lower(${t.recipient})`),
    check("mail_provider_events_recipient_bounded", sql`length(${t.recipient}) <= 320`),
    check(
      "mail_provider_events_digest_format",
      sql`${t.rawDigest} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

export const mailSuppressions = pgTable(
  "mail_suppressions",
  {
    email: text("email").primaryKey(),
    reason: text("reason", {
      enum: ["hard_bounce", "complaint", "provider", "manual"],
    }).notNull(),
    provider: text("provider", {
      enum: ["resend", "postmark", "ses", "manual"],
    }).notNull(),
    sourceEventId: uuid("source_event_id").references(
      () => mailProviderEvents.id,
      { onDelete: "set null" },
    ),
    detail: text("detail"),
    active: boolean("active").notNull().default(true),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    releasedBy: uuid("released_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("mail_suppressions_active_idx")
      .on(t.createdAt)
      .where(sql`${t.active} = true`),
    check(
      "mail_suppressions_reason_allowed",
      sql`${t.reason} in ('hard_bounce', 'complaint', 'provider', 'manual')`,
    ),
    check(
      "mail_suppressions_provider_allowed",
      sql`${t.provider} in ('resend', 'postmark', 'ses', 'manual')`,
    ),
    check(
      "mail_suppressions_source_consistent",
      sql`(${t.reason} = 'manual' and ${t.provider} = 'manual') or (${t.reason} <> 'manual' and ${t.provider} <> 'manual')`,
    ),
    check("mail_suppressions_email_lower", sql`${t.email} = lower(${t.email})`),
    check("mail_suppressions_email_bounded", sql`length(${t.email}) <= 320`),
    check(
      "mail_suppressions_release_consistent",
      sql`(${t.active} = true and ${t.releasedAt} is null) or (${t.active} = false and ${t.releasedAt} is not null)`,
    ),
  ],
);
