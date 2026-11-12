// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: original refund intent and independently retained physical evidence.
import { sql } from "drizzle-orm";
import { bigint, boolean, check, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAtColumn } from "@/core/db/columns";
import { payments, refunds } from "./schema";
import { merchantPaymentObservations } from "./merchant-collection-schema";
import type { MerchantReturnedCashEvidence } from "@/adapters/payments/merchant-returned-cash-types";
import type { MerchantPhysicalCaller } from "./merchant-physical-caller";
import type { CheckoutCaptureResult, MerchantChargeScope, MerchantSubscriptionChargeOrigin } from "@/adapters/payments";
import { subscriptionProviderChargeObservations, subscriptionProviderChargeReceipts } from "@/modules/subscriptions/schema";

/** Provider arguments carry an actual cash owner; a missing local payment is never fabricated. */
export type MerchantRefundProviderArguments = MerchantChargeScope & {
  refundAttemptId: string; paymentId?: string; subscriptionChargeReceiptId?: string; subscriptionOrigin?: MerchantSubscriptionChargeOrigin;
  providerRef: string; currency: string; amountMinor: number; idempotencyKey: string;
  reverseTransfer: false; refundApplicationFee: false; frozenBody: string;
};

/** A logical refund and a return of unapplied provider money are distinct. */
export const merchantRefundRequests = pgTable("merchant_refund_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  purpose: text("purpose", { enum: ["invoice_refund", "unapplied_return"] }).notNull(),
  refundId: uuid("refund_id").references(() => refunds.id, { onDelete: "restrict" }),
  paymentId: uuid("payment_id").references(() => payments.id, { onDelete: "restrict" }),
  subscriptionChargeReceiptId: uuid("subscription_charge_receipt_id").references(() => subscriptionProviderChargeReceipts.id, { onDelete: "restrict" }),
  originalObservationId: uuid("original_observation_id").references(() => merchantPaymentObservations.id, { onDelete: "restrict" }),
  subscriptionChargeObservationId: uuid("subscription_charge_observation_id").references(() => subscriptionProviderChargeObservations.id, { onDelete: "restrict" }),
  providerPlatformAccountId: text("provider_platform_account_id").notNull(),
  chargeAccountId: text("charge_account_id"),
  providerApiVersion: text("provider_api_version").notNull(),
  originalPaymentRef: text("original_payment_ref").notNull(),
  amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
  currency: text("currency").notNull(),
  idempotencyKey: text("idempotency_key").notNull(), reasonDigest: text("reason_digest").notNull(),
  originalRequest: jsonb("original_request").$type<MerchantRefundProviderArguments>().notNull(),
  originalCashAmountMinor: bigint("original_cash_amount_minor", { mode: "number" }).notNull(),
  requestDigest: text("request_digest").notNull(),
  createdAt: createdAtColumn(),
}, table => [
  uniqueIndex("merchant_refund_requests_logical_idx").on(table.refundId),
  uniqueIndex("merchant_refund_requests_key_idx").on(table.providerPlatformAccountId, sql`coalesce(${table.chargeAccountId},'')`, table.idempotencyKey),
  index("merchant_refund_requests_payment_idx").on(table.paymentId),
  index("merchant_refund_requests_subscription_idx").on(table.subscriptionChargeReceiptId),
  check("merchant_refund_requests_source", sql`((${table.paymentId} is not null and ${table.originalObservationId} is not null and ${table.subscriptionChargeReceiptId} is null and ${table.subscriptionChargeObservationId} is null) or (${table.paymentId} is null and ${table.originalObservationId} is null and ${table.subscriptionChargeReceiptId} is not null and ${table.subscriptionChargeObservationId} is not null)) is true`),
  check("merchant_refund_requests_purpose", sql`((${table.purpose}='invoice_refund' and ${table.refundId} is not null and ${table.paymentId} is not null) or (${table.purpose}='unapplied_return' and ${table.refundId} is null)) is true`),
  check("merchant_refund_requests_amount", sql`${table.originalCashAmountMinor} between 1 and 9007199254740991 and ${table.amountMinor} between 1 and ${table.originalCashAmountMinor} and ${table.currency} ~ '^[A-Z]{3}$'`),
  check("merchant_refund_requests_scope", sql`${table.providerPlatformAccountId} ~ '^acct_[A-Za-z0-9]+$' and (${table.chargeAccountId} is null or (${table.chargeAccountId} ~ '^acct_[A-Za-z0-9]+$' and ${table.chargeAccountId}<>${table.providerPlatformAccountId})) and ${table.providerApiVersion} in ('2026-02-25.clover','2026-10-28.endive')`),
  check("merchant_refund_requests_original", sql`${table.originalPaymentRef} ~ '^pi_[A-Za-z0-9_]+$' and ${table.requestDigest} ~ '^[a-f0-9]{64}$' and jsonb_typeof(${table.originalRequest})='object'`),
]);

