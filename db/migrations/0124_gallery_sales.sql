-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
--
-- Print and digital sales from a gallery (MASTER.md §4.5, C8.08).
--
-- §4.5 is explicit: "GalleryItem links to ProductVariant price sheets →
-- standard Order flow. No parallel commerce path." So the sheet is a link and
-- nothing else — the variant already owns price, stock and tax, and a second
-- opinion about the price of an 8x10 is how two answers to one question get
-- shipped.
CREATE TABLE "gallery_price_sheet_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gallery_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gallery_price_sheet_items" ADD CONSTRAINT "gallery_price_sheet_items_gallery_id_galleries_id_fk" FOREIGN KEY ("gallery_id") REFERENCES "public"."galleries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gallery_price_sheet_unique_idx" ON "gallery_price_sheet_items" USING btree ("gallery_id","variant_id");--> statement-breakpoint
CREATE INDEX "gallery_price_sheet_order_idx" ON "gallery_price_sheet_items" USING btree ("gallery_id","position");--> statement-breakpoint

-- Provenance travels on the commerce line itself, not beside it.
--
-- The old unique index was (cart_id, variant_id), which merges lines. Two
-- photographs ordered as the same 8x10 would have become one line of quantity
-- two, and the lab would have had no idea which images to print. It is
-- replaced by two partial indexes: ordinary shopping still merges, and a
-- gallery sale is one line per photograph.
ALTER TABLE "cart_items" ADD COLUMN "gallery_id" uuid;--> statement-breakpoint
ALTER TABLE "cart_items" ADD COLUMN "asset_id" uuid;--> statement-breakpoint
DROP INDEX IF EXISTS "cart_items_unique_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "cart_items_unique_idx" ON "cart_items" USING btree ("cart_id","variant_id") WHERE "cart_items"."asset_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "cart_items_gallery_unique_idx" ON "cart_items" USING btree ("cart_id","variant_id","asset_id") WHERE "cart_items"."asset_id" is not null;--> statement-breakpoint
CREATE INDEX "cart_items_gallery_idx" ON "cart_items" USING btree ("gallery_id");--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_provenance" CHECK (("cart_items"."gallery_id" is null and "cart_items"."asset_id" is null) or ("cart_items"."gallery_id" is not null and "cart_items"."asset_id" is not null));--> statement-breakpoint

ALTER TABLE "order_items" ADD COLUMN "gallery_id" uuid;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "asset_id" uuid;--> statement-breakpoint
CREATE INDEX "order_items_gallery_idx" ON "order_items" USING btree ("gallery_id");--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_provenance" CHECK (("order_items"."gallery_id" is null and "order_items"."asset_id" is null) or ("order_items"."gallery_id" is not null and "order_items"."asset_id" is not null));
