-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- The builder's code lane (C4.20, MASTER.md §37).
--
-- Files live here as data. The instance never runs them: they go to the
-- owner's own repository as a pull request, or to the owner as a patch.
CREATE TABLE IF NOT EXISTS "builder_code_proposals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "brief" text NOT NULL,
  "plugin_name" text NOT NULL,
  "status" text DEFAULT 'ready' NOT NULL,
  "summary" text NOT NULL,
  "rationale" text NOT NULL,
  "files" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "gates" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "diff" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "delivered_as" text,
  "pull_request_url" text,
  "branch" text,
  "refusal_reason" text,
  "model" text NOT NULL,
  "provider" text,
  "input_tokens" integer DEFAULT 0 NOT NULL,
  "output_tokens" integer DEFAULT 0 NOT NULL,
  "total_tokens" integer DEFAULT 0 NOT NULL,
  "created_by_actor" text NOT NULL,
  "delivered_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "builder_code_proposals_status_valid"
    CHECK ("status" in ('ready','refused','delivered','rejected')),
  -- A refusal says why, and a delivery says where. A row with one and not the
  -- other is a proposal nobody can account for.
  CONSTRAINT "builder_code_proposals_refusal_reason"
    CHECK ("status" <> 'refused' or "refusal_reason" is not null),
  CONSTRAINT "builder_code_proposals_delivery"
    CHECK ("status" <> 'delivered' or ("delivered_as" is not null and "delivered_at" is not null)),
  CONSTRAINT "builder_code_proposals_usage_valid"
    CHECK ("input_tokens" >= 0 and "output_tokens" >= 0),
  CONSTRAINT "builder_code_proposals_files_valid"
    CHECK (jsonb_typeof("files") = 'array')
);

CREATE INDEX IF NOT EXISTS "builder_code_proposals_status_idx"
  ON "builder_code_proposals" ("status", "created_at");
