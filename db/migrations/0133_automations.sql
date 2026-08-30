-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
--
-- Automations and their versions (MASTER.md §4.17, C9.01).
--
-- "A version is immutable, and a run pins the one that produced it." So the
-- graph is not a column on `automations`: it lives on a version, the automation
-- points at the current one, and nothing edits a published version.
-- `automation_versions` has no updated_at for the same reason
-- `document_versions` has none — a version that could be changed afterwards
-- answers "what were the rules then" with whatever somebody typed last.
--
-- `draft_graph` is the exception and is deliberately mutable. An owner building
-- a canvas saves constantly and most of those saves are not decisions; a
-- version per keystroke would bury the change that actually matters.
--
-- The run tables (AutomationRun, AutomationRunStep, AutomationContactState)
-- are C9.02 and are deliberately absent: C9.01 builds and validates
-- automations, and nothing yet executes one.
CREATE TABLE "automations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"trigger_kind" text DEFAULT 'event' NOT NULL,
	"event_pattern" text,
	"schedule_cron" text,
	"timezone" text,
	"next_run_at" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"entry_segment_id" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"current_version_id" uuid,
	"draft_graph" jsonb,
	"autonomy_ceiling" text,
	"budget_minor" integer,
	"reentry" text DEFAULT 'once' NOT NULL,
	"cooldown_days" integer,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "automations" ADD CONSTRAINT "automations_entry_segment_id_segments_id_fk" FOREIGN KEY ("entry_segment_id") REFERENCES "public"."segments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automations" ADD CONSTRAINT "automations_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- `current_version_id` carries no foreign key: versions reference automations,
-- and a reference back would be a cycle neither table could be inserted into
-- first. The same shape `documents.current_version_id` has.
CREATE UNIQUE INDEX "automations_name_idx" ON "automations" USING btree ("name");--> statement-breakpoint
CREATE INDEX "automations_status_idx" ON "automations" USING btree ("status","updated_at");--> statement-breakpoint

-- Indexed now rather than when C9.02 needs them: these are the columns every
-- published event and every scheduler tick will read, and an index added after
-- the query exists is an index added after somebody noticed it was slow.
CREATE INDEX "automations_event_idx" ON "automations" USING btree ("event_pattern","status");--> statement-breakpoint
CREATE INDEX "automations_due_idx" ON "automations" USING btree ("status","next_run_at");--> statement-breakpoint

CREATE TABLE "automation_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"automation_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"graph" jsonb NOT NULL,
	"note" text,
	"trigger_kind" text NOT NULL,
	"event_pattern" text,
	"schedule_cron" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "automation_versions" ADD CONSTRAINT "automation_versions_automation_id_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_versions" ADD CONSTRAINT "automation_versions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- One row per version number per automation. Under concurrent publishes only
-- the index can stop two "version 3"s existing.
CREATE UNIQUE INDEX "automation_versions_number_idx" ON "automation_versions" USING btree ("automation_id","version");--> statement-breakpoint
CREATE INDEX "automation_versions_automation_idx" ON "automation_versions" USING btree ("automation_id","created_at");
