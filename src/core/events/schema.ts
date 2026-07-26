// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// The audit trail (MASTER.md §4.8, §11). Every admin/agent mutation through
// the service layer lands here — it is written by the service registry
// wrapper, inside the same transaction as the mutation, so an unaudited
// mutation is impossible rather than unlikely. The owner can read a
// plain-English log of everything their AI did.
import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** "user:<id>", "agent:<key-name>", or "system". */
    actor: text("actor").notNull(),
    /** The service method name: "contacts.create", "auth.login"… */
    action: text("action").notNull(),
    subjectType: text("subject_type"),
    subjectId: uuid("subject_id"),
    /** Input snapshot / changed fields. Secrets are redacted before write. */
    diff: jsonb("diff").notNull().default({}),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_log_subject_idx").on(t.subjectType, t.subjectId),
    index("audit_log_at_idx").on(t.at),
  ],
);
