-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- Marketplace channels page provider orders onto invoices (MASTER.md §36, C3.13).
-- Expand-only: imported-order rows and a nullable sync cursor.
ALTER TABLE "marketplace_channels" ADD COLUMN "sync_cursor" text;--> statement-breakpoint
CREATE TABLE "marketplace_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"external_ref" text NOT NULL,
	"description" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "marketplace_orders" ADD CONSTRAINT "marketplace_orders_channel_id_marketplace_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."marketplace_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_orders" ADD CONSTRAINT "marketplace_orders_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "marketplace_orders_channel_external_idx" ON "marketplace_orders" ("channel_id", "external_ref");--> statement-breakpoint
CREATE INDEX "marketplace_orders_channel_idx" ON "marketplace_orders" ("channel_id");--> statement-breakpoint
CREATE INDEX "marketplace_orders_contact_idx" ON "marketplace_orders" ("contact_id");
