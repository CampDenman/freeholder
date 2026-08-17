// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The shared catalog root (MASTER.md §4.2, C5.09). Options, variants,
// pricing and inventory attach to Product in later C5 milestones; none of them
// gets to invent a parallel notion of what the business sells.

import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";
import { contacts } from "@/core/contacts/schema";
import { assets } from "@/core/media/schema";
import { taxCategories } from "@/modules/invoicing/schema";
import type { BlockNode } from "@/modules/cms/blocks/types";
import {
  ATTRIBUTE_KINDS,
  BUNDLE_PRICE_MODES,
  CANCELLATION_FEE_TYPES,
  MEDIA_ROLES,
  PRICE_BREAK_MODES,
  PRICE_LIST_KINDS,
  PRICE_RULE_MODES,
  RESERVATION_STATUSES,
  BACKORDER_POLICIES,
  PRODUCT_KINDS,
  PRODUCT_STATUSES,
  PRODUCT_VISIBILITIES,
  RELATION_KINDS,
  SERVICE_ASSIGNMENTS,
  SERVICE_DEPOSIT_TYPES,
  SERVICE_LOCATION_TYPES,
  STOCK_HOLDERS,
  STOCK_REASONS,
  PURCHASE_ORDER_STATUSES,
  SHIPPING_METHOD_KINDS,
  CART_KINDS,
  CART_STATUSES,
  ORDER_STATUSES,
  FULFILLMENT_KINDS,
  FULFILLMENT_STATUSES,
  RETURN_STATUSES,
  COUPON_KINDS,
  GIFT_CARD_STATUSES,
  OFFER_RULE_KINDS,
} from "./contract";
import { forms } from "@/modules/forms/schema";
import { businessLocations } from "@/core/locations/schema";

export interface ProductSeo {
  title?: string;
  description?: string;
}

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    kind: text("kind", { enum: PRODUCT_KINDS }).notNull(),
    subtitle: text("subtitle"),
    /** Typed CMS blocks, validated by catalog services on every write. */
    description: jsonb("description").$type<BlockNode[]>().notNull().default([]),
    brand: text("brand"),
    status: text("status", { enum: PRODUCT_STATUSES }).notNull().default("draft"),
    visibility: text("visibility", { enum: PRODUCT_VISIBILITIES })
      .notNull()
      .default("public"),
    taxCategoryId: uuid("tax_category_id").references(() => taxCategories.id, {
      onDelete: "restrict",
    }),
    seo: jsonb("seo").$type<ProductSeo>().notNull().default({}),
    /**
     * Working copy (C2.01). Autosave of an active product writes here so the
     * live name/description/seo stay put until publish copies them across.
     */
    workingName: text("working_name"),
    workingSubtitle: text("working_subtitle"),
    workingDescription: jsonb("working_description").$type<BlockNode[]>(),
    workingSeo: jsonb("working_seo").$type<ProductSeo>(),
    schemaType: text("schema_type").notNull().default("Product"),
    /** First activation. Retained after archive/restore as lifecycle evidence. */
    publishedAt: timestamp("published_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    /** Compare-and-swap token for humans, API clients and agents alike. */
    version: integer("version").notNull().default(1),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("products_slug_idx").on(t.slug),
    index("products_status_updated_idx").on(t.status, t.updatedAt),
    index("products_visibility_updated_idx").on(t.visibility, t.updatedAt),
    index("products_kind_updated_idx").on(t.kind, t.updatedAt),
    index("products_tax_category_idx").on(t.taxCategoryId),
    check(
      "products_slug_valid",
      sql`char_length(${t.slug}) between 1 and 180 and ${t.slug} ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'`,
    ),
    check("products_name_valid", sql`char_length(${t.name}) between 1 and 240`),
    check(
      "products_kind_valid",
      sql`${t.kind} in ('physical','digital','service','rental','bundle','pass')`,
    ),
    check(
      "products_status_valid",
      sql`${t.status} in ('draft','active','archived')`,
    ),
    check(
      "products_visibility_valid",
      sql`${t.visibility} in ('public','unlisted','member_only')`,
    ),
    check(
      "products_schema_type_valid",
      sql`${t.schemaType} in ('Product','Service')`,
    ),
    check("products_version_positive", sql`${t.version} > 0`),
    check(
      "products_lifecycle_timestamps",
      sql`(${t.status} = 'active' and ${t.publishedAt} is not null and ${t.archivedAt} is null)
        or (${t.status} = 'draft' and ${t.archivedAt} is null)
        or (${t.status} = 'archived' and ${t.archivedAt} is not null)`,
    ),
  ],
);

/** Append-only owner-readable state and visibility history. */
export const productLifecycleEvents = pgTable(
  "product_lifecycle_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    fromStatus: text("from_status", { enum: PRODUCT_STATUSES }),
    toStatus: text("to_status", { enum: PRODUCT_STATUSES }).notNull(),
    fromVisibility: text("from_visibility", { enum: PRODUCT_VISIBILITIES }),
    toVisibility: text("to_visibility", { enum: PRODUCT_VISIBILITIES }).notNull(),
    resultingVersion: integer("resulting_version").notNull(),
    actor: text("actor").notNull(),
    reason: text("reason"),
    createdAt: createdAtColumn(),
  },
  (t) => [
    index("product_lifecycle_events_product_idx").on(t.productId, t.createdAt),
    check(
      "product_lifecycle_events_status_valid",
      sql`${t.fromStatus} is null or ${t.fromStatus} in ('draft','active','archived')`,
    ),
    check(
      "product_lifecycle_events_to_status_valid",
      sql`${t.toStatus} in ('draft','active','archived')`,
    ),
    check(
      "product_lifecycle_events_visibility_valid",
      sql`(${t.fromVisibility} is null or ${t.fromVisibility} in ('public','unlisted','member_only'))
        and ${t.toVisibility} in ('public','unlisted','member_only')`,
    ),
    check(
      "product_lifecycle_events_version_positive",
      sql`${t.resultingVersion} > 0`,
    ),
  ],
);

