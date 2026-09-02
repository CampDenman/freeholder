-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
--
-- Ad measurement (MASTER.md §4.16, C9.19).
--
-- Additive: a daily rollup of first-party events, and two columns so a
-- campaign is only reconciled against its invoice once.
ALTER TABLE "ad_campaigns" ADD COLUMN "reconciled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD COLUMN "reconciled_delivered_minor" integer;--> statement-breakpoint

CREATE TABLE "ad_stats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"line_item_id" uuid NOT NULL,
	"creative_id" uuid NOT NULL,
	"slot_id" uuid NOT NULL,
	"day" date NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"viewable_impressions" integer DEFAULT 0 NOT NULL,
	"uniques" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"spend_cents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ad_stats" ADD CONSTRAINT "ad_stats_line_item_id_ad_line_items_id_fk" FOREIGN KEY ("line_item_id") REFERENCES "public"."ad_line_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_stats" ADD CONSTRAINT "ad_stats_creative_id_ad_creatives_id_fk" FOREIGN KEY ("creative_id") REFERENCES "public"."ad_creatives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_stats" ADD CONSTRAINT "ad_stats_slot_id_ad_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."ad_slots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ad_stats_grain_idx" ON "ad_stats" USING btree ("line_item_id","creative_id","slot_id","day");--> statement-breakpoint
CREATE INDEX "ad_stats_day_idx" ON "ad_stats" USING btree ("day");--> statement-breakpoint
CREATE INDEX "ad_stats_line_item_idx" ON "ad_stats" USING btree ("line_item_id");
