-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- Bounded site-chat sessions and explicit assistant-to-human handoffs (C7.15).

ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "assistant_escalated_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "assistant_escalation_reason" text;
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "assistant_escalation_resolved_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assistant_escalation_reason"
  CHECK ("assistant_escalation_reason" IS NULL OR char_length("assistant_escalation_reason") <= 1000);
--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assistant_escalation_state"
  CHECK ("assistant_escalation_resolved_at" IS NULL OR "assistant_escalated_at" IS NOT NULL);
--> statement-breakpoint
CREATE TABLE "site_chat_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "contact_id" uuid NOT NULL REFERENCES "contacts"("id") ON DELETE cascade,
  "conversation_id" uuid NOT NULL REFERENCES "conversations"("id") ON DELETE cascade,
  "token_hash" text NOT NULL,
  "locale" text DEFAULT 'en' NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
  "closed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "site_chat_sessions_token_hash" CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "site_chat_sessions_expiry" CHECK ("expires_at" > "created_at"),
  CONSTRAINT "site_chat_sessions_locale" CHECK (char_length("locale") BETWEEN 2 AND 35)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "site_chat_sessions_token_idx" ON "site_chat_sessions" ("token_hash");
--> statement-breakpoint
CREATE INDEX "site_chat_sessions_contact_idx" ON "site_chat_sessions" ("contact_id", "created_at");
--> statement-breakpoint
CREATE INDEX "site_chat_sessions_conversation_idx" ON "site_chat_sessions" ("conversation_id", "created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "site_chat_sessions_one_open_idx" ON "site_chat_sessions" ("conversation_id") WHERE "closed_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "chat_session_id" uuid REFERENCES "site_chat_sessions"("id") ON DELETE set null;
--> statement-breakpoint
CREATE INDEX "messages_chat_session_idx" ON "messages" ("chat_session_id", "occurred_at");
