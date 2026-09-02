-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
--
-- Recurring offers and the lives they lead (MASTER.md §4.15, §43 C9.13).
--
-- Additive: three new tables, nothing renamed or dropped.
--
-- No price column and no invoice column. §4.15 splits the money from the
-- access, so a plan points at a product whose variant carries the prices
-- (§4.9), and every period raises an ordinary invoice — §4.6's single money
-- object — with source_type = 'subscription'. What lives here is the calendar
-- and the history.
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"name" text NOT NULL,
	"interval" text NOT NULL,
	"interval_count" integer DEFAULT 1 NOT NULL,
	"trial_days" integer DEFAULT 0 NOT NULL,
	"trial_requires_card" boolean DEFAULT false NOT NULL,
	"setup_fee_minor" bigint DEFAULT 0 NOT NULL,
	"billing_mode" text DEFAULT 'manual' NOT NULL,
	"cancel_behaviour" text DEFAULT 'period_end' NOT NULL,
	"proration" text DEFAULT 'create_prorations' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_interval_count_positive" CHECK ("interval_count" >= 1),
	CONSTRAINT "plans_trial_days_nonnegative" CHECK ("trial_days" >= 0),
	CONSTRAINT "plans_setup_fee_nonnegative" CHECK ("setup_fee_minor" >= 0)
);
--> statement-breakpoint

-- ON DELETE restrict: deleting the product out from under a plan somebody is
-- subscribed to would leave a standing agreement that cannot say what it is for.
ALTER TABLE "plans" ADD CONSTRAINT "plans_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plans_product_idx" ON "plans" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "plans_status_idx" ON "plans" USING btree ("status");--> statement-breakpoint

CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"product_variant_id" uuid NOT NULL,
	"currency" text NOT NULL,
	"billing_mode" text NOT NULL,
	"provider" text,
	"provider_ref" text,
	"status" text DEFAULT 'active' NOT NULL,
	"current_period_start" timestamp with time zone NOT NULL,
	"current_period_end" timestamp with time zone NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"paused_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"grants" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_currency_valid" CHECK ("currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "subscriptions_period_order" CHECK ("current_period_end" > "current_period_start"),
	CONSTRAINT "subscriptions_ended_consistent" CHECK (("status" in ('expired', 'cancelled')) or "ended_at" is null)
);
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_product_variant_id_product_variants_id_fk" FOREIGN KEY ("product_variant_id") REFERENCES "public"."product_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "subscriptions_contact_idx" ON "subscriptions" USING btree ("contact_id");--> statement-breakpoint

-- The renewal sweep's own query: what is due, oldest first.
CREATE INDEX "subscriptions_due_idx" ON "subscriptions" USING btree ("status","current_period_end");--> statement-breakpoint
CREATE INDEX "subscriptions_plan_idx" ON "subscriptions" USING btree ("plan_id");--> statement-breakpoint

-- One local row per provider subscription. C9.33 reconciles against a
-- provider's schedule, and only an index can stop a replayed webhook creating
-- a second subscription for the same customer.
CREATE UNIQUE INDEX "subscriptions_provider_ref_idx" ON "subscriptions" USING btree ("provider","provider_ref") WHERE "subscriptions"."provider_ref" is not null;--> statement-breakpoint

CREATE TABLE "subscription_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subscription_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"from_plan_id" uuid,
	"to_plan_id" uuid,
	"invoice_id" uuid,
	"detail" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_from_plan_id_plans_id_fk" FOREIGN KEY ("from_plan_id") REFERENCES "public"."plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_to_plan_id_plans_id_fk" FOREIGN KEY ("to_plan_id") REFERENCES "public"."plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "subscription_events_subscription_idx" ON "subscription_events" USING btree ("subscription_id","at");--> statement-breakpoint
CREATE INDEX "subscription_events_kind_idx" ON "subscription_events" USING btree ("kind","at");
