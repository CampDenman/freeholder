-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- Lead scoring, transparent by construction (MASTER.md §4.14, C7.05).
--
-- Note what is absent: there is no score column anywhere. A score is the sum of
-- the award ledger below, computed when somebody asks, so the number and the
-- reasons for it cannot drift apart — which is exactly what a cached scalar
-- guarantees within a week.

CREATE TABLE IF NOT EXISTS "scoring_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "kind" text DEFAULT 'event' NOT NULL,
  "event_name" text,
  "match_payload" jsonb DEFAULT '{}' NOT NULL,
  "points" integer DEFAULT 0 NOT NULL,
  "decay_days" integer DEFAULT 0 NOT NULL,
  "max_awards" integer,
  "advance_to" text,
  "threshold_score" integer,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "scoring_rules_name" CHECK (char_length("name") BETWEEN 1 AND 120),
  CONSTRAINT "scoring_rules_points" CHECK ("points" BETWEEN -1000 AND 1000),
  CONSTRAINT "scoring_rules_decay" CHECK ("decay_days" BETWEEN 0 AND 3650),
  CONSTRAINT "scoring_rules_max_awards" CHECK ("max_awards" IS NULL OR "max_awards" BETWEEN 1 AND 10000),
  -- An event rule needs something to listen for; a threshold rule needs a line
  -- to cross and somewhere to move people to. A row that is neither can never
  -- fire, and storing one is how a scoring model becomes a thing nobody can
  -- explain.
  CONSTRAINT "scoring_rules_shape" CHECK (
    ("kind" = 'event' AND "event_name" IS NOT NULL AND "threshold_score" IS NULL)
    OR ("kind" = 'threshold' AND "threshold_score" IS NOT NULL AND "advance_to" IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scoring_rules_event_idx" ON "scoring_rules" ("event_name", "active");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scoring_rules_kind_idx" ON "scoring_rules" ("kind", "active");
--> statement-breakpoint
-- `points` and `decay_days` are copied from the rule at award time rather than
-- read through it: an owner who lowers a rule from 20 to 10 in March has
-- changed what future behaviour is worth, not what somebody did in January.
CREATE TABLE IF NOT EXISTS "contact_score_awards" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "contact_id" uuid NOT NULL REFERENCES "contacts"("id") ON DELETE CASCADE,
  "rule_id" uuid REFERENCES "scoring_rules"("id") ON DELETE SET NULL,
  -- Kept so a deleted rule still reads as a sentence rather than a blank.
  "rule_name" text NOT NULL,
  "event_name" text NOT NULL,
  "points" integer NOT NULL,
  "decay_days" integer DEFAULT 0 NOT NULL,
  "source_event_id" text,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_score_awards_contact_idx" ON "contact_score_awards" ("contact_id", "occurred_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_score_awards_rule_idx" ON "contact_score_awards" ("rule_id");
--> statement-breakpoint
-- One award per rule per delivery of one event. The bus retries, and a retry
-- that doubled somebody's score would make the number meaningless in exactly
-- the way §4.14 forbids.
CREATE UNIQUE INDEX IF NOT EXISTS "contact_score_awards_once_idx"
  ON "contact_score_awards" ("rule_id", "contact_id", "source_event_id")
  WHERE source_event_id IS NOT NULL;
