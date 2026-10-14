-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C12.08 (MASTER.md §44.8): members list things for sale on the catalog.
ALTER TABLE "products" ADD COLUMN "seller_user_id" uuid;
--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_seller_user_id_users_id_fk" FOREIGN KEY ("seller_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "products_seller_idx" ON "products" USING btree ("seller_user_id","status");
--> statement-breakpoint
ALTER TABLE "member_settings" ADD COLUMN "marketplace_enabled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "member_settings" ADD COLUMN "listing_review" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
CREATE TABLE "member_listings" (
	"product_id" uuid PRIMARY KEY NOT NULL,
	"seller_id" uuid NOT NULL,
	"review" text NOT NULL,
	"review_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	CONSTRAINT "member_listings_review_valid" CHECK ("member_listings"."review" in ('pending','approved','rejected'))
);
--> statement-breakpoint
ALTER TABLE "member_listings" ADD CONSTRAINT "member_listings_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "member_listings" ADD CONSTRAINT "member_listings_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "member_listings_seller_idx" ON "member_listings" USING btree ("seller_id","created_at");
--> statement-breakpoint
CREATE INDEX "member_listings_review_idx" ON "member_listings" USING btree ("review","created_at");
