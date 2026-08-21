-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- "Report into my briefing" (C4.17, MASTER.md §42).
ALTER TABLE "agent_playbooks"
  ADD COLUMN IF NOT EXISTS "reports_to_briefing" boolean DEFAULT false NOT NULL;

CREATE INDEX IF NOT EXISTS "agent_playbooks_briefing_idx"
  ON "agent_playbooks" ("reports_to_briefing")
  WHERE "reports_to_briefing";
