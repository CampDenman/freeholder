CREATE TABLE "bundle_components" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bundle_product_id" uuid NOT NULL,
	"component_variant_id" uuid NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"price_mode" text DEFAULT 'sum' NOT NULL,
	"amount_minor" bigint,
	"percent_off_ppm" integer,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bundle_components_qty_positive" CHECK ("bundle_components"."quantity" > 0),
	CONSTRAINT "bundle_components_mode_valid" CHECK ("bundle_components"."price_mode" in ('sum','fixed','percent_off')),
	CONSTRAINT "bundle_components_fixed_amount" CHECK (("bundle_components"."price_mode" <> 'fixed' and "bundle_components"."amount_minor" is null) or ("bundle_components"."price_mode" = 'fixed' and "bundle_components"."amount_minor" > 0)),
	CONSTRAINT "bundle_components_percent" CHECK (("bundle_components"."price_mode" <> 'percent_off' and "bundle_components"."percent_off_ppm" is null) or ("bundle_components"."price_mode" = 'percent_off' and "bundle_components"."percent_off_ppm" between 1 and 1000000)),
	CONSTRAINT "bundle_components_position_valid" CHECK ("bundle_components"."position" between 0 and 100000)
);
--> statement-breakpoint
CREATE TABLE "price_breaks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"price_list_id" uuid NOT NULL,
	"variant_id" uuid,
	"mode" text NOT NULL,
	"min_qty" integer NOT NULL,
	"max_qty" integer,
	"unit_amount_minor" bigint,
	"percent_off_ppm" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_breaks_mode_valid" CHECK ("price_breaks"."mode" in ('volume','tiered')),
	CONSTRAINT "price_breaks_min_positive" CHECK ("price_breaks"."min_qty" > 0),
	CONSTRAINT "price_breaks_window_valid" CHECK ("price_breaks"."max_qty" is null or "price_breaks"."max_qty" >= "price_breaks"."min_qty"),
	CONSTRAINT "price_breaks_price_xor" CHECK (("price_breaks"."unit_amount_minor" is not null and "price_breaks"."percent_off_ppm" is null and "price_breaks"."unit_amount_minor" > 0)
        or ("price_breaks"."unit_amount_minor" is null and "price_breaks"."percent_off_ppm" between 1 and 1000000))
);
--> statement-breakpoint
CREATE TABLE "product_relations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"related_product_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_relations_kind_valid" CHECK ("product_relations"."kind" in ('upsell','cross_sell','accessory','replacement','variant_of')),
	CONSTRAINT "product_relations_not_self" CHECK ("product_relations"."product_id" <> "product_relations"."related_product_id"),
	CONSTRAINT "product_relations_position_valid" CHECK ("product_relations"."position" between 0 and 100000)
);
--> statement-breakpoint
ALTER TABLE "bundle_components" ADD CONSTRAINT "bundle_components_bundle_product_id_products_id_fk" FOREIGN KEY ("bundle_product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bundle_components" ADD CONSTRAINT "bundle_components_component_variant_id_product_variants_id_fk" FOREIGN KEY ("component_variant_id") REFERENCES "public"."product_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_breaks" ADD CONSTRAINT "price_breaks_price_list_id_price_lists_id_fk" FOREIGN KEY ("price_list_id") REFERENCES "public"."price_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_breaks" ADD CONSTRAINT "price_breaks_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_relations" ADD CONSTRAINT "product_relations_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_relations" ADD CONSTRAINT "product_relations_related_product_id_products_id_fk" FOREIGN KEY ("related_product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bundle_components_unique_idx" ON "bundle_components" USING btree ("bundle_product_id","component_variant_id");--> statement-breakpoint
CREATE INDEX "bundle_components_variant_idx" ON "bundle_components" USING btree ("component_variant_id");--> statement-breakpoint
CREATE INDEX "price_breaks_list_idx" ON "price_breaks" USING btree ("price_list_id","variant_id","mode","min_qty");--> statement-breakpoint
CREATE UNIQUE INDEX "product_relations_unique_idx" ON "product_relations" USING btree ("product_id","related_product_id","kind");--> statement-breakpoint
CREATE INDEX "product_relations_related_idx" ON "product_relations" USING btree ("related_product_id","kind");