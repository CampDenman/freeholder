-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
--
-- Runs, steps, approvals and spend move out of the agent layer
-- (MASTER.md §4.17, §40, C9.02).
--
-- freeholder:schema-breaking Renames agent_runs, agent_steps, agent_approvals and agent_spend, and renames task_id to subject_id on two of them. The previous release reads the old names and will not find them; the rollback for this one is a restore rather than an image swap.
--
-- §39.9 asks for that to be declared on the migration rather than discovered
-- by whoever rolls back at 3am. The marker above is the declaration; the
-- changeset says the same thing in the owner's words.
--
-- Why the shape changes as well as the name. `agent_runs.task_id` and
-- `agent_id` were both NOT NULL, so a run was by construction an agent working
-- a task. §4.17 requires an automation that mixes a prompt step with a
-- deterministic one to produce one inspectable run — and an automation run has
-- no task, while a run whose steps are all module verbs has no agent at all.
-- So the owner becomes polymorphic and the worker becomes optional, which is
-- what a run actually is: something that happened, caused by one thing,
-- possibly performed by another.
--
-- Neither owner nor worker keeps a foreign key. A generic runtime with a
-- foreign key to `agent_tasks` is not generic; it is the agent runtime under a
-- different name. The same shape ContentUnlock (§4.3) and Document (§4.5) use.
--
-- Nothing else changes. The runtime columns C9.02 needs — a wake time, a step
-- count, an idempotency key, the contact a run is about — arrive with the code
-- that writes and reads them, so this change can be verified by reading it
-- against the agent tests, which pass unmodified.
ALTER TABLE "agent_runs" RENAME TO "runs";--> statement-breakpoint
ALTER TABLE "agent_steps" RENAME TO "run_steps";--> statement-breakpoint
ALTER TABLE "agent_approvals" RENAME TO "run_approvals";--> statement-breakpoint
ALTER TABLE "agent_spend" RENAME TO "run_spend";--> statement-breakpoint

-- The owner. Every existing row is an agent working a task, so the backfill is
-- a constant and the column can be made NOT NULL in the same breath.
ALTER TABLE "runs" RENAME COLUMN "task_id" TO "subject_id";--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "subject_kind" text;--> statement-breakpoint
UPDATE "runs" SET "subject_kind" = 'agent_task';--> statement-breakpoint
ALTER TABLE "runs" ALTER COLUMN "subject_kind" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" DROP CONSTRAINT IF EXISTS "agent_runs_task_id_agent_tasks_id_fk";--> statement-breakpoint

-- The worker. Optional from here: a deterministic automation step is performed
-- by nothing, and a NOT NULL column would have forced a fake agent into
-- existence to satisfy it.
ALTER TABLE "runs" ALTER COLUMN "agent_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" DROP CONSTRAINT IF EXISTS "agent_runs_agent_id_agents_id_fk";--> statement-breakpoint


ALTER TABLE "run_approvals" RENAME COLUMN "task_id" TO "subject_id";--> statement-breakpoint
ALTER TABLE "run_approvals" ADD COLUMN "subject_kind" text;--> statement-breakpoint
UPDATE "run_approvals" SET "subject_kind" = 'agent_task';--> statement-breakpoint
ALTER TABLE "run_approvals" ALTER COLUMN "subject_kind" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "run_approvals" DROP CONSTRAINT IF EXISTS "agent_approvals_task_id_agent_tasks_id_fk";--> statement-breakpoint

-- Spend keeps its agent, because only prompt work costs anything. The FK goes
-- for the same reason the others do: core/runs owns this table and must not
-- depend on a concept the agent layer defines.
ALTER TABLE "run_spend" DROP CONSTRAINT IF EXISTS "agent_spend_agent_id_agents_id_fk";--> statement-breakpoint

-- Indexes carry the old names after a table rename, so they are renamed too.
-- An index called `agent_runs_task_idx` on a table called `runs` is exactly
-- the kind of residue that makes somebody wonder what else was left behind.
ALTER INDEX IF EXISTS "agent_runs_task_idx" RENAME TO "runs_subject_idx_old";--> statement-breakpoint
DROP INDEX IF EXISTS "runs_subject_idx_old";--> statement-breakpoint
ALTER INDEX IF EXISTS "agent_runs_agent_idx" RENAME TO "runs_agent_idx";--> statement-breakpoint
ALTER INDEX IF EXISTS "agent_runs_lease_idx" RENAME TO "runs_lease_idx";--> statement-breakpoint
ALTER INDEX IF EXISTS "agent_steps_run_seq_idx" RENAME TO "run_steps_run_seq_idx";--> statement-breakpoint
ALTER INDEX IF EXISTS "agent_approvals_task_idx" RENAME TO "run_approvals_subject_idx_old";--> statement-breakpoint
DROP INDEX IF EXISTS "run_approvals_subject_idx_old";--> statement-breakpoint
ALTER INDEX IF EXISTS "agent_approvals_pending_idx" RENAME TO "run_approvals_pending_idx";--> statement-breakpoint
ALTER INDEX IF EXISTS "agent_spend_agent_period_idx" RENAME TO "run_spend_agent_period_idx";--> statement-breakpoint

CREATE INDEX "runs_subject_idx" ON "runs" USING btree ("subject_kind","subject_id");--> statement-breakpoint
CREATE INDEX "run_approvals_subject_idx" ON "run_approvals" USING btree ("subject_kind","subject_id");
