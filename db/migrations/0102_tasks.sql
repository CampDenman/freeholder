-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- The one work list (MASTER.md §4.14, C7.02).
--
-- `project_tasks` is deliberately left in place. It is no longer written and
-- no longer read, and its rows are copied below, but dropping a table in the
-- same release that stops using it is exactly what the schema-compat gate
-- refuses: the previous release still selects from it, and a rollback would
-- find it gone. The contract half is a one-line migration for a later release.

CREATE TABLE IF NOT EXISTS "tasks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "subject_type" text,
  "subject_id" uuid,
  "contact_id" uuid REFERENCES "contacts"("id") ON DELETE SET NULL,
  "title" text NOT NULL,
  "details" text,
  "due_at" timestamp with time zone,
  "remind_at" timestamp with time zone,
  "reminded_at" timestamp with time zone,
  "assignee_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "priority" text DEFAULT 'normal' NOT NULL,
  "status" text DEFAULT 'open' NOT NULL,
  "position" integer DEFAULT 0 NOT NULL,
  "cadence" text,
  "interval_count" integer DEFAULT 1 NOT NULL,
  "recurred_from_id" uuid,
  "completed_at" timestamp with time zone,
  "completed_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "tasks_title" CHECK (char_length("title") BETWEEN 1 AND 300),
  -- Both halves of the subject or neither: half a subject is a row that can
  -- neither be rendered nor found.
  CONSTRAINT "tasks_subject_pair" CHECK (("subject_type" IS NULL) = ("subject_id" IS NULL)),
  CONSTRAINT "tasks_done_has_time" CHECK ("status" <> 'done' OR "completed_at" IS NOT NULL),
  -- A recurrence needs a date to advance from.
  CONSTRAINT "tasks_recurrence_needs_due" CHECK ("cadence" IS NULL OR "due_at" IS NOT NULL),
  CONSTRAINT "tasks_interval" CHECK ("interval_count" BETWEEN 1 AND 52)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_open_idx" ON "tasks" ("status", "due_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_assignee_idx" ON "tasks" ("assignee_user_id", "status", "due_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_subject_idx" ON "tasks" ("subject_type", "subject_id", "position");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_contact_idx" ON "tasks" ("contact_id");
--> statement-breakpoint
-- The reminder sweep's entire work list, and nothing else in the table.
CREATE INDEX IF NOT EXISTS "tasks_reminder_idx" ON "tasks" ("remind_at")
  WHERE status = 'open' AND remind_at IS NOT NULL AND reminded_at IS NULL;
--> statement-breakpoint
-- C6.15's project checklists become rows in the one list. `todo` was the same
-- state `open` is; the other three already agree. The contact comes from the
-- project, which is what makes a task about a job show on the customer's
-- timeline without the timeline knowing what a project is.
INSERT INTO "tasks" (
  "id", "subject_type", "subject_id", "contact_id", "title", "status",
  "assignee_user_id", "due_at", "position", "completed_at", "created_at", "updated_at"
)
SELECT
  t."id",
  'project',
  t."project_id",
  p."contact_id",
  t."title",
  CASE t."status" WHEN 'todo' THEN 'open' ELSE t."status" END,
  t."assignee_user_id",
  CASE WHEN t."due_on" IS NULL THEN NULL ELSE (t."due_on"::timestamp + interval '12 hours') AT TIME ZONE 'UTC' END,
  t."position",
  t."done_at",
  t."created_at",
  t."updated_at"
FROM "project_tasks" t
JOIN "projects" p ON p."id" = t."project_id"
-- A checklist item marked done before `done_at` existed would fail the check
-- constraint. There should be none, and skipping is better than inventing a
-- completion time that never happened.
WHERE t."status" <> 'done' OR t."done_at" IS NOT NULL
ON CONFLICT ("id") DO NOTHING;
