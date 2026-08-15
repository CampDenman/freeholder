// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The shared catalog root (MASTER.md §4.2, C5.09). Options, variants,
// pricing and inventory attach to Product in later C5 milestones; none of them
// gets to invent a parallel notion of what the business sells.

import { sql } from "drizzle-orm";
import {
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
import { taxCategories } from "@/modules/invoicing/schema";
import type { BlockNode } from "@/modules/cms/blocks/types";
import {
  PRODUCT_KINDS,
  PRODUCT_STATUSES,
  PRODUCT_VISIBILITIES,
} from "./contract";

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
