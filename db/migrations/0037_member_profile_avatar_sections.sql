-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C12.20 (MASTER.md §44.3): member avatars and profile sections.
ALTER TABLE "member_profiles" ADD COLUMN "avatar_asset_id" uuid;
--> statement-breakpoint
ALTER TABLE "member_profiles" ADD CONSTRAINT "member_profiles_avatar_asset_id_assets_id_fk" FOREIGN KEY ("avatar_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "member_profile_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_profile_sections_kind_valid" CHECK ("member_profile_sections"."kind" in ('text','portfolio','services','pinned')),
	CONSTRAINT "member_profile_sections_visibility_valid" CHECK ("member_profile_sections"."visibility" in ('public','followers','friends','subscribers','only_me')),
	CONSTRAINT "member_profile_sections_title_length" CHECK (char_length("member_profile_sections"."title") between 1 and 80),
	CONSTRAINT "member_profile_sections_body_length" CHECK (char_length("member_profile_sections"."body") <= 5000)
);
--> statement-breakpoint
ALTER TABLE "member_profile_sections" ADD CONSTRAINT "member_profile_sections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "member_profile_sections_user_idx" ON "member_profile_sections" USING btree ("user_id","position");
