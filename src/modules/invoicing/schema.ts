// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The one money spine and its tax evidence (MASTER.md §4.3, §4.12, C5.02-C5.05).
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { contacts } from "@/core/contacts/schema";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";

const amount = (name: string) => bigint(name, { mode: "number" }).notNull().default(0);

export const taxCategories = pgTable(
  "tax_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    defaultRateHintPpm: integer("default_rate_hint_ppm"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("tax_categories_code_idx").on(t.code),
    check("tax_categories_code_valid", sql`${t.code} ~ '^[a-z0-9]+(?:_[a-z0-9]+)*$'`),
    check(
      "tax_categories_hint_valid",
      sql`${t.defaultRateHintPpm} is null or ${t.defaultRateHintPpm} between 0 and 10000000`,
    ),
  ],
);

export const taxZones = pgTable(
  "tax_zones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    templateKey: text("template_key"),
    templateVersion: integer("template_version"),
    country: text("country").notNull(),
    regions: text("regions").array().notNull().default([]),
    postalPatterns: text("postal_patterns").array().notNull().default([]),
    priority: integer("priority").notNull().default(0),
    basis: text("basis", { enum: ["origin", "destination"] })
      .notNull()
      .default("destination"),
    pricesIncludeTax: boolean("prices_include_tax").notNull().default(false),
    roundingScope: text("rounding_scope", { enum: ["line", "invoice"] })
      .notNull()
      .default("line"),
    roundingMode: text("rounding_mode", { enum: ["half_up", "bankers"] })
      .notNull()
      .default("half_up"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("tax_zones_template_idx").on(t.templateKey),
    index("tax_zones_match_idx").on(t.country, t.active, t.priority),
    check("tax_zones_country_valid", sql`${t.country} ~ '^[A-Z]{2}$'`),
    check("tax_zones_priority_valid", sql`${t.priority} between -100000 and 100000`),
    check("tax_zones_basis_valid", sql`${t.basis} in ('origin','destination')`),
    check("tax_zones_rounding_scope_valid", sql`${t.roundingScope} in ('line','invoice')`),
    check("tax_zones_rounding_mode_valid", sql`${t.roundingMode} in ('half_up','bankers')`),
    check(
      "tax_zones_template_pair",
      sql`(${t.templateKey} is null and ${t.templateVersion} is null) or (${t.templateKey} is not null and ${t.templateVersion} > 0)`,
    ),
  ],
);

export const taxRates = pgTable(
  "tax_rates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    zoneId: uuid("zone_id").notNull().references(() => taxZones.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id").references(() => taxCategories.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    jurisdiction: text("jurisdiction").notNull(),
    ratePpm: integer("rate_ppm").notNull(),
    compound: boolean("compound").notNull().default(false),
    priority: integer("priority").notNull().default(0),
    appliesToShipping: boolean("applies_to_shipping").notNull().default(false),
    effectiveFrom: date("effective_from", { mode: "string" }),
    effectiveTo: date("effective_to", { mode: "string" }),
    active: boolean("active").notNull().default(true),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("tax_rates_zone_idx").on(t.zoneId, t.active, t.priority),
    index("tax_rates_category_idx").on(t.categoryId),
    check("tax_rates_rate_valid", sql`${t.ratePpm} between 0 and 10000000`),
    check("tax_rates_priority_valid", sql`${t.priority} between -100000 and 100000`),
    check(
      "tax_rates_effective_window_valid",
      sql`${t.effectiveFrom} is null or ${t.effectiveTo} is null or ${t.effectiveTo} >= ${t.effectiveFrom}`,
    ),
  ],
);

export const taxRegistrations = pgTable(
  "tax_registrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    zoneId: uuid("zone_id").notNull().references(() => taxZones.id, { onDelete: "restrict" }),
    number: text("number"),
    scheme: text("scheme", { enum: ["standard", "oss", "ioss", "simplified"] })
      .notNull()
      .default("standard"),
    collectsFrom: date("collects_from", { mode: "string" }),
    thresholdMinor: amount("threshold_minor"),
    thresholdCurrency: text("threshold_currency"),
    status: text("status", { enum: ["monitoring", "active", "paused", "closed"] })
      .notNull()
      .default("monitoring"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("tax_registrations_zone_idx").on(t.zoneId, t.status),
    check("tax_registrations_threshold_valid", sql`${t.thresholdMinor} >= 0`),
    check(
      "tax_registrations_threshold_currency_valid",
      sql`(${t.thresholdMinor} = 0 and (${t.thresholdCurrency} is null or ${t.thresholdCurrency} ~ '^[A-Z]{3}$')) or (${t.thresholdMinor} > 0 and ${t.thresholdCurrency} ~ '^[A-Z]{3}$')`,
    ),
    check("tax_registrations_status_valid", sql`${t.status} in ('monitoring','active','paused','closed')`),
  ],
);