/** Reusable option dimensions shared across products (C5.10). */
export const optionTypes = pgTable(
  "option_types",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    code: text("code").notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("option_types_code_idx").on(t.code),
    check(
      "option_types_code_valid",
      sql`char_length(${t.code}) between 1 and 40 and ${t.code} ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'`,
    ),
    check("option_types_name_valid", sql`char_length(${t.name}) between 1 and 80`),
  ],
);

export const optionValues = pgTable(
  "option_values",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    optionTypeId: uuid("option_type_id")
      .notNull()
      .references(() => optionTypes.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    skuFragment: text("sku_fragment").notNull(),
    position: integer("position").notNull().default(0),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("option_values_type_fragment_idx").on(t.optionTypeId, t.skuFragment),
    index("option_values_type_position_idx").on(t.optionTypeId, t.position),
    check(
      "option_values_fragment_valid",
      sql`char_length(${t.skuFragment}) between 1 and 24 and ${t.skuFragment} ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'`,
    ),
    check("option_values_name_valid", sql`char_length(${t.name}) between 1 and 80`),
    check("option_values_position_valid", sql`${t.position} between 0 and 100000`),
  ],
);

export const productOptionAssignments = pgTable(
  "product_option_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    optionTypeId: uuid("option_type_id")
      .notNull()
      .references(() => optionTypes.id, { onDelete: "restrict" }),
    position: integer("position").notNull().default(0),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex("product_option_assignments_unique_idx").on(t.productId, t.optionTypeId),
    index("product_option_assignments_product_idx").on(t.productId, t.position),
    check("product_option_assignments_position_valid", sql`${t.position} between 0 and 100000`),
  ],
);

export const productOptionValueAssignments = pgTable(
  "product_option_value_assignments",
  {
    assignmentId: uuid("assignment_id")
      .notNull()
      .references(() => productOptionAssignments.id, { onDelete: "cascade" }),
    optionValueId: uuid("option_value_id")
      .notNull()
      .references(() => optionValues.id, { onDelete: "restrict" }),
  },
  (t) => [
    uniqueIndex("product_option_value_assignments_pk").on(t.assignmentId, t.optionValueId),
    index("product_option_value_assignments_value_idx").on(t.optionValueId),
  ],
);

export const productVariants = pgTable(
  "product_variants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    combinationKey: text("combination_key").notNull(),
    sku: text("sku").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    status: text("status", { enum: ["active", "archived"] }).notNull().default("active"),
    backorderPolicy: text("backorder_policy", { enum: BACKORDER_POLICIES })
      .notNull()
      .default("refuse"),
    expectedRestockAt: timestamp("expected_restock_at", { withTimezone: true }),
    requiresShipping: boolean("requires_shipping").notNull().default(true),
    weightG: integer("weight_g"),
    lengthMm: integer("length_mm"),
    widthMm: integer("width_mm"),
    heightMm: integer("height_mm"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("product_variants_combination_idx").on(t.productId, t.combinationKey),
    uniqueIndex("product_variants_sku_idx").on(t.sku),
    uniqueIndex("product_variants_default_idx")
      .on(t.productId)
      .where(sql`${t.isDefault} and ${t.status} = 'active'`),
    index("product_variants_product_status_idx").on(t.productId, t.status),
    check(
      "product_variants_sku_valid",
      sql`char_length(${t.sku}) between 1 and 180 and ${t.sku} ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'`,
    ),
    check("product_variants_status_valid", sql`${t.status} in ('active','archived')`),
    check("product_variants_combination_valid", sql`char_length(${t.combinationKey}) > 0`),
    check(
      "product_variants_backorder_valid",
      sql`${t.backorderPolicy} in ('refuse','allow_date','allow_silent')`,
    ),
    check("product_variants_weight", sql`${t.weightG} is null or ${t.weightG} >= 0`),
    check(
      "product_variants_dims",
      sql`(${t.lengthMm} is null and ${t.widthMm} is null and ${t.heightMm} is null)
        or (${t.lengthMm} > 0 and ${t.widthMm} > 0 and ${t.heightMm} > 0)`,
    ),
  ],
);

export const attributeDefinitions = pgTable(
  "attribute_definitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull(),
    label: text("label").notNull(),
    kind: text("kind", { enum: ATTRIBUTE_KINDS }).notNull(),
    unit: text("unit"),
    groupName: text("group_name"),
    isFilterable: boolean("is_filterable").notNull().default(false),
    isComparable: boolean("is_comparable").notNull().default(false),
    enumOptions: text("enum_options").array().notNull().default([]),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("attribute_definitions_key_idx").on(t.key),
    index("attribute_definitions_filter_idx").on(t.isFilterable, t.key),
    check(
      "attribute_definitions_key_valid",
      sql`char_length(${t.key}) between 1 and 40 and ${t.key} ~ '^[a-z0-9]+(?:_[a-z0-9]+)*$'`,
    ),
    check("attribute_definitions_label_valid", sql`char_length(${t.label}) between 1 and 80`),
    check(
      "attribute_definitions_kind_valid",
      sql`${t.kind} in ('text','number','bool','enum','measure')`,
    ),
    check(
      "attribute_definitions_measure_unit",
      sql`${t.kind} <> 'measure' or (${t.unit} is not null and char_length(${t.unit}) between 1 and 24)`,
    ),
  ],
);

