-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- Runtime playbook scheduling (C4.14, MASTER.md §40).
--
-- The schedule lives in a column rather than in the scheduler, because an
-- owner writing "every Monday, check for stale quotes" at 3pm on a Tuesday
-- cannot wait for a redeploy. "Due" is then a range scan over one indexed
-- timestamp instead of a cron parse per row per minute.
ALTER TABLE "agent_playbooks" ADD COLUMN IF NOT EXISTS "timezone" text;
ALTER TABLE "agent_playbooks" ADD COLUMN IF NOT EXISTS "next_run_at" timestamp with time zone;
ALTER TABLE "agent_playbooks" ADD COLUMN IF NOT EXISTS "last_run_at" timestamp with time zone;
ALTER TABLE "agent_playbooks" ADD COLUMN IF NOT EXISTS "catch_up" boolean DEFAULT false NOT NULL;
ALTER TABLE "agent_playbooks" ADD COLUMN IF NOT EXISTS "last_outcome" text;

CREATE INDEX IF NOT EXISTS "agent_playbooks_due_idx"
  ON "agent_playbooks" ("next_run_at")
  WHERE "enabled" AND "trigger" = 'schedule';
