-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
--
-- What a run needs to be resumable (MASTER.md §4.17, C9.02).
--
-- Additive throughout, so the previous release keeps reading `runs` exactly as
-- it did: every column is nullable or carries a default, and nothing is
-- renamed or dropped. §39.9's gate should stay quiet, and if it does not, the
-- gate is right and this comment is wrong.
--
-- Each of these exists because a run is a row between steps rather than a held
-- process (§4.17: "waiting is a row, not a held process"). A held process
-- keeps its state in a closure; a row has to write it down. `wake_at` is when
-- to look again, `resume_node_id` is where to carry on, `context` is what
-- earlier steps produced, and `step_count` is the number the ceiling is
-- checked against before each step rather than after it.
ALTER TABLE "runs" ADD COLUMN "subject_version_id" uuid;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "contact_id" uuid;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "wake_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "step_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "resume_node_id" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "context" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "idempotency_key" text;--> statement-breakpoint

-- The contact keeps a real foreign key, unlike the run's subject and worker.
-- It is not polymorphic — it is always a contact — so the spine rule applies
-- in full: the column references contacts, and `contacts.merge` repoints it.
ALTER TABLE "runs" ADD CONSTRAINT "runs_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "runs_contact_idx" ON "runs" USING btree ("contact_id");--> statement-breakpoint

-- The wake sweep is a range scan over sleeping runs rather than a parse of
-- every row, the same argument `agent_playbooks.next_run_at` records.
CREATE INDEX "runs_wake_idx" ON "runs" USING btree ("wake_at") WHERE "runs"."status" = 'running';--> statement-breakpoint

-- §4.17: "the same event must not enter the same automation twice." The outbox
-- retries and a job re-runs its handler, so only a unique index holds — a check
-- in the handler loses the race it exists to prevent.
CREATE UNIQUE INDEX "runs_idempotency_idx" ON "runs" USING btree ("subject_kind","subject_id","idempotency_key") WHERE "runs"."idempotency_key" is not null;--> statement-breakpoint

ALTER TABLE "run_steps" ADD COLUMN "node_id" text;--> statement-breakpoint

-- Which contacts an automation has already acted on, and when it may again.
-- §4.17: "Re-entry is a stated policy, not an accident ... A customer
-- receiving the same win-back note every time they cancel is the failure mode
-- that makes owners switch automation off entirely."
CREATE TABLE "automation_contact_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"automation_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"entry_count" integer DEFAULT 0 NOT NULL,
	"last_entered_at" timestamp with time zone,
	"cooldown_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "automation_contact_state" ADD CONSTRAINT "automation_contact_state_automation_id_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_contact_state" ADD CONSTRAINT "automation_contact_state_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- One row per person per automation. The re-entry decision is read and written
-- on the same row under concurrency, so two events arriving together must not
-- be able to create two states and both conclude "never entered".
CREATE UNIQUE INDEX "automation_contact_state_once_idx" ON "automation_contact_state" USING btree ("automation_id","contact_id");
