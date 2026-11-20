// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C9.33/C12.38: actual database retention time, never PI creation or supplied paidAt.
import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { invoices, payments } from "@/modules/invoicing/schema";
import { merchantPaymentObservations } from "@/modules/invoicing/merchant-collection-schema";
import { commercialPaymentAttestations } from "@/modules/invoicing/commercial-attestation-schema";
import { invoiceCreditApplications } from "@/modules/invoicing/credit-application-schema";
import { subscriptionProrations } from "./proration-schema";
export const subscriptionProrationCashConfirmations = pgTable("subscription_proration_cash_confirmations", {
  paymentId: uuid("payment_id").primaryKey().references(() => payments.id, { onDelete: "restrict" }),
  prorationId: uuid("proration_id").notNull().references(() => subscriptionProrations.id, { onDelete: "restrict" }),
  invoiceId: uuid("invoice_id").notNull().references(() => invoices.id, { onDelete: "restrict" }),
  providerObservationId: uuid("provider_observation_id").references(() => merchantPaymentObservations.id, { onDelete: "restrict" }),
  externalAttestationId: uuid("external_attestation_id").references(() => commercialPaymentAttestations.paymentId, { onDelete: "restrict" }),
  retainedAt: timestamp("retained_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  originalEvidenceDigest: text("original_evidence_digest").notNull(),
}, t => [index("subscription_proration_cash_confirmations_parent").on(t.prorationId),
  check("subscription_proration_cash_confirmations_origin", sql`(${t.providerObservationId} is null)<>(${t.externalAttestationId} is null)`),
  check("subscription_proration_cash_confirmations_digest", sql`${t.originalEvidenceDigest} ~ '^[a-f0-9]{64}$'`)]);
export const subscriptionProrationCreditConfirmations = pgTable("subscription_proration_credit_confirmations", {
  applicationId: uuid("application_id").primaryKey().references(() => invoiceCreditApplications.reservationId, { onDelete: "restrict" }),
  prorationId: uuid("proration_id").notNull().references(() => subscriptionProrations.id, { onDelete: "restrict" }),
  invoiceId: uuid("invoice_id").notNull().references(() => invoices.id, { onDelete: "restrict" }),
  retainedAt: timestamp("retained_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`), originalEvidenceDigest: text("original_evidence_digest").notNull(),
}, t => [index("subscription_proration_credit_confirmations_parent").on(t.prorationId),
  check("subscription_proration_credit_confirmations_digest", sql`${t.originalEvidenceDigest} ~ '^[a-f0-9]{64}$'`)]);