export const taxExemptions = pgTable(
  "tax_exemptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "restrict" }),
    zoneId: uuid("zone_id").notNull().references(() => taxZones.id, { onDelete: "restrict" }),
    kind: text("kind", { enum: ["reseller", "nonprofit", "reverse_charge", "diplomatic"] }).notNull(),
    certificateRef: text("certificate_ref"),
    validatedAt: timestamp("validated_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    status: text("status", { enum: ["pending", "valid", "expired", "revoked"] })
      .notNull()
      .default("pending"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("tax_exemptions_contact_idx").on(t.contactId, t.status),
    index("tax_exemptions_zone_idx").on(t.zoneId, t.status),
    check("tax_exemptions_status_valid", sql`${t.status} in ('pending','valid','expired','revoked')`),
    check(
      "tax_exemptions_validation_evidence",
      sql`${t.status} <> 'valid' or ${t.validatedAt} is not null`,
    ),
    check(
      "tax_exemptions_window_valid",
      sql`${t.validatedAt} is null or ${t.expiresAt} is null or ${t.expiresAt} > ${t.validatedAt}`,
    ),
  ],
);

export const invoiceSequences = pgTable(
  "invoice_sequences",
  {
    key: text("key").primaryKey(),
    prefix: text("prefix").notNull().default("INV-"),
    nextValue: bigint("next_value", { mode: "number" }).notNull().default(1),
    padding: integer("padding").notNull().default(6),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    check("invoice_sequences_key_valid", sql`length(trim(${t.key})) between 1 and 80`),
    check("invoice_sequences_next_positive", sql`${t.nextValue} > 0`),
    check("invoice_sequences_padding_valid", sql`${t.padding} between 1 and 18`),
  ],
);

export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "restrict" }),
    number: text("number"),
    sequenceKey: text("sequence_key").notNull().default("invoice"),
    sourceType: text("source_type", { enum: ["order", "quote", "booking", "subscription", "manual", "tip", "unlock"] })
      .notNull()
      .default("manual"),
    sourceId: text("source_id"),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    status: text("status", { enum: ["draft", "sent", "viewed", "partially_paid", "paid", "overdue", "void", "refunded"] })
      .notNull()
      .default("draft"),
    currency: text("currency").notNull(),
    subtotalMinor: amount("subtotal_minor"),
    discountMinor: amount("discount_minor"),
    shippingMinor: amount("shipping_minor"),
    taxMinor: amount("tax_minor"),
    taxZoneId: uuid("tax_zone_id").references(() => taxZones.id, { onDelete: "restrict" }),
    totalMinor: amount("total_minor"),
    paidMinor: amount("paid_minor"),
    refundedMinor: amount("refunded_minor"),
    billingAddress: jsonb("billing_address"),
    customerTaxId: text("customer_tax_id"),
    requiredTaxLegend: text("required_tax_legend"),
    memo: text("memo"),
    schedule: jsonb("schedule"),
    depositOfInvoiceId: uuid("deposit_of_invoice_id"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    issuedAt: timestamp("issued_at", { withTimezone: true }),
    viewedAt: timestamp("viewed_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    foreignKey({
      name: "invoices_deposit_of_fk",
      columns: [t.depositOfInvoiceId],
      foreignColumns: [t.id],
    }).onDelete("restrict"),
    uniqueIndex("invoices_number_idx").on(t.number),
    uniqueIndex("invoices_source_idx").on(t.sourceType, t.sourceId),
    uniqueIndex("invoices_idempotency_idx").on(t.idempotencyKey),
    index("invoices_contact_idx").on(t.contactId, t.createdAt),
    index("invoices_status_due_idx").on(t.status, t.dueAt),
    index("invoices_tax_zone_idx").on(t.taxZoneId, t.issuedAt),
    index("invoices_deposit_of_idx").on(t.depositOfInvoiceId),
    check("invoices_currency_valid", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check("invoices_request_hash_valid", sql`length(${t.requestHash}) = 64`),
    check("invoices_status_valid", sql`${t.status} in ('draft','sent','viewed','partially_paid','paid','overdue','void','refunded')`),
    check(
      "invoices_amounts_nonnegative",
      sql`${t.subtotalMinor} >= 0 and ${t.discountMinor} >= 0 and ${t.shippingMinor} >= 0 and ${t.taxMinor} >= 0 and ${t.totalMinor} >= 0 and ${t.paidMinor} >= 0 and ${t.refundedMinor} >= 0`,
    ),
    check(
      "invoices_total_consistent",
      sql`${t.totalMinor} = ${t.subtotalMinor} - ${t.discountMinor} + ${t.shippingMinor} + ${t.taxMinor}`,
    ),
    check("invoices_discount_bounded", sql`${t.discountMinor} <= ${t.subtotalMinor}`),
    check("invoices_paid_bounded", sql`${t.paidMinor} <= ${t.totalMinor}`),
    check("invoices_refund_bounded", sql`${t.refundedMinor} <= ${t.paidMinor}`),
    check(
      "invoices_issued_consistent",
      sql`(${t.status} = 'draft' and ${t.number} is null and ${t.issuedAt} is null) or (${t.status} <> 'draft' and ${t.number} is not null and ${t.issuedAt} is not null)`,
    ),
    check("invoices_paid_consistent", sql`${t.status} <> 'paid' or (${t.paidMinor} = ${t.totalMinor} and ${t.paidAt} is not null)`),
    check("invoices_void_consistent", sql`${t.status} <> 'void' or ${t.voidedAt} is not null`),
    check("invoices_refunded_consistent", sql`${t.status} <> 'refunded' or (${t.refundedMinor} = ${t.paidMinor} and ${t.paidMinor} > 0)`),
    check("invoices_not_own_deposit", sql`${t.depositOfInvoiceId} is null or ${t.depositOfInvoiceId} <> ${t.id}`),
  ],
);

