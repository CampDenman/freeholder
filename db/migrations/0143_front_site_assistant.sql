-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
--
-- The optional front-site assistant: configuration, permissions and meter
-- (MASTER.md §31, C9.21).
--
-- Three of §31's rules are visible in this file.
--
-- "An optional module, off by default, enabled by a setting in admin." So
-- `enabled` defaults to false and `spend_cap_cents` defaults to zero: an
-- instance that migrates to this release and never opens the screen has an
-- assistant that is off and could not spend anything even if it were on.
--
-- "Owner picks provider + model + key in admin." The key is not here.
-- `credential_ref` holds the *name* of an environment variable, which is the
-- same indirection `agent_connections.credential_ref` already uses: §17 puts
-- secrets in the environment and configuration in the database, so a dump of
-- this table contains no model key at all.
--
-- "Every conversation lands on the spine." There is no transcript table. The
-- visitor's words and the assistant's reply are ordinary rows in `messages` on
-- the contact's canonical conversation (C7.15); `assistant_turns` records only
-- what an attempt cost and what became of it.
CREATE TABLE "assistant_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"provider" text DEFAULT 'none' NOT NULL,
	"model" text,
	"base_url" text,
	"credential_ref" text,
	"input_cents_per_million" integer,
	"output_cents_per_million" integer,
	"max_output_tokens" integer DEFAULT 700 NOT NULL,
	"display_name" text,
	"spend_cap_cents" integer DEFAULT 0 NOT NULL,
	"spend_period" text DEFAULT 'month' NOT NULL,
	"replies_per_conversation" integer DEFAULT 20 NOT NULL,
	"replies_per_hour" integer DEFAULT 60 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assistant_settings_singleton" CHECK ("assistant_settings"."id" = 1),
	CONSTRAINT "assistant_settings_spend_cap" CHECK ("assistant_settings"."spend_cap_cents" >= 0),
	CONSTRAINT "assistant_settings_max_output" CHECK ("assistant_settings"."max_output_tokens" between 64 and 4000),
	CONSTRAINT "assistant_settings_replies_per_conversation" CHECK ("assistant_settings"."replies_per_conversation" between 0 and 500),
	CONSTRAINT "assistant_settings_replies_per_hour" CHECK ("assistant_settings"."replies_per_hour" between 0 and 5000),
	CONSTRAINT "assistant_settings_prices" CHECK (("assistant_settings"."input_cents_per_million" is null or "assistant_settings"."input_cents_per_million" >= 0)
        and ("assistant_settings"."output_cents_per_million" is null or "assistant_settings"."output_cents_per_million" >= 0)),
	CONSTRAINT "assistant_settings_model_present" CHECK ("assistant_settings"."provider" = 'none' or "assistant_settings"."model" is not null)
);
--> statement-breakpoint

-- One owner decision per offerable action. The catalogue of what *may* be
-- offered is code (src/modules/assistant/actions.ts), because it names
-- services and argument shapes that a row cannot carry — so an action removed
-- from a release stops working immediately rather than leaving a live grant
-- pointing at nothing. Who granted it is not a column: the AuditLog row every
-- `assistant.setScope` call writes already answers that, in the same
-- transaction, and a second copy is the one that drifts.
CREATE TABLE "assistant_scope_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "assistant_scope_grants_action_idx" ON "assistant_scope_grants" USING btree ("action");--> statement-breakpoint

-- One row per attempted answer, refusals included. Spend is summed from here
-- and checked *before* the next answer (§40), and the refusals are what an
-- owner reads when the assistant has gone quiet — a refusal that leaves no row
-- is a support ticket.
CREATE TABLE "assistant_turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"chat_session_id" uuid,
	"message_id" uuid,
	"outcome" text NOT NULL,
	"detail" text,
	"provider" text,
	"model" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"action" text,
	"action_allowed" boolean,
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assistant_turns_cost" CHECK ("assistant_turns"."cost_cents" >= 0),
	CONSTRAINT "assistant_turns_tokens" CHECK ("assistant_turns"."input_tokens" >= 0 and "assistant_turns"."output_tokens" >= 0),
	CONSTRAINT "assistant_turns_detail" CHECK ("assistant_turns"."detail" is null or char_length("assistant_turns"."detail") <= 1000)
);
--> statement-breakpoint
ALTER TABLE "assistant_turns" ADD CONSTRAINT "assistant_turns_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_turns" ADD CONSTRAINT "assistant_turns_chat_session_id_site_chat_sessions_id_fk" FOREIGN KEY ("chat_session_id") REFERENCES "public"."site_chat_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Cascaded from the message, not merely referencing it: erasing a contact
-- deletes their messages, and a metering row that outlived the message it
-- describes would be a fragment of an erased conversation.
ALTER TABLE "assistant_turns" ADD CONSTRAINT "assistant_turns_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- One attempt per visitor message. A retrying browser, or two tabs racing,
-- produce one attempt — and a visitor clicking again cannot spend the next
-- penny of a budget that ran out a second ago.
CREATE UNIQUE INDEX "assistant_turns_message_idx" ON "assistant_turns" USING btree ("message_id") WHERE message_id is not null;--> statement-breakpoint
CREATE INDEX "assistant_turns_conversation_idx" ON "assistant_turns" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "assistant_turns_created_idx" ON "assistant_turns" USING btree ("created_at");
