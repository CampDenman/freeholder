// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { bigint, check, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const storageQuotaState = pgTable("storage_quota_state", {
  namespace: text("namespace").primaryKey(),
  maxBytes: bigint("max_bytes", { mode: "number" }).notNull(),
  inventorySha256: text("inventory_sha256").notNull(),
  initializedAt: timestamp("initialized_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  check("storage_quota_state_namespace_check", sql`${t.namespace} ~ '^[a-f0-9]{64}$'`),
  check("storage_quota_state_max_bytes_check", sql`${t.maxBytes} > 0 AND ${t.maxBytes} <= 9007199254740991`),
  check("storage_quota_state_inventory_sha256_check", sql`${t.inventorySha256} ~ '^[a-f0-9]{64}$'`),
]);
export const storageQuotaObjects = pgTable("storage_quota_objects", {
  namespace: text("namespace").notNull().references(() => storageQuotaState.namespace, { onDelete: "restrict" }),
  objectKey: text("object_key").notNull(),
  bytes: bigint("bytes", { mode: "number" }).notNull(),
  pendingToken: uuid("pending_token"),
}, t => [
  primaryKey({ columns: [t.namespace, t.objectKey] }),
  check("storage_quota_objects_object_key_check", sql`length(${t.objectKey}) BETWEEN 1 AND 2048`),
  check("storage_quota_objects_bytes_check", sql`${t.bytes} >= 0 AND ${t.bytes} <= 9007199254740991`),
]);
