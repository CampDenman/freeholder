-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C12.21 (MASTER.md §44.4): images and video on posts, comments and messages.
-- A post may now be only photos, so text-or-repost is checked by the service.
ALTER TABLE "member_posts" DROP CONSTRAINT "member_posts_has_content";
--> statement-breakpoint
CREATE TABLE "member_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"parent_type" text NOT NULL,
	"parent_id" uuid NOT NULL,
	"alt_text" text DEFAULT '' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_attachments_parent_valid" CHECK ("member_attachments"."parent_type" in ('post','comment','message')),
	CONSTRAINT "member_attachments_alt_length" CHECK (char_length("member_attachments"."alt_text") <= 500)
);
--> statement-breakpoint
ALTER TABLE "member_attachments" ADD CONSTRAINT "member_attachments_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "member_attachments" ADD CONSTRAINT "member_attachments_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "member_attachments_asset_idx" ON "member_attachments" USING btree ("asset_id");
--> statement-breakpoint
CREATE INDEX "member_attachments_parent_idx" ON "member_attachments" USING btree ("parent_type","parent_id","position");
