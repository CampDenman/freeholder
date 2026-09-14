-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C3.13: mapped Printify variants, fenced provider work and real tracking.
ALTER TABLE "pod_sku_maps" ADD COLUMN "provider_variant_id" integer;
--> statement-breakpoint
ALTER TABLE "pod_jobs" ADD COLUMN "contact_id" uuid REFERENCES "contacts"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "pod_jobs" ADD COLUMN "provider_status" text;
--> statement-breakpoint
ALTER TABLE "pod_jobs" ADD COLUMN "provider_account_id" text;
--> statement-breakpoint
ALTER TABLE "pod_jobs" ADD COLUMN "provider_lease_token" uuid;
--> statement-breakpoint
ALTER TABLE "pod_jobs" ADD COLUMN "provider_lease_expires_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "pod_jobs" ADD COLUMN "shipments" jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
CREATE INDEX "pod_jobs_contact_idx" ON "pod_jobs" ("contact_id");
--> statement-breakpoint
UPDATE "pod_jobs" SET "contact_id" = "orders"."contact_id"
FROM "orders" WHERE "pod_jobs"."order_id" = "orders"."id";
