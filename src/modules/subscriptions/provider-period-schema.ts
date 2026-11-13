// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: normalized immutable actual invoice and line observations.
import { sql } from "drizzle-orm";
import { bigint, boolean, check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAtColumn } from "@/core/db/columns";
import { subscriptionCommercialTerms, subscriptions } from "./schema";
import { subscriptionProviderScheduleOperations } from "./provider-schedule-schema";
export const subscriptionProviderInvoiceObservations = pgTable("subscription_provider_invoice_observations", {
  id: uuid("id").primaryKey(), subscriptionId: uuid("subscription_id").notNull().references(() => subscriptions.id, { onDelete: "restrict" }),
  evidenceRevision: integer("evidence_revision").notNull(), evidenceDigest: text("evidence_digest").notNull(),
  providerOperationId: uuid("provider_operation_id").references(() => subscriptionProviderScheduleOperations.id, { onDelete: "restrict" }),
  termsId: uuid("terms_id").references(() => subscriptionCommercialTerms.id, { onDelete: "restrict" }), phaseDigest: text("phase_digest"),
  providerInvoiceRef: text("provider_invoice_ref").notNull(), providerSubscriptionRef: text("provider_subscription_ref").notNull(), providerCustomerRef: text("provider_customer_ref"),
  currency: text("currency"), subtotalMinor: bigint("subtotal_minor", { mode: "number" }), totalMinor: bigint("total_minor", { mode: "number" }),
  paidMinor: bigint("paid_minor", { mode: "number" }), remainingMinor: bigint("remaining_minor", { mode: "number" }), paid: boolean("paid").notNull(), unadjusted: boolean("unadjusted").notNull(),
  lineCount: integer("line_count").notNull(), verified: boolean("verified").notNull(), createdAt: createdAtColumn(),
}, t => [
  uniqueIndex("subscription_provider_invoice_observations_digest").on(t.subscriptionId, t.evidenceDigest),
  uniqueIndex("subscription_provider_invoice_observations_revision").on(t.subscriptionId, t.evidenceRevision),
  index("subscription_provider_invoice_observations_invoice").on(t.subscriptionId, t.providerInvoiceRef, t.evidenceRevision),
  index("subscription_provider_invoice_observations_operation").on(t.providerOperationId), index("subscription_provider_invoice_observations_terms").on(t.termsId),
  check("subscription_provider_invoice_observations_refs", sql`${t.providerInvoiceRef} ~ '^in_[A-Za-z0-9_]{1,195}$' and ${t.providerSubscriptionRef} ~ '^sub_[A-Za-z0-9_]{1,195}$' and (${t.providerCustomerRef} is null or ${t.providerCustomerRef} ~ '^cus_[A-Za-z0-9_]{1,195}$')`),
  check("subscription_provider_invoice_observations_shape", sql`${t.evidenceRevision}>0 and ${t.evidenceDigest} ~ '^[a-f0-9]{64}$' and ${t.lineCount} between 0 and 2000 and (${t.phaseDigest} is null or ${t.phaseDigest} ~ '^[a-f0-9]{64}$')`),
]);
export const subscriptionProviderInvoiceLines = pgTable("subscription_provider_invoice_lines", {
  id: uuid("id").primaryKey(), observationId: uuid("observation_id").notNull().references(() => subscriptionProviderInvoiceObservations.id, { onDelete: "restrict" }), position: integer("position").notNull(),
  providerLineRef: text("provider_line_ref").notNull(), providerPriceRef: text("provider_price_ref"), providerProductRef: text("provider_product_ref"),
  quantity: bigint("quantity", { mode: "number" }), quantityDecimal: text("quantity_decimal"), amountMinor: bigint("amount_minor", { mode: "number" }), currency: text("currency"),
  periodStart: timestamp("period_start", { withTimezone: true }), periodEnd: timestamp("period_end", { withTimezone: true }), subscriptionLine: boolean("subscription_line").notNull(), proration: boolean("proration"), unadjusted: boolean("unadjusted").notNull(),
  priceAmountMinor: bigint("price_amount_minor", { mode: "number" }), priceCurrency: text("price_currency"), priceInterval: text("price_interval"), priceIntervalCount: integer("price_interval_count"),
  licensed: boolean("licensed").notNull(), perUnit: boolean("per_unit").notNull(), inclusive: boolean("inclusive").notNull(), noTransform: boolean("no_transform").notNull(),
}, t => [uniqueIndex("subscription_provider_invoice_lines_position").on(t.observationId, t.position), uniqueIndex("subscription_provider_invoice_lines_ref").on(t.observationId, t.providerLineRef), check("subscription_provider_invoice_lines_position_check", sql`${t.position}>=0`), check("subscription_provider_invoice_lines_refs", sql`${t.providerLineRef} ~ '^il_[A-Za-z0-9_]{1,195}$' and (${t.providerPriceRef} is null or ${t.providerPriceRef} ~ '^price_[A-Za-z0-9_]{1,195}$') and (${t.providerProductRef} is null or ${t.providerProductRef} ~ '^prod_[A-Za-z0-9_]{1,195}$')`)]);
