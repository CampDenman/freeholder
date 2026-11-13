// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: receipt-owned money never needs a fabricated canonical payment.
import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAtColumn } from "@/core/db/columns";
import { payments } from "./schema";
import { subscriptionProviderChargeReceipts } from "@/modules/subscriptions/schema";
import type { MerchantRefundCashOrigin, MerchantRefundSource } from "./merchant-refund-origin";
import type { MerchantPhysicalCaller } from "./merchant-physical-caller";
export interface OriginalCashRecoveryOwner {
  source: MerchantRefundSource; cash: MerchantRefundCashOrigin; recipientAccountId: string | null;
  authorizedBy: string; authorizedAt: string;
}
export const originalCashRecoveries = pgTable("original_cash_recoveries", {
  id: uuid("id").primaryKey().defaultRandom(), namespaceKey: text("namespace_key").notNull(),
  paymentId: uuid("payment_id").references(() => payments.id, { onDelete: "restrict" }),
  subscriptionChargeReceiptId: uuid("subscription_charge_receipt_id").references(() => subscriptionProviderChargeReceipts.id, { onDelete: "restrict" }),
  owner: jsonb("owner").$type<OriginalCashRecoveryOwner>().notNull(), digest: text("digest").notNull(), authentication: text("authentication").notNull(), createdAt: createdAtColumn(),
}, t => [uniqueIndex("original_cash_recoveries_namespace").on(t.namespaceKey), index("original_cash_recoveries_payment").on(t.paymentId), index("original_cash_recoveries_receipt").on(t.subscriptionChargeReceiptId),
  check("original_cash_recoveries_source", sql`(${t.paymentId} is null)<>(${t.subscriptionChargeReceiptId} is null)`),
  check("original_cash_recoveries_proof", sql`${t.namespaceKey} ~ '^[a-f0-9]{64}$' and ${t.digest} ~ '^[a-f0-9]{64}$' and ${t.authentication} ~ '^[a-f0-9]{64}$'`)]);
export const originalCashRecoveryOperations = pgTable("original_cash_recovery_operations", {
  id: uuid("id").primaryKey().defaultRandom(), recoveryId: uuid("recovery_id").notNull().references(() => originalCashRecoveries.id, { onDelete: "restrict" }),
  kind: text("kind", { enum: ["inspection", "fee", "recipient"] }).notNull(), request: jsonb("request").$type<Record<string, unknown>>().notNull(),
  caller: jsonb("caller").$type<MerchantPhysicalCaller>().notNull(), nonceHash: text("nonce_hash").notNull(),
  digest: text("digest").notNull(), authentication: text("authentication").notNull(), createdAt: createdAtColumn(),
}, t => [index("original_cash_recovery_operations_owner").on(t.recoveryId),
  uniqueIndex("original_cash_recovery_operations_creation").on(t.recoveryId, t.kind, sql`coalesce(${t.request}->>'targetFactId','original_full_v1')`).where(sql`${t.kind}<>'inspection'`),
  check("original_cash_recovery_operations_kind", sql`${t.kind} in ('inspection','fee','recipient')`),
  check("original_cash_recovery_operations_proof", sql`${t.nonceHash} ~ '^[a-f0-9]{64}$' and ${t.digest} ~ '^[a-f0-9]{64}$' and ${t.authentication} ~ '^[a-f0-9]{64}$'`)]);
export const originalCashRecoveryFacts = pgTable("original_cash_recovery_facts", {
  id: uuid("id").primaryKey().defaultRandom(), recoveryId: uuid("recovery_id").notNull().references(() => originalCashRecoveries.id, { onDelete: "restrict" }),
  operationId: uuid("operation_id").references(() => originalCashRecoveryOperations.id, { onDelete: "restrict" }),
  sequence: integer("sequence").notNull(),
  kind: text("kind", { enum: ["primary", "refund", "state", "parent", "ack", "resource", "finish", "stop", "legacy_fee_stop", "customer_request", "partial_target", "partial_closure", "unassigned_refund_review"] }).notNull(),
  evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull(), digest: text("digest").notNull(), authentication: text("authentication").notNull(), createdAt: createdAtColumn(),
}, t => [index("original_cash_recovery_facts_owner").on(t.recoveryId), index("original_cash_recovery_facts_operation").on(t.operationId),
  uniqueIndex("original_cash_recovery_facts_sequence").on(t.recoveryId, t.sequence),
  check("original_cash_recovery_facts_sequence_positive", sql`${t.sequence}>0`),
  uniqueIndex("original_cash_recovery_facts_terminal").on(t.operationId, t.kind).where(sql`${t.kind} in ('finish','stop')`),
  uniqueIndex("original_cash_recovery_facts_target").on(t.recoveryId, sql`(${t.evidence}->>'targetKey')`).where(sql`${t.kind}='partial_target'`),
  check("original_cash_recovery_facts_kind", sql`${t.kind} in ('primary','refund','state','parent','ack','resource','finish','stop','legacy_fee_stop','customer_request','partial_target','partial_closure','unassigned_refund_review')`),
  check("original_cash_recovery_facts_proof", sql`${t.digest} ~ '^[a-f0-9]{64}$' and ${t.authentication} ~ '^[a-f0-9]{64}$'`)]);
export const originalCashRecoveryClosures = pgTable("original_cash_recovery_closures", {
  id: uuid("id").primaryKey().defaultRandom(), recoveryId: uuid("recovery_id").notNull().references(() => originalCashRecoveries.id, { onDelete: "restrict" }),
  operationId: uuid("operation_id").notNull().references(() => originalCashRecoveryOperations.id, { onDelete: "restrict" }),
  revision: text("revision").notNull(), unappliedReturnReceiptId: uuid("unapplied_return_receipt_id"),
  digest: text("digest").notNull(), authentication: text("authentication").notNull(), createdAt: createdAtColumn(),
}, t => [index("original_cash_recovery_closures_owner").on(t.recoveryId), uniqueIndex("original_cash_recovery_closures_read").on(t.operationId),
  check("original_cash_recovery_closures_proof", sql`${t.revision} ~ '^[a-f0-9]{64}$' and ${t.digest} ~ '^[a-f0-9]{64}$' and ${t.authentication} ~ '^[a-f0-9]{64}$'`)]);
