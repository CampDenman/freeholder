-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- One conversation with one person, whatever it arrived on (§4.14, C7.08).
--
-- A message carries its own channel; a conversation carries the channel a reply
-- would use. That is what lets a form submission, the email reply to it and a
-- text about the same job be one thread — §4.14's promise — while replying
-- still has one unambiguous route.

CREATE TABLE IF NOT EXISTS "conversations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  -- Always a real contact, never an orphan thread: a thread with nobody
  -- attached has no history, no consent record and no way to say who it is.
  "contact_id" uuid NOT NULL REFERENCES "contacts"("id") ON DELETE CASCADE,
  "subject" text,
  "reply_channel" text NOT NULL,
  -- Untyped until C7.11 owns messaging numbers.
  "number_id" uuid,
  "status" text DEFAULT 'open' NOT NULL,
  "snoozed_until" timestamp with time zone,
  "assignee_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "thread_key" text,
  "last_inbound_at" timestamp with time zone,
  "last_outbound_at" timestamp with time zone,
  "unread" boolean DEFAULT false NOT NULL,
  "message_count" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "conversations_subject" CHECK ("subject" IS NULL OR char_length("subject") <= 500),
  -- A snoozed thread knows when it comes back; otherwise it is closed with
  -- extra steps, and returning is the one thing snoozing promises.
  CONSTRAINT "conversations_snoozed_has_time" CHECK ("status" <> 'snoozed' OR "snoozed_until" IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversations_status_idx" ON "conversations" ("status", "updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversations_contact_idx" ON "conversations" ("contact_id", "updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversations_assignee_idx" ON "conversations" ("assignee_user_id", "status");
--> statement-breakpoint
-- One thread per provider thread id: a retried webhook must not open a second
-- conversation beside the first and send the reply to the wrong one.
CREATE UNIQUE INDEX IF NOT EXISTS "conversations_thread_key_idx"
  ON "conversations" ("thread_key") WHERE thread_key IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "conversation_id" uuid NOT NULL REFERENCES "conversations"("id") ON DELETE CASCADE,
  -- Denormalised so a timeline, an export and an erasure need no join.
  "contact_id" uuid NOT NULL REFERENCES "contacts"("id") ON DELETE CASCADE,
  "direction" text NOT NULL,
  "channel" text NOT NULL,
  "body" text NOT NULL,
  "media_asset_ids" uuid[] DEFAULT '{}' NOT NULL,
  "template_id" uuid,
  "sent_by" text NOT NULL,
  "sent_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "provider_ref" text,
  "segments" integer,
  "cost_minor" integer,
  "cost_currency" text,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "messages_body" CHECK (char_length("body") BETWEEN 1 AND 100000),
  CONSTRAINT "messages_cost" CHECK ("cost_minor" IS NULL OR "cost_minor" >= 0),
  -- A cost with no currency is a number nobody can add up (§15.4).
  CONSTRAINT "messages_cost_currency" CHECK ("cost_minor" IS NULL OR "cost_currency" IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_conversation_idx" ON "messages" ("conversation_id", "occurred_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_contact_idx" ON "messages" ("contact_id", "occurred_at");
--> statement-breakpoint
-- Every provider retries its webhooks, and a duplicate here is a duplicate in
-- somebody's inbox and in the bill.
CREATE UNIQUE INDEX IF NOT EXISTS "messages_provider_ref_idx"
  ON "messages" ("provider_ref") WHERE provider_ref IS NOT NULL;
--> statement-breakpoint
-- Delivery is a sequence, not a column: queued, sent, delivered, read — and a
-- hard failure between any two of them is the thing an owner needs to see.
CREATE TABLE IF NOT EXISTS "message_deliveries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "message_id" uuid NOT NULL REFERENCES "messages"("id") ON DELETE CASCADE,
  "status" text NOT NULL,
  "error_code" text,
  "error_text" text,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_deliveries_message_idx" ON "message_deliveries" ("message_id", "occurred_at");
--> statement-breakpoint
-- Providers resend the same callback, and a doubled "delivered" turns a history
-- into noise.
CREATE UNIQUE INDEX IF NOT EXISTS "message_deliveries_once_idx" ON "message_deliveries" ("message_id", "status");
