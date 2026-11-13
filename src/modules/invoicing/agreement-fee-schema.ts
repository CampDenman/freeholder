// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C9.33: bounded original commission assignments, not general bookkeeping.
import { sql } from "drizzle-orm";
import { bigint, check, foreignKey, index, integer, jsonb, pgTable, text, timestamp, unique, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { createdAtColumn } from "@/core/db/columns";
import { invoices, payments } from "./schema";
import { merchantTaxProfiles, merchantTaxProfileVersions } from "./merchant-tax-schema";
import { invoiceCreditApplications } from "./credit-application-schema";

export const agreementFeeDuties = pgTable("agreement_fee_duties", {
  invoiceId: uuid("invoice_id").primaryKey().references(() => invoices.id, { onDelete: "restrict" }),
  acceptanceId: uuid("acceptance_id").notNull(), // Exact subscription_prorations FK is in the owned SQL tail; no schema import cycle.
  merchantProfileId: uuid("merchant_profile_id").notNull().references(() => merchantTaxProfiles.id, { onDelete: "restrict" }), profileVersion: integer("profile_version").notNull(),
  currency: text("currency").notNull(), totalMinor: bigint("total_minor", { mode: "number" }).notNull(), targetFeeMinor: bigint("target_fee_minor", { mode: "number" }).notNull(),
  creditedMinor: bigint("credited_minor", { mode: "number" }).notNull(), carriedFeeMinor: bigint("carried_fee_minor", { mode: "number" }).notNull(),
  cashPrincipalMinor: bigint("cash_principal_minor", { mode: "number" }).notNull(), cashFeeTargetMinor: bigint("cash_fee_target_minor", { mode: "number" }).notNull(),
  expectedReceivableMinor: bigint("expected_receivable_minor", { mode: "number" }).notNull(), acceptedQuoteDigest: text("accepted_quote_digest").notNull(),
  originalOwnerDigest: text("original_owner_digest").notNull(), createdAt: createdAtColumn(),
}, t => [unique("agreement_fee_duties_acceptance_id_key").on(t.acceptanceId), index("agreement_fee_duties_merchant").on(t.merchantProfileId),
  foreignKey({ name: "agreement_fee_duties_profile_version", columns: [t.merchantProfileId, t.profileVersion], foreignColumns: [merchantTaxProfileVersions.profileId, merchantTaxProfileVersions.version] }).onDelete("restrict"),
  check("agreement_fee_duties_amounts", sql`${t.totalMinor} between 1 and 9007199254740991 and ${t.targetFeeMinor} between 0 and ${t.totalMinor} and ${t.creditedMinor} between 0 and ${t.totalMinor} and ${t.carriedFeeMinor} between 0 and ${t.creditedMinor} and ${t.cashPrincipalMinor}=${t.totalMinor}-${t.creditedMinor} and ${t.cashFeeTargetMinor}=least(${t.cashPrincipalMinor},greatest(0,${t.targetFeeMinor}-${t.carriedFeeMinor})) and ${t.expectedReceivableMinor}=greatest(0,${t.targetFeeMinor}-${t.carriedFeeMinor}-${t.cashFeeTargetMinor})`),
  check("agreement_fee_duties_owner", sql`${t.currency} ~ '^[A-Z]{3}$' and ${t.profileVersion}>0 and ${t.acceptedQuoteDigest} ~ '^[a-f0-9]{64}$' and ${t.originalOwnerDigest} ~ '^[a-f0-9]{64}$'`)]);
export const agreementFeeCreditAssignments = pgTable("agreement_fee_credit_assignments", {
  applicationId: uuid("application_id").primaryKey().references(() => invoiceCreditApplications.reservationId, { onDelete: "restrict" }),
  invoiceId: uuid("invoice_id").notNull().references(() => agreementFeeDuties.invoiceId, { onDelete: "restrict" }),
  amountMinor: bigint("amount_minor", { mode: "number" }).notNull(), feeObligationMinor: bigint("fee_obligation_minor", { mode: "number" }).notNull(),
  provenCollectedMinor: bigint("proven_collected_minor", { mode: "number" }).notNull(), originalEvidenceDigest: text("original_evidence_digest").notNull(), createdAt: createdAtColumn(),
}, t => [index("agreement_fee_credit_assignments_invoice").on(t.invoiceId), check("agreement_fee_credit_assignments_amounts", sql`${t.amountMinor} between 1 and 9007199254740991 and ${t.feeObligationMinor} between 0 and ${t.amountMinor} and ${t.provenCollectedMinor} between 0 and ${t.feeObligationMinor} and ${t.originalEvidenceDigest} ~ '^[a-f0-9]{64}$'`)]);
export const agreementFeeCashAssignments = pgTable("agreement_fee_cash_assignments", {
  paymentId: uuid("payment_id").primaryKey().references(() => payments.id, { onDelete: "restrict" }), invoiceId: uuid("invoice_id").notNull().references(() => agreementFeeDuties.invoiceId, { onDelete: "restrict" }),
  amountMinor: bigint("amount_minor", { mode: "number" }).notNull(), feeObligationMinor: bigint("fee_obligation_minor", { mode: "number" }).notNull(),
  origin: text("origin", { enum: ["recorded_external", "provider"] }).notNull(), originalEvidenceDigest: text("original_evidence_digest").notNull(), createdAt: createdAtColumn(),
}, t => [index("agreement_fee_cash_assignments_invoice").on(t.invoiceId), check("agreement_fee_cash_assignments_amounts", sql`${t.amountMinor} between 1 and 9007199254740991 and ${t.feeObligationMinor} between 0 and ${t.amountMinor} and ${t.origin} in('recorded_external','provider') and ${t.originalEvidenceDigest} ~ '^[a-f0-9]{64}$'`)]);
export const agreementFeeEligibility = pgTable("agreement_fee_eligibility", {
  invoiceId: uuid("invoice_id").primaryKey().references(() => agreementFeeDuties.invoiceId, { onDelete: "restrict" }),
  paidAt: timestamp("paid_at", { withTimezone: true }).notNull(), principalEvidenceDigest: text("principal_evidence_digest").notNull(),
  cashPaymentIds: jsonb("cash_payment_ids").$type<string[]>().notNull(), creditApplicationIds: jsonb("credit_application_ids").$type<string[]>().notNull(), createdAt: createdAtColumn(),
}, t => [check("agreement_fee_eligibility_evidence", sql`${t.principalEvidenceDigest} ~ '^[a-f0-9]{64}$' and jsonb_typeof(${t.cashPaymentIds})='array' and jsonb_array_length(${t.cashPaymentIds})<=1000 and jsonb_typeof(${t.creditApplicationIds})='array' and jsonb_array_length(${t.creditApplicationIds})<=1000`)]);
export const agreementFeeRemittances = pgTable("agreement_fee_remittances", {
  id: uuid("id").primaryKey(), invoiceId: uuid("invoice_id").notNull().references(() => agreementFeeDuties.invoiceId, { onDelete: "restrict" }),
  direction: text("direction", { enum: ["remitted", "returned"] }).notNull(), originalRemittanceId: uuid("original_remittance_id").references((): AnyPgColumn => agreementFeeRemittances.id, { onDelete: "restrict" }),
  amountMinor: bigint("amount_minor", { mode: "number" }).notNull(), currency: text("currency").notNull(),
  recordedBy: text("recorded_by").notNull(), evidenceDigest: text("evidence_digest").notNull(), requestDigest: text("request_digest").notNull(), idempotencyKey: text("idempotency_key").notNull(), createdAt: createdAtColumn(),
}, t => [index("agreement_fee_remittances_invoice").on(t.invoiceId), unique("agreement_fee_remittances_idempotency_key_key").on(t.idempotencyKey),
  check("agreement_fee_remittances_amounts", sql`${t.amountMinor} between 1 and 9007199254740991 and ${t.currency} ~ '^[A-Z]{3}$'`),
  check("agreement_fee_remittances_original", sql`(${t.direction}='remitted' and ${t.originalRemittanceId} is null) or (${t.direction}='returned' and ${t.originalRemittanceId} is not null)`),
  check("agreement_fee_remittances_evidence", sql`${t.recordedBy} ~ '^(user:|agent:|plugin:|system$)' and ${t.evidenceDigest} ~ '^[a-f0-9]{64}$' and ${t.requestDigest} ~ '^[a-f0-9]{64}$'`)]);
