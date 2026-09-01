-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
--
-- One template model for every kind of message (MASTER.md §30, C9.05).
--
-- Additive: a new table and nothing else, so the previous release is unaffected.
--
-- §30: "one template model serves everything — newsletter layouts, campaign
-- designs, and transactional emails (receipt, booking confirmation, quote
-- sent) are all EmailTemplate rows editable in the same drag-and-drop editor."
-- A table per kind would be four places for the block vocabulary, the variable
-- slots and the locale handling to drift apart.
--
-- Locale variants are entity_translations rows rather than columns here (§4.9),
-- so a template is translated by the same screen that translates a page.
--
-- default_blocks and default_subject hold the shipped wording beside the
-- owner's edits, because §30's "reset to default" needs somewhere to escape to
-- — and holding it here rather than in code means reset still works on an
-- instance whose release has moved on.
CREATE TABLE "email_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"slug" text,
	"subject" text DEFAULT '' NOT NULL,
	"blocks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"variables" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"default_blocks" jsonb,
	"default_subject" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- One template per slug. A transactional sender asking for "invoice.sent" and
-- getting whichever of two rows sorted first is a bug that only shows up in
-- somebody's inbox. Partial, because most templates an owner writes have no
-- slug at all and several nulls must not collide.
CREATE UNIQUE INDEX "email_templates_slug_idx" ON "email_templates" USING btree ("slug") WHERE "email_templates"."slug" is not null;--> statement-breakpoint
CREATE INDEX "email_templates_kind_idx" ON "email_templates" USING btree ("kind","status");
