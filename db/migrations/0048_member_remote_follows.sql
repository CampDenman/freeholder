-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C12.32 (MASTER.md §44.11): members follow fediverse accounts from here.
CREATE TABLE "member_remote_follows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"actor_uri" text NOT NULL,
	"inbox_uri" text NOT NULL,
	"handle" text NOT NULL,
	"display_name" text,
	"follow_id" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_remote_follows_state_valid" CHECK ("member_remote_follows"."state" in ('pending','accepted'))
);
--> statement-breakpoint
ALTER TABLE "member_remote_follows" ADD CONSTRAINT "member_remote_follows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "member_remote_follows_pair_idx" ON "member_remote_follows" USING btree ("user_id","actor_uri");
--> statement-breakpoint
CREATE INDEX "member_remote_follows_actor_idx" ON "member_remote_follows" USING btree ("actor_uri");
--> statement-breakpoint
CREATE TABLE "member_remote_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_uri" text NOT NULL,
	"object_id" text NOT NULL,
	"url" text,
	"text" text NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "member_remote_posts_object_idx" ON "member_remote_posts" USING btree ("object_id");
--> statement-breakpoint
CREATE INDEX "member_remote_posts_actor_idx" ON "member_remote_posts" USING btree ("actor_uri","published_at");
