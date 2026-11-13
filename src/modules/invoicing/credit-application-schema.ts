// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C9.33/C12.38: issued noncash credit has original principal and exact independent disposition.
import { sql } from "drizzle-orm";
import { bigint, check, index, pgTable, text, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { createdAtColumn } from "@/core/db/columns";
import { creditNoteLines, creditNotes, invoices, payments } from "./schema";
export const invoiceCreditFunding = pgTable("invoice_credit_funding", {
  id: uuid("id").primaryKey(), creditNoteId: uuid("credit_note_id").notNull().references(() => creditNotes.id, { onDelete: "restrict" }),
  creditNoteLineId: uuid("credit_note_line_id").notNull().references(() => creditNoteLines.id, { onDelete: "restrict" }),
  sourceInvoiceId: uuid("source_invoice_id").notNull().references(() => invoices.id, { onDelete: "restrict" }),
  sourcePaymentId: uuid("source_payment_id").notNull().references(() => payments.id, { onDelete: "restrict" }),
  sourceApplicationId: uuid("source_application_id").references((): AnyPgColumn => invoiceCreditApplications.reservationId, { onDelete: "restrict" }),
  prorationId: uuid("proration_id").notNull(), amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
  originalEvidenceDigest: text("original_evidence_digest").notNull(), createdAt: createdAtColumn(),
}, t => [index("invoice_credit_funding_note").on(t.creditNoteId), index("invoice_credit_funding_payment").on(t.sourcePaymentId), index("invoice_credit_funding_origin").on(t.prorationId),
  check("invoice_credit_funding_amount", sql`${t.amountMinor} between 1 and 9007199254740991 and ${t.originalEvidenceDigest} ~ '^[a-f0-9]{64}$'`)]);
export const invoiceCreditReservations = pgTable("invoice_credit_reservations", {
  id: uuid("id").primaryKey(), fundingId: uuid("funding_id").notNull().references(() => invoiceCreditFunding.id, { onDelete: "restrict" }),
  targetSourceId: text("target_source_id").notNull(), amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
  idempotencyKey: text("idempotency_key").notNull(), requestDigest: text("request_digest").notNull(), createdAt: createdAtColumn(),
}, t => [uniqueIndex("invoice_credit_reservations_key").on(t.idempotencyKey), index("invoice_credit_reservations_funding").on(t.fundingId), index("invoice_credit_reservations_source").on(t.targetSourceId),
  check("invoice_credit_reservations_amount", sql`${t.amountMinor} between 1 and 9007199254740991 and ${t.requestDigest} ~ '^[a-f0-9]{64}$'`)]);
export const invoiceCreditApplications = pgTable("invoice_credit_applications", {
  reservationId: uuid("reservation_id").primaryKey().references(() => invoiceCreditReservations.id, { onDelete: "restrict" }),
  invoiceId: uuid("invoice_id").notNull().references(() => invoices.id, { onDelete: "restrict" }),
  originalOwnerDigest: text("original_owner_digest").notNull(), createdAt: createdAtColumn(),
}, t => [index("invoice_credit_applications_invoice").on(t.invoiceId), check("invoice_credit_applications_owner", sql`${t.originalOwnerDigest} ~ '^[a-f0-9]{64}$'`)]);
export const invoiceCreditReleases = pgTable("invoice_credit_releases", {
  reservationId: uuid("reservation_id").primaryKey().references(() => invoiceCreditReservations.id, { onDelete: "restrict" }),
  reviewedBy: text("reviewed_by").notNull(), reasonDigest: text("reason_digest").notNull(), createdAt: createdAtColumn(),
}, t => [check("invoice_credit_releases_actor", sql`${t.reviewedBy} ~ '^(user:|agent:|system$)' and ${t.reasonDigest} ~ '^[a-f0-9]{64}$'`)]);
