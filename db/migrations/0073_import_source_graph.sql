-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- freeholder:schema-breaking Durable import sources require guarded, bounded graph phases. Previous images cannot safely interpret these imports; image rollback requires the pre-upgrade database and private objects.
CREATE TABLE import_source_graphs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 run_id uuid NOT NULL REFERENCES import_runs(id) ON DELETE CASCADE,
 generation uuid NOT NULL,
 source_revision text NOT NULL CHECK (source_revision ~ '^[a-f0-9]{64}$'),
 parser_version integer NOT NULL DEFAULT 1 CHECK (parser_version = 1),
 state text NOT NULL DEFAULT 'indexing' CHECK (state IN ('indexing','indexed','invalidated')),
 cursor jsonb NOT NULL CHECK (jsonb_typeof(cursor) = 'object' AND octet_length(cursor::text) <= 2048),
 commit_ordinal integer NOT NULL DEFAULT 0 CHECK (commit_ordinal BETWEEN 0 AND 10000),
 batch_counter integer NOT NULL DEFAULT 0 CHECK (batch_counter BETWEEN 0 AND 10000),
 lease_token uuid,
 lease_actor text,
 lease_until timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT import_source_graphs_lease_check CHECK ((lease_token IS NULL AND lease_actor IS NULL AND lease_until IS NULL) OR (lease_token IS NOT NULL AND lease_actor IS NOT NULL AND lease_until IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX import_source_graphs_run_unique ON import_source_graphs(run_id);
--> statement-breakpoint
CREATE TABLE import_source_entries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 graph_id uuid NOT NULL REFERENCES import_source_graphs(id) ON DELETE CASCADE,
 ordinal integer NOT NULL CHECK (ordinal >= 0 AND ordinal < 10000),
 source_identity text NOT NULL CHECK (source_identity ~ '^[a-f0-9]{64}$'),
 kind text NOT NULL CHECK (kind IN ('page','post','attachment','menu','skipped')),
 start_byte integer NOT NULL CHECK (start_byte >= 0),
 end_byte integer NOT NULL CHECK (end_byte > start_byte AND end_byte <= 104857600),
 digest text NOT NULL CHECK (digest ~ '^[a-f0-9]{64}$'),
 metadata jsonb NOT NULL CHECK (jsonb_typeof(metadata) = 'object' AND octet_length(metadata::text) <= 16384),
 body_bytes integer NOT NULL CHECK (body_bytes >= 0 AND body_bytes <= 20971520),
 target_slug text CHECK (target_slug IS NULL OR length(target_slug) <= 2048),
 target_page_id uuid
);
--> statement-breakpoint
CREATE UNIQUE INDEX import_source_entries_ordinal_unique ON import_source_entries(graph_id, ordinal);
--> statement-breakpoint
CREATE UNIQUE INDEX import_source_entries_identity_unique ON import_source_entries(graph_id, kind, source_identity);
--> statement-breakpoint
CREATE UNIQUE INDEX import_source_entries_target_unique ON import_source_entries(graph_id, target_slug);
--> statement-breakpoint
CREATE TABLE import_source_batches (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 graph_id uuid NOT NULL REFERENCES import_source_graphs(id) ON DELETE CASCADE,
 batch_index integer NOT NULL CHECK (batch_index >= 0 AND batch_index < 10000),
 child_run_id uuid NOT NULL REFERENCES import_runs(id),
 start_ordinal integer NOT NULL CHECK (start_ordinal BETWEEN 0 AND 9999),
 end_ordinal integer NOT NULL CHECK (end_ordinal > start_ordinal AND end_ordinal <= 10000),
 created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX import_source_batches_index_unique ON import_source_batches(graph_id, batch_index);
--> statement-breakpoint
CREATE UNIQUE INDEX import_source_batches_child_unique ON import_source_batches(child_run_id);