export const productAttributes = pgTable(
  "product_attributes",
  {
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    attributeId: uuid("attribute_id")
      .notNull()
      .references(() => attributeDefinitions.id, { onDelete: "restrict" }),
    textValue: text("text_value"),
    numberValue: text("number_value"),
    boolValue: boolean("bool_value"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("product_attributes_pk").on(t.productId, t.attributeId),
    index("product_attributes_attribute_idx").on(t.attributeId),
    check(
      "product_attributes_number_valid",
      sql`${t.numberValue} is null or ${t.numberValue} ~ '^-?[0-9]+(\\.[0-9]+)?$'`,
    ),
  ],
);

export const productMedia = pgTable(
  "product_media",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id").references(() => productVariants.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "restrict" }),
    role: text("role", { enum: MEDIA_ROLES }).notNull().default("gallery"),
    position: integer("position").notNull().default(0),
    createdAt: createdAtColumn(),
  },
  (t) => [
    index("product_media_product_idx").on(t.productId, t.role, t.position),
    index("product_media_variant_idx").on(t.variantId, t.role, t.position),
    index("product_media_asset_idx").on(t.assetId),
    check(
      "product_media_role_valid",
      sql`${t.role} in ('hero','gallery','swatch','size_chart','lifestyle','360','model')`,
    ),
    check("product_media_position_valid", sql`${t.position} between 0 and 100000`),
  ],
);

export const customerGroups = pgTable(
  "customer_groups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    tag: text("tag"),
    lifecycleStage: text("lifecycle_stage"),
    taxExempt: boolean("tax_exempt").notNull().default(false),
    exemptionRef: text("exemption_ref"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("customer_groups_name_idx").on(t.name),
    check("customer_groups_name_valid", sql`char_length(${t.name}) between 1 and 80`),
    check(
      "customer_groups_tag_valid",
      sql`${t.tag} is null or (char_length(${t.tag}) between 1 and 50)`,
    ),
    check(
      "customer_groups_lifecycle_valid",
      sql`${t.lifecycleStage} is null or ${t.lifecycleStage} in ('lead','prospect','customer','repeat')`,
    ),
  ],
);

export const priceLists = pgTable(
  "price_lists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    currency: text("currency").notNull(),
    kind: text("kind", { enum: PRICE_LIST_KINDS }).notNull().default("retail"),
    customerGroupId: uuid("customer_group_id").references(() => customerGroups.id, {
      onDelete: "restrict",
    }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "restrict" }),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    priority: integer("priority").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("price_lists_resolve_idx").on(t.currency, t.active, t.kind, t.priority),
    index("price_lists_group_idx").on(t.customerGroupId),
    index("price_lists_contact_idx").on(t.contactId),
    check("price_lists_name_valid", sql`char_length(${t.name}) between 1 and 120`),
    check("price_lists_currency_valid", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check(
      "price_lists_kind_valid",
      sql`${t.kind} in ('retail','wholesale','member','sale','contract')`,
    ),
    check(
      "price_lists_contract_contact",
      sql`(${t.kind} = 'contract' and ${t.contactId} is not null) or (${t.kind} <> 'contract' and ${t.contactId} is null)`,
    ),
    check(
      "price_lists_window_valid",
      sql`${t.startsAt} is null or ${t.endsAt} is null or ${t.endsAt} > ${t.startsAt}`,
    ),
    check("price_lists_priority_valid", sql`${t.priority} between -100000 and 100000`),
  ],
);

export const priceListEntries = pgTable(
  "price_list_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    priceListId: uuid("price_list_id")
      .notNull()
      .references(() => priceLists.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    compareAtMinor: bigint("compare_at_minor", { mode: "number" }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("price_list_entries_unique_idx").on(t.priceListId, t.variantId),
    index("price_list_entries_variant_idx").on(t.variantId),
    check("price_list_entries_amount_positive", sql`${t.amountMinor} > 0`),
    check(
      "price_list_entries_compare_valid",
      sql`${t.compareAtMinor} is null or ${t.compareAtMinor} > ${t.amountMinor}`,
    ),
  ],
);

export const productRelations = pgTable(
  "product_relations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    relatedProductId: uuid("related_product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: RELATION_KINDS }).notNull(),
    position: integer("position").notNull().default(0),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex("product_relations_unique_idx").on(t.productId, t.relatedProductId, t.kind),
    index("product_relations_related_idx").on(t.relatedProductId, t.kind),
    check(
      "product_relations_kind_valid",
      sql`${t.kind} in ('upsell','cross_sell','accessory','replacement','variant_of')`,
    ),
    check("product_relations_not_self", sql`${t.productId} <> ${t.relatedProductId}`),
    check("product_relations_position_valid", sql`${t.position} between 0 and 100000`),
  ],
);

export const bundleComponents = pgTable(
  "bundle_components",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bundleProductId: uuid("bundle_product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    componentVariantId: uuid("component_variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull().default(1),
    priceMode: text("price_mode", { enum: BUNDLE_PRICE_MODES }).notNull().default("sum"),
    amountMinor: bigint("amount_minor", { mode: "number" }),
    percentOffPpm: integer("percent_off_ppm"),
    position: integer("position").notNull().default(0),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex("bundle_components_unique_idx").on(t.bundleProductId, t.componentVariantId),
    index("bundle_components_variant_idx").on(t.componentVariantId),
    check("bundle_components_qty_positive", sql`${t.quantity} > 0`),
    check(
      "bundle_components_mode_valid",
      sql`${t.priceMode} in ('sum','fixed','percent_off')`,
    ),
    check(
      "bundle_components_fixed_amount",
      sql`(${t.priceMode} <> 'fixed' and ${t.amountMinor} is null) or (${t.priceMode} = 'fixed' and ${t.amountMinor} > 0)`,
    ),
    check(
      "bundle_components_percent",
      sql`(${t.priceMode} <> 'percent_off' and ${t.percentOffPpm} is null) or (${t.priceMode} = 'percent_off' and ${t.percentOffPpm} between 1 and 1000000)`,
    ),
    check("bundle_components_position_valid", sql`${t.position} between 0 and 100000`),
  ],
);

