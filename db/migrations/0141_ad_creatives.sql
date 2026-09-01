-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
--
-- The thing an ad slot actually renders (MASTER.md §4.16, C9.18).
--
-- C9.17 shipped inventory that deliberately served nothing. This is the row
-- that fills it, and §4.16 says whose row it is first: "In-house first. The
-- default inventory is the owner's own: an uploaded asset from core/media, a
-- headline and a click URL. That is the case that must be excellent."
--
-- Two kinds only, `image` and `native`. §4.16 also names `html_tag` and
-- `provider`, and both carry somebody else's script — which means consent
-- gating, disclosure at the moment of pasting, and generated ads.txt. That is
-- C9.20's entire subject, and columns for it now would be storage nothing
-- reads.
--
-- width/height sit on the creative rather than being read off the asset,
-- because the size is a contract with the slot: §4.16 reserves the hole from
-- the declared size at every breakpoint, and an advertiser who supplied a
-- retina file for a 728x90 leaderboard has still bought a 728x90.
CREATE TABLE "ad_creatives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"line_item_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"asset_id" uuid,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"click_url" text NOT NULL,
	"alt_text" text,
	"headline" text,
	"body" text,
	"cta_label" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"review_state" text DEFAULT 'pending' NOT NULL,
	"review_note" text,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ad_creatives" ADD CONSTRAINT "ad_creatives_line_item_id_ad_line_items_id_fk" FOREIGN KEY ("line_item_id") REFERENCES "public"."ad_line_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Restrict, not cascade: an image somebody is paying to run should not vanish
-- because it was tidied out of the media library. Catalog makes the same
-- choice for a product image, and for the same reason.
ALTER TABLE "ad_creatives" ADD CONSTRAINT "ad_creatives_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ad_creatives_line_item_idx" ON "ad_creatives" USING btree ("line_item_id");--> statement-breakpoint
-- The serving query's shape: everything eligible, in one pass.
CREATE INDEX "ad_creatives_servable_idx" ON "ad_creatives" USING btree ("status","review_state");
