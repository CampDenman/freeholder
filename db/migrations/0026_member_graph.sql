-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C12.02/C12.03 (MASTER.md §44.3–44.4): profile visibility and the social graph.
ALTER TABLE "member_profiles" ADD COLUMN "bio_visibility" text DEFAULT 'followers' NOT NULL;
--> statement-breakpoint
ALTER TABLE "member_profiles" ADD COLUMN "links" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "member_profiles" ADD COLUMN "links_visibility" text DEFAULT 'followers' NOT NULL;
--> statement-breakpoint
ALTER TABLE "member_profiles" ADD COLUMN "default_post_visibility" text DEFAULT 'followers' NOT NULL;
--> statement-breakpoint
ALTER TABLE "member_profiles" ADD COLUMN "is_private" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "member_profiles" ADD COLUMN "indexable" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "member_profiles" ADD CONSTRAINT "member_profiles_bio_visibility_valid" CHECK ("member_profiles"."bio_visibility" in ('public','followers','friends','subscribers','only_me'));
--> statement-breakpoint
ALTER TABLE "member_profiles" ADD CONSTRAINT "member_profiles_links_visibility_valid" CHECK ("member_profiles"."links_visibility" in ('public','followers','friends','subscribers','only_me'));
--> statement-breakpoint
ALTER TABLE "member_profiles" ADD CONSTRAINT "member_profiles_default_post_visibility_valid" CHECK ("member_profiles"."default_post_visibility" in ('public','followers','friends','subscribers','only_me'));
--> statement-breakpoint
CREATE TABLE "member_follows" (
	"follower_id" uuid NOT NULL,
	"followee_id" uuid NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_follows_follower_id_followee_id_pk" PRIMARY KEY("follower_id","followee_id"),
	CONSTRAINT "member_follows_not_self" CHECK ("member_follows"."follower_id" <> "member_follows"."followee_id"),
	CONSTRAINT "member_follows_status_valid" CHECK ("member_follows"."status" in ('active','requested'))
);
--> statement-breakpoint
ALTER TABLE "member_follows" ADD CONSTRAINT "member_follows_follower_id_users_id_fk" FOREIGN KEY ("follower_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "member_follows" ADD CONSTRAINT "member_follows_followee_id_users_id_fk" FOREIGN KEY ("followee_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "member_follows_followee_idx" ON "member_follows" USING btree ("followee_id","status");
--> statement-breakpoint
CREATE TABLE "member_friendships" (
	"low_id" uuid NOT NULL,
	"high_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	CONSTRAINT "member_friendships_low_id_high_id_pk" PRIMARY KEY("low_id","high_id"),
	CONSTRAINT "member_friendships_ordered" CHECK ("member_friendships"."low_id" < "member_friendships"."high_id"),
	CONSTRAINT "member_friendships_status_valid" CHECK ("member_friendships"."status" in ('pending','accepted')),
	CONSTRAINT "member_friendships_requester_in_pair" CHECK ("member_friendships"."requested_by" in ("member_friendships"."low_id", "member_friendships"."high_id"))
);
--> statement-breakpoint
ALTER TABLE "member_friendships" ADD CONSTRAINT "member_friendships_low_id_users_id_fk" FOREIGN KEY ("low_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "member_friendships" ADD CONSTRAINT "member_friendships_high_id_users_id_fk" FOREIGN KEY ("high_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "member_friendships" ADD CONSTRAINT "member_friendships_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "member_friendships_high_idx" ON "member_friendships" USING btree ("high_id","status");
--> statement-breakpoint
CREATE TABLE "member_relations" (
	"owner_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_relations_owner_id_target_id_kind_pk" PRIMARY KEY("owner_id","target_id","kind"),
	CONSTRAINT "member_relations_not_self" CHECK ("member_relations"."owner_id" <> "member_relations"."target_id"),
	CONSTRAINT "member_relations_kind_valid" CHECK ("member_relations"."kind" in ('block','mute','restrict'))
);
--> statement-breakpoint
ALTER TABLE "member_relations" ADD CONSTRAINT "member_relations_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "member_relations" ADD CONSTRAINT "member_relations_target_id_users_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "member_relations_target_idx" ON "member_relations" USING btree ("target_id","kind");