/** Before physical admission, an exact reservation can be retired under its cash lock. */
export const merchantRefundReservationRetirements = pgTable("merchant_refund_reservation_retirements", {
  requestId: uuid("request_id").primaryKey().references(() => merchantRefundRequests.id, { onDelete: "restrict" }),
  requestDigest: text("request_digest").notNull(), reason: text("reason", { enum: ["cancelled_before_dispatch"] }).notNull(),
  initiatedBy: text("initiated_by").notNull(), createdAt: createdAtColumn(),
}, table => [check("merchant_refund_reservation_retirements_reason", sql`${table.reason}='cancelled_before_dispatch' and ${table.requestDigest} ~ '^[a-f0-9]{64}$'`)]);

export const merchantRefundDispatches = pgTable("merchant_refund_dispatches", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull().references(() => merchantRefundRequests.id, { onDelete: "restrict" }),
  ordinal: integer("ordinal").notNull(), requestDigest: text("request_digest").notNull(),
  caller: jsonb("caller").$type<MerchantPhysicalCaller>().notNull(),
  completionNonceHash: text("completion_nonce_hash").notNull(),
  dispatchedAt: timestamp("dispatched_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [uniqueIndex("merchant_refund_dispatches_ordinal_idx").on(table.requestId, table.ordinal),
  check("merchant_refund_dispatches_ordinal", sql`${table.ordinal}>0`),
  check("merchant_refund_dispatches_digest", sql`${table.requestDigest} ~ '^[a-f0-9]{64}$'`)]);

/** Unrequested provider refunds also retain money facts, without inventing an intent. */
export const merchantRefundObservations = pgTable("merchant_refund_observations", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").references(() => merchantRefundRequests.id, { onDelete: "restrict" }),
  paymentId: uuid("payment_id").references(() => payments.id, { onDelete: "restrict" }),
  subscriptionChargeReceiptId: uuid("subscription_charge_receipt_id").references(() => subscriptionProviderChargeReceipts.id, { onDelete: "restrict" }),
  inspectionId: uuid("inspection_id").references(() => merchantCashReturnInspections.id, { onDelete: "restrict" }),
  claimedInspectionId: uuid("claimed_inspection_id"),
  claimedRequestId: uuid("claimed_request_id"), // Opaque actual source intent even if its FK row needs restoration.
  providerPlatformAccountId: text("provider_platform_account_id").notNull(), chargeAccountId: text("charge_account_id"),
  providerApiVersion: text("provider_api_version").notNull(),
  providerRef: text("provider_ref").notNull(), paymentProviderRef: text("payment_provider_ref"), providerChargeRef: text("provider_charge_ref"),
  amountMinor: bigint("amount_minor", { mode: "number" }).notNull(), currency: text("currency").notNull(),
  status: text("status", { enum: ["pending", "requires_action", "succeeded", "failed", "canceled"] }), failureCode: text("failure_code"),
  failureReason: text("failure_reason"), failureBalanceTransactionRef: text("failure_balance_transaction_ref"),
  transferReversalRef: text("transfer_reversal_ref"), sourceTransferReversalRef: text("source_transfer_reversal_ref"),
  bindingVerified: boolean("binding_verified").notNull(), evidenceDigest: text("evidence_digest").notNull(),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  uniqueIndex("merchant_refund_observations_fact_idx").on(table.evidenceDigest),
  index("merchant_refund_observations_payment_idx").on(table.paymentId),
  index("merchant_refund_observations_subscription_idx").on(table.subscriptionChargeReceiptId),
  check("merchant_refund_observations_source", sql`((${table.paymentId} is not null and ${table.subscriptionChargeReceiptId} is null) or (${table.paymentId} is null and ${table.subscriptionChargeReceiptId} is not null)) is true`),
  index("merchant_refund_observations_request_idx").on(table.requestId),
  index("merchant_refund_observations_original_idx").on(table.providerPlatformAccountId, table.chargeAccountId, table.providerRef),
  check("merchant_refund_observations_money", sql`${table.amountMinor} between 1 and 9007199254740991 and ${table.currency} ~ '^[A-Z]{3}$'`),
  check("merchant_refund_observations_status", sql`${table.status} is null or ${table.status} in ('pending','requires_action','succeeded','failed','canceled')`),
  check("merchant_refund_observations_scope", sql`${table.providerPlatformAccountId} ~ '^acct_[A-Za-z0-9]+$' and (${table.chargeAccountId} is null or ${table.chargeAccountId} ~ '^acct_[A-Za-z0-9]+$') and ${table.providerApiVersion} in ('2026-02-25.clover','2026-10-28.endive')`),
  check("merchant_refund_observations_refs", sql`${table.providerRef} ~ '^re_[A-Za-z0-9_]+$' and (${table.paymentProviderRef} is null or ${table.paymentProviderRef} ~ '^pi_[A-Za-z0-9_]+$') and ${table.evidenceDigest} ~ '^[a-f0-9]{64}$'`),
]);

