CREATE TABLE "digital_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"order_item_id" uuid NOT NULL,
	"token" text NOT NULL,
	"asset_id" uuid,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"downloaded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fulfillment_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fulfillment_id" uuid NOT NULL,
	"order_item_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fulfillment_items_qty" CHECK ("fulfillment_items"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "fulfillments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"location_id" uuid,
	"kind" text DEFAULT 'physical' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"box_id" uuid,
	"weight_g" integer,
	"carrier" text,
	"service" text,
	"tracking_number" text,
	"tracking_url" text,
	"shipped_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fulfillments_kind_valid" CHECK ("fulfillments"."kind" in ('physical','digital')),
	CONSTRAINT "fulfillments_status_valid" CHECK ("fulfillments"."status" in ('pending','picking','packed','shipped','delivered','failed','returned')),
	CONSTRAINT "fulfillments_weight" CHECK ("fulfillments"."weight_g" is null or "fulfillments"."weight_g" >= 0)
);
--> statement-breakpoint
CREATE TABLE "return_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"return_id" uuid NOT NULL,
	"order_item_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"restocked_quantity" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "return_items_qty" CHECK ("return_items"."quantity" > 0),
	CONSTRAINT "return_items_restocked" CHECK ("return_items"."restocked_quantity" >= 0 and "return_items"."restocked_quantity" <= "return_items"."quantity")
);
--> statement-breakpoint
CREATE TABLE "return_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"reason" text NOT NULL,
	"restock" boolean DEFAULT true NOT NULL,
	"label_url" text,
	"credit_note_id" uuid,
	"refund_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "return_requests_status_valid" CHECK ("return_requests"."status" in ('requested','approved','received','refunded','rejected')),
	CONSTRAINT "return_requests_reason" CHECK (char_length("return_requests"."reason") between 3 and 1000)
);
--> statement-breakpoint
ALTER TABLE "digital_deliveries" ADD CONSTRAINT "digital_deliveries_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digital_deliveries" ADD CONSTRAINT "digital_deliveries_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fulfillment_items" ADD CONSTRAINT "fulfillment_items_fulfillment_id_fulfillments_id_fk" FOREIGN KEY ("fulfillment_id") REFERENCES "public"."fulfillments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fulfillment_items" ADD CONSTRAINT "fulfillment_items_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fulfillments" ADD CONSTRAINT "fulfillments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fulfillments" ADD CONSTRAINT "fulfillments_location_id_business_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."business_locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fulfillments" ADD CONSTRAINT "fulfillments_box_id_packaging_boxes_id_fk" FOREIGN KEY ("box_id") REFERENCES "public"."packaging_boxes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_return_id_return_requests_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."return_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "digital_deliveries_token_idx" ON "digital_deliveries" USING btree ("token");--> statement-breakpoint
CREATE UNIQUE INDEX "digital_deliveries_line_idx" ON "digital_deliveries" USING btree ("order_item_id");--> statement-breakpoint
CREATE INDEX "digital_deliveries_order_idx" ON "digital_deliveries" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fulfillment_items_unique_idx" ON "fulfillment_items" USING btree ("fulfillment_id","order_item_id");--> statement-breakpoint
CREATE INDEX "fulfillment_items_order_item_idx" ON "fulfillment_items" USING btree ("order_item_id");--> statement-breakpoint
CREATE INDEX "fulfillments_order_idx" ON "fulfillments" USING btree ("order_id","status");--> statement-breakpoint
CREATE INDEX "fulfillments_location_idx" ON "fulfillments" USING btree ("location_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "return_items_unique_idx" ON "return_items" USING btree ("return_id","order_item_id");--> statement-breakpoint
CREATE INDEX "return_items_order_item_idx" ON "return_items" USING btree ("order_item_id");--> statement-breakpoint
CREATE INDEX "return_requests_order_idx" ON "return_requests" USING btree ("order_id","status");--> statement-breakpoint
CREATE INDEX "return_requests_contact_idx" ON "return_requests" USING btree ("contact_id","status");