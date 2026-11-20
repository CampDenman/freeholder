// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.08/C3.47: a completed empty capture differs from unknown historical scope.
import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { privacyRetentionExceptions } from "./schema";

export const privacyRetentionSourceSnapshots = pgTable("privacy_retention_source_snapshots", {
  exceptionId: uuid("exception_id").notNull().references(() => privacyRetentionExceptions.id, { onDelete: "cascade" }),
  sourceScope: text("source_scope").notNull(),
  captureVersion: integer("capture_version").notNull().default(1),
  memberCount: integer("member_count").notNull(),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  primaryKey({ name: "privacy_retention_source_snapshots_pk", columns: [table.exceptionId, table.sourceScope] }),
  check("privacy_retention_source_snapshots_scope", sql`length(${table.sourceScope}) between 1 and 200`),
  check("privacy_retention_source_snapshots_version", sql`${table.captureVersion}=1`),
  check("privacy_retention_source_snapshots_count", sql`${table.memberCount} between 0 and 10000`),
]);

/** Original opaque source identities survive retirement of the live source.
 * These are retention membership, never a mutable ownership/disclosure FK.
 */
export const privacyRetentionSourceMembers = pgTable("privacy_retention_source_members", {
  exceptionId: uuid("exception_id").notNull(),
  sourceScope: text("source_scope").notNull(),
  sourceId: uuid("source_id").notNull(),
  generation: uuid("generation").notNull(),
}, table => [
  primaryKey({ name: "privacy_retention_source_members_pk", columns: [table.exceptionId, table.sourceScope, table.sourceId, table.generation] }),
  foreignKey({ name: "privacy_retention_source_members_snapshot_fk", columns: [table.exceptionId, table.sourceScope], foreignColumns: [privacyRetentionSourceSnapshots.exceptionId, privacyRetentionSourceSnapshots.sourceScope] }).onDelete("cascade"),
  index("privacy_retention_source_members_lookup_idx").on(table.sourceScope, table.sourceId, table.generation, table.exceptionId),
]);