export const invoiceLines = pgTable(
  "invoice_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    invoiceId: uuid("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    sourceType: text("source_type"),
    sourceId: text("source_id"),
    description: text("description").notNull(),
    quantityMicros: bigint("quantity_micros", { mode: "number" }).notNull(),
    unitAmountMinor: amount("unit_amount_minor"),
    subtotalMinor: amount("subtotal_minor"),
    discountMinor: amount("discount_minor"),
    taxMinor: amount("tax_minor"),
    totalMinor: amount("total_minor"),
    taxCategoryCode: text("tax_category_code").notNull().default("standard"),
    snapshot: jsonb("snapshot").notNull().default({}),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex("invoice_lines_position_idx").on(t.invoiceId, t.position),
    index("invoice_lines_source_idx").on(t.sourceType, t.sourceId),
    check("invoice_lines_position_valid", sql`${t.position} >= 0`),
    check("invoice_lines_quantity_positive", sql`${t.quantityMicros} > 0`),
    check(
      "invoice_lines_amounts_nonnegative",
      sql`${t.unitAmountMinor} >= 0 and ${t.subtotalMinor} >= 0 and ${t.discountMinor} >= 0 and ${t.taxMinor} >= 0 and ${t.totalMinor} >= 0`,
    ),
    check("invoice_lines_discount_bounded", sql`${t.discountMinor} <= ${t.subtotalMinor}`),
    check(
      "invoice_lines_total_consistent",
      sql`${t.totalMinor} = ${t.subtotalMinor} - ${t.discountMinor} + ${t.taxMinor}`,
    ),
    check("invoice_lines_snapshot_object", sql`jsonb_typeof(${t.snapshot}) = 'object'`),
  ],
);

