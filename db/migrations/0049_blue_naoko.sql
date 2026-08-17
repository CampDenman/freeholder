CREATE TABLE "option_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "option_types_code_valid" CHECK (char_length("option_types"."code") between 1 and 40 and "option_types"."code" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
	CONSTRAINT "option_types_name_valid" CHECK (char_length("option_types"."name") between 1 and 80)
);
--> statement-breakpoint
CREATE TABLE "option_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"option_type_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sku_fragment" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "option_values_fragment_valid" CHECK (char_length("option_values"."sku_fragment") between 1 and 24 and "option_values"."sku_fragment" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
	CONSTRAINT "option_values_name_valid" CHECK (char_length("option_values"."name") between 1 and 80),
	CONSTRAINT "option_values_position_valid" CHECK ("option_values"."position" between 0 and 100000)
);
--> statement-breakpoint
CREATE TABLE "product_option_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"option_type_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_option_assignments_position_valid" CHECK ("product_option_assignments"."position" between 0 and 100000)
);
--> statement-breakpoint
CREATE TABLE "product_option_value_assignments" (
	"assignment_id" uuid NOT NULL,
	"option_value_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_variant_options" (
	"variant_id" uuid NOT NULL,
	"option_type_id" uuid NOT NULL,
	"option_value_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"combination_key" text NOT NULL,
	"sku" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_variants_sku_valid" CHECK (char_length("product_variants"."sku") between 1 and 180 and "product_variants"."sku" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
	CONSTRAINT "product_variants_status_valid" CHECK ("product_variants"."status" in ('active','archived')),
	CONSTRAINT "product_variants_combination_valid" CHECK (char_length("product_variants"."combination_key") > 0)
);
--> statement-breakpoint
ALTER TABLE "option_values" ADD CONSTRAINT "option_values_option_type_id_option_types_id_fk" FOREIGN KEY ("option_type_id") REFERENCES "public"."option_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_option_assignments" ADD CONSTRAINT "product_option_assignments_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_option_assignments" ADD CONSTRAINT "product_option_assignments_option_type_id_option_types_id_fk" FOREIGN KEY ("option_type_id") REFERENCES "public"."option_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_option_value_assignments" ADD CONSTRAINT "product_option_value_assignments_assignment_id_product_option_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."product_option_assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_option_value_assignments" ADD CONSTRAINT "product_option_value_assignments_option_value_id_option_values_id_fk" FOREIGN KEY ("option_value_id") REFERENCES "public"."option_values"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variant_options" ADD CONSTRAINT "product_variant_options_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variant_options" ADD CONSTRAINT "product_variant_options_option_type_id_option_types_id_fk" FOREIGN KEY ("option_type_id") REFERENCES "public"."option_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variant_options" ADD CONSTRAINT "product_variant_options_option_value_id_option_values_id_fk" FOREIGN KEY ("option_value_id") REFERENCES "public"."option_values"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "option_types_code_idx" ON "option_types" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "option_values_type_fragment_idx" ON "option_values" USING btree ("option_type_id","sku_fragment");--> statement-breakpoint
CREATE INDEX "option_values_type_position_idx" ON "option_values" USING btree ("option_type_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "product_option_assignments_unique_idx" ON "product_option_assignments" USING btree ("product_id","option_type_id");--> statement-breakpoint
CREATE INDEX "product_option_assignments_product_idx" ON "product_option_assignments" USING btree ("product_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "product_option_value_assignments_pk" ON "product_option_value_assignments" USING btree ("assignment_id","option_value_id");--> statement-breakpoint
CREATE INDEX "product_option_value_assignments_value_idx" ON "product_option_value_assignments" USING btree ("option_value_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_variant_options_pk" ON "product_variant_options" USING btree ("variant_id","option_type_id");--> statement-breakpoint
CREATE INDEX "product_variant_options_value_idx" ON "product_variant_options" USING btree ("option_value_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_variants_combination_idx" ON "product_variants" USING btree ("product_id","combination_key");--> statement-breakpoint
CREATE UNIQUE INDEX "product_variants_sku_idx" ON "product_variants" USING btree ("sku");--> statement-breakpoint
CREATE UNIQUE INDEX "product_variants_default_idx" ON "product_variants" USING btree ("product_id") WHERE "product_variants"."is_default" and "product_variants"."status" = 'active';--> statement-breakpoint
CREATE INDEX "product_variants_product_status_idx" ON "product_variants" USING btree ("product_id","status");