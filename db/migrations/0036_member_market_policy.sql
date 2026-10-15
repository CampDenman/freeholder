-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C12.28 (MASTER.md §44.9): a published prohibited-items policy sellers accept.
ALTER TABLE "member_settings" ADD COLUMN "market_policy" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "member_settings" ADD COLUMN "market_policy_version" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "member_profiles" ADD COLUMN "market_policy_accepted" integer;
--> statement-breakpoint
ALTER TABLE "member_settings" ADD CONSTRAINT "member_settings_market_policy_length" CHECK (char_length("member_settings"."market_policy") <= 20000);
