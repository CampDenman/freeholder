-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- Recipient-local quiet hours, frequency caps, and explicit exceptions (C7.13).

ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "policy_exception" text;
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "policy_exception_ref" text;
--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT IF EXISTS "messages_policy_exception_pair";
--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_policy_exception_pair"
  CHECK (("policy_exception" IS NULL AND "policy_exception_ref" IS NULL)
    OR ("policy_exception" IS NOT NULL AND "policy_exception_ref" IS NOT NULL));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "messaging_windows" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "scope" text NOT NULL,
  "contact_id" uuid REFERENCES "contacts"("id") ON DELETE CASCADE,
  "segment_id" uuid REFERENCES "segments"("id") ON DELETE CASCADE,
  "quiet_from" time,
  "quiet_to" time,
  "timezone_source" text DEFAULT 'contact' NOT NULL,
  "max_per_day" integer,
  "max_per_week" integer,
  "applies_to" text DEFAULT 'all' NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "messaging_windows_scope_target" CHECK (
    ("scope" = 'global' AND "contact_id" IS NULL AND "segment_id" IS NULL)
    OR ("scope" = 'contact' AND "contact_id" IS NOT NULL AND "segment_id" IS NULL)
    OR ("scope" = 'segment' AND "segment_id" IS NOT NULL AND "contact_id" IS NULL)
  ),
  CONSTRAINT "messaging_windows_quiet_pair" CHECK (
    ("quiet_from" IS NULL AND "quiet_to" IS NULL)
    OR ("quiet_from" IS NOT NULL AND "quiet_to" IS NOT NULL AND "quiet_from" <> "quiet_to")
  ),
  CONSTRAINT "messaging_windows_has_policy" CHECK (
    "quiet_from" IS NOT NULL OR "max_per_day" IS NOT NULL OR "max_per_week" IS NOT NULL
  ),
  CONSTRAINT "messaging_windows_daily_cap" CHECK ("max_per_day" IS NULL OR "max_per_day" > 0),
  CONSTRAINT "messaging_windows_weekly_cap" CHECK ("max_per_week" IS NULL OR "max_per_week" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "messaging_windows_code_idx" ON "messaging_windows" ("code");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messaging_windows_scope_idx" ON "messaging_windows" ("scope", "active");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messaging_windows_contact_idx" ON "messaging_windows" ("contact_id", "active");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messaging_windows_segment_idx" ON "messaging_windows" ("segment_id", "active");
--> statement-breakpoint
INSERT INTO "messaging_windows" (
  "id", "code", "name", "scope", "quiet_from", "quiet_to",
  "timezone_source", "applies_to"
) VALUES (
  '00000000-0000-4000-8000-000000000713',
  'recipient-local-quiet-hours',
  'Recipient-local quiet hours',
  'global',
  '21:00',
  '08:00',
  'contact',
  'all'
) ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "messaging_windows" (
  "id", "code", "name", "scope", "max_per_day", "max_per_week",
  "timezone_source", "applies_to"
) VALUES (
  '00000000-0000-4000-8000-000000000714',
  'marketing-frequency-cap',
  'Marketing frequency cap',
  'global',
  3,
  10,
  'contact',
  'marketing'
) ON CONFLICT ("code") DO NOTHING;
