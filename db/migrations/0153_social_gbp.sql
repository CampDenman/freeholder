-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
--
-- Google Business Profile hours, reviews and outbound tracking (MASTER.md §33, C9.27).
--
-- Reviews land in the reviews module; this table is the provider-ref loop
-- brake so the same Google review is not imported twice. Canonical URLs on
-- publications are the first-party UTM links stamped at publish time.
CREATE TABLE "social_gbp_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"provider_ref" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "social_gbp_reviews" ADD CONSTRAINT "social_gbp_reviews_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_gbp_reviews" ADD CONSTRAINT "social_gbp_reviews_profile_id_social_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."social_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "social_gbp_reviews_ref_idx" ON "social_gbp_reviews" USING btree ("provider_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "social_gbp_reviews_review_idx" ON "social_gbp_reviews" USING btree ("review_id");--> statement-breakpoint
CREATE INDEX "social_gbp_reviews_profile_idx" ON "social_gbp_reviews" USING btree ("profile_id");--> statement-breakpoint

ALTER TABLE "social_publications" ADD COLUMN "canonical_url" text;--> statement-breakpoint
ALTER TABLE "reviews" DROP CONSTRAINT "reviews_body";--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_body" CHECK (char_length("body") between 0 and 5000);