export const taxLines = pgTable(
  "tax_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    invoiceId: uuid("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
    invoiceLineId: uuid("invoice_line_id").references(() => invoiceLines.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["item", "shipping", "exemption"] }).notNull(),
    rateName: text("rate_name").notNull(),
    ratePpm: integer("rate_ppm").notNull(),
    taxableMinor: amount("taxable_minor"),
    amountMinor: amount("amount_minor"),
    jurisdiction: text("jurisdiction").notNull(),
    registrationNumber: text("registration_number"),
    inclusive: boolean("inclusive").notNull().default(false),
    compound: boolean("compound").notNull().default(false),
    priority: integer("priority").notNull().default(0),
    exemptionKind: text("exemption_kind"),
    explanation: text("explanation").notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => [
    index("tax_lines_invoice_idx").on(t.invoiceId, t.priority),
    index("tax_lines_invoice_line_idx").on(t.invoiceLineId),
    check("tax_lines_kind_valid", sql`${t.kind} in ('item','shipping','exemption')`),
    check("tax_lines_rate_valid", sql`${t.ratePpm} between 0 and 10000000`),
    check("tax_lines_amounts_nonnegative", sql`${t.taxableMinor} >= 0 and ${t.amountMinor} >= 0`),
    check(
      "tax_lines_item_pointer",
      sql`(${t.kind} = 'item' and ${t.invoiceLineId} is not null) or (${t.kind} = 'shipping' and ${t.invoiceLineId} is null) or ${t.kind} = 'exemption'`,
    ),
  ],
);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    invoiceId: uuid("invoice_id").notNull().references(() => invoices.id, { onDelete: "restrict" }),
    provider: text("provider").notNull(),
    providerCheckoutRef: text("provider_checkout_ref"),
    providerRef: text("provider_ref"),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    status: text("status", { enum: ["created", "processing", "succeeded", "failed", "cancelled"] })
      .notNull()
      .default("created"),
    method: text("method").notNull(),
    currency: text("currency").notNull(),
    amountMinor: amount("amount_minor"),
    refundedMinor: amount("refunded_minor"),
    failureCode: text("failure_code"),
    failureMessage: text("failure_message"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("payments_idempotency_idx").on(t.provider, t.idempotencyKey),
    uniqueIndex("payments_provider_ref_idx").on(t.provider, t.providerRef),
    uniqueIndex("payments_provider_checkout_ref_idx").on(t.provider, t.providerCheckoutRef),
    index("payments_invoice_idx").on(t.invoiceId, t.createdAt),
    index("payments_status_idx").on(t.status, t.createdAt),
    check("payments_currency_valid", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check("payments_request_hash_valid", sql`length(${t.requestHash}) = 64`),
    check("payments_amount_positive", sql`${t.amountMinor} > 0`),
    check("payments_refund_bounded", sql`${t.refundedMinor} between 0 and ${t.amountMinor}`),
    check("payments_status_valid", sql`${t.status} in ('created','processing','succeeded','failed','cancelled')`),
    check("payments_metadata_object", sql`jsonb_typeof(${t.metadata}) = 'object'`),
    check("payments_success_consistent", sql`${t.status} <> 'succeeded' or (${t.providerRef} is not null and ${t.processedAt} is not null)`),
    check("payments_failure_consistent", sql`${t.status} <> 'failed' or ${t.failedAt} is not null`),
  ],
);

export const paymentProviderCustomers = pgTable(
  "payment_provider_customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "restrict" }),
    provider: text("provider").notNull(),
    providerCustomerRef: text("provider_customer_ref").notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("payment_provider_customers_contact_idx").on(t.contactId, t.provider),
    uniqueIndex("payment_provider_customers_ref_idx").on(t.provider, t.providerCustomerRef),
    index("payment_provider_customers_contact_created_idx").on(t.contactId, t.createdAt),
    check("payment_provider_customers_provider_valid", sql`length(trim(${t.provider})) between 1 and 100`),
    check("payment_provider_customers_ref_valid", sql`length(trim(${t.providerCustomerRef})) between 1 and 500`),
  ],
);

export const paymentMethods = pgTable(
  "payment_methods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "restrict" }),
    provider: text("provider").notNull(),
    providerMethodRef: text("provider_method_ref").notNull(),
    providerCustomerRef: text("provider_customer_ref"),
    kind: text("kind", { enum: ["card", "wallet", "bank_debit", "bank_redirect", "buy_now_pay_later", "cash", "bank_transfer", "other"] }).notNull(),
    label: text("label").notNull(),
    brand: text("brand"),
    last4: text("last4"),
    expiryMonth: integer("expiry_month"),
    expiryYear: integer("expiry_year"),
    status: text("status", { enum: ["active", "revoked", "expired"] }).notNull().default("active"),
    consentSource: text("consent_source").notNull(),
    consentedAt: timestamp("consented_at", { withTimezone: true }).notNull(),
    providerStatusAt: timestamp("provider_status_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("payment_methods_provider_ref_idx").on(t.provider, t.providerMethodRef),
    index("payment_methods_contact_status_idx").on(t.contactId, t.status, t.createdAt),
    index("payment_methods_customer_ref_idx").on(t.provider, t.providerCustomerRef),
    check("payment_methods_provider_valid", sql`length(trim(${t.provider})) between 1 and 100`),
    check("payment_methods_ref_valid", sql`length(trim(${t.providerMethodRef})) between 1 and 500`),
    check("payment_methods_label_valid", sql`length(trim(${t.label})) between 1 and 200`),
    check("payment_methods_last4_valid", sql`${t.last4} is null or ${t.last4} ~ '^[A-Za-z0-9]{2,4}$'`),
    check("payment_methods_expiry_pair", sql`(${t.expiryMonth} is null and ${t.expiryYear} is null) or (${t.expiryMonth} between 1 and 12 and ${t.expiryYear} between 2000 and 9999)`),
    check("payment_methods_status_valid", sql`${t.status} in ('active','revoked','expired')`),
    check("payment_methods_revocation_consistent", sql`${t.status} <> 'revoked' or ${t.revokedAt} is not null`),
  ],
);

