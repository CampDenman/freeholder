-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- Print-on-demand jobs attach to catalog orders and fulfillments, and catalog
-- SKUs map onto provider products (MASTER.md §36, C3.13). Expand-only.
CREATE TABLE "pod_sku_maps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sku" text NOT NULL,
	"provider" text NOT NULL,
	"provider_product_id" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "pod_sku_maps_sku_provider_idx" ON "pod_sku_maps" ("sku", "provider");--> statement-breakpoint
ALTER TABLE "pod_jobs" ADD COLUMN "order_id" uuid;--> statement-breakpoint
ALTER TABLE "pod_jobs" ADD COLUMN "order_item_id" uuid;--> statement-breakpoint
ALTER TABLE "pod_jobs" ADD COLUMN "fulfillment_id" uuid;--> statement-breakpoint
CREATE INDEX "pod_jobs_order_idx" ON "pod_jobs" ("order_id");--> statement-breakpoint
CREATE INDEX "pod_jobs_fulfillment_idx" ON "pod_jobs" ("fulfillment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pod_jobs_order_item_idx" ON "pod_jobs" ("order_item_id") WHERE "order_item_id" IS NOT NULL;
