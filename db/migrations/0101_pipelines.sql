-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- Pipelines, stages and deals (C7.01, §4.1).
--
-- §4.1: "A deal is optional... Pipelines are configuration, so the module is
-- inert until an owner defines a stage." Nothing here seeds a row: the tables
-- exist and a retail instance never notices them.

CREATE TABLE IF NOT EXISTS "pipelines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "kind" text NOT NULL,
  "name" text NOT NULL,
  "is_default" boolean DEFAULT false NOT NULL,
  "position" integer DEFAULT 0 NOT NULL,
  "archived_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "pipelines_kind" CHECK ("kind" in ('lifecycle', 'deal')),
  CONSTRAINT "pipelines_name" CHECK (char_length("name") between 1 and 80)
);

CREATE INDEX IF NOT EXISTS "pipelines_kind_idx" ON "pipelines" ("kind", "position");
-- One default per kind: two would mean nothing could say which pipeline a deal
-- created by a form belongs in.
CREATE UNIQUE INDEX IF NOT EXISTS "pipelines_one_default_idx"
  ON "pipelines" ("kind") WHERE "is_default" and "archived_at" is null;

CREATE TABLE IF NOT EXISTS "pipeline_stages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "pipeline_id" uuid NOT NULL REFERENCES "pipelines"("id") ON DELETE cascade,
  "name" text NOT NULL,
  "position" integer DEFAULT 0 NOT NULL,
  "tone" text,
  -- On the stage rather than only on the deal, because "what is my pipeline
  -- worth" is a question about where things sit.
  "probability" integer,
  "is_won" boolean DEFAULT false NOT NULL,
  "is_lost" boolean DEFAULT false NOT NULL,
  -- What stops the configurable lifecycle pipeline forking from
  -- contacts.lifecycle_stage: the fine stage is the owner's, the coarse one is
  -- derived from it, and nothing writes the enum independently.
  "lifecycle_stage" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "pipeline_stages_name" CHECK (char_length("name") between 1 and 60),
  CONSTRAINT "pipeline_stages_probability" CHECK (
    "probability" is null or "probability" between 0 and 100
  ),
  CONSTRAINT "pipeline_stages_lifecycle" CHECK (
    "lifecycle_stage" is null
    or "lifecycle_stage" in ('lead', 'prospect', 'customer', 'repeat')
  ),
  -- Won and lost are the two ends; a stage claiming both would make every
  -- report ask which it meant.
  CONSTRAINT "pipeline_stages_outcome" CHECK (not ("is_won" and "is_lost"))
);

CREATE INDEX IF NOT EXISTS "pipeline_stages_pipeline_idx"
  ON "pipeline_stages" ("pipeline_id", "position");

CREATE TABLE IF NOT EXISTS "deals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "contact_id" uuid NOT NULL REFERENCES "contacts"("id") ON DELETE restrict,
  "pipeline_id" uuid NOT NULL REFERENCES "pipelines"("id") ON DELETE restrict,
  "stage_id" uuid NOT NULL REFERENCES "pipeline_stages"("id") ON DELETE restrict,
  "title" text NOT NULL,
  "value_minor" bigint DEFAULT 0 NOT NULL,
  "currency" text,
  -- Null means "whatever the stage says", which is the answer for almost every
  -- deal. A column always holding a copy would be a second thing to keep in
  -- step.
  "probability" integer,
  "expected_close_on" date,
  "source" text,
  "owner_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  -- Untyped: quotes is a module this one installs without.
  "quote_id" uuid,
  "status" text DEFAULT 'open' NOT NULL,
  "lost_reason" text,
  "closed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "deals_status" CHECK ("status" in ('open', 'won', 'lost')),
  CONSTRAINT "deals_title" CHECK (char_length("title") between 1 and 200),
  CONSTRAINT "deals_value" CHECK ("value_minor" >= 0),
  CONSTRAINT "deals_probability" CHECK (
    "probability" is null or "probability" between 0 and 100
  ),
  -- A closed deal has a closing time; a lost one says why. Both are what a
  -- pipeline report is made of.
  CONSTRAINT "deals_closed_has_time" CHECK (
    "status" = 'open' or "closed_at" is not null
  ),
  CONSTRAINT "deals_lost_has_reason" CHECK (
    "status" <> 'lost' or "lost_reason" is not null
  )
);

CREATE INDEX IF NOT EXISTS "deals_pipeline_idx" ON "deals" ("pipeline_id", "stage_id");
CREATE INDEX IF NOT EXISTS "deals_contact_idx" ON "deals" ("contact_id");
CREATE INDEX IF NOT EXISTS "deals_owner_idx" ON "deals" ("owner_user_id", "status");
CREATE INDEX IF NOT EXISTS "deals_status_idx" ON "deals" ("status", "expected_close_on");

-- One row per contact: a person is at one stage of one lifecycle. The coarse
-- contacts.lifecycle_stage is derived from this, never edited beside it.
CREATE TABLE IF NOT EXISTS "contact_stages" (
  "contact_id" uuid PRIMARY KEY REFERENCES "contacts"("id") ON DELETE cascade,
  "stage_id" uuid NOT NULL REFERENCES "pipeline_stages"("id") ON DELETE restrict,
  "entered_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "contact_stages_stage_idx" ON "contact_stages" ("stage_id");
