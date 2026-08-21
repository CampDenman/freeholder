-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- The daily briefing (C4.15, MASTER.md §42).
CREATE TABLE IF NOT EXISTS "briefings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "on_date" date NOT NULL,
  "status" text DEFAULT 'assembling' NOT NULL,
  "assembled_at" timestamp with time zone,
  "read_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "briefings_person_day_idx"
  ON "briefings" ("user_id", "on_date");
CREATE INDEX IF NOT EXISTS "briefings_unread_idx"
  ON "briefings" ("user_id", "read_at");

CREATE TABLE IF NOT EXISTS "briefing_contributions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "briefing_id" uuid NOT NULL REFERENCES "briefings"("id") ON DELETE cascade,
  "key" text NOT NULL,
  "source" text DEFAULT 'core' NOT NULL,
  "title" text NOT NULL,
  "body" text,
  "items" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "severity" text DEFAULT 'changed' NOT NULL,
  "playbook_run_id" uuid,
  "position" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "briefing_contributions_key_idx"
  ON "briefing_contributions" ("briefing_id", "key");
CREATE INDEX IF NOT EXISTS "briefing_contributions_briefing_idx"
  ON "briefing_contributions" ("briefing_id");

CREATE TABLE IF NOT EXISTS "briefing_preferences" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "key" text NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "briefing_preferences_idx"
  ON "briefing_preferences" ("user_id", "key");
