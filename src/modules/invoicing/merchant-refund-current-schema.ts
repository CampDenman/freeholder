// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.19/C12.38: current-read authority never replaces retained bank history.
import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAtColumn } from "@/core/db/columns";
import type { MerchantPhysicalCaller } from "./merchant-physical-caller";
import { merchantRefundObservations, merchantRefundRequests, merchantRefundResourceBindings } from "./merchant-refund-schema";

/** A repeated authenticated state can reuse its semantic observation, while
 * this distinct actual capture still invalidates an older current-state read.
 * No CRM subject or mutable current merchant is copied into these tables.
 */
export const merchantRefundObservationCaptures = pgTable("merchant_refund_observation_captures", {
  id: uuid("id").primaryKey().defaultRandom(),
  observationId: uuid("observation_id").notNull().references(() => merchantRefundObservations.id, { onDelete: "restrict" }),
  captureKey: text("capture_key").notNull(),
  createdAt: createdAtColumn(),
}, table => [index("merchant_refund_observation_captures_fact_idx").on(table.observationId),
  uniqueIndex("merchant_refund_observation_captures_key_idx").on(table.captureKey),
  check("merchant_refund_observation_captures_key", sql`${table.captureKey} ~ '^[a-f0-9]{64}$'`)]);

export const merchantRefundStateReads = pgTable("merchant_refund_state_reads", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull().references(() => merchantRefundRequests.id, { onDelete: "restrict" }),
  requestDigest: text("request_digest").notNull(),
  resourceBindingId: uuid("resource_binding_id").notNull().references(() => merchantRefundResourceBindings.id, { onDelete: "restrict" }),
  sourceRevision: text("source_revision").notNull(),
  sourceObservationIds: jsonb("source_observation_ids").$type<string[]>().notNull(),
  caller: jsonb("caller").$type<MerchantPhysicalCaller>().notNull(),
  completionNonceHash: text("completion_nonce_hash").notNull(), createdAt: createdAtColumn(),
}, table => [
  index("merchant_refund_state_reads_request_idx").on(table.requestId),
  check("merchant_refund_state_reads_digest", sql`${table.requestDigest} ~ '^[a-f0-9]{64}$' and ${table.sourceRevision} ~ '^[a-f0-9]{64}$' and ${table.completionNonceHash} ~ '^[a-f0-9]{64}$'`),
  check("merchant_refund_state_reads_inventory", sql`jsonb_typeof(${table.sourceObservationIds})='array' and jsonb_array_length(${table.sourceObservationIds})<=5000`),
]);

export const merchantRefundStateReadFinishes = pgTable("merchant_refund_state_read_finishes", {
  readId: uuid("read_id").primaryKey().references(() => merchantRefundStateReads.id, { onDelete: "restrict" }),
  callerInstanceId: uuid("caller_instance_id").notNull(), outcome: text("outcome", { enum: ["returned", "threw"] }).notNull(),
  captureId: uuid("capture_id").references(() => merchantRefundObservationCaptures.id, { onDelete: "restrict" }),
  createdAt: createdAtColumn(),
}, table => [check("merchant_refund_state_read_finishes_outcome", sql`${table.outcome} in ('returned','threw') and (${table.outcome}<>'returned' or ${table.captureId} is not null)`)]);

export const merchantRefundCurrentReceipts = pgTable("merchant_refund_current_receipts", {
  id: uuid("id").primaryKey().defaultRandom(),
  readId: uuid("read_id").notNull().references(() => merchantRefundStateReads.id, { onDelete: "restrict" }),
  requestId: uuid("request_id").notNull().references(() => merchantRefundRequests.id, { onDelete: "restrict" }),
  captureId: uuid("capture_id").notNull().references(() => merchantRefundObservationCaptures.id, { onDelete: "restrict" }),
  resolvedRevision: text("resolved_revision").notNull(), createdAt: createdAtColumn(),
}, table => [uniqueIndex("merchant_refund_current_receipts_read_idx").on(table.readId),
  index("merchant_refund_current_receipts_request_idx").on(table.requestId),
  check("merchant_refund_current_receipts_revision", sql`${table.resolvedRevision} ~ '^[a-f0-9]{64}$'`)]);
