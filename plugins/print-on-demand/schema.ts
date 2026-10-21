// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { contacts } from "@/core/contacts/schema";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";

export const podSkuMaps = pgTable(
  "pod_sku_maps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sku: text("sku").notNull(),
    provider: text("provider").notNull(),
    providerProductId: text("provider_product_id").notNull(),
    providerVariantId: integer("provider_variant_id"),
    payload: jsonb("payload").notNull().default({}),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [uniqueIndex("pod_sku_maps_sku_provider_idx").on(t.sku, t.provider)],
);

export const podJobs = pgTable(
  "pod_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sku: text("sku").notNull(),
    provider: text("provider").notNull(),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("queued"),
    payload: jsonb("payload").notNull().default({}),
    externalRef: text("external_ref"),
    lastError: text("last_error"),
    providerStatus: text("provider_status"),
    providerAccountId: text("provider_account_id"),
    providerLeaseToken: uuid("provider_lease_token"),
    providerLeaseExpiresAt: timestamp("provider_lease_expires_at", { withTimezone: true }),
    shipments: jsonb("shipments").$type<Array<{ carrier: string; number: string; url: string | null; deliveredAt: string | null }>>().notNull().default([]),
    orderId: uuid("order_id"),
    orderItemId: uuid("order_item_id"),
    fulfillmentId: uuid("fulfillment_id"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("pod_jobs_status_idx").on(t.status),
    index("pod_jobs_contact_idx").on(t.contactId),
    index("pod_jobs_order_idx").on(t.orderId),
    index("pod_jobs_fulfillment_idx").on(t.fulfillmentId),
    uniqueIndex("pod_jobs_order_item_idx")
      .on(t.orderItemId)
      .where(sql`${t.orderItemId} is not null`),
  ],
);
