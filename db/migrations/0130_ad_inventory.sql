-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
--
-- Ad inventory: sizes, slots, advertisers, campaigns and line items
-- (MASTER.md §4.16, C9.17).
--
-- Two of §4.16's rules are visible in this file.
--
-- "A slot declares a *set* per breakpoint, so one placement serves a
-- leaderboard on a laptop and a 320x50 on a phone without the owner building
-- two pages." So `formats` lives on the slot, not on the block that places it:
-- one slot, many pages, one answer about how tall to leave the hole.
--
-- "Advertiser ... A Contact, not a separate customer table." So `advertisers`
-- carries a contact_id and nothing that duplicates a contact. A local business
-- that both advertises and buys prints is one person here.
CREATE TABLE "ad_sizes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"breakpoint" text NOT NULL,
	"iab_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ad_sizes_shape_idx" ON "ad_sizes" USING btree ("breakpoint","width","height");--> statement-breakpoint

-- "Standard sizes ship seeded, per breakpoint" (§4.16) — but the list lives
-- in TypeScript, not here. `ads.ensureSizes` inserts it idempotently and runs
-- when setup completes, because reference data that exists only in a
-- migration cannot be restored: anything that truncates the table (a test
-- helper, a reset, a restore) leaves a publisher with no sizes and no way
-- back short of editing SQL. One source, and a service that can re-apply it.

CREATE TABLE "ad_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"description" text,
	"formats" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"lazy" boolean DEFAULT true NOT NULL,
	"refresh_seconds" integer DEFAULT 0 NOT NULL,
	"allow_house_fill" boolean DEFAULT true NOT NULL,
	"allow_third_party" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- A block references a slot by its code, so two would make a page ambiguous.
CREATE UNIQUE INDEX "ad_slots_code_idx" ON "ad_slots" USING btree ("code");--> statement-breakpoint
CREATE INDEX "ad_slots_status_idx" ON "ad_slots" USING btree ("status");--> statement-breakpoint

CREATE TABLE "advertisers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"display_name" text,
	"website" text,
	"notes" text,
	"billing_terms" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "advertisers" ADD CONSTRAINT "advertisers_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "advertisers_contact_idx" ON "advertisers" USING btree ("contact_id");--> statement-breakpoint

CREATE TABLE "ad_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"advertiser_contact_id" uuid NOT NULL,
	"name" text NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"status" text DEFAULT 'draft' NOT NULL,
	"pricing" text DEFAULT 'house' NOT NULL,
	"rate_cents" integer DEFAULT 0 NOT NULL,
	"budget_cents" integer,
	"pacing" text DEFAULT 'even' NOT NULL,
	"invoice_id" uuid,
	"priority" integer DEFAULT 0 NOT NULL,
	"approval_state" text DEFAULT 'none' NOT NULL,
	"approval_note" text,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD CONSTRAINT "ad_campaigns_advertiser_contact_id_contacts_id_fk" FOREIGN KEY ("advertiser_contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- invoice_id is a plain column, not a foreign key: "selling an ad is selling a
-- product", but the invoicing module may not be installed on an instance that
-- only runs house promotions. The link is recorded; the dependency is not.
CREATE INDEX "ad_campaigns_advertiser_idx" ON "ad_campaigns" USING btree ("advertiser_contact_id");--> statement-breakpoint
CREATE INDEX "ad_campaigns_status_idx" ON "ad_campaigns" USING btree ("status","starts_at");--> statement-breakpoint

CREATE TABLE "ad_line_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slot_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"targeting" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dayparting" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"frequency_cap" integer,
	"frequency_period_hours" integer DEFAULT 24 NOT NULL,
	"goal_impressions" integer,
	"goal_clicks" integer,
	"weight" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ad_line_items" ADD CONSTRAINT "ad_line_items_campaign_id_ad_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."ad_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ad_line_items_campaign_idx" ON "ad_line_items" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "ad_line_items_status_idx" ON "ad_line_items" USING btree ("status");