export const priceBreaks = pgTable(
  "price_breaks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    priceListId: uuid("price_list_id")
      .notNull()
      .references(() => priceLists.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id").references(() => productVariants.id, { onDelete: "cascade" }),
    mode: text("mode", { enum: PRICE_BREAK_MODES }).notNull(),
    minQty: integer("min_qty").notNull(),
    maxQty: integer("max_qty"),
    unitAmountMinor: bigint("unit_amount_minor", { mode: "number" }),
    percentOffPpm: integer("percent_off_ppm"),
    createdAt: createdAtColumn(),
  },
  (t) => [
    index("price_breaks_list_idx").on(t.priceListId, t.variantId, t.mode, t.minQty),
    check("price_breaks_mode_valid", sql`${t.mode} in ('volume','tiered')`),
    check("price_breaks_min_positive", sql`${t.minQty} > 0`),
    check(
      "price_breaks_window_valid",
      sql`${t.maxQty} is null or ${t.maxQty} >= ${t.minQty}`,
    ),
    check(
      "price_breaks_price_xor",
      sql`(${t.unitAmountMinor} is not null and ${t.percentOffPpm} is null and ${t.unitAmountMinor} > 0)
        or (${t.unitAmountMinor} is null and ${t.percentOffPpm} between 1 and 1000000)`,
    ),
  ],
);

export const cancellationPolicies = pgTable(
  "cancellation_policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    freeUntilHours: integer("free_until_hours").notNull().default(24),
    feeType: text("fee_type", { enum: CANCELLATION_FEE_TYPES })
      .notNull()
      .default("none"),
    /** Minor units when feeType is fixed; PPM when percent. */
    feeValue: bigint("fee_value", { mode: "number" }),
    rescheduleLimit: integer("reschedule_limit").notNull().default(1),
    noShowFeeMinor: bigint("no_show_fee_minor", { mode: "number" })
      .notNull()
      .default(0),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("cancellation_policies_name_idx").on(t.name),
    check(
      "cancellation_policies_name_valid",
      sql`char_length(${t.name}) between 1 and 80`,
    ),
    check("cancellation_policies_free_hours", sql`${t.freeUntilHours} >= 0`),
    check("cancellation_policies_reschedule", sql`${t.rescheduleLimit} >= 0`),
    check("cancellation_policies_no_show", sql`${t.noShowFeeMinor} >= 0`),
    check(
      "cancellation_policies_fee_type",
      sql`${t.feeType} in ('none','fixed','percent','forfeit_deposit')`,
    ),
    check(
      "cancellation_policies_fee_value",
      sql`(${t.feeType} in ('none','forfeit_deposit') and ${t.feeValue} is null)
        or (${t.feeType} = 'fixed' and ${t.feeValue} > 0)
        or (${t.feeType} = 'percent' and ${t.feeValue} between 1 and 1000000)`,
    ),
  ],
);

export const serviceOfferings = pgTable(
  "service_offerings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    durationMin: integer("duration_min").notNull(),
    bufferBeforeMin: integer("buffer_before_min").notNull().default(0),
    bufferAfterMin: integer("buffer_after_min").notNull().default(0),
    locationType: text("location_type", { enum: SERVICE_LOCATION_TYPES }).notNull(),
    depositType: text("deposit_type", { enum: SERVICE_DEPOSIT_TYPES })
      .notNull()
      .default("none"),
    /** Minor units when depositType is fixed; PPM when percent. */
    depositValue: bigint("deposit_value", { mode: "number" }).notNull().default(0),
    cancellationPolicyId: uuid("cancellation_policy_id").references(
      () => cancellationPolicies.id,
      { onDelete: "restrict" },
    ),
    intakeFormId: uuid("intake_form_id").references(() => forms.id, {
      onDelete: "set null",
    }),
    /**
     * Reserved for C6.14 contract/waiver templates. C5.15 stores the column
     * so scheduling can attach later without a catalog rewrite.
     */
    waiverTemplateId: uuid("waiver_template_id"),
    capacity: integer("capacity").notNull().default(1),
    assignment: text("assignment", { enum: SERVICE_ASSIGNMENTS })
      .notNull()
      .default("specific"),
    /** Reserved for C6.01 calendars. Empty until that engine exists. */
    calendarIds: uuid("calendar_ids").array().notNull().default(sql`'{}'`),
    travelTimeMin: integer("travel_time_min").notNull().default(0),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("service_offerings_product_idx").on(t.productId),
    index("service_offerings_policy_idx").on(t.cancellationPolicyId),
    index("service_offerings_form_idx").on(t.intakeFormId),
    check("service_offerings_duration", sql`${t.durationMin} > 0`),
    check("service_offerings_buffer_before", sql`${t.bufferBeforeMin} >= 0`),
    check("service_offerings_buffer_after", sql`${t.bufferAfterMin} >= 0`),
    check("service_offerings_capacity", sql`${t.capacity} > 0`),
    check("service_offerings_travel", sql`${t.travelTimeMin} >= 0`),
    check(
      "service_offerings_location",
      sql`${t.locationType} in ('in_person','virtual','client_site')`,
    ),
    check(
      "service_offerings_assignment",
      sql`${t.assignment} in ('specific','pool','round_robin')`,
    ),
    check(
      "service_offerings_deposit_type",
      sql`${t.depositType} in ('none','fixed','percent')`,
    ),
    check(
      "service_offerings_deposit_value",
      sql`(${t.depositType} = 'none' and ${t.depositValue} = 0)
        or (${t.depositType} = 'fixed' and ${t.depositValue} > 0)
        or (${t.depositType} = 'percent' and ${t.depositValue} between 1 and 1000000)`,
    ),
  ],
);

export interface PriceRuleSchedule {
  installmentCount?: number;
  intervalDays?: number;
  periodDays?: number;
}