export const refunds = pgTable(
  "refunds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    paymentId: uuid("payment_id").notNull().references(() => payments.id, { onDelete: "restrict" }),
    invoiceId: uuid("invoice_id").notNull().references(() => invoices.id, { onDelete: "restrict" }),
    provider: text("provider").notNull(),
    providerRef: text("provider_ref"),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    status: text("status", { enum: ["created", "processing", "succeeded", "failed", "cancelled"] })
      .notNull()
      .default("created"),
    currency: text("currency").notNull(),
    amountMinor: amount("amount_minor"),
    reason: text("reason"),
    failureCode: text("failure_code"),
    failureMessage: text("failure_message"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("refunds_idempotency_idx").on(t.provider, t.idempotencyKey),
    uniqueIndex("refunds_provider_ref_idx").on(t.provider, t.providerRef),
    index("refunds_payment_idx").on(t.paymentId, t.createdAt),
    index("refunds_invoice_idx").on(t.invoiceId, t.createdAt),
    check("refunds_currency_valid", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check("refunds_request_hash_valid", sql`length(${t.requestHash}) = 64`),
    check("refunds_amount_positive", sql`${t.amountMinor} > 0`),
    check("refunds_status_valid", sql`${t.status} in ('created','processing','succeeded','failed','cancelled')`),
    check("refunds_success_consistent", sql`${t.status} <> 'succeeded' or (${t.providerRef} is not null and ${t.processedAt} is not null)`),
    check("refunds_failure_consistent", sql`${t.status} <> 'failed' or ${t.failedAt} is not null`),
  ],
);

export const paymentDisputes = pgTable(
  "payment_disputes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    paymentId: uuid("payment_id").notNull().references(() => payments.id, { onDelete: "restrict" }),
    invoiceId: uuid("invoice_id").notNull().references(() => invoices.id, { onDelete: "restrict" }),
    provider: text("provider").notNull(),
    providerRef: text("provider_ref").notNull(),
    providerPaymentRef: text("provider_payment_ref").notNull(),
    status: text("status", { enum: ["open", "won", "lost"] }).notNull().default("open"),
    currency: text("currency").notNull(),
    amountMinor: amount("amount_minor"),
    reason: text("reason"),
    evidenceDueAt: timestamp("evidence_due_at", { withTimezone: true }),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
    providerStatusAt: timestamp("provider_status_at", { withTimezone: true }).notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("payment_disputes_provider_ref_idx").on(t.provider, t.providerRef),
    index("payment_disputes_payment_idx").on(t.paymentId, t.createdAt),
    index("payment_disputes_invoice_idx").on(t.invoiceId, t.createdAt),
    index("payment_disputes_status_due_idx").on(t.status, t.evidenceDueAt),
    check("payment_disputes_currency_valid", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check("payment_disputes_amount_positive", sql`${t.amountMinor} > 0`),
    check("payment_disputes_status_valid", sql`${t.status} in ('open','won','lost')`),
    check("payment_disputes_closed_consistent", sql`(${t.status} = 'open' and ${t.closedAt} is null) or (${t.status} <> 'open' and ${t.closedAt} is not null)`),
  ],
);

export const paymentProviderEvents = pgTable(
  "payment_provider_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    providerEventId: text("provider_event_id").notNull(),
    kind: text("kind").notNull(),
    providerObjectRef: text("provider_object_ref"),
    bodySha256: text("body_sha256").notNull(),
    status: text("status", { enum: ["processed", "ignored"] }).notNull(),
    detail: text("detail"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("payment_provider_events_provider_id_idx").on(t.provider, t.providerEventId),
    index("payment_provider_events_status_received_idx").on(t.status, t.receivedAt),
    index("payment_provider_events_object_idx").on(t.provider, t.providerObjectRef),
    check("payment_provider_events_hash_valid", sql`length(${t.bodySha256}) = 64`),
    check("payment_provider_events_status_valid", sql`${t.status} in ('processed','ignored')`),
  ],
);

export const creditNotes = pgTable(
  "credit_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    invoiceId: uuid("invoice_id").notNull().references(() => invoices.id, { onDelete: "restrict" }),
    number: text("number"),
    sequenceKey: text("sequence_key").notNull().default("credit-note"),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    status: text("status", { enum: ["draft", "issued", "void"] }).notNull().default("draft"),
    currency: text("currency").notNull(),
    reason: text("reason").notNull(),
    subtotalMinor: amount("subtotal_minor"),
    taxMinor: amount("tax_minor"),
    totalMinor: amount("total_minor"),
    issuedAt: timestamp("issued_at", { withTimezone: true }),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("credit_notes_number_idx").on(t.number),
    uniqueIndex("credit_notes_idempotency_idx").on(t.idempotencyKey),
    index("credit_notes_invoice_idx").on(t.invoiceId, t.createdAt),
    check("credit_notes_currency_valid", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check("credit_notes_request_hash_valid", sql`length(${t.requestHash}) = 64`),
    check("credit_notes_status_valid", sql`${t.status} in ('draft','issued','void')`),
    check("credit_notes_amounts_nonnegative", sql`${t.subtotalMinor} >= 0 and ${t.taxMinor} >= 0 and ${t.totalMinor} >= 0`),
    check("credit_notes_total_consistent", sql`${t.totalMinor} = ${t.subtotalMinor} + ${t.taxMinor}`),
    check("credit_notes_issued_consistent", sql`(${t.status} = 'draft' and ${t.number} is null and ${t.issuedAt} is null) or (${t.status} <> 'draft' and ${t.number} is not null and ${t.issuedAt} is not null)`),
    check("credit_notes_void_consistent", sql`${t.status} <> 'void' or ${t.voidedAt} is not null`),
  ],
);

export const creditNoteLines = pgTable(
  "credit_note_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    creditNoteId: uuid("credit_note_id").notNull().references(() => creditNotes.id, { onDelete: "cascade" }),
    invoiceLineId: uuid("invoice_line_id").references(() => invoiceLines.id, { onDelete: "restrict" }),
    position: integer("position").notNull(),
    description: text("description").notNull(),
    quantityMicros: bigint("quantity_micros", { mode: "number" }).notNull(),
    subtotalMinor: amount("subtotal_minor"),
    taxMinor: amount("tax_minor"),
    totalMinor: amount("total_minor"),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex("credit_note_lines_position_idx").on(t.creditNoteId, t.position),
    index("credit_note_lines_invoice_line_idx").on(t.invoiceLineId),
    check("credit_note_lines_position_valid", sql`${t.position} >= 0`),
    check("credit_note_lines_quantity_positive", sql`${t.quantityMicros} > 0`),
    check("credit_note_lines_amounts_nonnegative", sql`${t.subtotalMinor} >= 0 and ${t.taxMinor} >= 0 and ${t.totalMinor} >= 0`),
    check("credit_note_lines_total_consistent", sql`${t.totalMinor} = ${t.subtotalMinor} + ${t.taxMinor}`),
  ],
);

export const moneyStateEvents = pgTable(
  "money_state_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subjectType: text("subject_type", { enum: ["invoice", "payment", "refund", "credit_note", "dispute"] }).notNull(),
    subjectId: uuid("subject_id").notNull(),
    fromState: text("from_state"),
    toState: text("to_state").notNull(),
    reason: text("reason"),
    actor: text("actor").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("money_state_events_subject_idx").on(t.subjectType, t.subjectId, t.occurredAt),
    check("money_state_events_subject_valid", sql`${t.subjectType} in ('invoice','payment','refund','credit_note','dispute')`),
    check("money_state_events_transition_valid", sql`${t.fromState} is null or ${t.fromState} <> ${t.toState}`),
    check("money_state_events_metadata_object", sql`jsonb_typeof(${t.metadata}) = 'object'`),
  ],
);
