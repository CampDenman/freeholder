// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.19/C12.38: legacy read evidence has its own real ticket and original owner.
import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAtColumn } from "@/core/db/columns";
import { refunds } from "./schema";
import type { LegacyBankOriginal } from "./legacy-bank-read-contract";
import type { MerchantPhysicalCaller } from "./merchant-physical-caller";

export const legacyBankReads = pgTable("legacy_bank_reads", {
  id: uuid("id").primaryKey().defaultRandom(), refundId: uuid("refund_id").notNull().references(() => refunds.id, { onDelete: "restrict" }),
  original: jsonb("original").$type<LegacyBankOriginal>().notNull(), originalDigest: text("original_digest").notNull(), sourceRevision: text("source_revision").notNull(),
  caller: jsonb("caller").$type<MerchantPhysicalCaller>().notNull(), completionNonceHash: text("completion_nonce_hash").notNull(),
  createdAt: createdAtColumn(),
}, table => [index("legacy_bank_reads_refund_idx").on(table.refundId),
  check("legacy_bank_reads_digest", sql`${table.sourceRevision} ~ '^[a-f0-9]{64}$' and ${table.originalDigest} ~ '^[a-f0-9]{64}$' and ${table.completionNonceHash} ~ '^[a-f0-9]{64}$'`),
  check("legacy_bank_reads_original", sql`(jsonb_typeof(${table.original})='object' and (${table.original}->>'refundId')::uuid=${table.refundId} and ${table.original}->'originalCreatePlatformAccountId'='null'::jsonb and ${table.original}->'originalCreateProtocolVersion'='null'::jsonb) is true`),
  check("legacy_bank_reads_caller", sql`jsonb_typeof(${table.caller})='object' and (${table.caller}->>'id')::uuid is not null`),
]);
export const legacyBankReadFacts = pgTable("legacy_bank_read_facts", {
  id: uuid("id").primaryKey().defaultRandom(), readId: uuid("read_id").notNull().references(() => legacyBankReads.id, { onDelete: "restrict" }),
  sequence: integer("sequence").notNull(), kind: text("kind", { enum: ["exact_refund", "primary_cash", "inventory_refund", "cash_inventory"] }).notNull(),
  evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull(), evidenceDigest: text("evidence_digest").notNull(), createdAt: createdAtColumn(),
}, table => [uniqueIndex("legacy_bank_read_facts_sequence_idx").on(table.readId, table.sequence),
  check("legacy_bank_read_facts_evidence", sql`${table.sequence} between 1 and 5005 and ${table.evidenceDigest} ~ '^[a-f0-9]{64}$' and jsonb_typeof(${table.evidence})='object'`),
  check("legacy_bank_read_facts_kind", sql`${table.kind} in ('exact_refund','primary_cash','inventory_refund','cash_inventory')`),
]);
export const legacyBankReadFinishes = pgTable("legacy_bank_read_finishes", {
  readId: uuid("read_id").primaryKey().references(() => legacyBankReads.id, { onDelete: "restrict" }),
  callerInstanceId: uuid("caller_instance_id").notNull(), outcome: text("outcome", { enum: ["returned", "threw"] }).notNull(),
  factCount: integer("fact_count").notNull(), factsDigest: text("facts_digest").notNull(), createdAt: createdAtColumn(),
}, table => [check("legacy_bank_read_finishes_inventory", sql`${table.factCount} between 0 and 5005 and ${table.factsDigest} ~ '^[a-f0-9]{64}$'`),
  check("legacy_bank_read_finishes_outcome", sql`${table.outcome} in ('returned','threw')`),
]);

/** Actual finished-read freshness is separate from immutable raw bank facts. */
export const legacyBankCurrentReceipts = pgTable("legacy_bank_current_receipts", {
  id: uuid("id").primaryKey().defaultRandom(), readId: uuid("read_id").notNull().references(() => legacyBankReads.id, { onDelete: "restrict" }),
  refundId: uuid("refund_id").notNull().references(() => refunds.id, { onDelete: "restrict" }),
  resolvedRevision: text("resolved_revision").notNull(), status: text("status", { enum: ["pending", "requires_action", "succeeded", "failed", "canceled"] }),
  rawStatus: text("raw_status"), requiresReview: boolean("requires_review").notNull(), createdAt: createdAtColumn(),
}, table => [uniqueIndex("legacy_bank_current_receipts_read_idx").on(table.readId), index("legacy_bank_current_receipts_refund_idx").on(table.refundId),
  check("legacy_bank_current_receipts_revision", sql`${table.resolvedRevision} ~ '^[a-f0-9]{64}$' and (${table.rawStatus} is null or length(${table.rawStatus})<=100)`),
  check("legacy_bank_current_receipts_status", sql`${table.status} is null or ${table.status} in ('pending','requires_action','succeeded','failed','canceled')`),
]);