export const priceRules = pgTable(
  "price_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    mode: text("mode", { enum: PRICE_RULE_MODES }).notNull(),
    planSchedule: jsonb("plan_schedule")
      .$type<PriceRuleSchedule>()
      .notNull()
      .default({}),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("price_rules_product_mode_idx").on(t.productId, t.mode),
    index("price_rules_product_idx").on(t.productId),
    check(
      "price_rules_mode_valid",
      sql`${t.mode} in ('full','deposit_balance','payment_plan','hourly','retainer')`,
    ),
  ],
);

export const productVariantOptions = pgTable(
  "product_variant_options",
  {
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    optionTypeId: uuid("option_type_id")
      .notNull()
      .references(() => optionTypes.id, { onDelete: "restrict" }),
    optionValueId: uuid("option_value_id")
      .notNull()
      .references(() => optionValues.id, { onDelete: "restrict" }),
  },
  (t) => [
    uniqueIndex("product_variant_options_pk").on(t.variantId, t.optionTypeId),
    index("product_variant_options_value_idx").on(t.optionValueId),
  ],
);

/**
 * Stock of one variant at one location (C5.16).
 *
 * Presence is the track flag: no row means the variant is untracked and every
 * reader treats that as always available. `on_hand` is not stored — it is the
 * sum of `stock_movements.delta`.
 */
export const inventoryItems = pgTable(
  "inventory_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "restrict" }),
    locationId: uuid("location_id")
      .notNull()
      .references(() => businessLocations.id, { onDelete: "restrict" }),
    bin: text("bin"),
    /** C5.17 reads these; C5.16 stores them so procurement does not rewrite stock. */
    safetyStock: integer("safety_stock").notNull().default(0),
    reorderPoint: integer("reorder_point").notNull().default(0),
    incoming: integer("incoming").notNull().default(0),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("inventory_items_variant_location_idx").on(t.variantId, t.locationId),
    index("inventory_items_location_idx").on(t.locationId),
    check("inventory_items_safety", sql`${t.safetyStock} >= 0`),
    check("inventory_items_reorder", sql`${t.reorderPoint} >= 0`),
    check("inventory_items_incoming", sql`${t.incoming} >= 0`),
    check(
      "inventory_items_bin_valid",
      sql`${t.bin} is null or char_length(${t.bin}) between 1 and 40`,
    ),
  ],
);

export const stockMovements = pgTable(
  "stock_movements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    inventoryItemId: uuid("inventory_item_id")
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "restrict" }),
    delta: integer("delta").notNull(),
    reason: text("reason", { enum: STOCK_REASONS }).notNull(),
    referenceType: text("reference_type"),
    referenceId: uuid("reference_id"),
    actor: text("actor").notNull(),
    note: text("note"),
    createdAt: createdAtColumn(),
  },
  (t) => [
    index("stock_movements_item_idx").on(t.inventoryItemId, t.createdAt),
    index("stock_movements_reference_idx").on(t.referenceType, t.referenceId),
    check("stock_movements_delta_nonzero", sql`${t.delta} <> 0`),
    check(
      "stock_movements_reason_valid",
      sql`${t.reason} in ('sale','return','adjustment','transfer','receipt','damage','count')`,
    ),
  ],
);

export const stockReservations = pgTable(
  "stock_reservations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    inventoryItemId: uuid("inventory_item_id")
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull(),
    holderType: text("holder_type", { enum: STOCK_HOLDERS }).notNull(),
    holderId: uuid("holder_id").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    status: text("status", { enum: RESERVATION_STATUSES }).notNull().default("active"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("stock_reservations_item_status_idx").on(t.inventoryItemId, t.status, t.expiresAt),
    uniqueIndex("stock_reservations_active_holder_idx")
      .on(t.inventoryItemId, t.holderType, t.holderId)
      .where(sql`${t.status} = 'active'`),
    check("stock_reservations_qty_positive", sql`${t.quantity} > 0`),
    check(
      "stock_reservations_holder_valid",
      sql`${t.holderType} in ('cart','order','booking')`,
    ),
    check(
      "stock_reservations_status_valid",
      sql`${t.status} in ('active','consumed','released','expired')`,
    ),
  ],
);

export const suppliers = pgTable(
  "suppliers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    leadTimeDays: integer("lead_time_days").notNull().default(7),
    currency: text("currency").notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("suppliers_contact_idx").on(t.contactId),
    check("suppliers_name_valid", sql`char_length(${t.name}) between 1 and 120`),
    check("suppliers_lead_time", sql`${t.leadTimeDays} >= 0`),
    check("suppliers_currency", sql`${t.currency} ~ '^[A-Z]{3}$'`),
  ],
);

export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id, { onDelete: "restrict" }),
    locationId: uuid("location_id")
      .notNull()
      .references(() => businessLocations.id, { onDelete: "restrict" }),
    status: text("status", { enum: PURCHASE_ORDER_STATUSES }).notNull().default("draft"),
    currency: text("currency").notNull(),
    expectedAt: timestamp("expected_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("purchase_orders_supplier_idx").on(t.supplierId, t.status),
    index("purchase_orders_location_idx").on(t.locationId, t.status),
    check(
      "purchase_orders_status_valid",
      sql`${t.status} in ('draft','ordered','partial','received','cancelled')`,
    ),
    check("purchase_orders_currency", sql`${t.currency} ~ '^[A-Z]{3}$'`),
  ],
);

export const purchaseOrderLines = pgTable(
  "purchase_order_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    purchaseOrderId: uuid("purchase_order_id")
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull(),
    receivedQty: integer("received_qty").notNull().default(0),
    unitCostMinor: bigint("unit_cost_minor", { mode: "number" }).notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("purchase_order_lines_unique_idx").on(t.purchaseOrderId, t.variantId),
    index("purchase_order_lines_variant_idx").on(t.variantId),
    check("purchase_order_lines_qty", sql`${t.quantity} > 0`),
    check("purchase_order_lines_received", sql`${t.receivedQty} >= 0 and ${t.receivedQty} <= ${t.quantity}`),
    check("purchase_order_lines_cost", sql`${t.unitCostMinor} >= 0`),
  ],
);

