// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C9.33/C9.38/C12.38: explicit accepted mid-cycle promises never rewrite earlier periods.
import { sql } from "drizzle-orm";
import { bigint, check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAtColumn } from "@/core/db/columns";
import { creditNotes, invoiceLines, invoices, payments } from "@/modules/invoicing/schema";
import { subscriptionCommercialTerms, plans, subscriptions } from "./schema";
import { subscriptionProviderGenerations } from "./provider-generation-schema";
import { invoiceCreditApplications } from "@/modules/invoicing/credit-application-schema";
import type { SubscriptionCommercialSnapshot } from "./merchant-terms-contract";
export const subscriptionProrations = pgTable("subscription_prorations", {
  id: uuid("id").primaryKey(), subscriptionId: uuid("subscription_id").notNull().references(() => subscriptions.id, { onDelete: "restrict" }),
  planId: uuid("plan_id").notNull().references(() => plans.id, { onDelete: "restrict" }),
  previousTermsId: uuid("previous_terms_id").references(() => subscriptionCommercialTerms.id, { onDelete: "restrict" }),
  termsId: uuid("terms_id").references(() => subscriptionCommercialTerms.id, { onDelete: "restrict" }),
  generationId: uuid("generation_id").references(() => subscriptionProviderGenerations.id, { onDelete: "restrict" }),
  snapshot: jsonb("snapshot").$type<SubscriptionCommercialSnapshot>().notNull(), acceptedQuoteDigest: text("accepted_quote_digest").notNull(), sourceRevision: text("source_revision").notNull(),
  acceptedBy: text("accepted_by").notNull(), effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull(),
  originalPeriodStart: timestamp("original_period_start", { withTimezone: true }).notNull(), originalPeriodEnd: timestamp("original_period_end", { withTimezone: true }).notNull(),
  originalTrialEndsAt: timestamp("original_trial_ends_at", { withTimezone: true }), proposedPeriodStart: timestamp("proposed_period_start", { withTimezone: true }).notNull(), proposedPeriodEnd: timestamp("proposed_period_end", { withTimezone: true }).notNull(),
  originalInvoiceId: uuid("original_invoice_id").references(() => invoices.id, { onDelete: "restrict" }), originalInvoiceLineId: uuid("original_invoice_line_id").references(() => invoiceLines.id, { onDelete: "restrict" }),
  debitInvoiceId: uuid("debit_invoice_id").references(() => invoices.id, { onDelete: "restrict" }), creditNoteId: uuid("credit_note_id").references(() => creditNotes.id, { onDelete: "restrict" }),
  debitNetMinor: bigint("debit_net_minor", { mode: "number" }).notNull(), debitTaxMinor: bigint("debit_tax_minor", { mode: "number" }).notNull(),
  creditNetMinor: bigint("credit_net_minor", { mode: "number" }).notNull(), creditTaxMinor: bigint("credit_tax_minor", { mode: "number" }).notNull(),
  originalJobId: uuid("original_job_id"), jobClaimDigest: text("job_claim_digest"),
  state: text("state", { enum: ["accepted", "preparing", "awaiting_invoice", "awaiting_payment", "applied", "cancelled", "review"] }).notNull(),
  operationRevision: integer("operation_revision").notNull().default(0), appliedAt: timestamp("applied_at", { withTimezone: true }), cancelledAt: timestamp("cancelled_at", { withTimezone: true }), createdAt: createdAtColumn(),
}, t => [index("subscription_prorations_parent").on(t.subscriptionId), index("subscription_prorations_terms").on(t.termsId), index("subscription_prorations_credit").on(t.creditNoteId),
  uniqueIndex("subscription_prorations_job").on(t.originalJobId),
  check("subscription_prorations_calendar", sql`${t.originalPeriodEnd}>${t.originalPeriodStart} and ${t.effectiveAt}>=${t.originalPeriodStart} and ${t.effectiveAt}<${t.originalPeriodEnd} and ${t.proposedPeriodEnd}>${t.proposedPeriodStart} and (${t.originalTrialEndsAt} is null or ${t.originalTrialEndsAt}=${t.originalPeriodEnd})`),
  check("subscription_prorations_amounts", sql`${t.debitNetMinor} between 0 and 9007199254740991 and ${t.debitTaxMinor} between 0 and 9007199254740991 and ${t.creditNetMinor} between 0 and 9007199254740991 and ${t.creditTaxMinor} between 0 and 9007199254740991 and (${t.originalTrialEndsAt} is null or (${t.debitNetMinor}=0 and ${t.debitTaxMinor}=0 and ${t.creditNetMinor}=0 and ${t.creditTaxMinor}=0))`),
  check("subscription_prorations_acceptance", sql`${t.acceptedQuoteDigest} ~ '^[a-f0-9]{64}$' and ${t.sourceRevision} ~ '^[a-f0-9]{64}$' and ${t.acceptedBy} ~ '^(user:|agent:|plugin:)' and ${t.operationRevision}>=0`),
  check("subscription_prorations_state", sql`${t.state} in ('accepted','preparing','awaiting_invoice','awaiting_payment','applied','cancelled','review') and (${t.state}<>'applied' or ${t.appliedAt} is not null) and (${t.state}<>'cancelled' or ${t.cancelledAt} is not null)`),
]);
export const subscriptionProrationPrincipal = pgTable("subscription_proration_principal", {
  id: uuid("id").primaryKey(), prorationId: uuid("proration_id").notNull().references(() => subscriptionProrations.id, { onDelete: "restrict" }),
  sourcePaymentId: uuid("source_payment_id").notNull().references(() => payments.id, { onDelete: "restrict" }), amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
  sourceApplicationId: uuid("source_application_id").references(() => invoiceCreditApplications.reservationId, { onDelete: "restrict" }),
  originalEvidenceDigest: text("original_evidence_digest").notNull(), createdAt: createdAtColumn(),
}, t => [uniqueIndex("subscription_proration_principal_payment").on(t.prorationId, t.sourcePaymentId, t.sourceApplicationId), check("subscription_proration_principal_amount", sql`${t.amountMinor} between 1 and 9007199254740991 and ${t.originalEvidenceDigest} ~ '^[a-f0-9]{64}$'`)]);
export const subscriptionProrationCreditUses = pgTable("subscription_proration_credit_uses", {
  id: uuid("id").primaryKey(), prorationId: uuid("proration_id").notNull().references(() => subscriptionProrations.id, { onDelete: "restrict" }),
  creditNoteId: uuid("credit_note_id").notNull().references(() => creditNotes.id, { onDelete: "restrict" }), amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
  expectedRevision: text("expected_revision").notNull(), createdAt: createdAtColumn(),
}, t => [uniqueIndex("subscription_proration_credit_uses_note").on(t.prorationId, t.creditNoteId), check("subscription_proration_credit_uses_amount", sql`${t.amountMinor} between 1 and 9007199254740991 and ${t.expectedRevision} ~ '^[a-f0-9]{64}$'`)]);
