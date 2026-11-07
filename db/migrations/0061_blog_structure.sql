-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C2.27/C2.28 (MASTER.md §43): blog posts, categories, tags and authors.
-- New tables only: the previous release never reads them, so rollback is
-- safe. A post is still a `pages` row; `blog_posts` marks it as one.
CREATE TABLE "blog_settings" (
	"key" text PRIMARY KEY DEFAULT 'site' NOT NULL,
	"category_base" text DEFAULT 'blog/category' NOT NULL,
	"tag_base" text DEFAULT 'blog/tag' NOT NULL,
	"author_base" text DEFAULT 'blog/author' NOT NULL,
	"posts_per_page" integer DEFAULT 12 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blog_authors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"path" text NOT NULL,
	"name" text NOT NULL,
	"bio" text,
	"email" text,
	"user_id" uuid,
	"seo" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source" text DEFAULT 'admin' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "blog_authors" ADD CONSTRAINT "blog_authors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "blog_authors_slug_idx" ON "blog_authors" USING btree ("slug");
--> statement-breakpoint
CREATE UNIQUE INDEX "blog_authors_path_idx" ON "blog_authors" USING btree ("path");
--> statement-breakpoint
CREATE UNIQUE INDEX "blog_authors_user_idx" ON "blog_authors" USING btree ("user_id") WHERE "blog_authors"."user_id" is not null;
--> statement-breakpoint
CREATE TABLE "blog_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"taxonomy" text NOT NULL,
	"slug" text NOT NULL,
	"path" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"parent_id" uuid,
	"position" integer DEFAULT 0 NOT NULL,
	"seo" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source" text DEFAULT 'admin' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blog_terms_taxonomy_allowed" CHECK ("blog_terms"."taxonomy" in ('category', 'tag'))
);
--> statement-breakpoint
ALTER TABLE "blog_terms" ADD CONSTRAINT "blog_terms_parent_id_blog_terms_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."blog_terms"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "blog_terms_slug_idx" ON "blog_terms" USING btree ("taxonomy","slug");
--> statement-breakpoint
CREATE UNIQUE INDEX "blog_terms_path_idx" ON "blog_terms" USING btree ("path");
--> statement-breakpoint
CREATE INDEX "blog_terms_parent_idx" ON "blog_terms" USING btree ("parent_id");
--> statement-breakpoint
CREATE TABLE "blog_posts" (
	"page_id" uuid PRIMARY KEY NOT NULL,
	"author_id" uuid,
	"comments_enabled" boolean DEFAULT true NOT NULL,
	"source_modified_at" timestamp with time zone,
	"source" text DEFAULT 'admin' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "blog_posts" ADD CONSTRAINT "blog_posts_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "blog_posts" ADD CONSTRAINT "blog_posts_author_id_blog_authors_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."blog_authors"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "blog_posts_author_idx" ON "blog_posts" USING btree ("author_id");
--> statement-breakpoint
CREATE TABLE "blog_post_terms" (
	"page_id" uuid NOT NULL,
	"term_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "blog_post_terms_page_id_term_id_pk" PRIMARY KEY("page_id","term_id")
);
--> statement-breakpoint
ALTER TABLE "blog_post_terms" ADD CONSTRAINT "blog_post_terms_page_id_blog_posts_page_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."blog_posts"("page_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "blog_post_terms" ADD CONSTRAINT "blog_post_terms_term_id_blog_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."blog_terms"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "blog_post_terms_term_idx" ON "blog_post_terms" USING btree ("term_id");
