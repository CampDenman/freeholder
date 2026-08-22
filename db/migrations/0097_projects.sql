-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- One piece of work, from enquiry to done (C6.15, §4.7).
--
-- This is the same entity C8.01 will publish, not a second one: §4.7's
-- `Project` already carries client_contact_id, services[] and occurred_on,
-- because a case study *is* a job that got finished. C6.15 builds the working
-- half; C8.01 adds blocks, cover, SEO and featured to the same row.

CREATE TABLE IF NOT EXISTS "projects" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  -- Nullable, because internal work is real work: a rebrand of your own site
  -- is a project with no client.
  "contact_id" uuid REFERENCES "contacts"("id") ON DELETE restrict,
  -- "A Fortune 500 retailer" is a first-class option rather than a fib.
  "client_display_name" text,
  "title" text NOT NULL,
  "slug" text NOT NULL,
  "summary" text,
  "status" text DEFAULT 'enquiry' NOT NULL,
  "owner_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "location_id" uuid REFERENCES "business_locations"("id") ON DELETE set null,
  -- Product ids, untyped: catalog is a module and this may not depend on one.
  "service_product_ids" uuid[] DEFAULT '{}' NOT NULL,
  "started_on" date,
  "occurred_on" date,
  "completed_at" timestamp with time zone,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "projects_status" CHECK (
    "status" in ('enquiry', 'quoted', 'active', 'on_hold', 'complete', 'cancelled')
  ),
  CONSTRAINT "projects_title" CHECK (char_length("title") between 1 and 200),
  CONSTRAINT "projects_slug" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  -- A finished job has a finishing time, and it is the column every report
  -- dates from.
  CONSTRAINT "projects_complete_has_time" CHECK (
    "status" <> 'complete' or "completed_at" is not null
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS "projects_slug_idx" ON "projects" ("slug");
CREATE INDEX IF NOT EXISTS "projects_contact_idx" ON "projects" ("contact_id");
CREATE INDEX IF NOT EXISTS "projects_status_idx" ON "projects" ("status", "occurred_on");

-- Polymorphic on purpose: a job has many quotes, many bookings and many
-- invoices, and C6.13 will attach more kinds. A column per kind would be a
-- migration every time the business does something new.
CREATE TABLE IF NOT EXISTS "project_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "kind" text NOT NULL,
  -- Untyped by a foreign key: these live in modules projects may not import.
  "target_id" uuid NOT NULL,
  "label" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "project_links_kind" CHECK (
    "kind" in ('quote', 'contract', 'booking', 'invoice', 'rental', 'form_submission')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS "project_links_unique_idx"
  ON "project_links" ("project_id", "kind", "target_id");
CREATE INDEX IF NOT EXISTS "project_links_target_idx"
  ON "project_links" ("kind", "target_id");

CREATE TABLE IF NOT EXISTS "project_tasks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "title" text NOT NULL,
  "status" text DEFAULT 'todo' NOT NULL,
  "assignee_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "due_on" date,
  "position" integer DEFAULT 0 NOT NULL,
  "done_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "project_tasks_status" CHECK (
    "status" in ('todo', 'doing', 'blocked', 'done')
  ),
  CONSTRAINT "project_tasks_title" CHECK (char_length("title") between 1 and 300),
  CONSTRAINT "project_tasks_done_has_time" CHECK (
    "status" <> 'done' or "done_at" is not null
  )
);

CREATE INDEX IF NOT EXISTS "project_tasks_project_idx"
  ON "project_tasks" ("project_id", "position");
CREATE INDEX IF NOT EXISTS "project_tasks_assignee_idx"
  ON "project_tasks" ("assignee_user_id", "status");

-- `method` is not decoration: "traffic up 40%" is a number somebody will ask
-- about, and a business that cannot say how it was measured is making it up.
CREATE TABLE IF NOT EXISTS "project_outcomes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "label" text NOT NULL,
  "value" text NOT NULL,
  "unit" text,
  "method" text,
  "position" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "project_outcomes_label" CHECK (char_length("label") between 1 and 120),
  CONSTRAINT "project_outcomes_value" CHECK (char_length("value") between 1 and 120)
);

CREATE INDEX IF NOT EXISTS "project_outcomes_project_idx"
  ON "project_outcomes" ("project_id", "position");

-- §4.7: "Before/after is a pairing, not two uploads." `pair_key` is what lets
-- a renderer show a slider rather than two pictures side by side, and it has
-- to exist from the first version — retrofitting it means asking an owner to
-- re-upload work they have already filed.
CREATE TABLE IF NOT EXISTS "project_files" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "asset_id" uuid NOT NULL REFERENCES "assets"("id") ON DELETE cascade,
  "role" text DEFAULT 'gallery' NOT NULL,
  "pair_key" text,
  "caption" text,
  "position" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "project_files_role" CHECK (
    "role" in ('hero', 'gallery', 'before', 'after', 'process', 'detail', 'document')
  ),
  CONSTRAINT "project_files_pairing" CHECK (
    ("role" in ('before', 'after')) = ("pair_key" is not null)
  )
);

CREATE INDEX IF NOT EXISTS "project_files_project_idx"
  ON "project_files" ("project_id", "position");
CREATE UNIQUE INDEX IF NOT EXISTS "project_files_unique_idx"
  ON "project_files" ("project_id", "asset_id", "role");
