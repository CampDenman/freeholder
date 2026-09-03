-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
--
-- Social ingest (MASTER.md §33, C9.25).
--
-- Packages are the canonical owned post. Publications are where that package
-- has appeared — the unique (provider, provider_ref) is what stops a post we
-- already ingested (or later published) from coming back in as a new one.
-- Comments attach to a contact only when the provider gave an email.
CREATE TABLE "social_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_kind" text NOT NULL,
	"source_profile_id" uuid,
	"source_provider" text,
	"source_ref" text,
	"content_digest" text NOT NULL,
	"parent_package_id" uuid,
	"author_user_id" uuid,
	"body" text DEFAULT '' NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"canonical_url" text,
	"rights" text DEFAULT 'owned' NOT NULL,
	"provenance" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "social_packages" ADD CONSTRAINT "social_packages_source_profile_id_social_profiles_id_fk" FOREIGN KEY ("source_profile_id") REFERENCES "public"."social_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_packages" ADD CONSTRAINT "social_packages_parent_package_id_social_packages_id_fk" FOREIGN KEY ("parent_package_id") REFERENCES "public"."social_packages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_packages" ADD CONSTRAINT "social_packages_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "social_packages_source_idx" ON "social_packages" USING btree ("source_provider","source_ref") WHERE source_provider is not null and source_ref is not null;--> statement-breakpoint
CREATE INDEX "social_packages_digest_idx" ON "social_packages" USING btree ("content_digest");--> statement-breakpoint
CREATE INDEX "social_packages_parent_idx" ON "social_packages" USING btree ("parent_package_id");--> statement-breakpoint

CREATE TABLE "social_package_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"package_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "social_package_assets" ADD CONSTRAINT "social_package_assets_package_id_social_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."social_packages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_package_assets" ADD CONSTRAINT "social_package_assets_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "social_package_assets_idx" ON "social_package_assets" USING btree ("package_id","asset_id");--> statement-breakpoint
CREATE INDEX "social_package_assets_asset_idx" ON "social_package_assets" USING btree ("asset_id");--> statement-breakpoint

CREATE TABLE "social_publications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"package_id" uuid NOT NULL,
	"profile_id" uuid,
	"provider" text NOT NULL,
	"provider_ref" text NOT NULL,
	"status" text NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "social_publications" ADD CONSTRAINT "social_publications_package_id_social_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."social_packages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_publications" ADD CONSTRAINT "social_publications_profile_id_social_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."social_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "social_publications_ref_idx" ON "social_publications" USING btree ("provider","provider_ref");--> statement-breakpoint
CREATE INDEX "social_publications_package_idx" ON "social_publications" USING btree ("package_id");--> statement-breakpoint

CREATE TABLE "social_interactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"package_id" uuid NOT NULL,
	"profile_id" uuid,
	"provider_ref" text NOT NULL,
	"kind" text NOT NULL,
	"body" text NOT NULL,
	"author_handle" text NOT NULL,
	"author_email" text,
	"contact_id" uuid,
	"conversation_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "social_interactions" ADD CONSTRAINT "social_interactions_package_id_social_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."social_packages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_interactions" ADD CONSTRAINT "social_interactions_profile_id_social_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."social_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_interactions" ADD CONSTRAINT "social_interactions_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_interactions" ADD CONSTRAINT "social_interactions_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "social_interactions_ref_idx" ON "social_interactions" USING btree ("provider_ref");--> statement-breakpoint
CREATE INDEX "social_interactions_contact_idx" ON "social_interactions" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "social_interactions_package_idx" ON "social_interactions" USING btree ("package_id");
