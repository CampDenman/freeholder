CREATE TABLE "delivery_windows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"on_date" timestamp with time zone,
	"starts" text NOT NULL,
	"ends" text NOT NULL,
	"capacity" integer DEFAULT 1 NOT NULL,
	"cutoff_hours" integer DEFAULT 2 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_windows_capacity" CHECK ("delivery_windows"."capacity" > 0),
	CONSTRAINT "delivery_windows_cutoff" CHECK ("delivery_windows"."cutoff_hours" >= 0)
);
--> statement-breakpoint
CREATE TABLE "packaging_boxes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"inner_length_mm" integer NOT NULL,
	"inner_width_mm" integer NOT NULL,
	"inner_height_mm" integer NOT NULL,
	"max_weight_g" integer NOT NULL,
	"tare_weight_g" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "packaging_boxes_name" CHECK (char_length("packaging_boxes"."name") between 1 and 80),
	CONSTRAINT "packaging_boxes_dims" CHECK ("packaging_boxes"."inner_length_mm" > 0 and "packaging_boxes"."inner_width_mm" > 0 and "packaging_boxes"."inner_height_mm" > 0),
	CONSTRAINT "packaging_boxes_weight" CHECK ("packaging_boxes"."max_weight_g" > 0 and "packaging_boxes"."tare_weight_g" >= 0)
);
--> statement-breakpoint
CREATE TABLE "shipping_methods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"zone_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"handling_fee_minor" bigint DEFAULT 0 NOT NULL,
	"amount_minor" bigint,
	"threshold_minor" bigint,
	"min_days" integer,
	"max_days" integer,
	"taxable" boolean DEFAULT true NOT NULL,
	"location_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipping_methods_name_valid" CHECK (char_length("shipping_methods"."name") between 1 and 80),
	CONSTRAINT "shipping_methods_kind_valid" CHECK ("shipping_methods"."kind" in ('flat','weight','price','item','dimensional','free','pickup','local_delivery')),
	CONSTRAINT "shipping_methods_handling" CHECK ("shipping_methods"."handling_fee_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "shipping_rate_bands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"method_id" uuid NOT NULL,
	"min_value" integer DEFAULT 0 NOT NULL,
	"max_value" integer,
	"amount_minor" bigint NOT NULL,
	"per_unit_minor" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "shipping_rate_bands_min" CHECK ("shipping_rate_bands"."min_value" >= 0),
	CONSTRAINT "shipping_rate_bands_window" CHECK ("shipping_rate_bands"."max_value" is null or "shipping_rate_bands"."max_value" >= "shipping_rate_bands"."min_value"),
	CONSTRAINT "shipping_rate_bands_amount" CHECK ("shipping_rate_bands"."amount_minor" >= 0),
	CONSTRAINT "shipping_rate_bands_unit" CHECK ("shipping_rate_bands"."per_unit_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "shipping_zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"countries" text[] DEFAULT '{}' NOT NULL,
	"regions" text[] DEFAULT '{}' NOT NULL,
	"postal_patterns" text[] DEFAULT '{}' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipping_zones_name_valid" CHECK (char_length("shipping_zones"."name") between 1 and 80)
);
--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "requires_shipping" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "weight_g" integer;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "length_mm" integer;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "width_mm" integer;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "height_mm" integer;--> statement-breakpoint
ALTER TABLE "delivery_windows" ADD CONSTRAINT "delivery_windows_location_id_business_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."business_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipping_methods" ADD CONSTRAINT "shipping_methods_zone_id_shipping_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."shipping_zones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipping_methods" ADD CONSTRAINT "shipping_methods_location_id_business_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."business_locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipping_rate_bands" ADD CONSTRAINT "shipping_rate_bands_method_id_shipping_methods_id_fk" FOREIGN KEY ("method_id") REFERENCES "public"."shipping_methods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "delivery_windows_location_idx" ON "delivery_windows" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "shipping_methods_zone_idx" ON "shipping_methods" USING btree ("zone_id");--> statement-breakpoint
CREATE INDEX "shipping_rate_bands_method_idx" ON "shipping_rate_bands" USING btree ("method_id","min_value");--> statement-breakpoint
CREATE INDEX "shipping_zones_priority_idx" ON "shipping_zones" USING btree ("priority");--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_weight" CHECK ("product_variants"."weight_g" is null or "product_variants"."weight_g" >= 0);--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_dims" CHECK (("product_variants"."length_mm" is null and "product_variants"."width_mm" is null and "product_variants"."height_mm" is null)
        or ("product_variants"."length_mm" > 0 and "product_variants"."width_mm" > 0 and "product_variants"."height_mm" > 0));