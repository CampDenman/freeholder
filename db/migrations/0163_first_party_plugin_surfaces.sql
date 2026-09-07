-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- First-party plugin human surfaces and provider sync (MASTER.md C3.13).
-- Expand-only: nullable error/ref columns and defaults the previous release
-- never reads.
ALTER TABLE "gift_registry_items" ADD COLUMN "status" text DEFAULT 'open' NOT NULL;--> statement-breakpoint
ALTER TABLE "gift_registry_items" ADD COLUMN "invoice_id" uuid;--> statement-breakpoint
ALTER TABLE "gift_registry_items" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "pod_jobs" ADD COLUMN "external_ref" text;--> statement-breakpoint
ALTER TABLE "pod_jobs" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "marketplace_channels" ADD COLUMN "external_ref" text;--> statement-breakpoint
ALTER TABLE "marketplace_channels" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "marketplace_channels" ADD COLUMN "last_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "voice_video_artifacts" ADD COLUMN "status" text DEFAULT 'recorded' NOT NULL;--> statement-breakpoint
ALTER TABLE "voice_video_artifacts" ADD COLUMN "conversation_id" uuid;--> statement-breakpoint
ALTER TABLE "voice_video_artifacts" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "community_spaces" ADD COLUMN "access" text DEFAULT 'open' NOT NULL;
