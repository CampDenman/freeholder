-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C5.26: owner-configured calculators (MASTER.md 4.18).
--
-- `assumptions` is NOT NULL, and that is the constraint that matters. A figure
-- with no stated assumptions is exactly what this feature exists to stop being
-- publishable: the arithmetic is never the claim on its own, the arithmetic
-- plus what it assumed is. Making the column nullable would have made the
-- caveat optional, and an optional caveat is one nobody writes.
CREATE TABLE "calculators" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "trashed_at" timestamp with time zone,
  "slug" text NOT NULL,
  "name" text NOT NULL,
  "intro" text,
  "inputs" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "result_label" text NOT NULL,
  "result_unit" text,
  "assumptions" text NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "calculators_status" CHECK ("status" IN ('draft', 'active', 'closed')),
  CONSTRAINT "calculators_assumptions_present"
    CHECK (char_length(btrim("assumptions")) >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "calculators_slug_idx" ON "calculators" ("slug");
--> statement-breakpoint
CREATE INDEX "calculators_trash_idx" ON "calculators" ("trashed_at") WHERE "trashed_at" IS NOT NULL;
