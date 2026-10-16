-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C12.33 (MASTER.md §44.11): aliases and moves between fediverse accounts.
ALTER TABLE "member_profiles" ADD COLUMN "fediverse_aliases" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "member_profiles" ADD COLUMN "moved_to" text;
