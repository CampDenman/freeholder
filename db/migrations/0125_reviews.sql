-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
--
-- Collected customer feedback (MASTER.md §4.6, C8.09).
--
-- A Review is not a Testimonial. §4.5's testimonial is a quote the owner chose
-- and attributed to work they are proud of; a review is what a customer said,
-- whether or not the owner enjoys reading it.
--
-- `hidden` and `rejected` are deliberately different states. Hiding is an
-- editorial choice about a real opinion and it still counts toward the rating;
-- rejecting is a finding that the text was never a customer's opinion at all,
-- and it counts toward nothing. The aggregate is computed, never stored, so it
-- cannot drift from the reviews it claims to summarise.
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid,
	"display_name" text,
	"source" text NOT NULL,
	"subject_type" text DEFAULT 'business' NOT NULL,
	"subject_id" uuid,
	"rating" integer NOT NULL,
	"title" text,
	"body" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"display_locations" text[] DEFAULT '{}' NOT NULL,
	"reply_body" text,
	"reply_at" timestamp with time zone,
	"reply_by_user_id" uuid,
	"incentive_coupon_id" uuid,
	"incentive_disclosed" boolean DEFAULT false NOT NULL,
	"moderated_at" timestamp with time zone,
	"moderated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reviews_rating" CHECK ("reviews"."rating" between 1 and 5),
	CONSTRAINT "reviews_body" CHECK (char_length("reviews"."body") between 1 and 5000),
	CONSTRAINT "reviews_reply" CHECK (("reviews"."reply_body" is null and "reviews"."reply_at" is null) or ("reviews"."reply_body" is not null and "reviews"."reply_at" is not null)),
	CONSTRAINT "reviews_moderated" CHECK (("reviews"."status" = 'pending' and "reviews"."moderated_at" is null) or ("reviews"."status" <> 'pending' and "reviews"."moderated_at" is not null)),
	CONSTRAINT "reviews_incentive" CHECK ("reviews"."incentive_coupon_id" is null or "reviews"."incentive_disclosed" = true)
);
--> statement-breakpoint
CREATE TABLE "review_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"source" text NOT NULL,
	"subject_type" text DEFAULT 'business' NOT NULL,
	"subject_id" uuid,
	"token_hash" text NOT NULL,
	"incentive_coupon_id" uuid,
	"sent_at" timestamp with time zone,
	"responded_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"review_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_reply_by_user_id_users_id_fk" FOREIGN KEY ("reply_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_moderated_by_user_id_users_id_fk" FOREIGN KEY ("moderated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_media" ADD CONSTRAINT "review_media_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_media" ADD CONSTRAINT "review_media_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reviews_subject_idx" ON "reviews" USING btree ("subject_type","subject_id","status");--> statement-breakpoint
CREATE INDEX "reviews_contact_idx" ON "reviews" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "reviews_status_idx" ON "reviews" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "review_requests_token_idx" ON "review_requests" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "review_requests_subject_idx" ON "review_requests" USING btree ("contact_id","subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "review_requests_contact_idx" ON "review_requests" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "review_media_unique_idx" ON "review_media" USING btree ("review_id","asset_id");--> statement-breakpoint
CREATE INDEX "review_media_review_idx" ON "review_media" USING btree ("review_id","position");
