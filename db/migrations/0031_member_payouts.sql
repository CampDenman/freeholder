-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C12.09 (MASTER.md §44.8): payout model, seller payout accounts and the
-- per-line payout ledger.
ALTER TABLE "member_settings" ADD COLUMN "payout_model" text DEFAULT 'hold' NOT NULL;
--> statement-breakpoint
ALTER TABLE "member_settings" ADD COLUMN "hold_days" integer DEFAULT 14 NOT NULL;
--> statement-breakpoint
ALTER TABLE "member_settings" ADD COLUMN "site_fee_bps" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "member_settings" ADD COLUMN "payout_adapter" text DEFAULT 'manual' NOT NULL;
--> statement-breakpoint
ALTER TABLE "member_settings" ADD CONSTRAINT "member_settings_payout_model_valid" CHECK ("member_settings"."payout_model" in ('hold','seller_merchant','instant'));
--> statement-breakpoint
ALTER TABLE "member_settings" ADD CONSTRAINT "member_settings_hold_days_range" CHECK ("member_settings"."hold_days" between 1 and 90);
--> statement-breakpoint
ALTER TABLE "member_settings" ADD CONSTRAINT "member_settings_site_fee_range" CHECK ("member_settings"."site_fee_bps" between 0 and 5000);
--> statement-breakpoint
CREATE TABLE "member_payout_accounts" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"adapter" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"instructions_sealed" text,
	"external_account_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_payout_accounts_status_valid" CHECK ("member_payout_accounts"."status" in ('pending','ready','disabled'))
);
--> statement-breakpoint
ALTER TABLE "member_payout_accounts" ADD CONSTRAINT "member_payout_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "member_payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"order_item_id" uuid NOT NULL,
	"seller_id" uuid NOT NULL,
	"currency" text NOT NULL,
	"gross_minor" integer NOT NULL,
	"fee_minor" integer NOT NULL,
	"net_minor" integer NOT NULL,
	"state" text NOT NULL,
	"model" text NOT NULL,
	"release_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"reference" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_payouts_state_valid" CHECK ("member_payouts"."state" in ('held','due','paid','cancelled','review')),
	CONSTRAINT "member_payouts_amounts" CHECK ("member_payouts"."fee_minor" >= 0 and "member_payouts"."net_minor" = "member_payouts"."gross_minor" - "member_payouts"."fee_minor")
);
--> statement-breakpoint
ALTER TABLE "member_payouts" ADD CONSTRAINT "member_payouts_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "member_payouts_order_item_idx" ON "member_payouts" USING btree ("order_item_id");
--> statement-breakpoint
CREATE INDEX "member_payouts_seller_idx" ON "member_payouts" USING btree ("seller_id","state");
--> statement-breakpoint
CREATE INDEX "member_payouts_release_idx" ON "member_payouts" USING btree ("state","release_at");
