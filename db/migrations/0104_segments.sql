-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- The one definition of "who" (MASTER.md §4.14, C7.04).

CREATE TABLE IF NOT EXISTS "segments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "description" text,
  "kind" text DEFAULT 'dynamic' NOT NULL,
  -- Stored rather than compiled, so a segment stays inspectable: an owner can
  -- be shown what it asks, and one rule can be re-run on its own to say why
  -- somebody is in it.
  "definition" jsonb NOT NULL,
  "member_count_cached" integer,
  "last_evaluated_at" timestamp with time zone,
  "captured_at" timestamp with time zone,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "segments_name" CHECK (char_length("name") BETWEEN 1 AND 120),
  CONSTRAINT "segments_slug_shape" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  -- A static segment is only static once it has been captured. Before that it
  -- is a definition with no answer, and sending to it would send to nobody
  -- without saying so.
  CONSTRAINT "segments_static_captured" CHECK ("kind" <> 'static' OR "captured_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "segments_slug_idx" ON "segments" ("slug");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "segments_kind_idx" ON "segments" ("kind");
--> statement-breakpoint
-- Only static segments have rows here. A dynamic segment deliberately has no
-- membership table: storing one would be a second answer to the question its
-- definition already answers, and the two would disagree within a day.
CREATE TABLE IF NOT EXISTS "segment_members" (
  "segment_id" uuid NOT NULL REFERENCES "segments"("id") ON DELETE CASCADE,
  "contact_id" uuid NOT NULL REFERENCES "contacts"("id") ON DELETE CASCADE,
  "captured_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "segment_members_pk" PRIMARY KEY ("segment_id", "contact_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "segment_members_contact_idx" ON "segment_members" ("contact_id");
--> statement-breakpoint
-- A price list can name its audience in the one language the whole platform
-- uses. `customer_group_id` says the same thing in a poorer one — a single tag
-- and a single lifecycle stage — and stays until a later release can retire it;
-- a list may name either, and a list naming both must satisfy both.
ALTER TABLE "price_lists" ADD COLUMN IF NOT EXISTS "segment_id" uuid REFERENCES "segments"("id") ON DELETE RESTRICT;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "price_lists_segment_idx" ON "price_lists" ("segment_id");
