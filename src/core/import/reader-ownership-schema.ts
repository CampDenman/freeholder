// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C2.29/C3.46: minimal source ownership survives address changes and erasure.
import { check, index, integer, pgTable, primaryKey, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { contacts } from "@/core/contacts/schema";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";

export const readerOwnershipKeys = pgTable("import_reader_ownership_keys", {
  id: integer("id").primaryKey().default(1),
  encryptedKey: text("encrypted_key").notNull(),
  wrappingFingerprint: text("wrapping_fingerprint").notNull(),
  createdAt: createdAtColumn(),
}, table => [check("import_reader_key_singleton", sql`${table.id} = 1`)]);

export const readerOwnershipReceipts = pgTable("import_reader_ownership_receipts", {
  id: uuid("id").primaryKey().defaultRandom(),
  keyId: integer("key_id").notNull().default(1).references(() => readerOwnershipKeys.id),
  sourceDigest: text("source_digest").notNull(),
  addressDigest: text("address_digest"),
  firstRunId: uuid("first_run_id").notNull(),
  createdBy: text("created_by").notNull(),
  createdByKeyId: uuid("created_by_key_id"),
  contactId: uuid("contact_id").references(() => contacts.id),
  state: text("state", { enum: ["unbound", "review", "bound", "erased"] }).notNull(),
  createdAt: createdAtColumn(), updatedAt: updatedAtColumn(),
}, table => [
  uniqueIndex("import_reader_source_unique").on(table.sourceDigest),
  index("import_reader_contact_idx").on(table.contactId),
  index("import_reader_address_idx").on(table.addressDigest),
  check("import_reader_source_digest", sql`${table.sourceDigest} ~ '^[a-f0-9]{64}$'`),
  check("import_reader_address_digest", sql`${table.addressDigest} is null or ${table.addressDigest} ~ '^[a-f0-9]{64}$'`),
  check("import_reader_owner_state", sql`${table.state} in ('unbound','review','bound','erased') and ((${table.state} in ('unbound','review')) = (${table.contactId} is null))`),
]);

// These are historical subject UUIDs, deliberately without contact FKs: a
// merge deletes its duplicate, and undo later restores that exact identity.
// No reader name, address, body, source URL or source content is copied here.
export const readerOwnershipMergeWitnesses = pgTable("import_reader_merge_witnesses", {
  id: uuid("id").primaryKey(),
  duplicateSubjectId: uuid("duplicate_subject_id").notNull(),
  survivingSubjectId: uuid("surviving_subject_id").notNull(),
  phase: text("phase", { enum: ["captured", "applied"] }).notNull(),
  createdAt: createdAtColumn(),
});
export const readerOwnershipMergeItems = pgTable("import_reader_merge_items", {
  witnessId: uuid("witness_id").notNull().references(() => readerOwnershipMergeWitnesses.id, { onDelete: "cascade" }),
  receiptId: uuid("receipt_id").notNull().references(() => readerOwnershipReceipts.id),
  beforeContactId: uuid("before_contact_id"),
  beforeState: text("before_state").notNull(),
  afterContactId: uuid("after_contact_id"),
  afterState: text("after_state"),
}, table => [primaryKey({ columns: [table.witnessId, table.receiptId] })]);