export const backInStockSubscriptions = pgTable(
  "back_in_stock_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    locationId: uuid("location_id").references(() => businessLocations.id, {
      onDelete: "cascade",
    }),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex("back_in_stock_unique_idx").on(t.variantId, t.contactId, t.locationId),
    index("back_in_stock_contact_idx").on(t.contactId),
    index("back_in_stock_variant_idx").on(t.variantId, t.notifiedAt),
  ],
);

export const shippingZones = pgTable(
  "shipping_zones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    countries: text("countries").array().notNull().default([]),
    regions: text("regions").array().notNull().default([]),
    postalPatterns: text("postal_patterns").array().notNull().default([]),
    priority: integer("priority").notNull().default(0),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("shipping_zones_priority_idx").on(t.priority),
    check("shipping_zones_name_valid", sql`char_length(${t.name}) between 1 and 80`),
  ],
);

export const shippingMethods = pgTable(
  "shipping_methods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    zoneId: uuid("zone_id")
      .notNull()
      .references(() => shippingZones.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind", { enum: SHIPPING_METHOD_KINDS }).notNull(),
    handlingFeeMinor: bigint("handling_fee_minor", { mode: "number" }).notNull().default(0),
    amountMinor: bigint("amount_minor", { mode: "number" }),
    thresholdMinor: bigint("threshold_minor", { mode: "number" }),
    minDays: integer("min_days"),
    maxDays: integer("max_days"),
    taxable: boolean("taxable").notNull().default(true),
    locationId: uuid("location_id").references(() => businessLocations.id, {
      onDelete: "set null",
    }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("shipping_methods_zone_idx").on(t.zoneId),
    check("shipping_methods_name_valid", sql`char_length(${t.name}) between 1 and 80`),
    check(
      "shipping_methods_kind_valid",
      sql`${t.kind} in ('flat','weight','price','item','dimensional','free','pickup','local_delivery')`,
    ),
    check("shipping_methods_handling", sql`${t.handlingFeeMinor} >= 0`),
  ],
);

export const shippingRateBands = pgTable(
  "shipping_rate_bands",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    methodId: uuid("method_id")
      .notNull()
      .references(() => shippingMethods.id, { onDelete: "cascade" }),
    minValue: integer("min_value").notNull().default(0),
    maxValue: integer("max_value"),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    perUnitMinor: bigint("per_unit_minor", { mode: "number" }).notNull().default(0),
  },
  (t) => [
    index("shipping_rate_bands_method_idx").on(t.methodId, t.minValue),
    check("shipping_rate_bands_min", sql`${t.minValue} >= 0`),
    check("shipping_rate_bands_window", sql`${t.maxValue} is null or ${t.maxValue} >= ${t.minValue}`),
    check("shipping_rate_bands_amount", sql`${t.amountMinor} >= 0`),
    check("shipping_rate_bands_unit", sql`${t.perUnitMinor} >= 0`),
  ],
);

export const packagingBoxes = pgTable(
  "packaging_boxes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    innerLengthMm: integer("inner_length_mm").notNull(),
    innerWidthMm: integer("inner_width_mm").notNull(),
    innerHeightMm: integer("inner_height_mm").notNull(),
    maxWeightG: integer("max_weight_g").notNull(),
    tareWeightG: integer("tare_weight_g").notNull().default(0),
    createdAt: createdAtColumn(),
  },
  (t) => [
    check("packaging_boxes_name", sql`char_length(${t.name}) between 1 and 80`),
    check("packaging_boxes_dims", sql`${t.innerLengthMm} > 0 and ${t.innerWidthMm} > 0 and ${t.innerHeightMm} > 0`),
    check("packaging_boxes_weight", sql`${t.maxWeightG} > 0 and ${t.tareWeightG} >= 0`),
  ],
);

export const deliveryWindows = pgTable(
  "delivery_windows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    locationId: uuid("location_id")
      .notNull()
      .references(() => businessLocations.id, { onDelete: "cascade" }),
    onDate: timestamp("on_date", { withTimezone: true, mode: "date" }),
    starts: text("starts").notNull(),
    ends: text("ends").notNull(),
    capacity: integer("capacity").notNull().default(1),
    cutoffHours: integer("cutoff_hours").notNull().default(2),
    createdAt: createdAtColumn(),
  },
  (t) => [
    index("delivery_windows_location_idx").on(t.locationId),
    check("delivery_windows_capacity", sql`${t.capacity} > 0`),
    check("delivery_windows_cutoff", sql`${t.cutoffHours} >= 0`),
  ],
);

export const carts = pgTable(
  "carts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    token: text("token").notNull(),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    currency: text("currency").notNull(),
    kind: text("kind", { enum: CART_KINDS }).notNull().default("cart"),
    status: text("status", { enum: CART_STATUSES }).notNull().default("open"),
    name: text("name"),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull().defaultNow(),
    abandonedAt: timestamp("abandoned_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("carts_token_idx").on(t.token),
    index("carts_contact_status_idx").on(t.contactId, t.status, t.kind),
    check("carts_currency", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check("carts_kind_valid", sql`${t.kind} in ('cart','saved')`),
    check("carts_status_valid", sql`${t.status} in ('open','converted','abandoned')`),
  ],
);

export const cartItems = pgTable(
  "cart_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cartId: uuid("cart_id")
      .notNull()
      .references(() => carts.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "restrict" }),
    locationId: uuid("location_id").references(() => businessLocations.id, {
      onDelete: "set null",
    }),
    quantity: integer("quantity").notNull(),
    reservationId: uuid("reservation_id"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("cart_items_unique_idx").on(t.cartId, t.variantId),
    index("cart_items_variant_idx").on(t.variantId),
    check("cart_items_qty", sql`${t.quantity} > 0`),
  ],
);

