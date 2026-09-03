-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
--
-- Social connection hub (MASTER.md §33, C9.24).
--
-- Profiles, not posts. Provider is plain text so a plugin can add a network
-- without a migration here. Several profiles per provider is the unique
-- index, not a special case. pending_review is Freeholder's review step:
-- OAuth alone does not authorize the profile.
CREATE TABLE "social_oauth_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"return_to" text DEFAULT '/admin/social' NOT NULL,
	"code_verifier" text,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "social_oauth_states" ADD CONSTRAINT "social_oauth_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "social_oauth_states_hash_idx" ON "social_oauth_states" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "social_oauth_states_expiry_idx" ON "social_oauth_states" USING btree ("expires_at");--> statement-breakpoint

CREATE TABLE "social_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"display_name" text NOT NULL,
	"handle" text,
	"credentials" text,
	"status" text DEFAULT 'pending_review' NOT NULL,
	"assigned_to" text DEFAULT 'business' NOT NULL,
	"assignee_user_id" uuid,
	"allow_read" boolean DEFAULT true NOT NULL,
	"allow_respond" boolean DEFAULT false NOT NULL,
	"allow_publish" boolean DEFAULT false NOT NULL,
	"approval_policy" text DEFAULT 'required' NOT NULL,
	"capabilities" jsonb DEFAULT '{"read":true,"respond":false,"publish":false,"extras":[]}'::jsonb NOT NULL,
	"token_expires_at" timestamp with time zone,
	"last_health_at" timestamp with time zone,
	"last_health_status" text,
	"last_error" text,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" uuid,
	"connected_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "social_profiles" ADD CONSTRAINT "social_profiles_assignee_user_id_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_profiles" ADD CONSTRAINT "social_profiles_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_profiles" ADD CONSTRAINT "social_profiles_connected_by_users_id_fk" FOREIGN KEY ("connected_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "social_profiles_provider_idx" ON "social_profiles" USING btree ("provider","provider_account_id");--> statement-breakpoint
CREATE INDEX "social_profiles_status_idx" ON "social_profiles" USING btree ("status");--> statement-breakpoint
CREATE INDEX "social_profiles_assignee_idx" ON "social_profiles" USING btree ("assignee_user_id");--> statement-breakpoint

CREATE TABLE "social_profile_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "social_profile_locations" ADD CONSTRAINT "social_profile_locations_profile_id_social_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."social_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_profile_locations" ADD CONSTRAINT "social_profile_locations_location_id_business_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."business_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "social_profile_locations_idx" ON "social_profile_locations" USING btree ("profile_id","location_id");--> statement-breakpoint
CREATE INDEX "social_profile_locations_location_idx" ON "social_profile_locations" USING btree ("location_id");
