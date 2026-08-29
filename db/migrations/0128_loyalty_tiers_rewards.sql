-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
--
-- Tiers, rewards and redemption (MASTER.md §4.13, C9.12).
--
-- Two rules of §4.13 shape this. "Tier evaluation is a pure function of the
-- ledger and a window" — so loyalty_accounts.tier_id is an *answer*, written
-- by evaluation and never set by hand, because a tier somebody was put in is
-- a tier the next evaluation silently takes away.
--
-- And "Redemption obeys the convergence rule. Points become a coupon, a pass
-- balance, or a zero-value invoice line — never a parallel discount path."
-- redemptions.issued_reference is what the customer actually presents; it is
-- produced through the seam in core/rewards/issue.ts, so a real coupon comes
-- out of a real coupon system and loyalty never imports commerce.
ALTER TABLE "loyalty_programs" ADD COLUMN "min_account_age_days" integer DEFAULT 0 NOT NULL;--> statement-breakpoint

ALTER TABLE "loyalty_accounts" ADD COLUMN "tier_id" uuid;--> statement-breakpoint
ALTER TABLE "loyalty_accounts" ADD COLUMN "tier_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "loyalty_accounts" ADD COLUMN "tier_expires_at" timestamp with time zone;--> statement-breakpoint

CREATE TABLE "loyalty_tiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_id" uuid NOT NULL,
	"name" text NOT NULL,
	"threshold_basis" text DEFAULT 'points_earned' NOT NULL,
	"threshold" integer NOT NULL,
	"window_days" integer DEFAULT 365 NOT NULL,
	"benefits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "loyalty_tiers" ADD CONSTRAINT "loyalty_tiers_program_id_loyalty_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."loyalty_programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Ascending seniority, one tier per rung. Two tiers at one position is a
-- ladder with an ambiguous top, and evaluation would pick by accident.
CREATE UNIQUE INDEX "loyalty_tiers_program_position_idx" ON "loyalty_tiers" USING btree ("program_id","position");--> statement-breakpoint
CREATE INDEX "loyalty_tiers_program_idx" ON "loyalty_tiers" USING btree ("program_id");--> statement-breakpoint

CREATE TABLE "rewards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"cost_points" integer NOT NULL,
	"value" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"stock" integer,
	"per_contact_limit" integer,
	"eligible_tier_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rewards" ADD CONSTRAINT "rewards_program_id_loyalty_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."loyalty_programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rewards_program_status_idx" ON "rewards" USING btree ("program_id","status");--> statement-breakpoint

CREATE TABLE "redemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"reward_id" uuid NOT NULL,
	"points_spent" integer NOT NULL,
	"ledger_id" uuid,
	"issued_reference" text,
	"issued_by" text,
	"status" text DEFAULT 'issued' NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_account_id_loyalty_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."loyalty_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- RESTRICT, not CASCADE: a reward that somebody has redeemed cannot be
-- deleted out from under the record of their redeeming it. Retire it instead.
ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_reward_id_rewards_id_fk" FOREIGN KEY ("reward_id") REFERENCES "public"."rewards"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "redemptions_account_idx" ON "redemptions" USING btree ("account_id","at");--> statement-breakpoint
CREATE INDEX "redemptions_reward_idx" ON "redemptions" USING btree ("reward_id");
