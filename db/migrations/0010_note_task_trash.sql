-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C11.14: reversible removal keeps the original record and its relations.
ALTER TABLE "notes" ADD COLUMN "trashed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "trashed_at" timestamp with time zone;
--> statement-breakpoint
CREATE INDEX "notes_trash_idx" ON "notes" ("trashed_at") WHERE "trashed_at" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "tasks_trash_idx" ON "tasks" ("trashed_at") WHERE "trashed_at" IS NOT NULL;
