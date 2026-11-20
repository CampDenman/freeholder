// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C9.33/C12.38: an independent immutable AFTER-money effect admission.
import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { createdAtColumn } from "@/core/db/columns";
import { productVariants } from "@/modules/catalog/schema";
import { invoices } from "@/modules/invoicing/schema";
import { plans, subscriptions, subscriptionCommercialTerms, subscriptionEvents } from "./schema";
import { subscriptionControlledCollections } from "./controlled-provider-collection-schema";
import { subscriptionControlledResources } from "./controlled-provider-schema";
export type ControlledPaidParentEntry = { table: string; id: string; fingerprint: string; hashDomain: "postgres_row" };
export type ControlledPaidBankRevision = { paymentId: string; receiptId: string; inspectionId: string; observationId: string; revision: string };
export const subscriptionControlledPaidPeriodReceipts = pgTable("subscription_controlled_paid_period_receipts", {
  id: uuid("id").primaryKey().defaultRandom(), protocol: text("protocol").notNull(), admissionTransactionId: text("admission_transaction_id").notNull(),
  collectionId: uuid("collection_id").notNull(),
  resourceId: uuid("resource_id").notNull(),
  subscriptionId: uuid("subscription_id").notNull(),
  invoiceId: uuid("invoice_id").notNull(),
  termsId: uuid("terms_id").notNull(),
  renewalEventId: uuid("renewal_event_id").notNull(),
  planEventId: uuid("plan_event_id"),
  planId: uuid("plan_id").notNull(),
  productVariantId: uuid("product_variant_id").notNull(),
  acceptedQuoteDigest: text("accepted_quote_digest").notNull(), canonicalTargetDigest: text("canonical_target_digest").notNull(),
  parentRevision: text("parent_revision").notNull(), beforeParentFingerprint: text("before_parent_fingerprint").notNull(),
  beforeEntries: jsonb("before_entries").$type<ControlledPaidParentEntry[]>().notNull(),
  beforeParentFields: jsonb("before_parent_fields").$type<Record<string, unknown>>().notNull(),
  bankRevisions: jsonb("bank_revisions").$type<ControlledPaidBankRevision[]>().notNull(),
  periodStart: timestamp("period_start", { withTimezone: true }).notNull(), periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
  effectAt: timestamp("effect_at", { withTimezone: true }).notNull(), financialReviewPending: boolean("financial_review_pending").notNull(),
  digest: text("digest").notNull(), authentication: text("authentication").notNull(), createdAt: createdAtColumn(),
}, t => [
  foreignKey({ columns: [t.collectionId], foreignColumns: [subscriptionControlledCollections.id], name: "controlled_paid_period_collection_fk" }).onDelete("restrict"),
  foreignKey({ columns: [t.resourceId], foreignColumns: [subscriptionControlledResources.id], name: "controlled_paid_period_resource_fk" }).onDelete("restrict"),
  foreignKey({ columns: [t.subscriptionId], foreignColumns: [subscriptions.id], name: "controlled_paid_period_subscription_fk" }).onDelete("restrict"),
  foreignKey({ columns: [t.invoiceId], foreignColumns: [invoices.id], name: "controlled_paid_period_invoice_fk" }).onDelete("restrict"),
  foreignKey({ columns: [t.termsId], foreignColumns: [subscriptionCommercialTerms.id], name: "controlled_paid_period_terms_fk" }).onDelete("restrict"),
  foreignKey({ columns: [t.renewalEventId], foreignColumns: [subscriptionEvents.id], name: "controlled_paid_period_renewal_event_fk" }).onDelete("restrict"),
  foreignKey({ columns: [t.planEventId], foreignColumns: [subscriptionEvents.id], name: "controlled_paid_period_plan_event_fk" }).onDelete("restrict"),
  foreignKey({ columns: [t.planId], foreignColumns: [plans.id], name: "controlled_paid_period_plan_fk" }).onDelete("restrict"),
  foreignKey({ columns: [t.productVariantId], foreignColumns: [productVariants.id], name: "controlled_paid_period_variant_fk" }).onDelete("restrict"),
  unique("controlled_paid_period_collection_key").on(t.collectionId), unique("controlled_paid_period_invoice_key").on(t.invoiceId),
  unique("controlled_paid_period_renewal_event_key").on(t.renewalEventId), unique("controlled_paid_period_plan_event_key").on(t.planEventId),
  index("controlled_paid_period_subscription_idx").on(t.subscriptionId), index("controlled_paid_period_resource_idx").on(t.resourceId),
  check("controlled_paid_period_protocol", sql`${t.protocol}='controlled_paid_period.v1' and ${t.admissionTransactionId} ~ '^[0-9]+$'`),
  check("controlled_paid_period_digests", sql`${t.acceptedQuoteDigest} ~ '^[a-f0-9]{64}$' and ${t.canonicalTargetDigest} ~ '^[a-f0-9]{64}$' and ${t.parentRevision} ~ '^[a-f0-9]{64}$' and ${t.beforeParentFingerprint} ~ '^[a-f0-9]{64}$' and ${t.digest} ~ '^[a-f0-9]{64}$' and ${t.authentication} ~ '^[a-f0-9]{64}$'`),
  check("controlled_paid_period_calendar", sql`${t.periodEnd}>${t.periodStart} and ${t.effectAt}>=${t.periodStart} and ${t.effectAt}<${t.periodEnd}`),
  check("controlled_paid_period_evidence", sql`jsonb_typeof(${t.beforeEntries})='array' and jsonb_array_length(${t.beforeEntries}) between 1 and 5000 and jsonb_typeof(${t.beforeParentFields})='object' and jsonb_typeof(${t.bankRevisions})='array' and jsonb_array_length(${t.bankRevisions}) between 1 and 5000`),
]);
