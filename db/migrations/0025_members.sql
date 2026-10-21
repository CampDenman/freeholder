-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C12.01 (MASTER.md §44.1): members — one site, many people.
CREATE TABLE "member_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"handle" text NOT NULL,
	"display_name" text NOT NULL,
	"bio" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"is_adult" boolean DEFAULT false NOT NULL,
	"age_attested_at" timestamp with time zone NOT NULL,
	"status_reason" text,
	"status_changed_at" timestamp with time zone,
	"handle_changed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_profiles_handle_format" CHECK ("member_profiles"."handle" ~ '^[a-z0-9_]{3,30}$'),
	CONSTRAINT "member_profiles_status_valid" CHECK ("member_profiles"."status" in ('active','pending','suspended')),
	CONSTRAINT "member_profiles_display_name_length" CHECK (char_length("member_profiles"."display_name") between 1 and 80),
	CONSTRAINT "member_profiles_bio_length" CHECK (char_length("member_profiles"."bio") <= 1000)
);
--> statement-breakpoint
ALTER TABLE "member_profiles" ADD CONSTRAINT "member_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "member_profiles_handle_idx" ON "member_profiles" USING btree ("handle");
--> statement-breakpoint
CREATE INDEX "member_profiles_status_idx" ON "member_profiles" USING btree ("status","created_at");
--> statement-breakpoint
CREATE TABLE "member_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"join_policy" text DEFAULT 'open' NOT NULL,
	"minimum_age" integer DEFAULT 16 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_settings_singleton" CHECK ("member_settings"."id" = 1),
	CONSTRAINT "member_settings_join_policy_valid" CHECK ("member_settings"."join_policy" in ('open','approval','invite')),
	CONSTRAINT "member_settings_minimum_age_range" CHECK ("member_settings"."minimum_age" between 13 and 21)
);
--> statement-breakpoint
CREATE TABLE "member_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"invited_by" uuid,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_invitations_email_lower" CHECK ("member_invitations"."email" = lower("member_invitations"."email"))
);
--> statement-breakpoint
ALTER TABLE "member_invitations" ADD CONSTRAINT "member_invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "member_invitations_email_idx" ON "member_invitations" USING btree ("email");
