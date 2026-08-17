CREATE TABLE "attribute_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"kind" text NOT NULL,
	"unit" text,
	"group_name" text,
	"is_filterable" boolean DEFAULT false NOT NULL,
	"is_comparable" boolean DEFAULT false NOT NULL,
	"enum_options" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attribute_definitions_key_valid" CHECK (char_length("attribute_definitions"."key") between 1 and 40 and "attribute_definitions"."key" ~ '^[a-z0-9]+(?:_[a-z0-9]+)*$'),
	CONSTRAINT "attribute_definitions_label_valid" CHECK (char_length("attribute_definitions"."label") between 1 and 80),
	CONSTRAINT "attribute_definitions_kind_valid" CHECK ("attribute_definitions"."kind" in ('text','number','bool','enum','measure')),
	CONSTRAINT "attribute_definitions_measure_unit" CHECK ("attribute_definitions"."kind" <> 'measure' or ("attribute_definitions"."unit" is not null and char_length("attribute_definitions"."unit") between 1 and 24))
);
--> statement-breakpoint
CREATE TABLE "customer_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"tag" text,
	"lifecycle_stage" text,
	"tax_exempt" boolean DEFAULT false NOT NULL,
	"exemption_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_groups_name_valid" CHECK (char_length("customer_groups"."name") between 1 and 80),
	CONSTRAINT "customer_groups_tag_valid" CHECK ("customer_groups"."tag" is null or (char_length("customer_groups"."tag") between 1 and 50)),
	CONSTRAINT "customer_groups_lifecycle_valid" CHECK ("customer_groups"."lifecycle_stage" is null or "customer_groups"."lifecycle_stage" in ('lead','prospect','customer','repeat'))
);
--> statement-breakpoint
CREATE TABLE "price_list_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"price_list_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"compare_at_minor" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_list_entries_amount_positive" CHECK ("price_list_entries"."amount_minor" > 0),
	CONSTRAINT "price_list_entries_compare_valid" CHECK ("price_list_entries"."compare_at_minor" is null or "price_list_entries"."compare_at_minor" > "price_list_entries"."amount_minor")
);
--> statement-breakpoint
CREATE TABLE "price_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"currency" text NOT NULL,
	"kind" text DEFAULT 'retail' NOT NULL,
	"customer_group_id" uuid,
	"contact_id" uuid,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"priority" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_lists_name_valid" CHECK (char_length("price_lists"."name") between 1 and 120),
	CONSTRAINT "price_lists_currency_valid" CHECK ("price_lists"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "price_lists_kind_valid" CHECK ("price_lists"."kind" in ('retail','wholesale','member','sale','contract')),
	CONSTRAINT "price_lists_contract_contact" CHECK (("price_lists"."kind" = 'contract' and "price_lists"."contact_id" is not null) or ("price_lists"."kind" <> 'contract' and "price_lists"."contact_id" is null)),
	CONSTRAINT "price_lists_window_valid" CHECK ("price_lists"."starts_at" is null or "price_lists"."ends_at" is null or "price_lists"."ends_at" > "price_lists"."starts_at"),
	CONSTRAINT "price_lists_priority_valid" CHECK ("price_lists"."priority" between -100000 and 100000)
);
--> statement-breakpoint
CREATE TABLE "product_attributes" (
	"product_id" uuid NOT NULL,
	"attribute_id" uuid NOT NULL,
	"text_value" text,
	"number_value" text,
	"bool_value" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_attributes_number_valid" CHECK ("product_attributes"."number_value" is null or "product_attributes"."number_value" ~ '^-?[0-9]+(\.[0-9]+)?$')
);
--> statement-breakpoint
CREATE TABLE "product_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid,
	"asset_id" uuid NOT NULL,
	"role" text DEFAULT 'gallery' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_media_role_valid" CHECK ("product_media"."role" in ('hero','gallery','swatch','size_chart','lifestyle','360','model')),
	CONSTRAINT "product_media_position_valid" CHECK ("product_media"."position" between 0 and 100000)
);
--> statement-breakpoint
ALTER TABLE "price_list_entries" ADD CONSTRAINT "price_list_entries_price_list_id_price_lists_id_fk" FOREIGN KEY ("price_list_id") REFERENCES "public"."price_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_list_entries" ADD CONSTRAINT "price_list_entries_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_customer_group_id_customer_groups_id_fk" FOREIGN KEY ("customer_group_id") REFERENCES "public"."customer_groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_attributes" ADD CONSTRAINT "product_attributes_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_attributes" ADD CONSTRAINT "product_attributes_attribute_id_attribute_definitions_id_fk" FOREIGN KEY ("attribute_id") REFERENCES "public"."attribute_definitions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_media" ADD CONSTRAINT "product_media_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_media" ADD CONSTRAINT "product_media_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_media" ADD CONSTRAINT "product_media_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attribute_definitions_key_idx" ON "attribute_definitions" USING btree ("key");--> statement-breakpoint
CREATE INDEX "attribute_definitions_filter_idx" ON "attribute_definitions" USING btree ("is_filterable","key");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_groups_name_idx" ON "customer_groups" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "price_list_entries_unique_idx" ON "price_list_entries" USING btree ("price_list_id","variant_id");--> statement-breakpoint
CREATE INDEX "price_list_entries_variant_idx" ON "price_list_entries" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "price_lists_resolve_idx" ON "price_lists" USING btree ("currency","active","kind","priority");--> statement-breakpoint
CREATE INDEX "price_lists_group_idx" ON "price_lists" USING btree ("customer_group_id");--> statement-breakpoint
CREATE INDEX "price_lists_contact_idx" ON "price_lists" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_attributes_pk" ON "product_attributes" USING btree ("product_id","attribute_id");--> statement-breakpoint
CREATE INDEX "product_attributes_attribute_idx" ON "product_attributes" USING btree ("attribute_id");--> statement-breakpoint
CREATE INDEX "product_media_product_idx" ON "product_media" USING btree ("product_id","role","position");--> statement-breakpoint
CREATE INDEX "product_media_variant_idx" ON "product_media" USING btree ("variant_id","role","position");--> statement-breakpoint
CREATE INDEX "product_media_asset_idx" ON "product_media" USING btree ("asset_id");