export const wishlists = pgTable(
  "wishlists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    name: text("name").notNull().default("Wishlist"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("wishlists_contact_idx").on(t.contactId),
    check("wishlists_name_valid", sql`char_length(${t.name}) between 1 and 80`),
  ],
);

export const wishlistItems = pgTable(
  "wishlist_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    wishlistId: uuid("wishlist_id")
      .notNull()
      .references(() => wishlists.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex("wishlist_items_unique_idx").on(t.wishlistId, t.variantId),
    index("wishlist_items_variant_idx").on(t.variantId),
  ],
);

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "restrict" }),
    cartId: uuid("cart_id").references(() => carts.id, { onDelete: "set null" }),
    invoiceId: uuid("invoice_id"),
    currency: text("currency").notNull(),
    status: text("status", { enum: ORDER_STATUSES }).notNull().default("pending_payment"),
    subtotalMinor: bigint("subtotal_minor", { mode: "number" }).notNull().default(0),
    discountMinor: bigint("discount_minor", { mode: "number" }).notNull().default(0),
    shippingMinor: bigint("shipping_minor", { mode: "number" }).notNull().default(0),
    taxMinor: bigint("tax_minor", { mode: "number" }).notNull().default(0),
    totalMinor: bigint("total_minor", { mode: "number" }).notNull().default(0),
    couponId: uuid("coupon_id"),
    shippingMethodId: uuid("shipping_method_id"),
    shippingAddress: jsonb("shipping_address").$type<Record<string, unknown>>(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("orders_contact_idx").on(t.contactId, t.status),
    index("orders_invoice_idx").on(t.invoiceId),
    check("orders_currency", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check(
      "orders_status_valid",
      sql`${t.status} in ('pending_payment','paid','fulfilling','fulfilled','refunded','cancelled')`,
    ),
    check("orders_totals", sql`${t.subtotalMinor} >= 0 and ${t.discountMinor} >= 0 and ${t.shippingMinor} >= 0 and ${t.taxMinor} >= 0 and ${t.totalMinor} >= 0`),
  ],
);

export const orderItems = pgTable(
  "order_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull(),
    unitAmountMinor: bigint("unit_amount_minor", { mode: "number" }).notNull(),
    lineTotalMinor: bigint("line_total_minor", { mode: "number" }).notNull(),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAtColumn(),
  },
  (t) => [
    index("order_items_order_idx").on(t.orderId),
    check("order_items_qty", sql`${t.quantity} > 0`),
    check("order_items_amounts", sql`${t.unitAmountMinor} >= 0 and ${t.lineTotalMinor} >= 0`),
  ],
);

export const fulfillments = pgTable(
  "fulfillments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    locationId: uuid("location_id").references(() => businessLocations.id, { onDelete: "set null" }),
    kind: text("kind", { enum: FULFILLMENT_KINDS }).notNull().default("physical"),
    status: text("status", { enum: FULFILLMENT_STATUSES }).notNull().default("pending"),
    boxId: uuid("box_id").references(() => packagingBoxes.id, { onDelete: "set null" }),
    weightG: integer("weight_g"),
    carrier: text("carrier"),
    service: text("service"),
    trackingNumber: text("tracking_number"),
    trackingUrl: text("tracking_url"),
    shippedAt: timestamp("shipped_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    note: text("note"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("fulfillments_order_idx").on(t.orderId, t.status),
    index("fulfillments_location_idx").on(t.locationId, t.status),
    check("fulfillments_kind_valid", sql`${t.kind} in ('physical','digital')`),
    check(
      "fulfillments_status_valid",
      sql`${t.status} in ('pending','picking','packed','shipped','delivered','failed','returned')`,
    ),
    check("fulfillments_weight", sql`${t.weightG} is null or ${t.weightG} >= 0`),
  ],
);

export const fulfillmentItems = pgTable(
  "fulfillment_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fulfillmentId: uuid("fulfillment_id")
      .notNull()
      .references(() => fulfillments.id, { onDelete: "cascade" }),
    orderItemId: uuid("order_item_id")
      .notNull()
      .references(() => orderItems.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex("fulfillment_items_unique_idx").on(t.fulfillmentId, t.orderItemId),
    index("fulfillment_items_order_item_idx").on(t.orderItemId),
    check("fulfillment_items_qty", sql`${t.quantity} > 0`),
  ],
);

export const digitalDeliveries = pgTable(
  "digital_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    orderItemId: uuid("order_item_id")
      .notNull()
      .references(() => orderItems.id, { onDelete: "restrict" }),
    token: text("token").notNull(),
    assetId: uuid("asset_id"),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
    downloadedAt: timestamp("downloaded_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex("digital_deliveries_token_idx").on(t.token),
    uniqueIndex("digital_deliveries_line_idx").on(t.orderItemId),
    index("digital_deliveries_order_idx").on(t.orderId),
  ],
);

export const returnRequests = pgTable(
  "return_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "restrict" }),
    status: text("status", { enum: RETURN_STATUSES }).notNull().default("requested"),
    reason: text("reason").notNull(),
    restock: boolean("restock").notNull().default(true),
    labelUrl: text("label_url"),
    creditNoteId: uuid("credit_note_id"),
    refundId: uuid("refund_id"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("return_requests_order_idx").on(t.orderId, t.status),
    index("return_requests_contact_idx").on(t.contactId, t.status),
    check(
      "return_requests_status_valid",
      sql`${t.status} in ('requested','approved','received','refunded','rejected')`,
    ),
    check("return_requests_reason", sql`char_length(${t.reason}) between 3 and 1000`),
  ],
);

