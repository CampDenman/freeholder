// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: provider request identity survives CRM repointing and lost responses.
import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAtColumn } from "@/core/db/columns";
import { payments } from "./schema";

export const merchantPaymentRequests = pgTable("merchant_payment_requests", {
  paymentId: uuid("payment_id").primaryKey().references(() => payments.id, { onDelete: "restrict" }),
  providerInvoiceRef: uuid("provider_invoice_ref").notNull(),
  // This exact opaque metadata value is not a mutable contact owner or FK.
  // Current authorization and privacy still follow payment.invoice.contact.
  providerContactRef: uuid("provider_contact_ref").notNull(),
  requestDigest: text("request_digest").notNull(),
  createdAt: createdAtColumn(),
}, t => [check("merchant_payment_requests_digest", sql`${t.requestDigest} ~ '^[a-f0-9]{64}$'`)]);

export const merchantPaymentRetirementAcks = pgTable("merchant_payment_retirement_acks", {
  id: uuid("id").primaryKey().defaultRandom(),
  paymentId: uuid("payment_id").notNull().references(() => merchantPaymentRequests.paymentId, { onDelete: "restrict" }),
  checkoutRef: text("checkout_ref"), paymentRef: text("payment_ref"),
  kind: text("kind", { enum: ["session_expired", "intent_canceled"] }).notNull(),
  evidenceDigest: text("evidence_digest").notNull(), observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [index("merchant_payment_retirement_acks_payment_idx").on(t.paymentId), uniqueIndex("merchant_payment_retirement_acks_evidence_idx").on(t.paymentId, t.evidenceDigest),
  check("merchant_payment_retirement_acks_kind", sql`${t.kind} in ('session_expired','intent_canceled')`),
  check("merchant_payment_retirement_acks_refs", sql`((${t.checkoutRef} is null or ${t.checkoutRef} ~ '^cs_[A-Za-z0-9_]+$') and (${t.paymentRef} is null or ${t.paymentRef} ~ '^pi_[A-Za-z0-9_]+$') and ((${t.kind}='session_expired' and ${t.checkoutRef} is not null) or (${t.kind}='intent_canceled' and ${t.paymentRef} is not null))) is true`)]);

export const merchantPaymentDispatches = pgTable("merchant_payment_dispatches", {
  id: uuid("id").primaryKey().defaultRandom(), paymentId: uuid("payment_id").notNull().references(() => merchantPaymentRequests.paymentId, { onDelete: "restrict" }),
  ordinal: integer("ordinal").notNull(), requestDigest: text("request_digest").notNull(), dispatchedAt: timestamp("dispatched_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex("merchant_payment_dispatches_ordinal_idx").on(t.paymentId, t.ordinal), check("merchant_payment_dispatches_ordinal", sql`${t.ordinal}>0`), check("merchant_payment_dispatches_digest", sql`${t.requestDigest} ~ '^[a-f0-9]{64}$'`)]);

export const merchantPaymentCreationRefusals = pgTable("merchant_payment_creation_refusals", {
  dispatchId: uuid("dispatch_id").primaryKey().references(() => merchantPaymentDispatches.id, { onDelete: "restrict" }),
  providerCode: text("provider_code").notNull(), observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
});

export const merchantPaymentTerminalReceipts = pgTable("merchant_payment_terminal_receipts", {
  paymentId: uuid("payment_id").primaryKey().references(() => merchantPaymentRequests.paymentId, { onDelete: "restrict" }),
  checkoutRef: text("checkout_ref"), paymentRef: text("payment_ref"),
  sessionStatus: text("session_status", { enum: ["expired", "complete"] }),
  amountReceivedMinor: integer("amount_received_minor").notNull(),
  intentStatus: text("intent_status"), observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [check("merchant_payment_terminal_receipts_terminal", sql`(${t.amountReceivedMinor}=0 and ((${t.checkoutRef} is null and ${t.sessionStatus} is null and ${t.paymentRef} is not null and ${t.intentStatus}='canceled') or (${t.checkoutRef} is not null and ((${t.sessionStatus}='expired' and ((${t.paymentRef} is null and ${t.intentStatus} is null) or (${t.paymentRef} is not null and ${t.intentStatus} in ('canceled','requires_payment_method','requires_confirmation','requires_action')))) or (${t.sessionStatus}='complete' and ${t.paymentRef} is not null and ${t.intentStatus}='canceled'))))) is true`),
  check("merchant_payment_terminal_receipts_refs", sql`(${t.checkoutRef} is null or ${t.checkoutRef} ~ '^cs_[A-Za-z0-9_]+$') and (${t.paymentRef} is null or ${t.paymentRef} ~ '^pi_[A-Za-z0-9_]+$')`)]);
