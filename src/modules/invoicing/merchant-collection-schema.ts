// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.26/C12.38: original charge namespaces and one invoice's merchant parties.
import { sql } from "drizzle-orm";
import { bigint, boolean, check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { PublicMerchantSupport } from "@/core/commerce/merchant-identity";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";
import { invoiceMerchantAllocations, invoices, payments, refunds } from "./schema";

/** No secret or owner-entered account identity: populated by a provider read. */
export const merchantCollectionConfiguration = pgTable("merchant_collection_configuration", {
  id: integer("id").primaryKey().default(1),
  collectionKind: text("collection_kind", { enum: ["direct", "destination"] }).notNull(),
  providerPlatformAccountId: text("provider_platform_account_id").notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull(),
  updatedAt: updatedAtColumn(),
}, (t) => [
  check("merchant_collection_configuration_singleton", sql`${t.id} = 1`),
  check("merchant_collection_configuration_kind", sql`${t.collectionKind} in ('direct','destination')`),
  check("merchant_collection_configuration_platform", sql`${t.providerPlatformAccountId} ~ '^acct_[A-Za-z0-9]+$'`),
]);

/** All personally owned copies inherit the original77 allocation's contact. */
export const invoiceMerchantCollections = pgTable("invoice_merchant_collections", {
  allocationId: uuid("allocation_id").primaryKey().references(() => invoiceMerchantAllocations.id, { onDelete: "restrict" }),
  invoiceId: uuid("invoice_id").notNull().references(() => invoices.id, { onDelete: "restrict" }),
  collectionKind: text("collection_kind", { enum: ["platform", "direct", "destination"] }).notNull(),
  providerPlatformAccountId: text("provider_platform_account_id").notNull(),
  /** NULL is the platform namespace; it is not an unidentified seller. */
  chargeAccountId: text("charge_account_id"),
  recipientAccountId: text("recipient_account_id"),
  settlementMerchantAccountId: text("settlement_merchant_account_id"),
  merchantName: text("merchant_name").notNull(),
  merchantSupport: jsonb("merchant_support").$type<PublicMerchantSupport>(),
  /** Opaque original tax profile/version and calculation receipts, no guessed liability. */
  taxPolicy: jsonb("tax_policy").$type<{
    liability: "platform" | "seller";
    profileId: string;
    profileVersion: number;
    evidenceDigest: string;
  }>().notNull(),
  createdAt: createdAtColumn(),
}, (t) => [
  index("invoice_merchant_collections_invoice_idx").on(t.invoiceId),
  check("invoice_merchant_collections_kind", sql`${t.collectionKind} in ('platform','direct','destination')`),
  check("invoice_merchant_collections_platform", sql`${t.providerPlatformAccountId} ~ '^acct_[A-Za-z0-9]+$'`),
  check("invoice_merchant_collections_accounts", sql`(
    ${t.collectionKind} = 'platform' and ${t.chargeAccountId} is null and ${t.recipientAccountId} is null and ${t.settlementMerchantAccountId} is null
  ) or (
    ${t.collectionKind} = 'direct' and ${t.chargeAccountId} is not null and ${t.recipientAccountId} is not null and ${t.settlementMerchantAccountId} is not null
    and ${t.chargeAccountId} ~ '^acct_[A-Za-z0-9]+$' and ${t.chargeAccountId} <> ${t.providerPlatformAccountId}
    and ${t.recipientAccountId} = ${t.chargeAccountId} and ${t.settlementMerchantAccountId} = ${t.chargeAccountId}
  ) or (
    ${t.collectionKind} = 'destination' and ${t.chargeAccountId} is null and ${t.recipientAccountId} is not null and ${t.settlementMerchantAccountId} is not null and ${t.recipientAccountId} ~ '^acct_[A-Za-z0-9]+$'
    and ${t.recipientAccountId} <> ${t.providerPlatformAccountId} and ${t.settlementMerchantAccountId} = ${t.recipientAccountId}
  )`),
  check("invoice_merchant_collections_identity", sql`char_length(${t.merchantName}) between 1 and 200 and (${t.merchantSupport} is null or jsonb_typeof(${t.merchantSupport}) = 'object')`),
  check("invoice_merchant_collections_tax_policy", sql`(jsonb_typeof(${t.taxPolicy}) = 'object' and ${t.taxPolicy} ?& array['liability','profileId','profileVersion','evidenceDigest'] and ${t.taxPolicy}->>'liability' in ('platform','seller') and ${t.taxPolicy}->>'profileId' is not null and (${t.taxPolicy}->>'profileVersion')::integer > 0 and ${t.taxPolicy}->>'evidenceDigest' ~ '^[0-9a-f]{64}$') is true`),
]);

/** A single charge can collect only one frozen original allocation. */
export const merchantPaymentRoutes = pgTable("merchant_payment_routes", {
  paymentId: uuid("payment_id").primaryKey().references(() => payments.id, { onDelete: "restrict" }),
  allocationId: uuid("allocation_id").notNull().references(() => invoiceMerchantCollections.allocationId, { onDelete: "restrict" }),
  applicationFeeMinor: bigint("application_fee_minor", { mode: "number" }).notNull(),
  createdAt: createdAtColumn(),
}, (t) => [
  index("merchant_payment_routes_allocation_idx").on(t.allocationId),
  check("merchant_payment_routes_fee", sql`${t.applicationFeeMinor} >= 0`),
]);

/** Append-only provider facts survive a later allocation/settlement disagreement. */
export const merchantPaymentObservations = pgTable("merchant_payment_observations", {
  id: uuid("id").primaryKey().defaultRandom(),
  paymentId: uuid("payment_id").notNull().references(() => payments.id, { onDelete: "restrict" }),
  providerEventRef: text("provider_event_ref").notNull(),
  providerApiVersion: text("provider_api_version"),
  providerRef: text("provider_ref").notNull(),
  status: text("status", { enum: ["pending", "succeeded", "failed"] }).notNull(),
  amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
  currency: text("currency").notNull(),
  providerPlatformAccountId: text("provider_platform_account_id").notNull(),
  chargeAccountId: text("charge_account_id"),
  recipientAccountId: text("recipient_account_id"),
  settlementMerchantAccountId: text("settlement_merchant_account_id"),
  applicationFeeMinor: bigint("application_fee_minor", { mode: "number" }),
  providerChargeRef: text("provider_charge_ref"),
  applicationFeeRef: text("application_fee_ref"),
  transferRef: text("transfer_ref"),
  routeVerified: boolean("route_verified").notNull().default(false),
  customerChargeVerified: boolean("customer_charge_verified").notNull().default(false),
  applicationFeeCurrency: text("application_fee_currency"),
  observedApplicationFeeMinor: bigint("observed_application_fee_minor", { mode: "number" }),
  observedFeeRefundedMinor: bigint("observed_fee_refunded_minor", { mode: "number" }),
  settlementVerified: boolean("settlement_verified").notNull().default(false),
  observedAt: createdAtColumn(),
}, (t) => [
  uniqueIndex("merchant_payment_observations_event_idx").on(t.paymentId, t.providerEventRef),
  index("merchant_payment_observations_payment_idx").on(t.paymentId, t.observedAt),
  check("merchant_payment_observations_status", sql`${t.status} in ('pending','succeeded','failed')`),
  check("merchant_payment_observations_amount", sql`${t.amountMinor} >= 0 and (${t.applicationFeeMinor} is null or ${t.applicationFeeMinor} >= 0)`),
  check("merchant_payment_observations_currency", sql`${t.currency} ~ '^[A-Z]{3}$'`),
]);

/** Minimal original money evidence also survives an as-yet-unmatched attempt. */
export const merchantPaymentEventReceipts = pgTable("merchant_payment_event_receipts", {
  id: uuid("id").primaryKey().defaultRandom(),
  providerPlatformAccountId: text("provider_platform_account_id").notNull(),
  chargeAccountId: text("charge_account_id"),
  providerEventRef: text("provider_event_ref").notNull(),
  // This is a provider assertion, not an adopted payment ownership FK.
  claimedPaymentId: uuid("claimed_payment_id"),
  evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull(),
  receivedAt: createdAtColumn(),
}, t => [
  uniqueIndex("merchant_payment_event_receipts_event_idx").on(t.providerPlatformAccountId, sql`coalesce(${t.chargeAccountId}, '')`, t.providerEventRef),
  check("merchant_payment_event_receipts_scope", sql`${t.providerPlatformAccountId} ~ '^acct_[A-Za-z0-9]+$' and (${t.chargeAccountId} is null or ${t.chargeAccountId} ~ '^acct_[A-Za-z0-9]+$')`),
  check("merchant_payment_event_receipts_evidence", sql`jsonb_typeof(${t.evidence}) = 'object'`),
]);

/** Independent exact commission outcome; never rewinds a customer refund. */
export const merchantFeeRefunds = pgTable("merchant_fee_refunds", {
  id: uuid("id").primaryKey().defaultRandom(),
  refundId: uuid("refund_id").references(() => refunds.id, { onDelete: "restrict" }),
  sourceKey: text("source_key").notNull(),
  purpose: text("purpose", { enum: ["customer_refund", "commission_reconciliation"] }).notNull(),
  originalChargeReceiptId: uuid("original_charge_receipt_id"),
  observedOriginalFeeMinor: bigint("observed_original_fee_minor", { mode: "number" }).notNull(),
  targetRetainedFeeMinor: bigint("target_retained_fee_minor", { mode: "number" }).notNull(),
  paymentId: uuid("payment_id").notNull().references(() => payments.id, { onDelete: "restrict" }),
  providerPlatformAccountId: text("provider_platform_account_id").notNull(),
  applicationFeeRef: text("application_fee_ref").notNull(),
  providerChargeRef: text("provider_charge_ref").notNull(),
  amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
  currency: text("currency").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  attemptNumber: integer("attempt_number").notNull().default(1),
  status: text("status", { enum: ["reserved", "dispatching", "accepted", "unknown", "refused"] }).notNull().default("reserved"),
  providerRef: text("provider_ref"),
  dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
}, (t) => [
  uniqueIndex("merchant_fee_refunds_source_attempt_idx").on(t.sourceKey, t.attemptNumber),
  uniqueIndex("merchant_fee_refunds_unresolved_idx").on(t.sourceKey).where(sql`${t.status} <> 'refused'`),
  uniqueIndex("merchant_fee_refunds_key_idx").on(t.idempotencyKey),
  uniqueIndex("merchant_fee_refunds_provider_ref_idx").on(t.providerPlatformAccountId, t.providerRef),
  check("merchant_fee_refunds_amount", sql`${t.amountMinor} > 0 and ${t.observedOriginalFeeMinor} >= ${t.amountMinor} and ${t.targetRetainedFeeMinor} >= 0`),
  check("merchant_fee_refunds_purpose", sql`(${t.purpose} = 'customer_refund' and ${t.refundId} is not null) or (${t.purpose} = 'commission_reconciliation' and ${t.refundId} is null)`),
  check("merchant_fee_refunds_attempt", sql`${t.attemptNumber} > 0`),
  check("merchant_fee_refunds_platform", sql`${t.providerPlatformAccountId} ~ '^acct_[A-Za-z0-9]+$'`),
  check("merchant_fee_refunds_currency", sql`${t.currency} ~ '^[A-Z]{3}$'`),
  check("merchant_fee_refunds_status", sql`${t.status} in ('reserved','dispatching','accepted','unknown','refused')`),
  check("merchant_fee_refunds_accepted", sql`${t.status} <> 'accepted' or (${t.providerRef} is not null and ${t.acceptedAt} is not null)`),
]);

/** Physical acknowledgements commit before a logical fee-operation transition. */
export const merchantFeeObservations = pgTable("merchant_fee_observations", {
  id: uuid("id").primaryKey().defaultRandom(),
  operationId: uuid("operation_id").notNull().references(() => merchantFeeRefunds.id, { onDelete: "restrict" }),
  providerRef: text("provider_ref").notNull(),
  applicationFeeRef: text("application_fee_ref").notNull(),
  amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
  currency: text("currency").notNull(),
  bindingVerified: boolean("binding_verified").notNull(),
  observedAt: createdAtColumn(),
}, t => [
  uniqueIndex("merchant_fee_observations_fact_idx").on(t.operationId, t.providerRef, t.applicationFeeRef, t.amountMinor, t.currency, t.bindingVerified),
  check("merchant_fee_observations_money", sql`${t.amountMinor} >= 0 and ${t.currency} ~ '^[A-Z]{3}$'`),
]);
