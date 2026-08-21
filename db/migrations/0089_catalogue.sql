-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- A federated catalogue of shareable definitions (C4.23, MASTER.md §40).
CREATE TABLE IF NOT EXISTS "catalogue_sources" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "url" text NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "added_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "last_fetched_at" timestamp with time zone,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "catalogue_sources_url_idx" ON "catalogue_sources" ("url");
CREATE INDEX IF NOT EXISTS "catalogue_sources_enabled_idx" ON "catalogue_sources" ("enabled");

CREATE TABLE IF NOT EXISTS "catalogue_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "source_id" uuid NOT NULL REFERENCES "catalogue_sources"("id") ON DELETE cascade,
  "slug" text NOT NULL,
  "kind" text NOT NULL,
  "name" text NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  "version" text NOT NULL,
  "freeholder_range" text,
  "declared_scopes" text[] DEFAULT '{}' NOT NULL,
  "author" text,
  "license" text,
  "document" jsonb NOT NULL,
  -- Provenance in one column: what an owner previewed and what gets installed
  -- are the same bytes, or the install is refused.
  "checksum" text NOT NULL,
  "fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "catalogue_entries_kind_valid" CHECK ("kind" in ('playbook', 'agent'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "catalogue_entries_unique_idx"
  ON "catalogue_entries" ("source_id", "slug");
CREATE INDEX IF NOT EXISTS "catalogue_entries_kind_idx" ON "catalogue_entries" ("kind", "name");

CREATE TABLE IF NOT EXISTS "catalogue_installs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "entry_id" uuid REFERENCES "catalogue_entries"("id") ON DELETE set null,
  "source_url" text NOT NULL,
  "slug" text NOT NULL,
  "kind" text NOT NULL,
  "version" text NOT NULL,
  "checksum" text NOT NULL,
  "installed_id" uuid,
  "installed_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "catalogue_installs_slug_idx"
  ON "catalogue_installs" ("slug", "created_at");
