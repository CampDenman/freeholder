-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- Notes and what they used to say (MASTER.md §4.14, C7.03).

CREATE TABLE IF NOT EXISTS "notes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "subject_type" text NOT NULL,
  "subject_id" uuid NOT NULL,
  "contact_id" uuid REFERENCES "contacts"("id") ON DELETE SET NULL,
  "author_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "body" text NOT NULL,
  "visibility" text DEFAULT 'team' NOT NULL,
  "pinned" boolean DEFAULT false NOT NULL,
  "pinned_at" timestamp with time zone,
  "mentions" uuid[] DEFAULT '{}' NOT NULL,
  "edit_count" integer DEFAULT 0 NOT NULL,
  "edited_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "notes_body" CHECK (char_length("body") BETWEEN 1 AND 20000),
  -- The note at the top of a customer shapes every conversation with them, so
  -- "who put it there and when" has to be answerable.
  CONSTRAINT "notes_pinned_has_time" CHECK ("pinned" = false OR "pinned_at" IS NOT NULL),
  CONSTRAINT "notes_edited_has_time" CHECK ("edit_count" = 0 OR "edited_at" IS NOT NULL)
);
--> statement-breakpoint
-- Pinned first, then newest: the only order this table is ever read in.
CREATE INDEX IF NOT EXISTS "notes_subject_idx" ON "notes" ("subject_type", "subject_id", "pinned", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notes_contact_idx" ON "notes" ("contact_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notes_author_idx" ON "notes" ("author_user_id");
--> statement-breakpoint
-- One row per edit, holding the *previous* body, so the note itself is always
-- current and the history reads backwards from it. Cascaded, because what a
-- note used to say is as much about the person as what it says now.
CREATE TABLE IF NOT EXISTS "note_revisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "note_id" uuid NOT NULL REFERENCES "notes"("id") ON DELETE CASCADE,
  "body" text NOT NULL,
  "edited_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "edited_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "note_revisions_note_idx" ON "note_revisions" ("note_id", "edited_at");
