-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- Mandatory SMS consent and carrier control words (§4.14, C7.12).

-- Frequency and consent policy need to know why an outbound message was sent.
-- Inbound messages deliberately remain NULL: a customer's words are not a
-- campaign, transaction, or support action chosen by the business.
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "purpose" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sms_compliance_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "contact_id" uuid NOT NULL REFERENCES "contacts"("id") ON DELETE CASCADE,
  "provider_ref" text NOT NULL,
  "intent" text NOT NULL,
  "keyword" text NOT NULL,
  "locale" text NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "sms_compliance_events_keyword"
    CHECK (char_length("keyword") BETWEEN 1 AND 100)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sms_compliance_events_provider_ref_idx"
  ON "sms_compliance_events" ("provider_ref");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sms_compliance_events_contact_idx"
  ON "sms_compliance_events" ("contact_id", "occurred_at");
