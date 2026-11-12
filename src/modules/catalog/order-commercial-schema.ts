// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: freeze source commercial authority before a draft invoice exists.
import {sql} from "drizzle-orm";
import {bigint,check,foreignKey,index,integer,jsonb,pgTable,text,timestamp,uniqueIndex,uuid} from "drizzle-orm/pg-core";
import {createdAtColumn} from "@/core/db/columns";
import {contacts} from "@/core/contacts/schema";
import type {TaxAddress} from "@/adapters/tax";
import type {PublicMerchantSupport} from "@/core/commerce/merchant-identity";
import {merchantTaxProfiles,merchantTaxProfileVersions} from "@/modules/invoicing/merchant-tax-schema";
import {orders,orderItems} from "./schema";
export const orderCommercialPolicies=pgTable("order_commercial_policies",{
 orderId:uuid("order_id").primaryKey().references(()=>orders.id,{onDelete:"cascade"}),
 model:text("model",{enum:["hold","instant","seller_merchant"]}).notNull(),adapter:text("adapter").notNull(),
 siteFeeBps:integer("site_fee_bps").notNull(),holdDays:integer("hold_days").notNull(),
 collectionKind:text("collection_kind",{enum:["direct","destination"]}),providerPlatformAccountId:text("provider_platform_account_id"),
 taxDestination:jsonb("tax_destination").$type<TaxAddress>(),acceptedQuoteDigest:text("accepted_quote_digest"),acceptedCommercialDigest:text("accepted_commercial_digest"),
 buyerErasedAt:timestamp("buyer_erased_at",{withTimezone:true}),createdAt:createdAtColumn(),
},t=>[check("order_commercial_policies_terms",sql`${t.siteFeeBps} between 0 and 10000 and ${t.holdDays} between 0 and 365 and ${t.model} in ('hold','instant','seller_merchant')`),check("order_commercial_policies_digest",sql`${t.acceptedQuoteDigest} is null or ${t.acceptedQuoteDigest} ~ '^[a-f0-9]{64}$'`)]);
export const orderCommercialParties=pgTable("order_commercial_parties",{
 id:uuid("id").primaryKey().defaultRandom(),orderId:uuid("order_id").notNull().references(()=>orderCommercialPolicies.orderId,{onDelete:"cascade"}),
 sellerUserId:uuid("seller_user_id"),sellerKey:text("seller_key").notNull(),
 merchantContactId:uuid("merchant_contact_id").references(()=>contacts.id,{onDelete:"restrict"}),
 merchantName:text("merchant_name").notNull(),merchantSupport:jsonb("merchant_support").$type<PublicMerchantSupport>(),recipientAccountId:text("recipient_account_id"),
 profileId:uuid("profile_id").notNull().references(()=>merchantTaxProfiles.id,{onDelete:"restrict"}),profileVersion:integer("profile_version").notNull(),
 liability:text("liability",{enum:["platform","seller"]}).notNull(),shippingMinor:bigint("shipping_minor",{mode:"number"}).notNull(),merchantErasedAt:timestamp("merchant_erased_at",{withTimezone:true}),
 createdAt:createdAtColumn(),
},t=>[uniqueIndex("order_commercial_parties_owner_idx").on(t.orderId,t.sellerKey),index("order_commercial_parties_contact_idx").on(t.merchantContactId),
 foreignKey({name:"order_commercial_parties_tax_version_fk",columns:[t.profileId,t.profileVersion],foreignColumns:[merchantTaxProfileVersions.profileId,merchantTaxProfileVersions.version]}).onDelete("restrict"),
 check("order_commercial_parties_owner",sql`(${t.sellerUserId} is null and ${t.sellerKey}='site' and ${t.merchantContactId} is null and ${t.liability}='platform' and ${t.recipientAccountId} is null) or (${t.sellerUserId} is not null and ${t.sellerKey}='seller:'||${t.sellerUserId}::text and ${t.liability}='seller')`),
 check("order_commercial_parties_amount",sql`${t.shippingMinor} between 0 and 9007199254740991 and ${t.profileVersion}>0`)]);
export const orderCommercialLines=pgTable("order_commercial_lines",{
 orderItemId:uuid("order_item_id").primaryKey().references(()=>orderItems.id,{onDelete:"cascade"}),
 partyId:uuid("party_id").notNull().references(()=>orderCommercialParties.id,{onDelete:"cascade"}),position:integer("position").notNull(),
},t=>[index("order_commercial_lines_party_idx").on(t.partyId),check("order_commercial_lines_position",sql`${t.position}>=0`)]);
