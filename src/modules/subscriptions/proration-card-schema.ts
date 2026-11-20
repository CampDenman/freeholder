// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C9.33/C12.38: actual card mandate/attempt and independent original GET receipts.
import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAtColumn } from "@/core/db/columns";
import type { OffSessionChargeRequest } from "@/adapters/payments";
import { invoices, paymentMethods, payments } from "@/modules/invoicing/schema";
import { subscriptionProrations } from "./proration-schema";
import { merchantPaymentRequests } from "@/modules/invoicing/merchant-payment-recovery-schema";
import type { ProrationCardMethod } from "./proration-card-contract";
import type { ProviderReadSignedProof } from "./provider-read-signatures";
export const subscriptionProrationPaymentProtocols = pgTable("subscription_proration_payment_protocols", {
  paymentId: uuid("payment_id").primaryKey().references(() => merchantPaymentRequests.paymentId, { onDelete: "restrict" }), prorationId: uuid("proration_id").notNull().references(() => subscriptionProrations.id, { onDelete: "restrict" }),
  invoiceId: uuid("invoice_id").notNull().references(() => invoices.id, { onDelete: "restrict" }),
  providerApiVersion: text("provider_api_version", { enum: ["2026-02-25.clover", "2026-10-28.endive"] }).notNull(), createdAt: createdAtColumn(),
}, t => [index("subscription_proration_payment_protocols_parent").on(t.prorationId), check("subscription_proration_payment_protocols_version", sql`${t.providerApiVersion} in('2026-02-25.clover','2026-10-28.endive')`)]);
export const subscriptionProrationCardMandates = pgTable("subscription_proration_card_mandates", {
  prorationId: uuid("proration_id").primaryKey().references(() => subscriptionProrations.id, { onDelete: "restrict" }),
  invoiceId: uuid("invoice_id").notNull().references(() => invoices.id, { onDelete: "restrict" }), paymentMethodId: uuid("payment_method_id").notNull().references(() => paymentMethods.id, { onDelete: "restrict" }),
  method: jsonb("method").$type<ProrationCardMethod>().notNull(), methodDigest: text("method_digest").notNull(), acceptedQuoteDigest: text("accepted_quote_digest").notNull(),
  createdAt: createdAtColumn(),
}, t => [uniqueIndex("subscription_proration_card_mandates_invoice").on(t.invoiceId), check("subscription_proration_card_mandates_digest", sql`${t.methodDigest} ~ '^[a-f0-9]{64}$' and ${t.acceptedQuoteDigest} ~ '^[a-f0-9]{64}$' and jsonb_typeof(${t.method})='object'`)]);
export const subscriptionProrationCardAttempts = pgTable("subscription_proration_card_attempts", {
  paymentId: uuid("payment_id").primaryKey().references(() => payments.id, { onDelete: "restrict" }), prorationId: uuid("proration_id").notNull().references(() => subscriptionProrationCardMandates.prorationId, { onDelete: "restrict" }),
  invoiceId: uuid("invoice_id").notNull().references(() => invoices.id, { onDelete: "restrict" }), providerRequest: jsonb("provider_request").$type<OffSessionChargeRequest>().notNull(), requestDigest: text("request_digest").notNull(), createdAt: createdAtColumn(),
}, t => [uniqueIndex("subscription_proration_card_attempts_original").on(t.prorationId), index("subscription_proration_card_attempts_invoice").on(t.invoiceId), check("subscription_proration_card_attempts_digest", sql`${t.requestDigest} ~ '^[a-f0-9]{64}$' and jsonb_typeof(${t.providerRequest})='object'`)]);
export const subscriptionProrationCardJobs = pgTable("subscription_proration_card_jobs", {
  prorationId: uuid("proration_id").primaryKey().references(() => subscriptionProrationCardMandates.prorationId, { onDelete: "restrict" }), jobId: uuid("job_id").notNull(),
  originalTask: jsonb("original_task").$type<{ prorationId: string; originalJobId: string; acceptedQuoteDigest: string }>().notNull(), claimDigest: text("claim_digest").notNull(), createdAt: createdAtColumn(),
}, t => [uniqueIndex("subscription_proration_card_jobs_job").on(t.jobId), check("subscription_proration_card_jobs_digest", sql`${t.claimDigest} ~ '^[a-f0-9]{64}$' and jsonb_typeof(${t.originalTask})='object'`)]);
export const subscriptionProrationCardReads = pgTable("subscription_proration_card_reads", {
  id: uuid("id").primaryKey(), paymentId: uuid("payment_id").notNull().references(() => payments.id, { onDelete: "restrict" }),
  admission: jsonb("admission").$type<ProviderReadSignedProof>().notNull(), admissionDigest: text("admission_digest").notNull(), createdAt: createdAtColumn(),
}, t => [index("subscription_proration_card_reads_payment").on(t.paymentId), check("subscription_proration_card_reads_digest", sql`${t.admissionDigest} ~ '^[a-f0-9]{64}$' and jsonb_typeof(${t.admission})='object'`)]);
export const subscriptionProrationCardReadFinishes = pgTable("subscription_proration_card_read_finishes", {
  readId: uuid("read_id").primaryKey().references(() => subscriptionProrationCardReads.id, { onDelete: "restrict" }), proof: jsonb("proof").$type<ProviderReadSignedProof>().notNull(), proofDigest: text("proof_digest").notNull(),
  actualResult: jsonb("actual_result").$type<Record<string, unknown>>().notNull(), createdAt: createdAtColumn(),
}, t => [check("subscription_proration_card_read_finishes_digest", sql`${t.proofDigest} ~ '^[a-f0-9]{64}$' and jsonb_typeof(${t.proof})='object' and jsonb_typeof(${t.actualResult})='object'`)]);
export const subscriptionProrationCardReadStops = pgTable("subscription_proration_card_read_stops", {
  readId: uuid("read_id").primaryKey().references(() => subscriptionProrationCardReads.id, { onDelete: "restrict" }), proof: jsonb("proof").$type<ProviderReadSignedProof>().notNull(), proofDigest: text("proof_digest").notNull(), createdAt: createdAtColumn(),
}, t => [check("subscription_proration_card_read_stops_digest", sql`${t.proofDigest} ~ '^[a-f0-9]{64}$' and jsonb_typeof(${t.proof})='object'`)]);
