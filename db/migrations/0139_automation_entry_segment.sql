-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
--
-- The entry condition, pinned to the version that was published
-- (MASTER.md §30, §4.17, §43 C7.17).
--
-- Additive: one nullable column, nothing renamed or dropped.
--
-- `automations.entry_segment_id` already existed and was never read. C7.17
-- adopts §30's segment as the entry condition for automations, and the moment
-- it starts deciding who enters, it belongs on the version for the same reason
-- the trigger does: a run must be readable against what it was actually doing,
-- and an automation whose audience was narrowed last week did not narrow last
-- month's runs.
ALTER TABLE "automation_versions" ADD COLUMN "entry_segment_id" uuid;--> statement-breakpoint
ALTER TABLE "automation_versions" ADD CONSTRAINT "automation_versions_entry_segment_id_segments_id_fk" FOREIGN KEY ("entry_segment_id") REFERENCES "public"."segments"("id") ON DELETE set null ON UPDATE no action;
