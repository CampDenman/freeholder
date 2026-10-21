-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C3.13: owner-storage recording import (voice/video) and Shopify refund
-- reconciliation (marketplace). Import state and storage keys live on the
-- recording row; refund reconciliation is keyed per provider refund.
ALTER TABLE "voice_video_artifacts" ADD COLUMN "import_status" text;
--> statement-breakpoint
ALTER TABLE "voice_video_artifacts" ADD COLUMN "storage_key" text;
--> statement-breakpoint
ALTER TABLE "voice_video_artifacts" ADD COLUMN "storage_content_type" text;
--> statement-breakpoint
ALTER TABLE "voice_video_artifacts" ADD COLUMN "storage_checksum_sha256" text;
--> statement-breakpoint
ALTER TABLE "voice_video_artifacts" ADD COLUMN "transcript_storage_key" text;
--> statement-breakpoint
ALTER TABLE "voice_video_artifacts" ADD COLUMN "imported_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "voice_video_artifacts" ADD COLUMN "import_error" text;
--> statement-breakpoint
CREATE TABLE "marketplace_refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" uuid NOT NULL,
	"order_external_ref" text NOT NULL,
	"external_ref" text NOT NULL,
	"invoice_id" uuid,
	"credit_note_id" uuid,
	"amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"status" text DEFAULT 'pending_order' NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "marketplace_refunds" ADD CONSTRAINT "marketplace_refunds_channel_id_marketplace_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."marketplace_channels"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "marketplace_refunds_channel_external_idx" ON "marketplace_refunds" USING btree ("channel_id","external_ref");
--> statement-breakpoint
CREATE INDEX "marketplace_refunds_channel_idx" ON "marketplace_refunds" USING btree ("channel_id");
--> statement-breakpoint
CREATE INDEX "marketplace_refunds_order_idx" ON "marketplace_refunds" USING btree ("channel_id","order_external_ref");
