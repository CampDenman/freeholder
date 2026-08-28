-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- Shared SMS templates, owner keyword actions, media evidence, and invalid-number state (C7.14).

ALTER TABLE "content_templates" ADD COLUMN IF NOT EXISTS "variables" text[] DEFAULT '{}' NOT NULL;
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "recipient_address" text;
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "phone_status" text DEFAULT 'unknown' NOT NULL;
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "phone_invalid_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "phone_invalid_reason" text;
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "phone_invalid_provider_code" text;
--> statement-breakpoint
ALTER TABLE "contacts" DROP CONSTRAINT IF EXISTS "contacts_phone_state_consistent";
--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_phone_state_consistent" CHECK (
  ("phone_status" = 'invalid' AND "phone_invalid_at" IS NOT NULL)
  OR ("phone_status" <> 'invalid' AND "phone_invalid_at" IS NULL
    AND "phone_invalid_reason" IS NULL AND "phone_invalid_provider_code" IS NULL)
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_phone_status_allowed"
  CHECK ("phone_status" IN ('unknown', 'valid', 'invalid'));
--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_recipient_address_length"
  CHECK ("recipient_address" IS NULL OR char_length("recipient_address") <= 320);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "keyword_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "keyword" text NOT NULL,
  "normalized_keyword" text NOT NULL,
  "match" text DEFAULT 'exact' NOT NULL,
  "action" text NOT NULL,
  "action_value" text,
  "reply_body" text,
  "locale" text DEFAULT '*' NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "keyword_rules_keyword_length" CHECK (char_length("keyword") BETWEEN 1 AND 100),
  CONSTRAINT "keyword_rules_action_value" CHECK (
    ("action" IN ('tag', 'route') AND "action_value" IS NOT NULL)
    OR ("action" NOT IN ('tag', 'route') AND "action_value" IS NULL)
  ),
  CONSTRAINT "keyword_rules_match_allowed" CHECK ("match" IN ('exact', 'prefix')),
  CONSTRAINT "keyword_rules_action_allowed" CHECK (
    "action" IN ('opt_out','opt_in','help','auto_reply','tag','route','booking_confirm')
  ),
  CONSTRAINT "keyword_rules_reply_required" CHECK (
    "action" NOT IN ('help', 'auto_reply') OR "reply_body" IS NOT NULL
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "keyword_rules_match_idx"
  ON "keyword_rules" ("normalized_keyword", "match", "locale");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "keyword_rules_active_idx" ON "keyword_rules" ("active", "locale");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "keyword_rule_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "provider_ref" text NOT NULL,
  "rule_id" uuid REFERENCES "keyword_rules"("id") ON DELETE set null,
  "contact_id" uuid NOT NULL REFERENCES "contacts"("id") ON DELETE cascade,
  "conversation_id" uuid NOT NULL REFERENCES "conversations"("id") ON DELETE cascade,
  "action" text NOT NULL,
  "outcome" text NOT NULL,
  "detail" text,
  "booking_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "keyword_rule_events_action_allowed" CHECK (
    "action" IN ('opt_out','opt_in','help','auto_reply','tag','route','booking_confirm')
  ),
  CONSTRAINT "keyword_rule_events_outcome_allowed" CHECK (
    "outcome" IN ('applied','refused','noop')
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "keyword_rule_events_provider_idx"
  ON "keyword_rule_events" ("provider_ref");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "keyword_rule_events_contact_idx"
  ON "keyword_rule_events" ("contact_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "keyword_rule_events_rule_idx"
  ON "keyword_rule_events" ("rule_id", "created_at");
