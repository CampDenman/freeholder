// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// The audit trail (MASTER.md §4.8, §11). Every admin/agent mutation through
// the service layer lands here — it is written by the service registry
// wrapper, inside the same transaction as the mutation, so an unaudited
// mutation is impossible rather than unlikely. The owner can read a
// plain-English log of everything their AI did.
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

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
    /** Null until a dispatch has run every listener without throwing. */
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // The sweeper's query: undispatched, oldest first.
    index("outbox_pending_idx").on(t.dispatchedAt, t.createdAt),
  ],
);
