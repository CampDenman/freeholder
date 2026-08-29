-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
--
-- The help centre / knowledge base (MASTER.md §4.6, C8.12).
--
-- §4.6 is explicit: "The help centre is the CMS, not a second CMS. A
-- HelpArticle is a Page with a category and a helpfulness counter." So there
-- is no help_articles table. An article is a row in `pages` that has a
-- category, which is the same choice `sections.kind` made — one object, one
-- discriminator, listed separately in admin because that is the only place
-- the difference matters.
--
-- What that buys, none of it written twice: the block editor, locale
-- variants, per-page SEO, the working copy, scheduling, approval, the publish
-- flow, the catch-all route, and inclusion in the sitemap. A separate table
-- would have had to reimplement each one and then keep up with it forever.
CREATE TABLE "help_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Per-locale rows rather than one row with translated names, because §4.9
-- already made that choice for pages, and a help centre that arranges itself
-- differently from the site it lives on is a second CMS by another route.
CREATE UNIQUE INDEX "help_categories_slug_locale_idx" ON "help_categories" USING btree ("slug","locale");--> statement-breakpoint
CREATE INDEX "help_categories_position_idx" ON "help_categories" USING btree ("locale","position");--> statement-breakpoint

ALTER TABLE "pages" ADD COLUMN "help_category_id" uuid;--> statement-breakpoint
-- Two counters and no comment box (§4.6). "Did this help — yes/no" is
-- answerable by somebody who is already frustrated; a free-text box is a
-- support queue nobody staffed, and an unanswered one is worse than none.
ALTER TABLE "pages" ADD COLUMN "helpful_yes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "helpful_no" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- SET NULL, not CASCADE: deleting a category must never delete the writing.
-- An article whose category is gone is uncategorised and still published,
-- which is recoverable; the alternative silently destroys owner content.
ALTER TABLE "pages" ADD CONSTRAINT "pages_help_category_id_help_categories_id_fk" FOREIGN KEY ("help_category_id") REFERENCES "public"."help_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pages_help_category_idx" ON "pages" USING btree ("help_category_id");--> statement-breakpoint
-- Trigram, because §4.6 says search is the same kind the inbox uses: somebody
-- looking for help types a fragment of the problem, not a stemmed keyword.
-- pg_trgm is already installed (0022).
CREATE INDEX "pages_title_search_idx" ON "pages" USING gin ("title" gin_trgm_ops);
