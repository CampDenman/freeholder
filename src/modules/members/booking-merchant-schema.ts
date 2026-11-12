// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Booking acceptance owns its seller before later mutable offering edits.
import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { TaxAddress } from "@/adapters/tax";
import type { PublicMerchantSupport } from "@/core/commerce/merchant-identity";
import { contacts } from "@/core/contacts/schema";
import { createdAtColumn } from "@/core/db/columns";
import { merchantTaxProfileVersions } from "@/modules/invoicing/merchant-tax-schema";
import { bookings } from "@/core/scheduling/schema";

export const bookingMarketPolicies = pgTable("booking_market_policies", {
  bookingId: uuid("booking_id").primaryKey().references(() => bookings.id, { onDelete: "restrict" }),
  model: text("model", { enum: ["hold", "instant", "seller_merchant"] }).notNull(),
  adapter: text("adapter").notNull(), siteFeeBps: integer("site_fee_bps").notNull(), holdDays: integer("hold_days").notNull(),
  sellerUserId: uuid("seller_user_id").notNull(),
  merchantContactId: uuid("merchant_contact_id").references(() => contacts.id, { onDelete: "restrict" }),
  merchantName: text("merchant_name"), merchantSupport: jsonb("merchant_support").$type<PublicMerchantSupport>(),
  providerAccountId: text("provider_account_id"), createdAt: createdAtColumn(),
}, t => [
  index("booking_market_policies_contact_idx").on(t.merchantContactId),
  check("booking_market_policies_fee", sql`${t.siteFeeBps} between 0 and 10000 and ${t.holdDays} between 0 and 365`),
  check("booking_market_policies_model", sql`${t.model} in ('hold','instant','seller_merchant')`),
]);

export const bookingMerchantScopes = pgTable("booking_merchant_scopes", {
  bookingId: uuid("booking_id").primaryKey().references(() => bookingMarketPolicies.bookingId, { onDelete: "restrict" }),
  merchantScopeVersion: integer("merchant_scope_version").notNull().default(1),
  sellerUserId: uuid("seller_user_id").notNull(),
  merchantContactId: uuid("merchant_contact_id").references(() => contacts.id, { onDelete: "restrict" }),
  collectionKind: text("collection_kind", { enum: ["direct", "destination"] }).notNull(),
  providerPlatformAccountId: text("provider_platform_account_id").notNull(), chargeAccountId: text("charge_account_id"),
  recipientAccountId: text("recipient_account_id").notNull(), settlementMerchantAccountId: text("settlement_merchant_account_id").notNull(),
  merchantName: text("merchant_name").notNull(), merchantSupport: jsonb("merchant_support").$type<PublicMerchantSupport>(),
  taxProfileId: uuid("tax_profile_id").notNull(), taxProfileVersion: integer("tax_profile_version").notNull(),
  taxLiability: text("tax_liability", { enum: ["platform", "seller"] }).notNull(),
  taxDestination: jsonb("tax_destination").$type<TaxAddress | Record<string, never>>(),
  quoteDigest: text("quote_digest"),
  destinationErasedAt: timestamp("destination_erased_at", { withTimezone: true }),
  merchantIdentityErasedAt: timestamp("merchant_identity_erased_at", { withTimezone: true }),
  createdAt: createdAtColumn(),
}, t => [
  index("booking_merchant_scopes_contact_idx").on(t.merchantContactId),
  foreignKey({ name: "booking_merchant_scopes_profile_fk", columns: [t.taxProfileId,t.taxProfileVersion], foreignColumns: [merchantTaxProfileVersions.profileId,merchantTaxProfileVersions.version] }).onDelete("restrict"),
  check("booking_merchant_scopes_version", sql`${t.merchantScopeVersion} = 1 and ${t.taxProfileVersion} > 0`),
  check("booking_merchant_scopes_route", sql`${t.providerPlatformAccountId} ~ '^acct_[A-Za-z0-9]+$' and ${t.recipientAccountId} ~ '^acct_[A-Za-z0-9]+$'
    and ${t.recipientAccountId} <> ${t.providerPlatformAccountId} and ${t.settlementMerchantAccountId} = ${t.recipientAccountId}
    and ((${t.collectionKind} = 'direct' and ${t.chargeAccountId} is not null and ${t.chargeAccountId} = ${t.recipientAccountId}) or (${t.collectionKind} = 'destination' and ${t.chargeAccountId} is null))`),
  check("booking_merchant_scopes_tax", sql`${t.taxLiability} = 'seller' and ((${t.taxDestination} is null and ${t.quoteDigest} is null and ${t.destinationErasedAt} is null) or ${t.destinationErasedAt} is not null or (coalesce(${t.taxDestination}->>'country' ~ '^[A-Z]{2}$',false) and ${t.quoteDigest} is not null))`),
  check("booking_merchant_scopes_digest", sql`${t.quoteDigest} is null or ${t.quoteDigest} ~ '^[a-f0-9]{64}$'`),
]);
