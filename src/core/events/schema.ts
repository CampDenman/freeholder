// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The audit trail (MASTER.md §4.8, §11). Every admin/agent mutation through
// the service layer lands here — it is written by the service registry
// wrapper, inside the same transaction as the mutation, so an unaudited
// mutation is impossible rather than unlikely. The owner can read a
// plain-English log of everything their AI did.
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** "user:<id>", "agent:<key-name>", or "system". */
    actor: text("actor").notNull(),
    /** The service method name: "contacts.create", "auth.login"… */
    action: text("action").notNull(),
    subjectType: text("subject_type"),
    /**
     * Polymorphic, so text rather than uuid: a subject may be a contact id, a
     * module name, or the singleton business profile. Typing it uuid asserted
     * something untrue and made auditing a settings change impossible.
     */
    subjectId: text("subject_id"),
    /** Input snapshot / changed fields. Secrets are redacted before write. */
    diff: jsonb("diff").notNull().default({}),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_log_subject_idx").on(t.subjectType, t.subjectId),
    index("audit_log_at_idx").on(t.at),
  ],
);

/**
 * The transactional outbox (§11). Logic lives in events/outbox.ts; the table
 * lives here because drizzle-kit reads schema files, and a table it cannot see
 * is a migration nobody generates.
 */
export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventName: text("event_name").notNull(),
    payload: jsonb("payload").notNull().default({}),
    status: text("status", {
      enum: ["pending", "dispatched", "dead_letter"],
    }).notNull().default("pending"),
    /** Null until a dispatch has run every listener without throwing. */
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    deadLetteredAt: timestamp("dead_lettered_at", { withTimezone: true }),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    attempts: integer("attempts").notNull().default(0),
    replayCount: integer("replay_count").notNull().default(0),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // The sweeper's query: due pending work, oldest first.
    index("outbox_pending_idx").on(t.status, t.nextAttemptAt, t.createdAt),
    index("outbox_dead_letter_idx").on(t.status, t.deadLetteredAt),
    check("outbox_events_status_check", sql`${t.status} in ('pending', 'dispatched', 'dead_letter')`),
    check("outbox_events_attempts_nonnegative", sql`${t.attempts} >= 0`),
    check("outbox_events_replay_count_nonnegative", sql`${t.replayCount} >= 0`),
    check(
      "outbox_events_dispatched_timestamp_check",
      sql`${t.status} <> 'dispatched' or ${t.dispatchedAt} is not null`,
    ),
    check(
      "outbox_events_dead_letter_timestamp_check",
      sql`${t.status} <> 'dead_letter' or ${t.deadLetteredAt} is not null`,
    ),
  ],
);

/** One durable receipt per event/listener pair: completed listeners never replay. */
export const outboxEventDeliveries = pgTable(
  "outbox_event_deliveries",
  {
    eventId: uuid("event_id")
      .notNull()
      .references(() => outboxEvents.id, { onDelete: "cascade" }),
    listenerId: text("listener_id").notNull(),
    status: text("status", {
      enum: ["pending", "processing", "delivered", "dead_letter"],
    }).notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    deadLetteredAt: timestamp("dead_lettered_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({
      name: "outbox_event_deliveries_pk",
      columns: [t.eventId, t.listenerId],
    }),
    index("outbox_delivery_pending_idx").on(
      t.status,
      t.nextAttemptAt,
      t.leaseExpiresAt,
    ),
    check(
      "outbox_event_deliveries_status_check",
      sql`${t.status} in ('pending', 'processing', 'delivered', 'dead_letter')`,
    ),
    check(
      "outbox_event_deliveries_attempts_nonnegative",
      sql`${t.attempts} >= 0`,
    ),
    check(
      "outbox_event_deliveries_listener_not_blank",
      sql`length(trim(${t.listenerId})) > 0`,
    ),
    check(
      "outbox_event_deliveries_processing_lease_check",
      sql`${t.status} <> 'processing' or ${t.leaseExpiresAt} is not null`,
    ),
    check(
      "outbox_event_deliveries_delivered_timestamp_check",
      sql`${t.status} <> 'delivered' or ${t.deliveredAt} is not null`,
    ),
    check(
      "outbox_event_deliveries_dead_letter_timestamp_check",
      sql`${t.status} <> 'dead_letter' or ${t.deadLetteredAt} is not null`,
    ),
  ],
);
