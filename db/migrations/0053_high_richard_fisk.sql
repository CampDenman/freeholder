CREATE TABLE "inventory_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"variant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"bin" text,
	"safety_stock" integer DEFAULT 0 NOT NULL,
	"reorder_point" integer DEFAULT 0 NOT NULL,
	"incoming" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_items_safety" CHECK ("inventory_items"."safety_stock" >= 0),
	CONSTRAINT "inventory_items_reorder" CHECK ("inventory_items"."reorder_point" >= 0),
	CONSTRAINT "inventory_items_incoming" CHECK ("inventory_items"."incoming" >= 0),
	CONSTRAINT "inventory_items_bin_valid" CHECK ("inventory_items"."bin" is null or char_length("inventory_items"."bin") between 1 and 40)
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"delta" integer NOT NULL,
	"reason" text NOT NULL,
	"reference_type" text,
	"reference_id" uuid,
	"actor" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_movements_delta_nonzero" CHECK ("stock_movements"."delta" <> 0),
	CONSTRAINT "stock_movements_reason_valid" CHECK ("stock_movements"."reason" in ('sale','return','adjustment','transfer','receipt','damage','count'))
);
--> statement-breakpoint
CREATE TABLE "stock_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"holder_type" text NOT NULL,
	"holder_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_reservations_qty_positive" CHECK ("stock_reservations"."quantity" > 0),
	CONSTRAINT "stock_reservations_holder_valid" CHECK ("stock_reservations"."holder_type" in ('cart','order','booking')),
	CONSTRAINT "stock_reservations_status_valid" CHECK ("stock_reservations"."status" in ('active','consumed','released','expired'))
);
--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_location_id_business_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."business_locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_items_variant_location_idx" ON "inventory_items" USING btree ("variant_id","location_id");--> statement-breakpoint
CREATE INDEX "inventory_items_location_idx" ON "inventory_items" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "stock_movements_item_idx" ON "stock_movements" USING btree ("inventory_item_id","created_at");--> statement-breakpoint
CREATE INDEX "stock_movements_reference_idx" ON "stock_movements" USING btree ("reference_type","reference_id");--> statement-breakpoint
CREATE INDEX "stock_reservations_item_status_idx" ON "stock_reservations" USING btree ("inventory_item_id","status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_reservations_active_holder_idx" ON "stock_reservations" USING btree ("inventory_item_id","holder_type","holder_id") WHERE "stock_reservations"."status" = 'active';