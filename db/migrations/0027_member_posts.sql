-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C12.04 (MASTER.md §44.4): member posts, comments, reactions, hashtags,
-- mentions and consent-gated people tags.
CREATE TABLE "member_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_id" uuid NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"visibility" text NOT NULL,
	"repost_of" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "member_posts_visibility_valid" CHECK ("member_posts"."visibility" in ('public','followers','friends','subscribers','only_me')),
	CONSTRAINT "member_posts_body_length" CHECK (char_length("member_posts"."body") <= 5000),
	CONSTRAINT "member_posts_has_content" CHECK (char_length("member_posts"."body") > 0 or "member_posts"."repost_of" is not null)
);
--> statement-breakpoint
ALTER TABLE "member_posts" ADD CONSTRAINT "member_posts_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "member_posts_author_idx" ON "member_posts" USING btree ("author_id","created_at");
--> statement-breakpoint
CREATE INDEX "member_posts_created_idx" ON "member_posts" USING btree ("created_at","id");
--> statement-breakpoint
CREATE INDEX "member_posts_repost_idx" ON "member_posts" USING btree ("repost_of");
--> statement-breakpoint
CREATE TABLE "member_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"parent_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "member_comments_body_length" CHECK (char_length("member_comments"."body") between 1 and 2000)
);
--> statement-breakpoint
ALTER TABLE "member_comments" ADD CONSTRAINT "member_comments_post_id_member_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."member_posts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "member_comments" ADD CONSTRAINT "member_comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "member_comments_post_idx" ON "member_comments" USING btree ("post_id","created_at");
--> statement-breakpoint
CREATE TABLE "member_reactions" (
	"post_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_reactions_post_id_user_id_pk" PRIMARY KEY("post_id","user_id"),
	CONSTRAINT "member_reactions_kind_valid" CHECK ("member_reactions"."kind" in ('like','love','laugh','wow','sad','thanks'))
);
--> statement-breakpoint
ALTER TABLE "member_reactions" ADD CONSTRAINT "member_reactions_post_id_member_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."member_posts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "member_reactions" ADD CONSTRAINT "member_reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "member_post_tags" (
	"post_id" uuid NOT NULL,
	"tag" text NOT NULL,
	CONSTRAINT "member_post_tags_post_id_tag_pk" PRIMARY KEY("post_id","tag")
);
--> statement-breakpoint
ALTER TABLE "member_post_tags" ADD CONSTRAINT "member_post_tags_post_id_member_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."member_posts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "member_post_tags_tag_idx" ON "member_post_tags" USING btree ("tag");
--> statement-breakpoint
CREATE TABLE "member_mentions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"comment_id" uuid,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_mentions_kind_valid" CHECK ("member_mentions"."kind" in ('mention','tag')),
	CONSTRAINT "member_mentions_status_valid" CHECK ("member_mentions"."status" in ('pending','approved','declined'))
);
--> statement-breakpoint
ALTER TABLE "member_mentions" ADD CONSTRAINT "member_mentions_post_id_member_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."member_posts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "member_mentions" ADD CONSTRAINT "member_mentions_comment_id_member_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."member_comments"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "member_mentions" ADD CONSTRAINT "member_mentions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "member_mentions_user_idx" ON "member_mentions" USING btree ("user_id","kind","status");
--> statement-breakpoint
CREATE INDEX "member_mentions_post_idx" ON "member_mentions" USING btree ("post_id");
