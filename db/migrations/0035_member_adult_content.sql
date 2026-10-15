-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C12.29 (MASTER.md §44.9): adult content is opt-in for adults and never shown to minors.
ALTER TABLE "member_settings" ADD COLUMN "adult_content" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "member_profiles" ADD COLUMN "show_adult" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "member_posts" ADD COLUMN "adult" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "member_listings" ADD COLUMN "adult" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "member_profiles" ADD CONSTRAINT "member_profiles_show_adult_needs_adult" CHECK (not "member_profiles"."show_adult" or "member_profiles"."is_adult");
