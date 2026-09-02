-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
--
-- Access as grants, never as a flag on the content (MASTER.md §4.15, C9.14).
--
-- Additive: four new tables. Core owns them because plans, passes, unlocks,
-- loyalty tiers and manual decisions all grant the same kind of thing, and a
-- module that imported another module to ask "may they in?" would be the
-- second path §4.15 exists to prevent.
CREATE TABLE "entitlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"grantor_type" text NOT NULL,
	"grantor_id" uuid NOT NULL,
	"name" text NOT NULL,
	"resource" jsonb NOT NULL,
	"quantity" integer,
	"period" text DEFAULT 'total' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entitlements_quantity_positive" CHECK ("quantity" is null or "quantity" >= 1)
);
--> statement-breakpoint
CREATE INDEX "entitlements_grantor_idx" ON "entitlements" USING btree ("grantor_type","grantor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entitlements_grantor_resource_idx" ON "entitlements" USING btree ("grantor_type","grantor_id",(resource->>'kind'),(coalesce(resource->>'selector', '')));--> statement-breakpoint

CREATE TABLE "entitlement_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"entitlement_id" uuid NOT NULL,
	"source_subscription_id" uuid,
	"source_pass_balance_id" uuid,
	"source_unlock_id" uuid,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"used" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entitlement_grants_used_nonnegative" CHECK ("used" >= 0),
	CONSTRAINT "entitlement_grants_window" CHECK ("ends_at" is null or "ends_at" > "starts_at")
);
--> statement-breakpoint
ALTER TABLE "entitlement_grants" ADD CONSTRAINT "entitlement_grants_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlement_grants" ADD CONSTRAINT "entitlement_grants_entitlement_id_entitlements_id_fk" FOREIGN KEY ("entitlement_id") REFERENCES "public"."entitlements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entitlement_grants_contact_idx" ON "entitlement_grants" USING btree ("contact_id","status");--> statement-breakpoint
CREATE INDEX "entitlement_grants_entitlement_idx" ON "entitlement_grants" USING btree ("entitlement_id");--> statement-breakpoint
CREATE INDEX "entitlement_grants_subscription_idx" ON "entitlement_grants" USING btree ("source_subscription_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entitlement_grants_subscription_live_idx" ON "entitlement_grants" USING btree ("entitlement_id","contact_id","source_subscription_id") WHERE "source_subscription_id" is not null and "status" in ('active', 'paused');--> statement-breakpoint
CREATE UNIQUE INDEX "entitlement_grants_pass_live_idx" ON "entitlement_grants" USING btree ("entitlement_id","contact_id","source_pass_balance_id") WHERE "source_pass_balance_id" is not null and "status" in ('active', 'paused');--> statement-breakpoint
CREATE UNIQUE INDEX "entitlement_grants_unlock_live_idx" ON "entitlement_grants" USING btree ("entitlement_id","contact_id","source_unlock_id") WHERE "source_unlock_id" is not null and "status" in ('active', 'paused');--> statement-breakpoint
CREATE UNIQUE INDEX "entitlement_grants_manual_live_idx" ON "entitlement_grants" USING btree ("entitlement_id","contact_id") WHERE "source_subscription_id" is null and "source_pass_balance_id" is null and "source_unlock_id" is null and "status" in ('active', 'paused');--> statement-breakpoint

CREATE TABLE "pass_balances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"entitlement_id" uuid NOT NULL,
	"quantity_original" integer NOT NULL,
	"quantity_remaining" integer NOT NULL,
	"source_order_id" uuid,
	"expires_at" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pass_balances_original_positive" CHECK ("quantity_original" >= 1),
	CONSTRAINT "pass_balances_remaining_nonnegative" CHECK ("quantity_remaining" >= 0)
);
--> statement-breakpoint
ALTER TABLE "pass_balances" ADD CONSTRAINT "pass_balances_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pass_balances" ADD CONSTRAINT "pass_balances_entitlement_id_entitlements_id_fk" FOREIGN KEY ("entitlement_id") REFERENCES "public"."entitlements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pass_balances_contact_idx" ON "pass_balances" USING btree ("contact_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "pass_balances_order_idx" ON "pass_balances" USING btree ("source_order_id","product_id") WHERE "source_order_id" is not null;--> statement-breakpoint

CREATE TABLE "content_unlocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"entitlement_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "content_unlocks" ADD CONSTRAINT "content_unlocks_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_unlocks" ADD CONSTRAINT "content_unlocks_entitlement_id_entitlements_id_fk" FOREIGN KEY ("entitlement_id") REFERENCES "public"."entitlements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_unlocks_contact_idx" ON "content_unlocks" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "content_unlocks_invoice_idx" ON "content_unlocks" USING btree ("invoice_id");
