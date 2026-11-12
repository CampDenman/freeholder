// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: explicit merchant tax ownership; no profile is inferred from routing.
import { sql } from "drizzle-orm";
import { bigint, check, foreignKey, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { TaxAddress } from "@/adapters/tax";
import type { PublicMerchantSupport } from "@/core/commerce/merchant-identity";
import { contacts } from "@/core/contacts/schema";
import { createdAtColumn } from "@/core/db/columns";
import { invoiceLines, invoices } from "./schema";
import type { MerchantTaxRuleSnapshot } from "./merchant-tax-contract";

/** Stable business ownership keeps existing customer exemptions through edits. */
export const merchantTaxProfiles = pgTable("merchant_tax_profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  sellerUserId: uuid("seller_user_id"),
  sellerKey: text("seller_key").notNull(),
  contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "restrict" }),
  currentVersion: integer("current_version").notNull().default(0),
  state: text("state", { enum: ["active", "erased"] }).notNull().default("active"),
  createdAt: createdAtColumn(),
  erasedAt: timestamp("erased_at", { withTimezone: true }),
}, t => [
  uniqueIndex("merchant_tax_profiles_owner_idx").on(t.sellerKey),
  index("merchant_tax_profiles_contact_idx").on(t.contactId),
  check("merchant_tax_profiles_owner",sql`(${t.sellerUserId} is null and ${t.sellerKey}='site' and ${t.contactId} is null) or (${t.sellerUserId} is not null and ${t.sellerKey}='seller:'||${t.sellerUserId}::text and (${t.contactId} is not null or ${t.state}='erased'))`),
  check("merchant_tax_profiles_version",sql`${t.currentVersion}>=0`),
  check("merchant_tax_profiles_state",sql`${t.state} in ('active','erased')`),
]);

/** Origin, declaration and public site identity are versioned before quoting. */
export const merchantTaxProfileVersions = pgTable("merchant_tax_profile_versions",{
  id: uuid("id").primaryKey().defaultRandom(),
  profileId: uuid("profile_id").notNull().references(()=>merchantTaxProfiles.id,{onDelete:"restrict"}),
  version: integer("version").notNull(),
  requestKey: uuid("request_key").notNull(),
  liability: text("liability", { enum: ["platform", "seller"] }).notNull(),
  origin: jsonb("origin").$type<TaxAddress | Record<string, never>>().notNull(),
  collectionStatus: text("collection_status", { enum: ["registered", "not_registered"] }).notNull(),
  nonCollectionReason: text("non_collection_reason"),
  /** Immutable configuration document, containing no customer identities. */
  rulesSnapshot: jsonb("rules_snapshot").$type<MerchantTaxRuleSnapshot[]>().notNull(),
  // Site-owned invoice portions need an explicit business identity. A seller
  // keeps the independently verified public identity on their payout account.
  merchantName: text("merchant_name"),
  merchantSupport: jsonb("merchant_support").$type<PublicMerchantSupport>(),
  declarationDigest: text("declaration_digest").notNull(),
  createdAt: createdAtColumn(),
  erasedAt: timestamp("erased_at", { withTimezone: true }),
}, t=>[
  uniqueIndex("merchant_tax_profile_versions_version_idx").on(t.profileId,t.version),
  uniqueIndex("merchant_tax_profile_versions_request_idx").on(t.profileId,t.requestKey),
  check("merchant_tax_profile_versions_version",sql`${t.version}>0`),
  check("merchant_tax_profile_versions_liability",sql`${t.liability} in ('platform','seller')`),
  check("merchant_tax_profile_versions_collection",sql`${t.collectionStatus} in ('registered','not_registered')`),
  check("merchant_tax_profile_versions_digest",sql`${t.declarationDigest} ~ '^[a-f0-9]{64}$'`),
  check("merchant_tax_profile_versions_origin",sql`${t.erasedAt} is not null or (jsonb_typeof(${t.origin})='object' and coalesce((${t.origin}->>'country') ~ '^[A-Z]{2}$',false))`),
  check("merchant_tax_profile_versions_non_collection",sql`${t.erasedAt} is not null or ${t.collectionStatus}<>'not_registered' or coalesce(length(trim(${t.nonCollectionReason})) between 3 and 1000,false)`),
]);

/** No duplicate origin/address/registration plaintext: retain opaque proof and money. */
export const invoiceMerchantTaxQuotes = pgTable("invoice_merchant_tax_quotes", {
  id: uuid("id").primaryKey().defaultRandom(),
  invoiceId: uuid("invoice_id").notNull().references(() => invoices.id,{onDelete:"cascade"}),
  sellerUserId: uuid("seller_user_id"),
  sellerKey: text("seller_key").notNull(),
  profileId: uuid("profile_id").notNull().references(() => merchantTaxProfiles.id,{onDelete:"restrict"}),
  profileVersion: integer("profile_version").notNull(),
  liability: text("liability",{enum:["platform","seller"]}).notNull(),
  evidenceDigest: text("evidence_digest").notNull(),
  occurredAt: timestamp("occurred_at",{withTimezone:true}).notNull(),
  shippingMinor: bigint("shipping_minor",{mode:"number"}).notNull(),
  shippingTaxMinor: bigint("shipping_tax_minor",{mode:"number"}).notNull(),
  taxMinor: bigint("tax_minor",{mode:"number"}).notNull(),
  createdAt: createdAtColumn(),
},t=>[
  uniqueIndex("invoice_merchant_tax_quotes_party_idx").on(t.invoiceId,t.sellerKey),
  index("invoice_merchant_tax_quotes_profile_idx").on(t.profileId),
  foreignKey({name:"invoice_merchant_tax_quotes_version_fk",columns:[t.profileId,t.profileVersion],foreignColumns:[merchantTaxProfileVersions.profileId,merchantTaxProfileVersions.version]}).onDelete("restrict"),
  check("invoice_merchant_tax_quotes_owner",sql`(${t.sellerUserId} is null and ${t.sellerKey}='site') or (${t.sellerUserId} is not null and ${t.sellerKey}='seller:'||${t.sellerUserId}::text)`),
  check("invoice_merchant_tax_quotes_amounts",sql`${t.shippingMinor} between 0 and 9007199254740991 and ${t.shippingTaxMinor} between 0 and 9007199254740991 and ${t.taxMinor} between 0 and 9007199254740991`),
  check("invoice_merchant_tax_quotes_version",sql`${t.profileVersion}>0`),
  check("invoice_merchant_tax_quotes_liability",sql`${t.liability} in ('platform','seller')`),
  check("invoice_merchant_tax_quotes_digest",sql`${t.evidenceDigest} ~ '^[a-f0-9]{64}$'`),
]);

/** Each issued line has one original tax party, with an actual database FK. */
export const invoiceMerchantTaxQuoteLines = pgTable("invoice_merchant_tax_quote_lines",{
  invoiceLineId: uuid("invoice_line_id").primaryKey().references(()=>invoiceLines.id,{onDelete:"cascade"}),
  quoteId: uuid("quote_id").notNull().references(()=>invoiceMerchantTaxQuotes.id,{onDelete:"cascade"}),
},t=>[index("invoice_merchant_tax_quote_lines_quote_idx").on(t.quoteId)]);
