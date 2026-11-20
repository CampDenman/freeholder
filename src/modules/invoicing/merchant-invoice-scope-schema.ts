// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Single-source member invoices use their original booking, not fictitious order portions.
import { sql } from "drizzle-orm";
import { bigint, check, index, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAtColumn } from "@/core/db/columns";
import { bookings } from "@/core/scheduling/schema";
import { invoices, payments } from "./schema";

export const invoiceMerchantScopes = pgTable("invoice_merchant_scopes", {
  invoiceId: uuid("invoice_id").primaryKey().references(() => invoices.id, { onDelete: "restrict" }),
  bookingId: uuid("booking_id").notNull().references(() => bookings.id, { onDelete: "restrict" }),
  collectionKind: text("collection_kind", { enum: ["direct", "destination"] }).notNull(),
  providerPlatformAccountId: text("provider_platform_account_id").notNull(), chargeAccountId: text("charge_account_id"),
  recipientAccountId: text("recipient_account_id").notNull(), settlementMerchantAccountId: text("settlement_merchant_account_id").notNull(),
  taxPolicy: jsonb("tax_policy").$type<{ liability: "seller"; profileId: string; profileVersion: number; evidenceDigest: string }>().notNull(),
  createdAt: createdAtColumn(),
}, t => [
  index("invoice_merchant_scopes_booking_idx").on(t.bookingId),
  check("invoice_merchant_scopes_route", sql`${t.providerPlatformAccountId} ~ '^acct_[A-Za-z0-9]+$' and ${t.recipientAccountId} ~ '^acct_[A-Za-z0-9]+$'
    and ${t.recipientAccountId} <> ${t.providerPlatformAccountId} and ${t.settlementMerchantAccountId} = ${t.recipientAccountId}
    and ((${t.collectionKind} = 'direct' and ${t.chargeAccountId} is not null and ${t.chargeAccountId} = ${t.recipientAccountId}) or (${t.collectionKind} = 'destination' and ${t.chargeAccountId} is null))`),
]);

export const merchantInvoicePaymentRoutes = pgTable("merchant_invoice_payment_routes", {
  paymentId: uuid("payment_id").primaryKey().references(() => payments.id, { onDelete: "restrict" }),
  invoiceId: uuid("invoice_id").notNull().references(() => invoiceMerchantScopes.invoiceId, { onDelete: "restrict" }),
  applicationFeeMinor: bigint("application_fee_minor", { mode: "number" }).notNull(),
  createdAt: createdAtColumn(),
}, t => [index("merchant_invoice_payment_routes_invoice_idx").on(t.invoiceId), check("merchant_invoice_payment_routes_fee", sql`${t.applicationFeeMinor} >= 0`)]);
