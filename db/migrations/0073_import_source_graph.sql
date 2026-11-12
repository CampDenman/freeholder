-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- freeholder:schema-breaking Durable import sources require guarded, bounded graph phases. Previous images cannot safely interpret these imports; image rollback requires the pre-upgrade database and private objects.
CREATE TABLE import_source_graphs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 run_id uuid NOT NULL REFERENCES import_runs(id) ON DELETE CASCADE,
 generation uuid NOT NULL,
 source_revision text NOT NULL CHECK (source_revision ~ '^[a-f0-9]{64}$'),
 source_started_at timestamptz NOT NULL,
 plan_digest text CHECK (plan_digest IS NULL OR plan_digest ~ '^[a-f0-9]{64}$'),
 plan_revision integer NOT NULL DEFAULT 1 CHECK (plan_revision > 0),
 parser_version integer NOT NULL DEFAULT 1 CHECK (parser_version = 1),
 state text NOT NULL DEFAULT 'indexing' CHECK (state IN ('indexing','indexed','invalidated')),
 cursor jsonb NOT NULL CHECK (jsonb_typeof(cursor) = 'object' AND octet_length(cursor::text) <= 2048),
 header_metadata jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(header_metadata) = 'object' AND octet_length(header_metadata::text) <= 1048576),
 plan_metadata jsonb CHECK (plan_metadata IS NULL OR (jsonb_typeof(plan_metadata) = 'object' AND octet_length(plan_metadata::text) <= 4194304)),
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
 target_page_id uuid,
 resolution text CHECK (resolution IS NULL OR resolution IN ('keep-existing','replace','rename'))
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
 kind text NOT NULL DEFAULT 'content' CHECK (kind IN ('content','media','navigation')),
 media_key text,
 created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX import_source_batches_index_unique ON import_source_batches(graph_id, batch_index);
--> statement-breakpoint
CREATE UNIQUE INDEX import_source_batches_child_unique ON import_source_batches(child_run_id);
--> statement-breakpoint
CREATE TABLE import_source_media (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 graph_id uuid NOT NULL REFERENCES import_source_graphs(id) ON DELETE CASCADE,
 key text NOT NULL CHECK (length(key) BETWEEN 1 AND 4096),
 planned jsonb NOT NULL CHECK (jsonb_typeof(planned) = 'object' AND octet_length(planned::text) <= 16384),
 digest text CHECK (digest IS NULL OR digest ~ '^[a-f0-9]{64}$'),
 bytes integer CHECK (bytes IS NULL OR bytes BETWEEN 1 AND 26214400),
 asset_id uuid,
 error text CHECK (error IS NULL OR length(error) <= 500),
 CONSTRAINT import_source_media_bytes_binding CHECK ((bytes IS NULL) = (digest IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX import_source_media_identity_unique ON import_source_media(graph_id,key);
--> statement-breakpoint
CREATE FUNCTION freeholder_guard_import_graph_writer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_setting('freeholder.import_graph_writer', true) IS DISTINCT FROM 'v1'
    AND (EXISTS (SELECT 1 FROM import_source_graphs WHERE run_id=OLD.id)
      OR EXISTS (SELECT 1 FROM import_source_batches WHERE child_run_id=OLD.id)) THEN
   RAISE EXCEPTION 'This import requires the guarded source graph writer' USING ERRCODE='55000';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER import_runs_source_graph_writer BEFORE UPDATE OR DELETE ON import_runs
 FOR EACH ROW EXECUTE FUNCTION freeholder_guard_import_graph_writer();
--> statement-breakpoint
CREATE FUNCTION freeholder_guard_import_graph_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.run_id IS DISTINCT FROM OLD.run_id OR NEW.generation IS DISTINCT FROM OLD.generation
    OR NEW.source_revision IS DISTINCT FROM OLD.source_revision OR NEW.parser_version IS DISTINCT FROM OLD.parser_version
    OR NEW.source_started_at IS DISTINCT FROM OLD.source_started_at
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR (OLD.header_metadata <> '{}'::jsonb AND NEW.header_metadata IS DISTINCT FROM OLD.header_metadata)
    OR (OLD.plan_metadata IS NOT NULL AND NEW.plan_metadata IS DISTINCT FROM OLD.plan_metadata)
    OR (OLD.plan_digest IS NOT NULL AND (NEW.plan_digest IS DISTINCT FROM OLD.plan_digest OR NEW.plan_revision IS DISTINCT FROM OLD.plan_revision)) THEN
   RAISE EXCEPTION 'The original source graph identity is immutable' USING ERRCODE='23514';
 END IF;
 IF (NEW.cursor->>'ordinal')::integer < (OLD.cursor->>'ordinal')::integer
    OR NEW.commit_ordinal < OLD.commit_ordinal OR NEW.batch_counter < OLD.batch_counter
    OR (OLD.state='invalidated' AND NEW.state<>'invalidated')
    OR (OLD.state='indexed' AND NEW.state='indexing') THEN
   RAISE EXCEPTION 'An accepted source graph cannot move backwards' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER import_source_graphs_identity_guard BEFORE UPDATE ON import_source_graphs
 FOR EACH ROW EXECUTE FUNCTION freeholder_guard_import_graph_identity();
--> statement-breakpoint
CREATE FUNCTION freeholder_guard_import_entry_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.graph_id IS DISTINCT FROM OLD.graph_id OR NEW.ordinal IS DISTINCT FROM OLD.ordinal
    OR NEW.source_identity IS DISTINCT FROM OLD.source_identity OR NEW.kind IS DISTINCT FROM OLD.kind
    OR NEW.start_byte IS DISTINCT FROM OLD.start_byte OR NEW.end_byte IS DISTINCT FROM OLD.end_byte
    OR NEW.digest IS DISTINCT FROM OLD.digest OR NEW.metadata IS DISTINCT FROM OLD.metadata
    OR NEW.body_bytes IS DISTINCT FROM OLD.body_bytes THEN
   RAISE EXCEPTION 'The original indexed entry identity is immutable' USING ERRCODE='23514';
 END IF;
 IF (NEW.target_slug IS DISTINCT FROM OLD.target_slug OR NEW.resolution IS DISTINCT FROM OLD.resolution)
    AND EXISTS (SELECT 1 FROM import_source_graphs WHERE id=OLD.graph_id AND plan_digest IS NOT NULL) THEN
   RAISE EXCEPTION 'The accepted import plan is frozen' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER import_source_entries_identity_guard BEFORE UPDATE ON import_source_entries
 FOR EACH ROW EXECUTE FUNCTION freeholder_guard_import_entry_identity();
--> statement-breakpoint
CREATE FUNCTION freeholder_guard_import_media_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.graph_id IS DISTINCT FROM OLD.graph_id OR NEW.key IS DISTINCT FROM OLD.key
    OR NEW.planned IS DISTINCT FROM OLD.planned
    OR (OLD.digest IS NOT NULL AND (NEW.digest IS DISTINCT FROM OLD.digest OR NEW.bytes IS DISTINCT FROM OLD.bytes))
    OR (OLD.asset_id IS NOT NULL AND NEW.asset_id IS DISTINCT FROM OLD.asset_id) THEN
   RAISE EXCEPTION 'The original shared media identity and accepted receipt are immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER import_source_media_identity_guard BEFORE UPDATE ON import_source_media
 FOR EACH ROW EXECUTE FUNCTION freeholder_guard_import_media_identity();