export const merchantRefundCreationRefusals = pgTable("merchant_refund_creation_refusals", {
  dispatchId: uuid("dispatch_id").primaryKey().references(() => merchantRefundDispatches.id, { onDelete: "restrict" }),
  providerCode: text("provider_code").notNull(),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
});

/** This does not claim absence: an exact failed/canceled provider operation is retained. */
export const merchantRefundTerminalReceipts = pgTable("merchant_refund_terminal_receipts", {
  requestId: uuid("request_id").primaryKey().references(() => merchantRefundRequests.id, { onDelete: "restrict" }),
  observationId: uuid("observation_id").notNull().references(() => merchantRefundObservations.id, { onDelete: "restrict" }),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Neither provider status nor process age can replace physical completion. */
export const merchantRefundDispatchFinishes = pgTable("merchant_refund_dispatch_finishes", {
  dispatchId: uuid("dispatch_id").primaryKey().references(() => merchantRefundDispatches.id, { onDelete: "restrict" }),
  callerInstanceId: uuid("caller_instance_id").notNull(),
  outcome: text("outcome", { enum: ["returned", "threw"] }).notNull(),
  providerRef: text("provider_ref"), finishedAt: timestamp("finished_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [check("merchant_refund_dispatch_finishes_outcome", sql`${table.outcome} in ('returned','threw')`)]);

export const merchantRefundDispatchStops = pgTable("merchant_refund_dispatch_stops", {
  dispatchId: uuid("dispatch_id").primaryKey().references(() => merchantRefundDispatches.id, { onDelete: "restrict" }),
  callerInstanceId: uuid("caller_instance_id").notNull(), requestDigest: text("request_digest").notNull(),
  mechanicalCheck: text("mechanical_check", { enum: ["original_process_absent", "unobservable_host_review"] }).notNull(),
  evidenceDigest: text("evidence_digest").notNull(), reviewedBy: text("reviewed_by").notNull(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Mutable refund metadata alone never releases unknown refund reservations. */
export const merchantRefundResourceBindings = pgTable("merchant_refund_resource_bindings", {
  id: uuid("id").primaryKey().defaultRandom(), requestId: uuid("request_id").notNull().references(() => merchantRefundRequests.id, { onDelete: "restrict" }),
  dispatchId: uuid("dispatch_id").notNull().references(() => merchantRefundDispatches.id, { onDelete: "restrict" }),
  providerRef: text("provider_ref").notNull(), origin: text("origin", { enum: ["physical_ack", "human_request_review"] }).notNull(),
  evidenceDigest: text("evidence_digest").notNull(), reviewedBy: text("reviewed_by"),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [uniqueIndex("merchant_refund_resource_bindings_evidence_idx").on(table.requestId, table.evidenceDigest),
  check("merchant_refund_resource_bindings_ref", sql`${table.providerRef} ~ '^re_[A-Za-z0-9_]+$'`)]);

/** A read begins only after an exact original source/caller inventory snapshot. */
export const merchantCashReturnInspections = pgTable("merchant_cash_return_inspections", {
  id: uuid("id").primaryKey().defaultRandom(), paymentId: uuid("payment_id").references(() => payments.id, { onDelete: "restrict" }),
  subscriptionChargeReceiptId: uuid("subscription_charge_receipt_id").references(() => subscriptionProviderChargeReceipts.id, { onDelete: "restrict" }),
  originalObservationId: uuid("original_observation_id").references(() => merchantPaymentObservations.id, { onDelete: "restrict" }),
  subscriptionChargeObservationId: uuid("subscription_charge_observation_id").references(() => subscriptionProviderChargeObservations.id, { onDelete: "restrict" }),
  providerPlatformAccountId: text("provider_platform_account_id").notNull(), chargeAccountId: text("charge_account_id"),
  providerApiVersion: text("provider_api_version").notNull(), originalPaymentRef: text("original_payment_ref").notNull(),
  originalCashAmountMinor: bigint("original_cash_amount_minor", { mode: "number" }).notNull(), currency: text("currency").notNull(),
  sourceHistoryDigest: text("source_history_digest").notNull(),
  caller: jsonb("caller").$type<MerchantPhysicalCaller>().notNull(), completionNonceHash: text("completion_nonce_hash").notNull(), createdAt: createdAtColumn(),
}, table => [check("merchant_cash_return_inspections_source", sql`((${table.paymentId} is not null and ${table.originalObservationId} is not null and ${table.subscriptionChargeReceiptId} is null and ${table.subscriptionChargeObservationId} is null) or (${table.paymentId} is null and ${table.originalObservationId} is null and ${table.subscriptionChargeReceiptId} is not null and ${table.subscriptionChargeObservationId} is not null)) is true`),
  check("merchant_cash_return_inspections_digest", sql`${table.sourceHistoryDigest} ~ '^[a-f0-9]{64}$'`)]);
export const merchantCashReturnInspectionFinishes = pgTable("merchant_cash_return_inspection_finishes", {
  inspectionId: uuid("inspection_id").primaryKey().references(() => merchantCashReturnInspections.id, { onDelete: "restrict" }),
  callerInstanceId: uuid("caller_instance_id").notNull(), outcome: text("outcome", { enum: ["returned", "threw"] }).notNull(), createdAt: createdAtColumn(),
}, table => [check("merchant_cash_return_inspection_finishes_outcome", sql`${table.outcome} in ('returned','threw')`)]);

/** Primary cash is retained before any fee/transfer/refund/dispute GET can fail. */
export const merchantCashReturnPrimaryObservations = pgTable("merchant_cash_return_primary_observations", {
  id: uuid("id").primaryKey().defaultRandom(), inspectionId: uuid("inspection_id").notNull().references(() => merchantCashReturnInspections.id, { onDelete: "restrict" }),
  evidence: jsonb("evidence").$type<CheckoutCaptureResult>().notNull(), evidenceDigest: text("evidence_digest").notNull(), createdAt: createdAtColumn(),
}, table => [uniqueIndex("merchant_cash_return_primary_observations_fact_idx").on(table.inspectionId, table.evidenceDigest),
  check("merchant_cash_return_primary_observations_evidence", sql`jsonb_typeof(${table.evidence})='object' and ${table.evidenceDigest} ~ '^[a-f0-9]{64}$'`)]);
export const merchantCashReturnObservations = pgTable("merchant_cash_return_observations", {
  id: uuid("id").primaryKey().defaultRandom(), inspectionId: uuid("inspection_id").notNull().references(() => merchantCashReturnInspections.id, { onDelete: "restrict" }),
  sequence: integer("sequence").notNull(),
  evidence: jsonb("evidence").$type<MerchantReturnedCashEvidence>().notNull(), evidenceDigest: text("evidence_digest").notNull(), createdAt: createdAtColumn(),
}, table => [uniqueIndex("merchant_cash_return_observations_fact_idx").on(table.inspectionId, table.evidenceDigest),
  uniqueIndex("merchant_cash_return_observations_sequence_idx").on(table.inspectionId, table.sequence),
  check("merchant_cash_return_observations_sequence", sql`${table.sequence} > 0`),
  check("merchant_cash_return_observations_evidence", sql`jsonb_typeof(${table.evidence})='object' and ${table.evidenceDigest} ~ '^[a-f0-9]{64}$'`)]);

/** A refunded positive charge never becomes a fictitious zero-money PI. */
export const merchantUnappliedChargeResolutions = pgTable("merchant_unapplied_charge_resolutions", {
  inspectionId: uuid("inspection_id").notNull().references(() => merchantCashReturnInspections.id, { onDelete: "restrict" }),
  returnObservationId: uuid("return_observation_id").notNull().references(() => merchantCashReturnObservations.id, { onDelete: "restrict" }),
  id: uuid("id").primaryKey().defaultRandom(), paymentId: uuid("payment_id").references(() => payments.id, { onDelete: "restrict" }),
  subscriptionChargeReceiptId: uuid("subscription_charge_receipt_id").references(() => subscriptionProviderChargeReceipts.id, { onDelete: "restrict" }),
  originalObservationId: uuid("original_observation_id").references(() => merchantPaymentObservations.id, { onDelete: "restrict" }),
  subscriptionChargeObservationId: uuid("subscription_charge_observation_id").references(() => subscriptionProviderChargeObservations.id, { onDelete: "restrict" }),
  providerPlatformAccountId: text("provider_platform_account_id").notNull(), chargeAccountId: text("charge_account_id"),
  originalPaymentRef: text("original_payment_ref").notNull(), originalCashAmountMinor: bigint("original_cash_amount_minor", { mode: "number" }).notNull(), currency: text("currency").notNull(),
  ownEvidenceDigest: text("own_evidence_digest").notNull(),
  disposition: text("disposition", { enum: ["returned_to_original_payer"] }).notNull(), evidenceDigest: text("evidence_digest").notNull(),
  createdAt: createdAtColumn(),
}, table => [check("merchant_unapplied_charge_resolutions_source", sql`((${table.paymentId} is not null and ${table.originalObservationId} is not null and ${table.subscriptionChargeReceiptId} is null and ${table.subscriptionChargeObservationId} is null) or (${table.paymentId} is null and ${table.originalObservationId} is null and ${table.subscriptionChargeReceiptId} is not null and ${table.subscriptionChargeObservationId} is not null)) is true`),
  uniqueIndex("merchant_unapplied_charge_resolutions_version_idx").on(table.providerPlatformAccountId, sql`coalesce(${table.chargeAccountId},'')`, table.originalPaymentRef, table.evidenceDigest),
  index("merchant_unapplied_charge_resolutions_original_idx").on(table.providerPlatformAccountId, table.chargeAccountId, table.originalPaymentRef),
  check("merchant_unapplied_charge_resolutions_money", sql`${table.originalCashAmountMinor} between 1 and 9007199254740991 and ${table.currency} ~ '^[A-Z]{3}$'`),
  check("merchant_unapplied_charge_resolutions_kind", sql`${table.disposition}='returned_to_original_payer' and ${table.evidenceDigest} ~ '^[a-f0-9]{64}$'`)]);

export const merchantUnappliedChargeResolutionRefunds = pgTable("merchant_unapplied_charge_resolution_refunds", {
  resolutionId: uuid("resolution_id").notNull().references(() => merchantUnappliedChargeResolutions.id, { onDelete: "restrict" }),
  observationId: uuid("observation_id").notNull().references(() => merchantRefundObservations.id, { onDelete: "restrict" }),
}, table => [primaryKey({ columns: [table.resolutionId, table.observationId] })]);
