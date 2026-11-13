// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C9.33: recorded external principal is distinct from independently verified bank money.
import { sql } from "drizzle-orm";
import { bigint, check, foreignKey, index, integer, pgTable, text, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { createdAtColumn } from "@/core/db/columns";
import { invoices, payments, refunds } from "./schema";
import { merchantTaxProfiles, merchantTaxProfileVersions } from "./merchant-tax-schema";
export const commercialPaymentAttestations = pgTable("commercial_payment_attestations", {
  paymentId: uuid("payment_id").primaryKey().references(() => payments.id, { onDelete: "restrict" }),
  invoiceId: uuid("invoice_id").notNull().references(() => invoices.id, { onDelete: "restrict" }),
  merchantProfileId: uuid("merchant_profile_id").notNull().references(() => merchantTaxProfiles.id, { onDelete: "restrict" }), profileVersion: integer("profile_version").notNull(),
  currency: text("currency").notNull(), amountMinor: bigint("amount_minor", { mode: "number" }).notNull(), feeOwedMinor: bigint("fee_owed_minor", { mode: "number" }).notNull(),
  originalOwnerDigest: text("original_owner_digest").notNull(), evidenceDigest: text("evidence_digest").notNull(), referenceDigest: text("reference_digest").notNull(),
  recordedBy: text("recorded_by").notNull(), createdAt: createdAtColumn(),
}, t => [index("commercial_payment_attestations_invoice").on(t.invoiceId), index("commercial_payment_attestations_merchant").on(t.merchantProfileId),
  foreignKey({ name: "commercial_payment_attestations_version", columns: [t.merchantProfileId, t.profileVersion], foreignColumns: [merchantTaxProfileVersions.profileId, merchantTaxProfileVersions.version] }).onDelete("restrict"),
  check("commercial_payment_attestations_amounts", sql`${t.amountMinor} between 1 and 9007199254740991 and ${t.feeOwedMinor} between 0 and ${t.amountMinor} and ${t.currency} ~ '^[A-Z]{3}$' and ${t.profileVersion}>0`),
  check("commercial_payment_attestations_evidence", sql`${t.originalOwnerDigest} ~ '^[a-f0-9]{64}$' and ${t.evidenceDigest} ~ '^[a-f0-9]{64}$' and ${t.referenceDigest} ~ '^[a-f0-9]{64}$' and ${t.recordedBy} ~ '^(user:|agent:|plugin:|system$)'`)]);
export const commercialRefundAttestations = pgTable("commercial_refund_attestations", {
  refundId: uuid("refund_id").primaryKey().references(() => refunds.id, { onDelete: "restrict" }), paymentId: uuid("payment_id").notNull().references(() => commercialPaymentAttestations.paymentId, { onDelete: "restrict" }),
  amountMinor: bigint("amount_minor", { mode: "number" }).notNull(), currency: text("currency").notNull(), evidenceDigest: text("evidence_digest").notNull(), recordedBy: text("recorded_by").notNull(), createdAt: createdAtColumn(),
}, t => [index("commercial_refund_attestations_payment").on(t.paymentId), check("commercial_refund_attestations_evidence", sql`${t.amountMinor} between 1 and 9007199254740991 and ${t.currency} ~ '^[A-Z]{3}$' and ${t.evidenceDigest} ~ '^[a-f0-9]{64}$' and ${t.recordedBy} ~ '^(user:|agent:|plugin:|system$)'`)]);
export const commercialFeeAttestations = pgTable("commercial_fee_attestations", {
  id: uuid("id").primaryKey(), paymentId: uuid("payment_id").notNull().references(() => commercialPaymentAttestations.paymentId, { onDelete: "restrict" }),
  direction: text("direction", { enum: ["remitted", "returned"] }).notNull(), originalRemittanceId: uuid("original_remittance_id").references((): AnyPgColumn => commercialFeeAttestations.id, { onDelete: "restrict" }),
  amountMinor: bigint("amount_minor", { mode: "number" }).notNull(), idempotencyKey: text("idempotency_key").notNull(), evidenceDigest: text("evidence_digest").notNull(), requestDigest: text("request_digest").notNull(),
  recordedBy: text("recorded_by").notNull(), createdAt: createdAtColumn(),
}, t => [index("commercial_fee_attestations_payment").on(t.paymentId), index("commercial_fee_attestations_original").on(t.originalRemittanceId), uniqueIndex("commercial_fee_attestations_key").on(t.idempotencyKey), check("commercial_fee_attestations_evidence", sql`${t.amountMinor} between 1 and 9007199254740991 and ${t.evidenceDigest} ~ '^[a-f0-9]{64}$' and ${t.requestDigest} ~ '^[a-f0-9]{64}$' and ${t.recordedBy} ~ '^(user:|agent:|plugin:|system$)'`),
  check("commercial_fee_attestations_direction", sql`(${t.direction}='remitted' and ${t.originalRemittanceId} is null) or (${t.direction}='returned' and ${t.originalRemittanceId} is not null)`)]);
