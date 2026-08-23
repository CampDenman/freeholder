-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- The numbers a business sends and receives on (§4.14, C7.10).
--
-- Credentials that reach a provider live in the environment (§17); this is
-- everything else, and it is in the database because it is configuration an
-- owner changes rather than a secret.

CREATE TABLE IF NOT EXISTS "messaging_numbers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "provider" text NOT NULL,
  "provider_ref" text NOT NULL,
  "e164" text NOT NULL,
  "label" text,
  "country" text,
  "kind" text DEFAULT 'long_code' NOT NULL,
  -- Per number, not per provider: the same account can hold a long code that
  -- cannot send pictures and a toll-free number that can.
  "capabilities" jsonb DEFAULT '{}' NOT NULL,
  "purpose" text DEFAULT 'transactional' NOT NULL,
  "is_default" boolean DEFAULT false NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "healthy" boolean DEFAULT true NOT NULL,
  -- A check that could not be made is *unknown*, never healthy: §4.14's
  -- "unregistered number silently filtered by carriers" is exactly that
  -- failure wearing a green tick.
  "health_unknown" boolean DEFAULT false NOT NULL,
  "health_problem" text,
  "provider_status" text,
  "health_checked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "messaging_numbers_e164" CHECK (char_length("e164") BETWEEN 1 AND 40),
  -- A number that failed its check has to say why, or the owner has a red light
  -- and nothing to act on.
  CONSTRAINT "messaging_numbers_problem" CHECK ("healthy" = true OR "health_problem" IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "messaging_numbers_ref_idx" ON "messaging_numbers" ("provider", "provider_ref");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messaging_numbers_e164_idx" ON "messaging_numbers" ("e164");
--> statement-breakpoint
-- One default per purpose. Without this, which number a booking confirmation
-- goes out on becomes whichever the planner returned first.
CREATE UNIQUE INDEX IF NOT EXISTS "messaging_numbers_default_idx"
  ON "messaging_numbers" ("purpose") WHERE is_default;
