CREATE TABLE "product_lifecycle_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"from_visibility" text,
	"to_visibility" text NOT NULL,
	"resulting_version" integer NOT NULL,
	"actor" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_lifecycle_events_status_valid" CHECK ("product_lifecycle_events"."from_status" is null or "product_lifecycle_events"."from_status" in ('draft','active','archived')),
	CONSTRAINT "product_lifecycle_events_to_status_valid" CHECK ("product_lifecycle_events"."to_status" in ('draft','active','archived')),
	CONSTRAINT "product_lifecycle_events_visibility_valid" CHECK (("product_lifecycle_events"."from_visibility" is null or "product_lifecycle_events"."from_visibility" in ('public','unlisted','member_only'))
        and "product_lifecycle_events"."to_visibility" in ('public','unlisted','member_only')),
	CONSTRAINT "product_lifecycle_events_version_positive" CHECK ("product_lifecycle_events"."resulting_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"kind" text NOT NULL,
	"subtitle" text,
	"description" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"brand" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"tax_category_id" uuid,
	"seo" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"schema_type" text DEFAULT 'Product' NOT NULL,
	"published_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_slug_valid" CHECK (char_length("products"."slug") between 1 and 180 and "products"."slug" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
	CONSTRAINT "products_name_valid" CHECK (char_length("products"."name") between 1 and 240),
	CONSTRAINT "products_kind_valid" CHECK ("products"."kind" in ('physical','digital','service','rental','bundle','pass')),
	CONSTRAINT "products_status_valid" CHECK ("products"."status" in ('draft','active','archived')),
	CONSTRAINT "products_visibility_valid" CHECK ("products"."visibility" in ('public','unlisted','member_only')),
	CONSTRAINT "products_schema_type_valid" CHECK ("products"."schema_type" in ('Product','Service')),
	CONSTRAINT "products_version_positive" CHECK ("products"."version" > 0),
	CONSTRAINT "products_lifecycle_timestamps" CHECK (("products"."status" = 'active' and "products"."published_at" is not null and "products"."archived_at" is null)
        or ("products"."status" = 'draft' and "products"."archived_at" is null)
        or ("products"."status" = 'archived' and "products"."archived_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "product_lifecycle_events" ADD CONSTRAINT "product_lifecycle_events_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_tax_category_id_tax_categories_id_fk" FOREIGN KEY ("tax_category_id") REFERENCES "public"."tax_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_lifecycle_events_product_idx" ON "product_lifecycle_events" USING btree ("product_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "products_slug_idx" ON "products" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "products_status_updated_idx" ON "products" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "products_visibility_updated_idx" ON "products" USING btree ("visibility","updated_at");--> statement-breakpoint
CREATE INDEX "products_kind_updated_idx" ON "products" USING btree ("kind","updated_at");--> statement-breakpoint
CREATE INDEX "products_tax_category_idx" ON "products" USING btree ("tax_category_id");