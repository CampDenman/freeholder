-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
--
-- Social composer (MASTER.md §33, C9.26).
--
-- Variants are the per-profile rendition (caption, crop, review). Publications
-- gain a schedule, an idempotency key and a nullable provider_ref so a post
-- can be queued before the network has an id for it. The unique provider ref
-- still stops a loop once it exists.
CREATE TABLE "social_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"package_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"caption" text DEFAULT '' NOT NULL,
	"hashtags" text[] DEFAULT '{}' NOT NULL,
	"asset_ids" text[] DEFAULT '{}' NOT NULL,
	"aspect_ratio" text NOT NULL,
	"safe_area" jsonb NOT NULL,
	"duration_seconds" integer,
	"generated" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "social_variants" ADD CONSTRAINT "social_variants_package_id_social_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."social_packages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_variants" ADD CONSTRAINT "social_variants_profile_id_social_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."social_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "social_variants_package_idx" ON "social_variants" USING btree ("package_id");--> statement-breakpoint
CREATE INDEX "social_variants_profile_idx" ON "social_variants" USING btree ("profile_id");--> statement-breakpoint

ALTER TABLE "social_publications" ALTER COLUMN "provider_ref" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "social_publications" ADD COLUMN "variant_id" uuid;--> statement-breakpoint
ALTER TABLE "social_publications" ADD COLUMN "scheduled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "social_publications" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "social_publications" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "social_publications" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "social_publications" ADD CONSTRAINT "social_publications_variant_id_social_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."social_variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
DROP INDEX IF EXISTS "social_publications_ref_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "social_publications_ref_idx" ON "social_publications" USING btree ("provider","provider_ref") WHERE provider_ref is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "social_publications_idempotency_idx" ON "social_publications" USING btree ("idempotency_key") WHERE idempotency_key is not null;--> statement-breakpoint
CREATE INDEX "social_publications_scheduled_idx" ON "social_publications" USING btree ("scheduled_at","status");
