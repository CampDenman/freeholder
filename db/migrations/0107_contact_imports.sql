-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- Importing a contact list, reversibly (MASTER.md §4.1, C7.07).
--
-- Separate from `import_runs` (C3.21's content importer) on purpose. That one
-- pulls pages out of a WordPress site and has no notion of a row; this one
-- writes to the contact spine, where reversibility means being able to say,
-- per person, what the file did to them and what they looked like before.

CREATE TABLE IF NOT EXISTS "contact_imports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "filename" text NOT NULL,
  "delimiter" text DEFAULT ',' NOT NULL,
  "headers" text[] DEFAULT '{}' NOT NULL,
  -- One entry per column: which contact field it feeds, or `ignore`.
  "mapping" text[] DEFAULT '{}' NOT NULL,
  "source" text DEFAULT 'import' NOT NULL,
  "status" text DEFAULT 'mapping' NOT NULL,
  "counts" jsonb DEFAULT '{}' NOT NULL,
  "error" text,
  "committed_at" timestamp with time zone,
  "reverted_at" timestamp with time zone,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "contact_imports_filename" CHECK (char_length("filename") BETWEEN 1 AND 300),
  -- A committed import knows when, and so does a reverted one. Without this,
  -- "what did we import last Tuesday" has no answer.
  CONSTRAINT "contact_imports_committed_has_time" CHECK ("status" <> 'committed' OR "committed_at" IS NOT NULL),
  CONSTRAINT "contact_imports_reverted_has_time" CHECK ("status" <> 'reverted' OR "reverted_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_imports_status_idx" ON "contact_imports" ("status", "created_at");
--> statement-breakpoint
-- `before_state` is what makes the batch reversible: undoing is restoring those
-- values, not guessing at them. Rows the import *created* carry a null
-- before-state and are identified by `created`, because undoing a creation is a
-- different act from undoing an edit.
CREATE TABLE IF NOT EXISTS "contact_import_rows" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "import_id" uuid NOT NULL REFERENCES "contact_imports"("id") ON DELETE CASCADE,
  "line_number" integer NOT NULL,
  "cells" text[] DEFAULT '{}' NOT NULL,
  "email" text,
  "outcome" text DEFAULT 'skip' NOT NULL,
  "errors" text[] DEFAULT '{}' NOT NULL,
  "changes" jsonb DEFAULT '{}' NOT NULL,
  "contact_id" uuid REFERENCES "contacts"("id") ON DELETE SET NULL,
  "created" boolean DEFAULT false NOT NULL,
  "before_state" jsonb,
  "applied_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_import_rows_import_idx" ON "contact_import_rows" ("import_id", "line_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_import_rows_outcome_idx" ON "contact_import_rows" ("import_id", "outcome");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_import_rows_contact_idx" ON "contact_import_rows" ("contact_id");
--> statement-breakpoint
-- One row per line per import. A commit that ran twice would otherwise double
-- the ledger and make the revert restore the wrong state.
CREATE UNIQUE INDEX IF NOT EXISTS "contact_import_rows_line_idx" ON "contact_import_rows" ("import_id", "line_number");
