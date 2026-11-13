// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C3.22/C11.08: each physical write keeps its original resource identity.
import { sql } from "drizzle-orm";
import { bigint, check, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { contacts } from "@/core/contacts/schema";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";

export const MEDIA_WRITE_STATES = ["unverified", "started", "accepted", "unknown", "confirmed_absent"] as const;
export const mediaObjectWrites = pgTable("media_object_writes", {
  id: uuid("id").primaryKey().defaultRandom(),
  operation: text("operation_kind", { enum: ["put", "delete"] }).notNull().default("put"),
  key: text("object_key").notNull(),
  keyDigest: text("key_digest").notNull(),
  namespace: text("storage_namespace"),
  storageKind: text("storage_kind"),
  // Resource names only. Credentials never enter this snapshot.
  storageLocation: jsonb("storage_location").notNull().default({}),
  sha256: text("sha256"),
  bytes: bigint("bytes", { mode: "number" }),
  contentType: text("content_type").notNull(),
  actor: text("actor").notNull(),
  contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "restrict" }),
  state: text("state", { enum: MEDIA_WRITE_STATES }).notNull(),
  writerRuntimeId: uuid("writer_runtime_id"),
  writerFinishedAt: timestamp("writer_finished_at", { withTimezone: true }),
  observedAcceptedAt: timestamp("observed_accepted_at", { withTimezone: true }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewedBy: text("reviewed_by"),
  evidenceDigest: text("evidence_digest"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  redactedAt: timestamp("redacted_at", { withTimezone: true }),
  createdAt: createdAtColumn(), updatedAt: updatedAtColumn(),
}, table => [
  index("media_object_writes_key_idx").on(table.key, table.createdAt),
  index("media_object_writes_digest_idx").on(table.keyDigest),
  index("media_object_writes_contact_idx").on(table.contactId, table.state),
  index("media_object_writes_open_idx").on(table.state, table.createdAt),
  check("media_object_writes_state", sql`${table.state} in ('unverified','started','accepted','unknown','confirmed_absent')`),
  check("media_object_writes_operation", sql`${table.operation} in ('put','delete')`),
  check("media_object_writes_namespace", sql`${table.namespace} is null or ${table.namespace} ~ '^[a-f0-9]{64}$'`),
  check("media_object_writes_digest", sql`${table.sha256} is null or ${table.sha256} ~ '^[a-f0-9]{64}$'`),
  check("media_object_writes_bytes", sql`${table.bytes} is null or ${table.bytes} >= 0`),
]);
