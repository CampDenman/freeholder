-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
--
-- Assistant guardrails (MASTER.md §31, C9.23).
--
-- Guardrails are columns on the settings singleton, not prompt text: topics
-- to refuse, topics to escalate, a tone preset, and an optional contact-form
-- path. The module matches those lists itself. A model asked not to invent
-- a price will still invent one; a function that reads the reply against the
-- retrieved notes will not.
--
-- `knowledge_gaps` is yesterday's unanswered question. The visitor's words
-- already live on the contact's conversation (C7.15); this table is the
-- queue an owner works, turning a failed answer into a KnowledgeEntry in
-- one click. contact_id is here so a merge cannot orphan the queue.
ALTER TABLE "assistant_settings" ADD COLUMN "tone" text DEFAULT 'professional' NOT NULL;--> statement-breakpoint
ALTER TABLE "assistant_settings" ADD COLUMN "refuse_topics" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "assistant_settings" ADD COLUMN "escalate_topics" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "assistant_settings" ADD COLUMN "contact_form_path" text;--> statement-breakpoint
ALTER TABLE "assistant_settings" ADD CONSTRAINT "assistant_settings_tone" CHECK ("assistant_settings"."tone" in ('professional', 'friendly', 'brief'));--> statement-breakpoint

CREATE TABLE "knowledge_gaps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"message_id" uuid,
	"question" text NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"knowledge_entry_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "knowledge_gaps" ADD CONSTRAINT "knowledge_gaps_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_gaps" ADD CONSTRAINT "knowledge_gaps_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_gaps" ADD CONSTRAINT "knowledge_gaps_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_gaps" ADD CONSTRAINT "knowledge_gaps_knowledge_entry_id_knowledge_entries_id_fk" FOREIGN KEY ("knowledge_entry_id") REFERENCES "public"."knowledge_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_gaps_message_idx" ON "knowledge_gaps" USING btree ("message_id") WHERE "message_id" is not null;--> statement-breakpoint
CREATE INDEX "knowledge_gaps_contact_idx" ON "knowledge_gaps" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "knowledge_gaps_status_idx" ON "knowledge_gaps" USING btree ("status", "created_at");
