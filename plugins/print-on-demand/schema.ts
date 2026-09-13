// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";

export const podSkuMaps = pgTable(
  "pod_sku_maps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sku: text("sku").notNull(),
    provider: text("provider").notNull(),
    providerProductId: text("provider_product_id").notNull(),
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
    status: text("status").notNull().default("queued"),
    payload: jsonb("payload").notNull().default({}),
    externalRef: text("external_ref"),
    lastError: text("last_error"),
    orderId: uuid("order_id"),
    orderItemId: uuid("order_item_id"),
    fulfillmentId: uuid("fulfillment_id"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("pod_jobs_status_idx").on(t.status),
    index("pod_jobs_order_idx").on(t.orderId),
    index("pod_jobs_fulfillment_idx").on(t.fulfillmentId),
    uniqueIndex("pod_jobs_order_item_idx")
      .on(t.orderItemId)
      .where(sql`${t.orderItemId} is not null`),
  ],
);
