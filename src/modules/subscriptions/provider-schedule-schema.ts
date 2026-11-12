// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: original remote schedules outlive local status and privacy projections.
import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";
import { dataRequests } from "@/core/privacy/schema";
import { merchantTaxProfiles } from "@/modules/invoicing/merchant-tax-schema";
import { subscriptionMerchantScopes } from "./schema";

export type ScheduleStopProof = {
  operationRevision: number;
  evidenceRevision: number;
  journalDigest: string;
  resources: Array<{ providerSubscriptionRef: string; providerState: "paused" | "cancelled"; invoiceEnumerationDigest: string;
    invoices: Array<{ providerInvoiceRef: string; state: "void" | "paid";
      cancelledIntentRefs: string[];
      paid: Array<{ providerPaymentIntentRef: string; receiptId: string; paymentId: string; invoiceId: string }>;
      zeroTotalInvoiceId?: string }> }>;
};
export const subscriptionProviderScheduleResources = pgTable("subscription_provider_schedule_resources", {
  subscriptionId: uuid("subscription_id").primaryKey().references(() => subscriptionMerchantScopes.subscriptionId, { onDelete: "restrict" }),
  providerSubscriptionRef: text("provider_subscription_ref"),
  providerCustomerRef: text("provider_customer_ref"),
  operationRevision: integer("operation_revision").notNull().default(0),
  evidenceRevision: integer("evidence_revision").notNull().default(0),
  state: text("state", { enum: ["uncreated", "active", "quiescing", "quiesced", "unknown"] }).notNull().default("uncreated"),
  stoppedProof: jsonb("stopped_proof").$type<ScheduleStopProof>(),
  recoveryPending: boolean("recovery_pending").notNull().default(false),
  createdAt: createdAtColumn(), updatedAt: updatedAtColumn(),
}, t => [
  check("subscription_schedule_resource_revision", sql`${t.operationRevision}>=0 and ${t.evidenceRevision}>=0`),
  check("subscription_schedule_resource_state", sql`${t.state} in ('uncreated','active','quiescing','quiesced','unknown')`),
  check("subscription_schedule_resource_stop", sql`${t.state}<>'quiesced' or (${t.stoppedProof} is not null and ${t.providerSubscriptionRef} is not null and ${t.providerCustomerRef} is not null and ${t.recoveryPending}=false)`),
]);

/** One durable intent per physical mutation; unknown never authorizes another POST. */
export const subscriptionProviderScheduleOperations = pgTable("subscription_provider_schedule_operations", {
  id: uuid("id").primaryKey().defaultRandom(),
  subscriptionId: uuid("subscription_id").notNull().references(() => subscriptionProviderScheduleResources.subscriptionId, { onDelete: "restrict" }),
  operationRevision: integer("operation_revision").notNull(),
  kind: text("kind", { enum: ["create", "update", "pause", "resume", "cancel", "void_invoice", "delete_draft"] }).notNull(),
  providerApiVersion: text("provider_api_version").notNull(),
  originalRequest: jsonb("original_request").$type<Record<string, unknown>>().notNull(),
  requestDigest: text("request_digest").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  state: text("state", { enum: ["running", "unknown", "confirmed", "refused"] }).notNull().default("running"),
  positiveObserved: boolean("positive_observed").notNull().default(false),
  providerObservation: jsonb("provider_observation").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAtColumn(), finishedAt: timestamp("finished_at", { withTimezone: true }),
}, t => [
  uniqueIndex("subscription_schedule_operations_revision").on(t.subscriptionId, t.operationRevision),
  uniqueIndex("subscription_schedule_operations_key").on(t.idempotencyKey),
  index("subscription_schedule_operations_resource").on(t.subscriptionId),
  check("subscription_schedule_operations_revision_check", sql`${t.operationRevision}>0`),
  check("subscription_schedule_operations_kind", sql`${t.kind} in ('create','update','pause','resume','cancel','void_invoice','delete_draft')`),
  check("subscription_schedule_operations_api", sql`${t.providerApiVersion}='2026-10-28.endive'`),
  check("subscription_schedule_operations_state", sql`${t.state} in ('running','unknown','confirmed','refused')`),
  check("subscription_schedule_operations_digest", sql`${t.requestDigest} ~ '^[a-f0-9]{64}$'`),
]);

/** The merchant may be erased independently of the people buying its plans. */
export const subscriptionProviderScheduleErasures = pgTable("subscription_provider_schedule_erasures", {
  id: uuid("id").primaryKey().defaultRandom(),
  profileId: uuid("profile_id").notNull().references(() => merchantTaxProfiles.id, { onDelete: "restrict" }),
  subscriptionId: uuid("subscription_id").references(() => subscriptionMerchantScopes.subscriptionId, { onDelete: "restrict" }),
  privacyScope: text("privacy_scope", { enum: ["commerce.merchantTax", "subscriptions.agreements"] }).notNull(),
  requestId: uuid("request_id").notNull().references(() => dataRequests.id, { onDelete: "restrict" }),
  originalJobId: uuid("original_job_id").notNull(),
  jobId: uuid("job_id").notNull(),
  jobKey: text("job_key").notNull(),
  jobIds: jsonb("job_ids").$type<string[]>().notNull(),
  state: text("state", { enum: ["pending", "completed"] }).notNull().default("pending"),
  createdAt: createdAtColumn(), completedAt: timestamp("completed_at", { withTimezone: true }),
}, t => [
  uniqueIndex("subscription_schedule_erasures_original").on(t.profileId, t.requestId, sql`coalesce(${t.subscriptionId}::text,'')`),
  index("subscription_schedule_erasures_profile").on(t.profileId),
  index("subscription_schedule_erasures_request").on(t.requestId),
  check("subscription_schedule_erasures_state", sql`${t.state} in ('pending','completed')`),
  check("subscription_schedule_erasures_scope", sql`(${t.privacyScope}='commerce.merchantTax' and ${t.subscriptionId} is null) or (${t.privacyScope}='subscriptions.agreements' and ${t.subscriptionId} is not null)`),
  check("subscription_schedule_erasures_complete", sql`${t.state}<>'completed' or ${t.completedAt} is not null`),
]);
