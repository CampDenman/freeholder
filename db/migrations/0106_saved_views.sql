-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- A filter somebody actually uses, kept (MASTER.md §4.14, C7.06).
--
-- `filters` is a capture of the query string rather than a second filtering
-- language: the URL is already the state on every admin list, so a saved view
-- is a named URL and the back button, a bookmark and a pasted link are the
-- same thing.

CREATE TABLE IF NOT EXISTS "saved_views" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "entity" text NOT NULL,
  "name" text NOT NULL,
  "filters" jsonb DEFAULT '{}' NOT NULL,
  "columns" text[] DEFAULT '{}' NOT NULL,
  "sort_key" text,
  "sort_dir" text,
  "owner_user_id" uuid REFERENCES "users"("id") ON DELETE CASCADE,
  "shared" boolean DEFAULT false NOT NULL,
  "is_default" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "saved_views_name" CHECK (char_length("name") BETWEEN 1 AND 120),
  CONSTRAINT "saved_views_entity_key" CHECK (char_length("entity") BETWEEN 1 AND 60)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "saved_views_entity_idx" ON "saved_views" ("entity", "owner_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "saved_views_shared_idx" ON "saved_views" ("entity", "shared");
--> statement-breakpoint
-- One default per person per list. Without this a second "make default" leaves
-- two, and which one opens becomes whichever the planner returned first — a bug
-- that looks like the software forgetting.
CREATE UNIQUE INDEX IF NOT EXISTS "saved_views_default_idx"
  ON "saved_views" ("entity", "owner_user_id") WHERE is_default;
