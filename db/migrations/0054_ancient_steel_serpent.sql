CREATE TABLE "back_in_stock_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"variant_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"location_id" uuid,
	"notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"received_qty" integer DEFAULT 0 NOT NULL,
	"unit_cost_minor" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_order_lines_qty" CHECK ("purchase_order_lines"."quantity" > 0),
	CONSTRAINT "purchase_order_lines_received" CHECK ("purchase_order_lines"."received_qty" >= 0 and "purchase_order_lines"."received_qty" <= "purchase_order_lines"."quantity"),
	CONSTRAINT "purchase_order_lines_cost" CHECK ("purchase_order_lines"."unit_cost_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"currency" text NOT NULL,
	"expected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_orders_status_valid" CHECK ("purchase_orders"."status" in ('draft','ordered','partial','received','cancelled')),
	CONSTRAINT "purchase_orders_currency" CHECK ("purchase_orders"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"contact_id" uuid,
	"lead_time_days" integer DEFAULT 7 NOT NULL,
	"currency" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suppliers_name_valid" CHECK (char_length("suppliers"."name") between 1 and 120),
	CONSTRAINT "suppliers_lead_time" CHECK ("suppliers"."lead_time_days" >= 0),
	CONSTRAINT "suppliers_currency" CHECK ("suppliers"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "backorder_policy" text DEFAULT 'refuse' NOT NULL;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "expected_restock_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "back_in_stock_subscriptions" ADD CONSTRAINT "back_in_stock_subscriptions_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "back_in_stock_subscriptions" ADD CONSTRAINT "back_in_stock_subscriptions_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "back_in_stock_subscriptions" ADD CONSTRAINT "back_in_stock_subscriptions_location_id_business_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."business_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_location_id_business_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."business_locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "back_in_stock_unique_idx" ON "back_in_stock_subscriptions" USING btree ("variant_id","contact_id","location_id");--> statement-breakpoint
CREATE INDEX "back_in_stock_contact_idx" ON "back_in_stock_subscriptions" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "back_in_stock_variant_idx" ON "back_in_stock_subscriptions" USING btree ("variant_id","notified_at");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_order_lines_unique_idx" ON "purchase_order_lines" USING btree ("purchase_order_id","variant_id");--> statement-breakpoint
CREATE INDEX "purchase_order_lines_variant_idx" ON "purchase_order_lines" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "purchase_orders_supplier_idx" ON "purchase_orders" USING btree ("supplier_id","status");--> statement-breakpoint
CREATE INDEX "purchase_orders_location_idx" ON "purchase_orders" USING btree ("location_id","status");--> statement-breakpoint
CREATE INDEX "suppliers_contact_idx" ON "suppliers" USING btree ("contact_id");--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_backorder_valid" CHECK ("product_variants"."backorder_policy" in ('refuse','allow_date','allow_silent'));