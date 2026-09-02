-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
--
-- Paywalls over grants (MASTER.md §4.15, C9.15).
--
-- Additive: two new tables. The rule lives here, not on the page: a Paywall
-- selects content and an EntitlementGrant answers for a person. Metered
-- counts are per visitor, first-party, and the same for crawlers as humans.
CREATE TABLE "paywalls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"applies_to" jsonb NOT NULL,
	"mode" text DEFAULT 'hard' NOT NULL,
	"meter_count" integer DEFAULT 0 NOT NULL,
	"meter_window_days" integer DEFAULT 30 NOT NULL,
	"preview_strategy" text DEFAULT 'blocks' NOT NULL,
	"preview_value" integer DEFAULT 1 NOT NULL,
	"required_entitlement_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"upsell_page_id" uuid,
	"seo_policy" text DEFAULT 'fully_gated' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "paywalls_meter_count_nonnegative" CHECK ("meter_count" >= 0),
	CONSTRAINT "paywalls_meter_window_positive" CHECK ("meter_window_days" >= 1),
	CONSTRAINT "paywalls_preview_value_nonnegative" CHECK ("preview_value" >= 0)
);
--> statement-breakpoint
CREATE INDEX "paywalls_status_idx" ON "paywalls" USING btree ("status");--> statement-breakpoint

CREATE TABLE "paywall_meter_counters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"paywall_id" uuid NOT NULL,
	"contact_id" uuid,
	"anon_id" text,
	"window_starts_at" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "paywall_meters_subject" CHECK (("contact_id" is not null and "anon_id" is null) or ("contact_id" is null and "anon_id" is not null)),
	CONSTRAINT "paywall_meters_count_nonnegative" CHECK ("count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "paywall_meter_counters" ADD CONSTRAINT "paywall_meter_counters_paywall_id_paywalls_id_fk" FOREIGN KEY ("paywall_id") REFERENCES "public"."paywalls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paywall_meter_counters" ADD CONSTRAINT "paywall_meter_counters_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "paywall_meters_paywall_idx" ON "paywall_meter_counters" USING btree ("paywall_id");--> statement-breakpoint
CREATE UNIQUE INDEX "paywall_meters_contact_idx" ON "paywall_meter_counters" USING btree ("paywall_id","contact_id") WHERE "contact_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "paywall_meters_anon_idx" ON "paywall_meter_counters" USING btree ("paywall_id","anon_id") WHERE "anon_id" is not null;
