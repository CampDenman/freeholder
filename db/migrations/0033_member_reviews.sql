-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C12.11 (MASTER.md §44.8): double-blind reviews after completed sales.
CREATE TABLE "member_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"seller_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"rating" integer NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"reveal_at" timestamp with time zone NOT NULL,
	"reply" text,
	"replied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_reviews_rating_range" CHECK ("member_reviews"."rating" between 1 and 5),
	CONSTRAINT "member_reviews_direction_valid" CHECK ("member_reviews"."direction" in ('of_seller','of_buyer')),
	CONSTRAINT "member_reviews_body_length" CHECK (char_length("member_reviews"."body") <= 2000),
	CONSTRAINT "member_reviews_reply_length" CHECK ("member_reviews"."reply" is null or char_length("member_reviews"."reply") <= 2000),
	CONSTRAINT "member_reviews_not_self" CHECK ("member_reviews"."author_id" <> "member_reviews"."subject_id")
);
--> statement-breakpoint
ALTER TABLE "member_reviews" ADD CONSTRAINT "member_reviews_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "member_reviews" ADD CONSTRAINT "member_reviews_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "member_reviews" ADD CONSTRAINT "member_reviews_subject_id_users_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "member_reviews_one_per_side_idx" ON "member_reviews" USING btree ("order_id","seller_id","author_id");
--> statement-breakpoint
CREATE INDEX "member_reviews_subject_idx" ON "member_reviews" USING btree ("subject_id","reveal_at");