export const returnItems = pgTable(
  "return_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    returnId: uuid("return_id")
      .notNull()
      .references(() => returnRequests.id, { onDelete: "cascade" }),
    orderItemId: uuid("order_item_id")
      .notNull()
      .references(() => orderItems.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull(),
    restockedQuantity: integer("restocked_quantity").notNull().default(0),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex("return_items_unique_idx").on(t.returnId, t.orderItemId),
    index("return_items_order_item_idx").on(t.orderItemId),
    check("return_items_qty", sql`${t.quantity} > 0`),
    check("return_items_restocked", sql`${t.restockedQuantity} >= 0 and ${t.restockedQuantity} <= ${t.quantity}`),
  ],
);

export const coupons = pgTable(
  "coupons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    kind: text("kind", { enum: COUPON_KINDS }).notNull(),
    percentOffPpm: integer("percent_off_ppm"),
    amountMinor: bigint("amount_minor", { mode: "number" }),
    currency: text("currency"),
    minSubtotalMinor: bigint("min_subtotal_minor", { mode: "number" }).notNull().default(0),
    maxRedemptions: integer("max_redemptions"),
    perContactLimit: integer("per_contact_limit").notNull().default(1),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    active: boolean("active").notNull().default(true),
    recovery: boolean("recovery").notNull().default(false),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("coupons_code_idx").on(t.code),
    check("coupons_code_valid", sql`${t.code} ~ '^[A-Z0-9][A-Z0-9-]{2,31}$'`),
    check("coupons_kind_valid", sql`${t.kind} in ('percent','fixed','free_shipping')`),
    check("coupons_percent", sql`${t.percentOffPpm} is null or (${t.percentOffPpm} > 0 and ${t.percentOffPpm} <= 1000000)`),
    check("coupons_amount", sql`${t.amountMinor} is null or ${t.amountMinor} > 0`),
    check("coupons_currency", sql`${t.currency} is null or ${t.currency} ~ '^[A-Z]{3}$'`),
    check("coupons_min", sql`${t.minSubtotalMinor} >= 0`),
    check("coupons_limits", sql`(${t.maxRedemptions} is null or ${t.maxRedemptions} > 0) and ${t.perContactLimit} > 0`),
  ],
);

export const couponRedemptions = pgTable(
  "coupon_redemptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    couponId: uuid("coupon_id")
      .notNull()
      .references(() => coupons.id, { onDelete: "restrict" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "restrict" }),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
    cartId: uuid("cart_id").references(() => carts.id, { onDelete: "set null" }),
    discountMinor: bigint("discount_minor", { mode: "number" }).notNull().default(0),
    createdAt: createdAtColumn(),
  },
  (t) => [
    index("coupon_redemptions_coupon_idx").on(t.couponId, t.createdAt),
    index("coupon_redemptions_contact_idx").on(t.contactId, t.couponId),
    check("coupon_redemptions_discount", sql`${t.discountMinor} >= 0`),
  ],
);

export const cartCoupons = pgTable(
  "cart_coupons",
  {
    cartId: uuid("cart_id")
      .notNull()
      .references(() => carts.id, { onDelete: "cascade" }),
    couponId: uuid("coupon_id")
      .notNull()
      .references(() => coupons.id, { onDelete: "cascade" }),
    createdAt: createdAtColumn(),
  },
  (t) => [uniqueIndex("cart_coupons_pk").on(t.cartId, t.couponId)],
);

export const giftCards = pgTable(
  "gift_cards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    currency: text("currency").notNull(),
    issuedMinor: bigint("issued_minor", { mode: "number" }).notNull(),
    remainingMinor: bigint("remaining_minor", { mode: "number" }).notNull(),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    status: text("status", { enum: GIFT_CARD_STATUSES }).notNull().default("active"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    note: text("note"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("gift_cards_code_idx").on(t.code),
    index("gift_cards_contact_idx").on(t.contactId, t.status),
    check("gift_cards_code_valid", sql`${t.code} ~ '^[A-Z0-9][A-Z0-9-]{7,31}$'`),
    check("gift_cards_currency", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check("gift_cards_status_valid", sql`${t.status} in ('active','redeemed','void')`),
    check("gift_cards_amounts", sql`${t.issuedMinor} > 0 and ${t.remainingMinor} >= 0 and ${t.remainingMinor} <= ${t.issuedMinor}`),
  ],
);

export const giftCardRedemptions = pgTable(
  "gift_card_redemptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    giftCardId: uuid("gift_card_id")
      .notNull()
      .references(() => giftCards.id, { onDelete: "restrict" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "restrict" }),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => [
    index("gift_card_redemptions_card_idx").on(t.giftCardId),
    index("gift_card_redemptions_contact_idx").on(t.contactId),
    check("gift_card_redemptions_amount", sql`${t.amountMinor} > 0`),
  ],
);

export const offerRules = pgTable(
  "offer_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind", { enum: OFFER_RULE_KINDS }).notNull(),
    name: text("name").notNull(),
    triggerVariantId: uuid("trigger_variant_id").references(() => productVariants.id, { onDelete: "cascade" }),
    offerVariantId: uuid("offer_variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "restrict" }),
    active: boolean("active").notNull().default(true),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("offer_rules_kind_idx").on(t.kind, t.active),
    check("offer_rules_kind_valid", sql`${t.kind} in ('bump','post_add')`),
    check("offer_rules_name_valid", sql`char_length(${t.name}) between 1 and 80`),
  ],
);

export const cartRecoveries = pgTable(
  "cart_recoveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cartId: uuid("cart_id")
      .notNull()
      .references(() => carts.id, { onDelete: "cascade" }),
    couponId: uuid("coupon_id").references(() => coupons.id, { onDelete: "set null" }),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
    recoveredAt: timestamp("recovered_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("cart_recoveries_cart_idx").on(t.cartId)],
);
