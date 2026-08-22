-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- Contract templates and countersignature (C6.14, §4.3).
--
-- C6.09 built the half that matters legally: a signed document is a snapshot
-- of the words somebody read, hashed. This is the authoring half, and it
-- renders *into* that snapshot rather than replacing it.

-- Versioned rather than edited in place, for the same reason a quote is: a
-- document issued last month points at the version it came from, and an owner
-- tightening their terms today must not change what that pointer means.
CREATE TABLE IF NOT EXISTS "contract_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "kind" text DEFAULT 'waiver' NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "title" text NOT NULL,
  -- The words, with {{variables}} the renderer substitutes. Replaced, never
  -- evaluated: a template language with logic in it is one somebody can be
  -- talked into running, and this produces a document a court may read.
  "body" text NOT NULL,
  "variables" jsonb DEFAULT '[]'::jsonb NOT NULL,
  -- A mutual agreement that only one party signed is not an agreement.
  "requires_countersignature" boolean DEFAULT false NOT NULL,
  "archived_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "contract_templates_kind" CHECK ("kind" in ('waiver', 'agreement')),
  CONSTRAINT "contract_templates_version" CHECK ("version" > 0),
  CONSTRAINT "contract_templates_name" CHECK (char_length("name") between 1 and 120),
  CONSTRAINT "contract_templates_body" CHECK (char_length("body") > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "contract_templates_name_version_idx"
  ON "contract_templates" ("name", "version");
CREATE INDEX IF NOT EXISTS "contract_templates_kind_idx"
  ON "contract_templates" ("kind", "archived_at");

-- `template_id` existed from C6.09 as a reserved column; now it points
-- somewhere. Added as a constraint rather than a new column so documents
-- already issued keep their null and their meaning.
ALTER TABLE "contract_documents"
  DROP CONSTRAINT IF EXISTS "contract_documents_template_id_fk";
ALTER TABLE "contract_documents"
  ADD CONSTRAINT "contract_documents_template_id_fk"
  FOREIGN KEY ("template_id") REFERENCES "contract_templates"("id") ON DELETE set null;

-- The business's own signature. Separate columns rather than a second row in
-- the same shape, because the countersignature belongs to this document rather
-- than beside it.
ALTER TABLE "contract_documents"
  ADD COLUMN IF NOT EXISTS "countersigned_at" timestamp with time zone;
ALTER TABLE "contract_documents"
  ADD COLUMN IF NOT EXISTS "countersigner_user_id" uuid REFERENCES "users"("id") ON DELETE set null;
ALTER TABLE "contract_documents" ADD COLUMN IF NOT EXISTS "countersigner_name" text;
ALTER TABLE "contract_documents" ADD COLUMN IF NOT EXISTS "countersignature_hash" text;
ALTER TABLE "contract_documents"
  ADD COLUMN IF NOT EXISTS "requires_countersignature" boolean DEFAULT false NOT NULL;
