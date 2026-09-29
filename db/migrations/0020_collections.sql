-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C3.25 slice 1: product taxonomy. A collection groups products for public
-- browse at /c/<slug>; membership is either manual rows in collection_products
-- or derived from one saved segment by the recompute job. Trash, never
-- deletion (C11.14): trashed_at keeps the row and its slug recoverable.
CREATE TABLE "collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"seo" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"rule_type" text DEFAULT 'manual' NOT NULL,
	"rule_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sort_order" text DEFAULT 'manual' NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"image_id" uuid,
	"trashed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collections_slug_valid" CHECK (char_length("slug") between 1 and 180 and "slug" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
	CONSTRAINT "collections_title_valid" CHECK (char_length("title") between 1 and 240),
	CONSTRAINT "collections_rule_type_valid" CHECK ("rule_type" in ('manual','segment')),
	CONSTRAINT "collections_sort_order_valid" CHECK ("sort_order" in ('manual','title','newest')),
	CONSTRAINT "collections_segment_rule_config" CHECK (("rule_type" = 'segment') = ("rule_config" ? 'segmentId')),
	CONSTRAINT "collections_version_positive" CHECK ("version" > 0)
);
--> statement-breakpoint
CREATE TABLE "collection_products" (
	"collection_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collection_products_position_valid" CHECK ("position" between 0 and 100000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "collections_slug_idx" ON "collections" ("slug");
--> statement-breakpoint
CREATE INDEX "collections_published_idx" ON "collections" ("published","updated_at");
--> statement-breakpoint
CREATE INDEX "collections_rule_idx" ON "collections" ("rule_type");
--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_image_id_assets_id_fk" FOREIGN KEY ("image_id") REFERENCES "assets"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "collection_products" ADD CONSTRAINT "collection_products_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "collections"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "collection_products" ADD CONSTRAINT "collection_products_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "collection_products_unique_idx" ON "collection_products" ("collection_id","product_id");
--> statement-breakpoint
CREATE INDEX "collection_products_product_idx" ON "collection_products" ("product_id");
--> statement-breakpoint
CREATE INDEX "collection_products_position_idx" ON "collection_products" ("collection_id","position");
