-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- freeholder:schema-breaking Actual HTTP originals require guarded frontier ownership. Previous images cannot mutate these imports or discard their active private responses. Image rollback requires the matching pre-upgrade database and private objects.
-- Source-only unpublished migration81: deliberately absent from the journal
-- until the real migration80 predecessor and complete crawl integration exist.
CREATE TABLE import_crawl_sources (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 run_id uuid NOT NULL REFERENCES import_runs(id) ON DELETE CASCADE,
 generation uuid NOT NULL,
 kind text NOT NULL CHECK (kind IN ('wordpress-rest','sitemap','rss','atom','html')),
 site_url text CHECK (site_url IS NULL OR length(site_url) BETWEEN 1 AND 8192),
 source_url text CHECK (source_url IS NULL OR length(source_url) BETWEEN 1 AND 8192),
 created_by text NOT NULL,
 executor_identity jsonb NOT NULL CHECK (jsonb_typeof(executor_identity)='object' AND executor_identity ?& ARRAY['kind','id'] AND jsonb_typeof(executor_identity->'kind')='string' AND jsonb_typeof(executor_identity->'id')='string' AND executor_identity->>'kind' IN ('key','user') AND executor_identity->>'id' ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' AND executor_identity-ARRAY['kind','id']='{}'::jsonb),
 state text NOT NULL DEFAULT 'discovering' CHECK (state IN ('discovering','sealed','invalidated','rolled_back')),
 source_revision text CHECK (source_revision IS NULL OR source_revision ~ '^[a-f0-9]{64}$'),
 request_counter integer NOT NULL DEFAULT 0 CHECK (request_counter BETWEEN 0 AND 20010),
 network_requests integer NOT NULL DEFAULT 0 CHECK (network_requests BETWEEN 0 AND 20010),
 captured_bytes integer NOT NULL DEFAULT 0 CHECK (captured_bytes BETWEEN 0 AND 104857600),
 reserved_bytes integer NOT NULL DEFAULT 0 CHECK (reserved_bytes BETWEEN 0 AND 104857600),
 metadata_bytes integer NOT NULL DEFAULT 0 CHECK (metadata_bytes BETWEEN 0 AND 16777216),
 page_count integer NOT NULL DEFAULT 0 CHECK (page_count BETWEEN 0 AND 10000),
 robots_response_id uuid,
 redacted_at timestamptz,
 source_started_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL,
 next_request_at timestamptz NOT NULL,
 lease_token uuid,
 lease_actor text,
 lease_until timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (captured_bytes+reserved_bytes<=104857600),
 CHECK (expires_at>source_started_at),
 CHECK ((lease_token IS NULL AND lease_actor IS NULL AND lease_until IS NULL) OR (lease_token IS NOT NULL AND lease_actor IS NOT NULL AND lease_until IS NOT NULL)),
 CHECK (redacted_at IS NOT NULL OR (site_url IS NOT NULL AND source_url IS NOT NULL)),
 CHECK (state<>'sealed' OR source_revision IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX import_crawl_sources_run_unique ON import_crawl_sources(run_id);
--> statement-breakpoint
CREATE UNIQUE INDEX import_crawl_sources_generation_unique ON import_crawl_sources(id,generation);
--> statement-breakpoint
CREATE INDEX import_crawl_sources_expiry_idx ON import_crawl_sources(expires_at);
--> statement-breakpoint
CREATE TABLE import_crawl_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 source_id uuid NOT NULL REFERENCES import_crawl_sources(id) ON DELETE CASCADE,
 ordinal integer NOT NULL CHECK (ordinal BETWEEN 0 AND 20009),
 url text CHECK (url IS NULL OR length(url) BETWEEN 1 AND 8192),
 url_digest text CHECK (url_digest IS NULL OR url_digest ~ '^[a-f0-9]{64}$'),
 role text NOT NULL CHECK (role IN ('robots','html','sitemap','rss','atom','rest-pages','rest-posts')),
 depth integer NOT NULL CHECK (depth BETWEEN 0 AND 4),
 rest_page integer CHECK (rest_page BETWEEN 1 AND 100),
 state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','claimed','accepted','blocked','failed')),
 discovered_by_response_id uuid,
 accepted_response_id uuid,
 entry_metadata jsonb CHECK (entry_metadata IS NULL OR (jsonb_typeof(entry_metadata)='object' AND octet_length(entry_metadata::text)<=16384 AND entry_metadata-ARRAY['url','title','publishedAt','status','kind']='{}'::jsonb)),
 attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 20010),
 redacted_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((role IN ('rest-pages','rest-posts'))=(rest_page IS NOT NULL)),
 CHECK ((state='accepted')=(accepted_response_id IS NOT NULL)),
 CHECK (redacted_at IS NOT NULL OR (url IS NOT NULL AND url_digest IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX import_crawl_requests_ordinal_unique ON import_crawl_requests(source_id,ordinal);
--> statement-breakpoint
CREATE UNIQUE INDEX import_crawl_requests_identity_unique ON import_crawl_requests(source_id,role,url_digest);
--> statement-breakpoint
CREATE INDEX import_crawl_requests_state_idx ON import_crawl_requests(source_id,state,ordinal);
--> statement-breakpoint
CREATE TABLE import_crawl_responses (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 request_id uuid NOT NULL REFERENCES import_crawl_requests(id) ON DELETE CASCADE,
 attempt integer NOT NULL CHECK (attempt BETWEEN 1 AND 20010),
 claimed_by text NOT NULL,
 executor_identity jsonb NOT NULL CHECK (jsonb_typeof(executor_identity)='object' AND executor_identity ?& ARRAY['kind','id'] AND jsonb_typeof(executor_identity->'kind')='string' AND jsonb_typeof(executor_identity->'id')='string' AND executor_identity->>'kind' IN ('key','user') AND executor_identity->>'id' ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' AND executor_identity-ARRAY['kind','id']='{}'::jsonb),
 storage_key text CHECK (storage_key IS NULL OR length(storage_key) BETWEEN 1 AND 4096),
 key_digest text NOT NULL CHECK (key_digest ~ '^[a-f0-9]{64}$'),
 storage_namespace text NOT NULL CHECK (storage_namespace ~ '^[a-f0-9]{64}$'),
 state text NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved','admitted','fetched','put_unknown','stored','transport_failed','retired')),
 reserved_bytes integer NOT NULL CHECK (reserved_bytes BETWEEN 1 AND 20971520),
 facts jsonb CHECK (facts IS NULL OR (jsonb_typeof(facts)='object' AND octet_length(facts::text)<=16384 AND facts ?& ARRAY['version','method','requestedUrl','role','status','contentType','contentEncoding','bytes','digest'] AND facts->'version'='1'::jsonb AND facts->'method'='"GET"'::jsonb AND facts->'status' IN ('200'::jsonb,'404'::jsonb) AND facts->'contentEncoding'='"identity"'::jsonb AND jsonb_typeof(facts->'requestedUrl')='string' AND length(facts->>'requestedUrl') BETWEEN 1 AND 8192 AND jsonb_typeof(facts->'role')='string' AND jsonb_typeof(facts->'contentType')='string' AND length(facts->>'contentType')<=255 AND jsonb_typeof(facts->'bytes')='number' AND jsonb_typeof(facts->'digest')='string' AND facts-ARRAY['version','method','requestedUrl','role','status','contentType','contentEncoding','bytes','digest','totalRecords','totalPages']='{}'::jsonb AND facts->>'method'='GET' AND facts->>'digest' ~ '^[a-f0-9]{64}$' AND (facts->>'bytes')::integer BETWEEN 0 AND reserved_bytes)),
 discovery_ordinal integer NOT NULL DEFAULT 0 CHECK (discovery_ordinal BETWEEN 0 AND 20010),
 discovery_complete boolean NOT NULL DEFAULT false,
 started_at timestamptz NOT NULL,
 received_at timestamptz,
 provider_accepted_at timestamptz,
 retired_at timestamptz,
 redacted_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK (redacted_at IS NOT NULL OR storage_key IS NOT NULL),
 CHECK (state NOT IN ('fetched','put_unknown','stored') OR (facts IS NOT NULL AND received_at IS NOT NULL)),
 CHECK (state<>'retired' OR retired_at IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX import_crawl_responses_attempt_unique ON import_crawl_responses(request_id,attempt);
--> statement-breakpoint
CREATE UNIQUE INDEX import_crawl_responses_key_unique ON import_crawl_responses(key_digest);
--> statement-breakpoint
CREATE UNIQUE INDEX import_crawl_responses_request_pair_unique ON import_crawl_responses(id,request_id);
--> statement-breakpoint
CREATE INDEX import_crawl_responses_state_idx ON import_crawl_responses(state);
--> statement-breakpoint
ALTER TABLE import_crawl_requests ADD CONSTRAINT import_crawl_requests_accepted_original_fk FOREIGN KEY(accepted_response_id,id) REFERENCES import_crawl_responses(id,request_id) DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE import_crawl_requests ADD CONSTRAINT import_crawl_requests_discovered_original_fk FOREIGN KEY(discovered_by_response_id) REFERENCES import_crawl_responses(id) DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE import_crawl_sources ADD CONSTRAINT import_crawl_sources_robots_original_fk FOREIGN KEY(robots_response_id) REFERENCES import_crawl_responses(id) DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
CREATE TABLE import_crawl_response_erasures (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 response_id uuid NOT NULL REFERENCES import_crawl_responses(id) ON DELETE RESTRICT,
 request_id uuid NOT NULL REFERENCES data_requests(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX import_crawl_response_erasures_pair_unique ON import_crawl_response_erasures(response_id,request_id);
--> statement-breakpoint
CREATE INDEX import_crawl_response_erasures_request_idx ON import_crawl_response_erasures(request_id);
--> statement-breakpoint
CREATE FUNCTION freeholder_guard_import_crawl_writer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_setting('freeholder.import_crawl_writer',true) IS DISTINCT FROM 'v1' THEN
  RAISE EXCEPTION 'This original HTTP source requires the guarded crawl writer' USING ERRCODE='55000';
 END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Original HTTP source witnesses require payload minimization, not deletion' USING ERRCODE='55000'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER import_crawl_sources_writer BEFORE INSERT OR UPDATE OR DELETE ON import_crawl_sources FOR EACH ROW EXECUTE FUNCTION freeholder_guard_import_crawl_writer();
--> statement-breakpoint
CREATE TRIGGER import_crawl_requests_writer BEFORE INSERT OR UPDATE OR DELETE ON import_crawl_requests FOR EACH ROW EXECUTE FUNCTION freeholder_guard_import_crawl_writer();
--> statement-breakpoint
CREATE TRIGGER import_crawl_responses_writer BEFORE INSERT OR UPDATE OR DELETE ON import_crawl_responses FOR EACH ROW EXECUTE FUNCTION freeholder_guard_import_crawl_writer();
--> statement-breakpoint
CREATE TRIGGER import_crawl_response_erasures_writer BEFORE INSERT OR UPDATE OR DELETE ON import_crawl_response_erasures FOR EACH ROW EXECUTE FUNCTION freeholder_guard_import_crawl_writer();
--> statement-breakpoint
CREATE FUNCTION freeholder_guard_import_crawl_run() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM import_crawl_sources WHERE run_id=OLD.id)
    AND current_setting('freeholder.import_crawl_writer',true) IS DISTINCT FROM 'v1' THEN
  RAISE EXCEPTION 'This import owns an actual HTTP frontier and requires its guarded writer' USING ERRCODE='55000';
 END IF;
 IF TG_OP='DELETE' AND EXISTS(SELECT 1 FROM import_crawl_sources WHERE run_id=OLD.id) THEN RAISE EXCEPTION 'The original crawl recovery root must remain available' USING ERRCODE='55000'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER import_runs_crawl_writer BEFORE UPDATE OR DELETE ON import_runs FOR EACH ROW EXECUTE FUNCTION freeholder_guard_import_crawl_run();
--> statement-breakpoint
CREATE FUNCTION freeholder_guard_import_crawl_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.run_id IS DISTINCT FROM OLD.run_id OR NEW.generation IS DISTINCT FROM OLD.generation
    OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.executor_identity IS DISTINCT FROM OLD.executor_identity
    OR NEW.source_started_at IS DISTINCT FROM OLD.source_started_at OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
    OR (OLD.redacted_at IS NOT NULL AND NEW.redacted_at IS DISTINCT FROM OLD.redacted_at)
    OR (OLD.source_revision IS NOT NULL AND NEW.source_revision IS DISTINCT FROM OLD.source_revision)
    OR (OLD.robots_response_id IS NOT NULL AND NEW.robots_response_id IS DISTINCT FROM OLD.robots_response_id) THEN
  RAISE EXCEPTION 'The original crawl source identity is immutable' USING ERRCODE='23514';
 END IF;
 IF (NEW.site_url IS DISTINCT FROM OLD.site_url OR NEW.source_url IS DISTINCT FROM OLD.source_url)
    AND NOT (NEW.state IN ('invalidated','rolled_back') AND NEW.redacted_at IS NOT NULL AND NEW.site_url IS NULL AND NEW.source_url IS NULL) THEN
  RAISE EXCEPTION 'The original selected HTTP source cannot be reassigned' USING ERRCODE='23514';
 END IF;
 IF NEW.request_counter<OLD.request_counter OR NEW.network_requests<OLD.network_requests
    OR NEW.captured_bytes<OLD.captured_bytes OR NEW.page_count<OLD.page_count
    OR (OLD.state IN ('invalidated','rolled_back') AND NEW.state NOT IN ('invalidated','rolled_back'))
    OR (OLD.state='sealed' AND NEW.state='discovering') THEN
  RAISE EXCEPTION 'Accepted crawl facts cannot move backwards' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER import_crawl_sources_identity BEFORE UPDATE ON import_crawl_sources FOR EACH ROW EXECUTE FUNCTION freeholder_guard_import_crawl_identity();
--> statement-breakpoint
CREATE FUNCTION freeholder_guard_import_crawl_request_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.source_id IS DISTINCT FROM OLD.source_id OR NEW.ordinal IS DISTINCT FROM OLD.ordinal
    OR NEW.role IS DISTINCT FROM OLD.role OR NEW.depth IS DISTINCT FROM OLD.depth OR NEW.rest_page IS DISTINCT FROM OLD.rest_page
    OR NEW.discovered_by_response_id IS DISTINCT FROM OLD.discovered_by_response_id OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR (OLD.redacted_at IS NOT NULL AND NEW.redacted_at IS DISTINCT FROM OLD.redacted_at)
    OR (OLD.accepted_response_id IS NOT NULL AND NEW.accepted_response_id IS DISTINCT FROM OLD.accepted_response_id) THEN
  RAISE EXCEPTION 'The original crawl request identity is immutable' USING ERRCODE='23514';
 END IF;
 IF (NEW.url IS DISTINCT FROM OLD.url OR NEW.url_digest IS DISTINCT FROM OLD.url_digest OR NEW.entry_metadata IS DISTINCT FROM OLD.entry_metadata)
    AND NOT (NEW.redacted_at IS NOT NULL AND NEW.url IS NULL AND NEW.url_digest IS NULL AND NEW.entry_metadata IS NULL
      AND EXISTS(SELECT 1 FROM import_crawl_sources WHERE id=OLD.source_id AND state IN ('invalidated','rolled_back'))) THEN
  RAISE EXCEPTION 'An original frontier address cannot be replaced' USING ERRCODE='23514';
 END IF;
 IF NEW.attempts<OLD.attempts OR (OLD.state IN ('accepted','blocked') AND NEW.state IS DISTINCT FROM OLD.state) THEN
  RAISE EXCEPTION 'An accepted or blocked original request cannot be rediscovered' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER import_crawl_requests_identity BEFORE UPDATE ON import_crawl_requests FOR EACH ROW EXECUTE FUNCTION freeholder_guard_import_crawl_request_identity();
--> statement-breakpoint
-- One normalized completion/membership authority covers enabled raw formats.
-- A shared readerSources header is sealed only after legacy and HTTP originals
-- are captured together; an older unknown header never adopts later sources.
CREATE FUNCTION freeholder_crawl_source_held(original_source uuid, original_generation uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM privacy_retention_exceptions h
  LEFT JOIN privacy_retention_source_snapshots s ON s.exception_id=h.id
   AND s.source_scope=CASE WHEN h.scope='imports.crawlOriginals' THEN 'imports.crawlOriginals' ELSE 'imports.readerSources' END
  WHERE h.scope IN ('cms.readerComments','imports.readerSources','imports.crawlOriginals')
   AND (h.expires_at IS NULL OR h.expires_at>clock_timestamp())
   AND (s.exception_id IS NULL OR s.capture_version<>1
    OR s.member_count<>(SELECT count(*) FROM privacy_retention_source_members m WHERE m.exception_id=s.exception_id AND m.source_scope=s.source_scope)
    OR EXISTS(SELECT 1 FROM privacy_retention_source_members m WHERE m.exception_id=s.exception_id AND m.source_scope=s.source_scope
      AND m.source_id=original_source AND m.generation=original_generation)))
$$;
--> statement-breakpoint
CREATE FUNCTION freeholder_crawl_response_held(response uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM import_crawl_responses original
  JOIN import_crawl_requests request ON request.id=original.request_id
  JOIN import_crawl_sources source ON source.id=request.source_id
  WHERE original.id=response AND freeholder_crawl_source_held(source.id,source.generation))
$$;
--> statement-breakpoint
CREATE FUNCTION freeholder_guard_import_crawl_response_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.request_id IS DISTINCT FROM OLD.request_id OR NEW.attempt IS DISTINCT FROM OLD.attempt
    OR NEW.claimed_by IS DISTINCT FROM OLD.claimed_by OR NEW.executor_identity IS DISTINCT FROM OLD.executor_identity
    OR NEW.key_digest IS DISTINCT FROM OLD.key_digest OR NEW.storage_namespace IS DISTINCT FROM OLD.storage_namespace
    OR NEW.reserved_bytes IS DISTINCT FROM OLD.reserved_bytes OR NEW.started_at IS DISTINCT FROM OLD.started_at
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR (OLD.retired_at IS NOT NULL AND NEW.retired_at IS DISTINCT FROM OLD.retired_at)
    OR (OLD.redacted_at IS NOT NULL AND NEW.redacted_at IS DISTINCT FROM OLD.redacted_at)
    OR (OLD.received_at IS NOT NULL AND NEW.received_at IS DISTINCT FROM OLD.received_at)
    OR (OLD.provider_accepted_at IS NOT NULL AND NEW.provider_accepted_at IS DISTINCT FROM OLD.provider_accepted_at) THEN
  RAISE EXCEPTION 'An actual HTTP response cannot acquire a new source, executor or storage resource' USING ERRCODE='23514';
 END IF;
 IF (OLD.facts IS NOT NULL AND NEW.facts IS DISTINCT FROM OLD.facts) OR NEW.storage_key IS DISTINCT FROM OLD.storage_key THEN
  IF NOT (NEW.state='retired' AND NEW.retired_at IS NOT NULL AND NEW.redacted_at IS NOT NULL AND NEW.storage_key IS NOT DISTINCT FROM OLD.storage_key AND NEW.facts IS NULL
      AND NOT freeholder_crawl_response_held(OLD.id)
      AND NOT EXISTS(SELECT 1 FROM media_object_writes WHERE key_digest=OLD.key_digest AND (state IN ('unverified','started','unknown') OR deleted_at IS NULL AND operation_kind='put'))) THEN
   RAISE EXCEPTION 'Original response payload facts require verified retirement before minimization' USING ERRCODE='23514';
  END IF;
 END IF;
 IF NEW.facts IS NOT NULL AND NOT EXISTS(SELECT 1 FROM import_crawl_requests request WHERE request.id=NEW.request_id AND request.url=NEW.facts->>'requestedUrl' AND request.role=NEW.facts->>'role') THEN
  RAISE EXCEPTION 'The actual response lost its original requested URL or role' USING ERRCODE='23514';
 END IF;
 IF NEW.discovery_ordinal<OLD.discovery_ordinal OR (OLD.discovery_complete AND NOT NEW.discovery_complete) THEN
  RAISE EXCEPTION 'Accepted response discovery cannot move backwards' USING ERRCODE='23514';
 END IF;
 IF OLD.state='retired' AND NEW.state<>'retired' THEN
  RAISE EXCEPTION 'A retired original response cannot restart capture' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER import_crawl_responses_identity BEFORE UPDATE ON import_crawl_responses FOR EACH ROW EXECUTE FUNCTION freeholder_guard_import_crawl_response_identity();
--> statement-breakpoint
-- Admission only: a late positive/negative physical observation must still be
-- recorded after invalidation or erasure. Never hide a real provider outcome.
CREATE FUNCTION freeholder_guard_crawl_physical_admission() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original import_crawl_responses%ROWTYPE; source_state text; source_expiry timestamptz;
BEGIN
 SELECT * INTO original FROM import_crawl_responses WHERE key_digest=NEW.key_digest;
 IF NOT FOUND THEN RETURN NEW; END IF;
 IF NEW.storage_namespace IS DISTINCT FROM original.storage_namespace THEN
  RAISE EXCEPTION 'The original HTTP response belongs to another storage resource' USING ERRCODE='55000';
 END IF;
 IF NEW.operation_kind='put' THEN
  SELECT source.state,source.expires_at INTO source_state,source_expiry FROM import_crawl_requests request JOIN import_crawl_sources source ON source.id=request.source_id WHERE request.id=original.request_id;
  IF source_state<>'discovering' OR source_expiry<=now() OR original.state NOT IN ('fetched','put_unknown') OR original.facts IS NULL
      OR NEW.sha256 IS DISTINCT FROM original.facts->>'digest' OR NEW.bytes IS DISTINCT FROM (original.facts->>'bytes')::bigint
      OR NEW.object_key IS DISTINCT FROM original.storage_key
      OR NEW.content_type IS DISTINCT FROM coalesce(nullif(original.facts->>'contentType',''),'application/octet-stream') THEN
   RAISE EXCEPTION 'No current actual HTTP response authorizes this physical PUT' USING ERRCODE='55000';
  END IF;
 ELSE
  IF original.retired_at IS NULL OR freeholder_crawl_response_held(original.id) THEN
   RAISE EXCEPTION 'The original HTTP response remains active, held or unresolved' USING ERRCODE='55000';
  END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER media_writes_crawl_admission BEFORE INSERT ON media_object_writes FOR EACH ROW EXECUTE FUNCTION freeholder_guard_crawl_physical_admission();
--> statement-breakpoint
CREATE FUNCTION freeholder_guard_crawl_object_discard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original import_crawl_responses%ROWTYPE;
BEGIN
 SELECT * INTO original FROM import_crawl_responses WHERE storage_key=OLD.key;
 IF FOUND AND (original.retired_at IS NULL OR freeholder_crawl_response_held(original.id)) THEN
  RAISE EXCEPTION 'The reserved HTTP original still has a private source owner' USING ERRCODE='55000';
 END IF;
 RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER media_objects_crawl_discard BEFORE DELETE ON media_objects FOR EACH ROW EXECUTE FUNCTION freeholder_guard_crawl_object_discard();
--> statement-breakpoint
CREATE FUNCTION freeholder_guard_crawl_erasure_membership() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND (NEW.response_id IS DISTINCT FROM OLD.response_id OR NEW.request_id IS DISTINCT FROM OLD.request_id OR NEW.created_at IS DISTINCT FROM OLD.created_at) THEN
  RAISE EXCEPTION 'An original HTTP erasure cohort cannot be reassigned' USING ERRCODE='23514';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM data_requests request WHERE request.id=NEW.request_id AND request.kind='erasure' AND (request.status IN ('verified','in_progress','partially_completed','completed') OR EXISTS(SELECT 1 FROM privacy_retention_exceptions exception WHERE exception.data_request_id=request.id AND exception.scope IN ('cms.readerComments','imports.readerSources','imports.crawlOriginals') AND (exception.expires_at IS NULL OR exception.expires_at>now())))) THEN
  RAISE EXCEPTION 'Original response membership requires a verified erasure or documented original hold' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER import_crawl_response_erasures_identity BEFORE INSERT OR UPDATE ON import_crawl_response_erasures FOR EACH ROW EXECUTE FUNCTION freeholder_guard_crawl_erasure_membership();
--> statement-breakpoint
-- The application snapshots AFTER the actual upsert in the same transaction.
-- Defer the compatibility check until that callback has run. A runtime that
-- does not understand original crawl membership cannot report a saved hold.
CREATE FUNCTION freeholder_require_crawl_hold_snapshot_runtime() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE capture jsonb; family text; original_count integer; original_digest text;
BEGIN
 IF NEW.scope NOT IN ('cms.readerComments','imports.readerSources','imports.crawlOriginals')
    OR NOT EXISTS(SELECT 1 FROM import_crawl_sources) THEN RETURN NEW; END IF;
 family:=CASE WHEN NEW.scope='imports.crawlOriginals' THEN 'imports.crawlOriginals' ELSE 'imports.readerSources' END;
 capture:=coalesce(nullif(current_setting('freeholder.import_crawl_hold_captures',true),''),'{}')::jsonb->NEW.id::text;
 IF capture IS NULL OR capture->>'sourceScope' IS DISTINCT FROM family
    OR jsonb_typeof(capture->'count') IS DISTINCT FROM 'number'
    OR coalesce(capture->>'digest','')!~'^[a-f0-9]{64}$' THEN
  RAISE EXCEPTION 'Original crawl retention requires its actual hold capture receipt' USING ERRCODE='55000';
 END IF;
 SELECT count(*)::integer,
   encode(sha256(convert_to(coalesce(string_agg(member.source_id::text||':'||member.generation::text,'|' ORDER BY member.source_id,member.generation),''),'UTF8')),'hex')
 INTO original_count,original_digest
 FROM privacy_retention_source_members member
 JOIN import_crawl_sources source ON source.id=member.source_id AND source.generation=member.generation
 WHERE member.exception_id=NEW.id AND member.source_scope=family;
 IF original_count<>(capture->>'count')::integer OR original_digest IS DISTINCT FROM capture->>'digest'
    OR NOT EXISTS(SELECT 1 FROM privacy_retention_source_snapshots header
      WHERE header.exception_id=NEW.id AND header.source_scope=family AND header.capture_version=1
       AND header.member_count=(SELECT count(*) FROM privacy_retention_source_members member WHERE member.exception_id=header.exception_id AND member.source_scope=header.source_scope)) THEN
  RAISE EXCEPTION 'Original crawl retention lost its exact canonical capture membership' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER privacy_retention_crawl_snapshot_runtime AFTER INSERT ON privacy_retention_exceptions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION freeholder_require_crawl_hold_snapshot_runtime();
--> statement-breakpoint
-- Distinct response objects retain distinct local byte ranges. No synthetic
-- upload/container or copied source body is introduced by graph indexing.
CREATE TABLE import_crawl_graphs (
 graph_id uuid PRIMARY KEY REFERENCES import_source_graphs(id) ON DELETE RESTRICT,
 source_id uuid NOT NULL,
 source_generation uuid NOT NULL,
 source_revision text NOT NULL CHECK(source_revision~'^[a-f0-9]{64}$'),
 request_ordinal integer NOT NULL DEFAULT 0 CHECK(request_ordinal BETWEEN 0 AND 20010),
 entry_ordinal integer NOT NULL DEFAULT 0 CHECK(entry_ordinal BETWEEN 0 AND 10000),
 body_bytes integer NOT NULL DEFAULT 0 CHECK(body_bytes BETWEEN 0 AND 104857600),
 metadata_bytes integer NOT NULL DEFAULT 0 CHECK(metadata_bytes BETWEEN 0 AND 4194304),
 physical_bytes integer NOT NULL DEFAULT 0 CHECK(physical_bytes BETWEEN 0 AND 104857600),
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT import_crawl_graphs_original_fk FOREIGN KEY(source_id,source_generation) REFERENCES import_crawl_sources(id,generation) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE UNIQUE INDEX import_crawl_graphs_original_unique ON import_crawl_graphs(source_id,source_generation);
--> statement-breakpoint
CREATE TABLE import_crawl_entry_originals (
 entry_id uuid PRIMARY KEY REFERENCES import_source_entries(id) ON DELETE RESTRICT,
 graph_id uuid NOT NULL REFERENCES import_crawl_graphs(graph_id) ON DELETE RESTRICT,
 request_id uuid NOT NULL REFERENCES import_crawl_requests(id) ON DELETE RESTRICT,
 response_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT import_crawl_entry_originals_response_fk FOREIGN KEY(response_id,request_id) REFERENCES import_crawl_responses(id,request_id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX import_crawl_entry_originals_graph_idx ON import_crawl_entry_originals(graph_id);
--> statement-breakpoint
CREATE INDEX import_crawl_entry_originals_response_idx ON import_crawl_entry_originals(response_id);
--> statement-breakpoint
CREATE FUNCTION freeholder_guard_crawl_graph_original() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_setting('freeholder.import_crawl_writer',true) IS DISTINCT FROM 'v1'
  OR current_setting('freeholder.import_graph_writer',true) IS DISTINCT FROM 'v1' THEN
  RAISE EXCEPTION 'Actual HTTP graph bindings require both original guarded writers' USING ERRCODE='55000';
 END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Original HTTP graph witnesses require retirement, not deletion' USING ERRCODE='55000'; END IF;
 IF TG_OP='UPDATE' AND (NEW.graph_id IS DISTINCT FROM OLD.graph_id OR NEW.source_id IS DISTINCT FROM OLD.source_id
  OR NEW.source_generation IS DISTINCT FROM OLD.source_generation OR NEW.source_revision IS DISTINCT FROM OLD.source_revision
  OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.request_ordinal<OLD.request_ordinal OR NEW.entry_ordinal<OLD.entry_ordinal
  OR NEW.body_bytes<OLD.body_bytes OR NEW.metadata_bytes<OLD.metadata_bytes OR NEW.physical_bytes<OLD.physical_bytes) THEN
  RAISE EXCEPTION 'The actual source graph or accepted index progress cannot be replaced' USING ERRCODE='23514';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM import_source_graphs graph JOIN import_crawl_sources source ON source.run_id=graph.run_id
  WHERE graph.id=NEW.graph_id AND source.id=NEW.source_id AND source.generation=NEW.source_generation
   AND graph.generation=NEW.source_generation AND graph.source_revision=NEW.source_revision AND source.source_revision=NEW.source_revision) THEN
  RAISE EXCEPTION 'The graph lost its original sealed HTTP source binding' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER import_crawl_graphs_original BEFORE INSERT OR UPDATE OR DELETE ON import_crawl_graphs FOR EACH ROW EXECUTE FUNCTION freeholder_guard_crawl_graph_original();
--> statement-breakpoint
CREATE FUNCTION freeholder_guard_crawl_entry_original() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_setting('freeholder.import_crawl_writer',true) IS DISTINCT FROM 'v1'
  OR current_setting('freeholder.import_graph_writer',true) IS DISTINCT FROM 'v1' THEN
  RAISE EXCEPTION 'Actual HTTP graph entries require both original guarded writers' USING ERRCODE='55000';
 END IF;
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'An actual HTTP entry cannot acquire another original response' USING ERRCODE='55000'; END IF;
 IF NOT EXISTS(SELECT 1 FROM import_source_entries entry JOIN import_crawl_graphs binding ON binding.graph_id=entry.graph_id
  JOIN import_crawl_requests request ON request.source_id=binding.source_id
  JOIN import_crawl_responses response ON response.request_id=request.id
  WHERE entry.id=NEW.entry_id AND entry.graph_id=NEW.graph_id AND request.id=NEW.request_id AND response.id=NEW.response_id
   AND request.accepted_response_id=response.id AND response.state='stored' AND response.retired_at IS NULL
   AND entry.start_byte>=0 AND entry.end_byte>entry.start_byte AND entry.end_byte<=(response.facts->>'bytes')::integer
   AND entry.metadata->>'format'='http-originals'
   AND entry.metadata->'original'->>'responseId'=response.id::text
   AND entry.metadata->'original'->>'requestId'=request.id::text
   AND entry.metadata->'original'->>'sourceId'=binding.source_id::text
   AND entry.metadata->'original'->>'generation'=binding.source_generation::text
   AND entry.metadata->'original'->>'digest'=response.facts->>'digest'
   AND (entry.metadata->'original'->>'start')::integer=entry.start_byte
   AND (entry.metadata->'original'->>'end')::integer=entry.end_byte) THEN
  RAISE EXCEPTION 'The entry lost its actual response-local range or original source' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER import_crawl_entry_originals_identity BEFORE INSERT OR UPDATE OR DELETE ON import_crawl_entry_originals FOR EACH ROW EXECUTE FUNCTION freeholder_guard_crawl_entry_original();
--> statement-breakpoint
-- Every HTTP-bound entry must finish its actual response FK in the same TX.
CREATE FUNCTION freeholder_require_crawl_entry_original() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM import_crawl_graphs WHERE graph_id=NEW.graph_id)
   AND NOT EXISTS(SELECT 1 FROM import_crawl_entry_originals WHERE entry_id=NEW.id AND graph_id=NEW.graph_id) THEN
  RAISE EXCEPTION 'The HTTP graph entry needs its actual original response witness' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER import_source_entries_crawl_original_required AFTER INSERT ON import_source_entries DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION freeholder_require_crawl_entry_original();
--> statement-breakpoint
-- A zero-response source still has legally held URL facts. Actual response
-- absence must also precede minimizing source/request URL projections.
CREATE FUNCTION freeholder_guard_crawl_url_minimization() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original_source uuid; original_generation uuid; original_request uuid; changing boolean;
BEGIN
 IF TG_TABLE_NAME='import_crawl_sources' THEN
  original_source:=OLD.id; original_generation:=OLD.generation;
  changing:=NEW.site_url IS DISTINCT FROM OLD.site_url OR NEW.source_url IS DISTINCT FROM OLD.source_url OR NEW.redacted_at IS DISTINCT FROM OLD.redacted_at;
 ELSE
  original_source:=OLD.source_id; original_request:=OLD.id;
  SELECT generation INTO original_generation FROM import_crawl_sources WHERE id=original_source;
  changing:=NEW.url IS DISTINCT FROM OLD.url OR NEW.url_digest IS DISTINCT FROM OLD.url_digest OR NEW.entry_metadata IS DISTINCT FROM OLD.entry_metadata OR NEW.redacted_at IS DISTINCT FROM OLD.redacted_at;
 END IF;
 IF changing AND (freeholder_crawl_source_held(original_source,original_generation)
   OR EXISTS(SELECT 1 FROM import_crawl_requests request JOIN import_crawl_responses response ON response.request_id=request.id
     WHERE request.source_id=original_source AND (original_request IS NULL OR request.id=original_request) AND (response.redacted_at IS NULL
       OR EXISTS(SELECT 1 FROM media_objects reservation WHERE reservation.key=response.storage_key)
       OR EXISTS(SELECT 1 FROM media_object_writes physical WHERE physical.key_digest=response.key_digest
          AND (physical.state IN ('unverified','started','unknown') OR physical.operation_kind='put' AND physical.deleted_at IS NULL))))) THEN
  RAISE EXCEPTION 'Original HTTP URL facts remain held or await actual physical retirement' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER import_crawl_sources_url_retention BEFORE UPDATE ON import_crawl_sources FOR EACH ROW EXECUTE FUNCTION freeholder_guard_crawl_url_minimization();
--> statement-breakpoint
CREATE TRIGGER import_crawl_requests_url_retention BEFORE UPDATE ON import_crawl_requests FOR EACH ROW EXECUTE FUNCTION freeholder_guard_crawl_url_minimization();
--> statement-breakpoint
-- Capture the actual original erasure generations, including a known-empty
-- set. Missing historical scope is recovery debt, never a clock-based guess.
CREATE TABLE import_crawl_erasure_scopes (
 request_id uuid PRIMARY KEY REFERENCES data_requests(id) ON DELETE RESTRICT,
 capture_version integer NOT NULL DEFAULT 1 CHECK(capture_version=1),
 source_count integer NOT NULL CHECK(source_count BETWEEN 0 AND 10000),
 response_count integer NOT NULL CHECK(response_count BETWEEN 0 AND 100000),
 captured_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE import_crawl_erasure_sources (
 request_id uuid NOT NULL REFERENCES import_crawl_erasure_scopes(request_id) ON DELETE RESTRICT,
 source_id uuid NOT NULL, generation uuid NOT NULL,
 CONSTRAINT import_crawl_erasure_sources_pk PRIMARY KEY(request_id,source_id,generation),
 CONSTRAINT import_crawl_erasure_sources_original_fk FOREIGN KEY(source_id,generation) REFERENCES import_crawl_sources(id,generation) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX import_crawl_erasure_sources_original_idx ON import_crawl_erasure_sources(source_id,generation,request_id);
--> statement-breakpoint
CREATE FUNCTION freeholder_guard_crawl_erasure_capture() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Original HTTP erasure capture cannot be replaced or removed' USING ERRCODE='55000'; END IF;
 IF current_setting('freeholder.import_crawl_writer',true) IS DISTINCT FROM 'v1'
  OR current_setting('freeholder.import_crawl_erasure_request',true) IS DISTINCT FROM NEW.request_id::text
  OR NOT EXISTS(SELECT 1 FROM data_requests request WHERE request.id=NEW.request_id AND request.kind='erasure' AND request.status='verified')
  OR EXISTS(SELECT 1 FROM data_request_artifacts WHERE data_request_id=NEW.request_id)
  OR EXISTS(SELECT 1 FROM audit_log WHERE action='contacts.fulfillDataRequest' AND subject_type='dataRequest' AND subject_id=NEW.request_id::text) THEN
  RAISE EXCEPTION 'Original HTTP capture requires its actual initial verified fulfillment transaction' USING ERRCODE='55000';
 END IF;
 IF TG_TABLE_NAME='import_crawl_erasure_scopes' THEN
  IF EXISTS(SELECT 1 FROM import_crawl_response_erasures WHERE request_id=NEW.request_id) THEN
   RAISE EXCEPTION 'Existing original response cohorts require recovery, not a new empty capture' USING ERRCODE='55000';
  END IF;
  IF NEW.source_count<>(SELECT count(*) FROM import_crawl_sources) OR NEW.response_count<>(SELECT count(*) FROM import_crawl_responses) THEN
   RAISE EXCEPTION 'Original HTTP capture must include every actual original generation and response' USING ERRCODE='55000';
  END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER import_crawl_erasure_scopes_capture BEFORE INSERT OR UPDATE OR DELETE ON import_crawl_erasure_scopes FOR EACH ROW EXECUTE FUNCTION freeholder_guard_crawl_erasure_capture();
--> statement-breakpoint
CREATE TRIGGER import_crawl_erasure_sources_capture BEFORE INSERT OR UPDATE OR DELETE ON import_crawl_erasure_sources FOR EACH ROW EXECUTE FUNCTION freeholder_guard_crawl_erasure_capture();
--> statement-breakpoint
CREATE FUNCTION freeholder_crawl_erasure_scope_complete(original_request uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM import_crawl_erasure_scopes header WHERE header.request_id=original_request AND header.capture_version=1
  AND header.source_count=(SELECT count(*) FROM import_crawl_erasure_sources member WHERE member.request_id=header.request_id)
  AND header.response_count=(SELECT count(*) FROM import_crawl_response_erasures cohort WHERE cohort.request_id=header.request_id)
  AND NOT EXISTS(SELECT 1 FROM import_crawl_response_erasures cohort
   JOIN import_crawl_responses response ON response.id=cohort.response_id JOIN import_crawl_requests request ON request.id=response.request_id
   JOIN import_crawl_sources source ON source.id=request.source_id
   WHERE cohort.request_id=header.request_id AND NOT EXISTS(SELECT 1 FROM import_crawl_erasure_sources member
    WHERE member.request_id=header.request_id AND member.source_id=source.id AND member.generation=source.generation)))
$$;
--> statement-breakpoint
CREATE FUNCTION freeholder_require_crawl_erasure_scope_complete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT freeholder_crawl_erasure_scope_complete(NEW.request_id) THEN
  RAISE EXCEPTION 'Original HTTP erasure capture lost its exact source or response membership' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER import_crawl_erasure_scopes_complete AFTER INSERT ON import_crawl_erasure_scopes DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION freeholder_require_crawl_erasure_scope_complete();
--> statement-breakpoint
-- This predicate is physical and generation-bound. A redaction flag alone
-- never authorizes dropping a held projection or claiming byte absence.
CREATE FUNCTION freeholder_crawl_projection_retired(original_source uuid, original_response uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM import_crawl_sources source WHERE source.id=original_source AND source.state IN ('invalidated','rolled_back')
  AND NOT freeholder_crawl_source_held(source.id,source.generation)
  AND (original_response IS NULL OR EXISTS(SELECT 1 FROM import_crawl_requests request JOIN import_crawl_responses response ON response.request_id=request.id WHERE request.source_id=source.id AND response.id=original_response))
  AND NOT EXISTS(SELECT 1 FROM import_crawl_requests request JOIN import_crawl_responses response ON response.request_id=request.id
   WHERE request.source_id=source.id AND (original_response IS NULL OR response.id=original_response)
    AND (response.retired_at IS NULL OR response.redacted_at IS NULL OR response.facts IS NOT NULL
     OR EXISTS(SELECT 1 FROM media_objects reservation WHERE reservation.key=response.storage_key)
     OR EXISTS(SELECT 1 FROM media_object_writes physical WHERE physical.key_digest=response.key_digest
       AND (physical.state IN ('unverified','started','unknown') OR physical.operation_kind='put' AND physical.deleted_at IS NULL)))))
$$;
--> statement-breakpoint
-- Preserve the published73 identity rules, with one exact HTTP-only reduction
-- after actual retirement. IDs, ranges, digests and target ownership never move.
CREATE OR REPLACE FUNCTION freeholder_guard_import_entry_identity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE minimize boolean;
BEGIN
 minimize:=current_setting('freeholder.import_crawl_projection_redaction',true)='v1'
  AND NEW.metadata='{"format":"http-originals","redacted":true}'::jsonb
  AND EXISTS(SELECT 1 FROM import_crawl_entry_originals witness JOIN import_crawl_graphs binding ON binding.graph_id=witness.graph_id
    WHERE witness.entry_id=OLD.id AND witness.graph_id=OLD.graph_id AND freeholder_crawl_projection_retired(binding.source_id,witness.response_id));
 IF NEW.graph_id IS DISTINCT FROM OLD.graph_id OR NEW.ordinal IS DISTINCT FROM OLD.ordinal
    OR NEW.source_identity IS DISTINCT FROM OLD.source_identity OR NEW.kind IS DISTINCT FROM OLD.kind
    OR NEW.start_byte IS DISTINCT FROM OLD.start_byte OR NEW.end_byte IS DISTINCT FROM OLD.end_byte
    OR NEW.digest IS DISTINCT FROM OLD.digest OR NEW.body_bytes IS DISTINCT FROM OLD.body_bytes
    OR (NEW.metadata IS DISTINCT FROM OLD.metadata AND NOT coalesce(minimize,false)) THEN
  RAISE EXCEPTION 'The original indexed entry identity is immutable' USING ERRCODE='23514';
 END IF;
 IF (NEW.target_slug IS DISTINCT FROM OLD.target_slug OR NEW.resolution IS DISTINCT FROM OLD.resolution)
    AND EXISTS(SELECT 1 FROM import_source_graphs WHERE id=OLD.graph_id AND plan_digest IS NOT NULL)
    AND NOT (coalesce(minimize,false) AND OLD.target_page_id IS NULL AND NEW.target_page_id IS NULL
      AND NEW.target_slug IS NULL AND NEW.resolution IS NOT DISTINCT FROM OLD.resolution) THEN
  RAISE EXCEPTION 'The accepted import plan is frozen' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION freeholder_guard_import_graph_identity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE minimize boolean;
BEGIN
 minimize:=current_setting('freeholder.import_crawl_projection_redaction',true)='v1'
  AND NEW.state='invalidated' AND NEW.header_metadata='{"format":"http-originals","redacted":true}'::jsonb
  AND NEW.plan_metadata='{"redacted":true}'::jsonb
  AND EXISTS(SELECT 1 FROM import_crawl_graphs binding WHERE binding.graph_id=OLD.id AND freeholder_crawl_projection_retired(binding.source_id,null::uuid));
 IF NEW.run_id IS DISTINCT FROM OLD.run_id OR NEW.generation IS DISTINCT FROM OLD.generation
    OR NEW.source_revision IS DISTINCT FROM OLD.source_revision OR NEW.parser_version IS DISTINCT FROM OLD.parser_version
    OR NEW.source_started_at IS DISTINCT FROM OLD.source_started_at OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR (OLD.header_metadata<>'{}'::jsonb AND NEW.header_metadata IS DISTINCT FROM OLD.header_metadata AND NOT coalesce(minimize,false))
    OR (OLD.plan_metadata IS NOT NULL AND NEW.plan_metadata IS DISTINCT FROM OLD.plan_metadata AND NOT coalesce(minimize,false))
    OR (OLD.plan_digest IS NOT NULL AND (NEW.plan_digest IS DISTINCT FROM OLD.plan_digest OR NEW.plan_revision IS DISTINCT FROM OLD.plan_revision)) THEN
  RAISE EXCEPTION 'The original source graph identity is immutable' USING ERRCODE='23514';
 END IF;
 IF (NEW.cursor->>'ordinal')::integer<(OLD.cursor->>'ordinal')::integer
    OR NEW.commit_ordinal<OLD.commit_ordinal OR NEW.batch_counter<OLD.batch_counter
    OR (OLD.state='invalidated' AND NEW.state<>'invalidated') OR (OLD.state='indexed' AND NEW.state='indexing') THEN
  RAISE EXCEPTION 'An accepted source graph cannot move backwards' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
-- The actual original URL digest is separate from fetched-file bytes. Missing
-- historical witnesses are recovery debt, never guessed or backfilled here.
ALTER TABLE import_source_media ADD COLUMN source_key_digest text CHECK (source_key_digest IS NULL OR source_key_digest ~ '^[a-f0-9]{64}$');
--> statement-breakpoint
CREATE FUNCTION freeholder_guard_crawl_media_key_capture() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM import_source_graphs graph WHERE graph.id=NEW.graph_id)
   AND (NEW.source_key_digest IS DISTINCT FROM encode(sha256(convert_to(NEW.key,'UTF8')),'hex')
     OR NEW.key LIKE 'redacted:%') THEN
  RAISE EXCEPTION 'The original HTTP media URL needs its actual first capture digest' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER import_source_media_crawl_key_capture BEFORE INSERT ON import_source_media
 FOR EACH ROW EXECUTE FUNCTION freeholder_guard_crawl_media_key_capture();
--> statement-breakpoint
CREATE FUNCTION freeholder_crawl_media_projection_retired(original_media uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM import_source_media media
   JOIN import_crawl_graphs binding ON binding.graph_id=media.graph_id
   JOIN import_source_graphs graph ON graph.id=binding.graph_id
   JOIN import_crawl_sources source ON source.id=binding.source_id AND source.generation=binding.source_generation
   JOIN import_crawl_erasure_sources member ON member.source_id=source.id AND member.generation=source.generation
   WHERE media.id=original_media AND media.source_key_digest IS NOT NULL
    AND (media.key='redacted:'||media.id::text OR media.source_key_digest=encode(sha256(convert_to(media.key,'UTF8')),'hex'))
    AND media.asset_id IS NULL AND media.digest IS NULL AND media.bytes IS NULL
    AND graph.plan_digest IS NULL AND graph.lease_token IS NULL AND source.lease_token IS NULL
    AND freeholder_crawl_erasure_scope_complete(member.request_id)
    AND freeholder_crawl_projection_retired(source.id,null::uuid)
    AND NOT EXISTS(SELECT 1 FROM import_source_batches batch WHERE batch.graph_id=graph.id))
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION freeholder_guard_import_media_identity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE minimize boolean;
BEGIN
 minimize:=current_setting('freeholder.import_crawl_projection_redaction',true)='v1'
  AND NEW.planned='{"redacted":true}'::jsonb
  AND freeholder_crawl_media_projection_retired(OLD.id);
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.graph_id IS DISTINCT FROM OLD.graph_id
    OR NEW.source_key_digest IS DISTINCT FROM OLD.source_key_digest
    OR (NEW.key IS DISTINCT FROM OLD.key AND NOT coalesce(minimize,false))
    OR (NEW.planned IS DISTINCT FROM OLD.planned AND NOT coalesce(minimize,false))
    OR (OLD.digest IS NOT NULL AND (NEW.digest IS DISTINCT FROM OLD.digest OR NEW.bytes IS DISTINCT FROM OLD.bytes))
    OR (OLD.asset_id IS NOT NULL AND NEW.asset_id IS DISTINCT FROM OLD.asset_id) THEN
  RAISE EXCEPTION 'The original shared media identity and accepted receipt are immutable' USING ERRCODE='23514';
 END IF;
 IF NEW.key IS DISTINCT FROM OLD.key AND NOT (
   OLD.source_key_digest=encode(sha256(convert_to(OLD.key,'UTF8')),'hex') AND NEW.key='redacted:'||OLD.id::text AND NEW.error IS NULL
   AND OLD.asset_id IS NULL AND NEW.asset_id IS NULL AND OLD.digest IS NULL AND NEW.digest IS NULL AND OLD.bytes IS NULL AND NEW.bytes IS NULL
   AND freeholder_crawl_media_projection_retired(OLD.id)
 ) THEN
  RAISE EXCEPTION 'Accepted or unresolved original HTTP file identity needs reviewed recovery before erasure' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION freeholder_require_crawl_erasure_completion() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE artifact jsonb; outcome text; member record; retained boolean;
BEGIN
 -- Unrelated edits to old completed requests never infer or adopt new scope.
 IF NEW.kind<>'erasure' OR NEW.status NOT IN ('completed','partially_completed')
  OR (NEW.status IS NOT DISTINCT FROM OLD.status AND NEW.fulfilled_at IS NOT DISTINCT FROM OLD.fulfilled_at) THEN RETURN NEW; END IF;
 IF NOT freeholder_crawl_erasure_scope_complete(NEW.id) THEN
  RAISE EXCEPTION 'Original HTTP erasure needs its actual complete original capture, including empty' USING ERRCODE='55000';
 END IF;
 SELECT body INTO artifact FROM data_request_artifacts WHERE data_request_id=NEW.id;
 IF artifact->>'format' IS DISTINCT FROM 'freeholder.erasure-receipt' OR jsonb_typeof(artifact->'outcomes') IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'Original HTTP erasure needs its valid original artifact' USING ERRCODE='55000';
 END IF;
 SELECT value->>'outcome' INTO outcome FROM jsonb_array_elements(artifact->'outcomes') WHERE value->>'scope'='imports.crawlOriginals' LIMIT 1;
 IF outcome IS NULL OR outcome NOT IN ('erased','retained') THEN
  RAISE EXCEPTION 'Original HTTP erasure still has incomplete or missing source work' USING ERRCODE='55000';
 END IF;
 FOR member IN SELECT source_id,generation FROM import_crawl_erasure_sources WHERE request_id=NEW.id LOOP
  retained:=outcome='retained' AND NEW.status='partially_completed' AND freeholder_crawl_source_held(member.source_id,member.generation);
  IF NOT retained AND (NOT freeholder_crawl_projection_retired(member.source_id,null::uuid)
    OR EXISTS(SELECT 1 FROM import_crawl_sources source WHERE source.id=member.source_id AND (source.site_url IS NOT NULL OR source.source_url IS NOT NULL OR source.redacted_at IS NULL))
    OR EXISTS(SELECT 1 FROM import_crawl_requests request WHERE request.source_id=member.source_id
      AND (request.url IS NOT NULL OR request.url_digest IS NOT NULL OR request.entry_metadata IS NOT NULL OR request.redacted_at IS NULL))
    OR EXISTS(SELECT 1 FROM import_crawl_sources source JOIN import_runs root ON root.id=source.run_id WHERE source.id=member.source_id
      AND (root.origin IS NOT NULL OR root.checkpoint ? 'origin' OR root.checkpoint ? 'report' OR root.checkpoint ? 'source'))
    OR EXISTS(SELECT 1 FROM import_crawl_graphs binding JOIN import_source_graphs graph ON graph.id=binding.graph_id
      WHERE binding.source_id=member.source_id AND (graph.header_metadata IS DISTINCT FROM '{"format":"http-originals","redacted":true}'::jsonb OR graph.plan_metadata IS DISTINCT FROM '{"redacted":true}'::jsonb))
    OR EXISTS(SELECT 1 FROM import_crawl_entry_originals witness JOIN import_crawl_graphs binding ON binding.graph_id=witness.graph_id JOIN import_source_entries entry ON entry.id=witness.entry_id
      WHERE binding.source_id=member.source_id AND (entry.metadata IS DISTINCT FROM '{"format":"http-originals","redacted":true}'::jsonb OR entry.target_page_id IS NULL AND entry.target_slug IS NOT NULL))
    OR EXISTS(SELECT 1 FROM import_crawl_graphs binding JOIN import_source_media media ON media.graph_id=binding.graph_id
      WHERE binding.source_id=member.source_id AND (media.planned IS DISTINCT FROM '{"redacted":true}'::jsonb
        OR media.source_key_digest IS NULL OR media.key IS DISTINCT FROM 'redacted:'||media.id::text OR media.error IS NOT NULL))
    OR EXISTS(SELECT 1 FROM import_crawl_graphs binding JOIN import_source_batches batch ON batch.graph_id=binding.graph_id JOIN import_runs child ON child.id=batch.child_run_id
      WHERE binding.source_id=member.source_id AND child.status IN ('discover','previewed','mapped','failed')
       AND (child.preview IS DISTINCT FROM '{"sourceFormat":"redacted-http-input"}'::jsonb OR child.checkpoint ? 'pendingBlogPosts'))) THEN
   RAISE EXCEPTION 'Original HTTP bytes or private index projections still await actual retirement' USING ERRCODE='55000';
  END IF;
 END LOOP;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER data_requests_crawl_erasure_completion AFTER UPDATE ON data_requests DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION freeholder_require_crawl_erasure_completion();

-- C1.08/C3.47: uploaded originals need their own first-fulfilment scope.
-- The HTTP collector and physical response identity remain separate.
CREATE TABLE import_source_erasure_scopes (
 request_id uuid PRIMARY KEY REFERENCES data_requests(id) ON DELETE RESTRICT,
 capture_version integer NOT NULL DEFAULT 1 CHECK(capture_version=1),
 source_count integer NOT NULL CHECK(source_count BETWEEN 0 AND 10000),
 object_count integer NOT NULL CHECK(object_count BETWEEN 0 AND 250000),
 captured_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE import_source_erasure_members (
 request_id uuid NOT NULL REFERENCES import_source_erasure_scopes(request_id) ON DELETE RESTRICT,
 run_id uuid NOT NULL REFERENCES import_runs(id) ON DELETE RESTRICT,
 upload_id uuid NOT NULL, chunk_count integer NOT NULL CHECK(chunk_count BETWEEN 1 AND 25),
 graph_id uuid REFERENCES import_source_graphs(id) ON DELETE RESTRICT,
 graph_generation uuid, source_revision text CHECK(source_revision IS NULL OR source_revision ~ '^[a-f0-9]{64}$'),
 CONSTRAINT import_source_erasure_members_pk PRIMARY KEY(request_id,run_id,upload_id),
 CONSTRAINT import_source_erasure_members_graph_witness CHECK((graph_id IS NULL)=(graph_generation IS NULL) AND (graph_id IS NULL)=(source_revision IS NULL))
);
--> statement-breakpoint
CREATE INDEX import_source_erasure_members_graph_idx ON import_source_erasure_members(graph_id,request_id);
--> statement-breakpoint
CREATE TABLE import_source_erasure_objects (
 request_id uuid NOT NULL, run_id uuid NOT NULL, upload_id uuid NOT NULL,
 chunk_index integer NOT NULL CHECK(chunk_index BETWEEN 0 AND 24),
 key_digest text NOT NULL CHECK(key_digest ~ '^[a-f0-9]{64}$'),
 CONSTRAINT import_source_erasure_objects_pk PRIMARY KEY(request_id,run_id,upload_id,chunk_index),
 CONSTRAINT import_source_erasure_objects_member_fk FOREIGN KEY(request_id,run_id,upload_id)
  REFERENCES import_source_erasure_members(request_id,run_id,upload_id) ON DELETE RESTRICT,
 CONSTRAINT import_source_erasure_objects_key_binding CHECK(key_digest=encode(sha256(convert_to('imports/'||run_id::text||'/'||upload_id::text||'/'||lpad(chunk_index::text,5,'0')||'.part','UTF8')),'hex'))
);
--> statement-breakpoint
CREATE INDEX import_source_erasure_objects_digest_idx ON import_source_erasure_objects(key_digest,request_id);
--> statement-breakpoint
CREATE FUNCTION freeholder_source_erasure_expected_objects() RETURNS TABLE(run_id uuid,upload_id uuid,chunk_index integer) LANGUAGE sql STABLE AS $$
 WITH expected AS (
 SELECT split_part(key,'/',2)::uuid run_id,split_part(key,'/',3)::uuid upload_id,split_part(split_part(key,'/',4),'.',1)::integer chunk_index
 FROM media_objects WHERE key ~ '^imports/[a-f0-9-]{36}/[a-f0-9-]{36}/[0-9]{5}\.part$'
 UNION
 SELECT root.id,(root.checkpoint->'retainedSource'->>'uploadId')::uuid,part.index
 FROM import_runs root CROSS JOIN LATERAL generate_series(0,CASE WHEN jsonb_typeof(root.checkpoint->'retainedSource'->'chunkDigests')='array' THEN jsonb_array_length(root.checkpoint->'retainedSource'->'chunkDigests')-1 ELSE -1 END) part(index)
 WHERE root.checkpoint->'retainedSource'->>'uploadId' ~ '^[a-f0-9-]{36}$'
 UNION
 SELECT root.id,(root.checkpoint->'sourceUpload'->>'uploadId')::uuid,part.index
 FROM import_runs root CROSS JOIN LATERAL generate_series(0,CASE
  WHEN root.checkpoint->'sourceUpload'->>'bytes' ~ '^[0-9]{1,9}$' AND root.checkpoint->'sourceUpload'->>'chunkBytes' ~ '^[0-9]{1,9}$'
  THEN ceil((root.checkpoint->'sourceUpload'->>'bytes')::numeric/nullif((root.checkpoint->'sourceUpload'->>'chunkBytes')::numeric,0))::integer-1 ELSE -1 END) part(index)
 WHERE root.checkpoint->'sourceUpload'->>'uploadId' ~ '^[a-f0-9-]{36}$')
 SELECT DISTINCT expected.run_id,expected.upload_id,expected.chunk_index FROM expected
$$;
--> statement-breakpoint
CREATE FUNCTION freeholder_guard_source_erasure_capture() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Original uploaded-source membership cannot be rewritten or removed' USING ERRCODE='55000'; END IF;
 IF current_setting('freeholder.import_source_erasure_request',true) IS DISTINCT FROM NEW.request_id::text
  OR NOT EXISTS(SELECT 1 FROM data_requests request WHERE request.id=NEW.request_id AND request.kind='erasure' AND request.status='verified')
  OR EXISTS(SELECT 1 FROM data_request_artifacts WHERE data_request_id=NEW.request_id)
  OR EXISTS(SELECT 1 FROM audit_log WHERE action='contacts.fulfillDataRequest' AND subject_type='dataRequest' AND subject_id=NEW.request_id::text) THEN
  RAISE EXCEPTION 'Original uploaded-source scope needs its actual first verified fulfilment transaction' USING ERRCODE='55000';
 END IF;
 IF TG_TABLE_NAME='import_source_erasure_members' THEN
 IF NEW.graph_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM import_source_graphs graph JOIN import_runs root ON root.id=graph.run_id
  WHERE graph.id=NEW.graph_id AND graph.run_id=NEW.run_id AND graph.generation=NEW.graph_generation AND graph.source_revision=NEW.source_revision
   AND root.checkpoint->'retainedSource'->>'uploadId'=NEW.upload_id::text
   AND root.checkpoint->'retainedSource'->>'revision'=NEW.source_revision
   AND NOT EXISTS(SELECT 1 FROM import_crawl_graphs http WHERE http.graph_id=graph.id)) THEN
  RAISE EXCEPTION 'Original uploaded graph must match its actual upload, revision and generation' USING ERRCODE='55000';
 END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER import_source_erasure_scopes_capture BEFORE INSERT OR UPDATE OR DELETE ON import_source_erasure_scopes FOR EACH ROW EXECUTE FUNCTION freeholder_guard_source_erasure_capture();
--> statement-breakpoint
CREATE TRIGGER import_source_erasure_members_capture BEFORE INSERT OR UPDATE OR DELETE ON import_source_erasure_members FOR EACH ROW EXECUTE FUNCTION freeholder_guard_source_erasure_capture();
--> statement-breakpoint
CREATE TRIGGER import_source_erasure_objects_capture BEFORE INSERT OR UPDATE OR DELETE ON import_source_erasure_objects FOR EACH ROW EXECUTE FUNCTION freeholder_guard_source_erasure_capture();
--> statement-breakpoint
CREATE FUNCTION freeholder_source_erasure_scope_complete(original_request uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM import_source_erasure_scopes header WHERE header.request_id=original_request AND header.capture_version=1
  AND header.source_count=(SELECT count(*) FROM import_source_erasure_members member WHERE member.request_id=header.request_id)
  AND header.object_count=(SELECT count(*) FROM import_source_erasure_objects original WHERE original.request_id=header.request_id)
  AND NOT EXISTS(SELECT 1 FROM import_source_erasure_members member WHERE member.request_id=header.request_id
   AND member.chunk_count<>(SELECT count(*) FROM import_source_erasure_objects original
    WHERE original.request_id=member.request_id AND original.run_id=member.run_id AND original.upload_id=member.upload_id)))
$$;
--> statement-breakpoint
CREATE FUNCTION freeholder_require_source_erasure_capture() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT freeholder_source_erasure_scope_complete(NEW.request_id)
  OR EXISTS(SELECT run_id,upload_id,chunk_index FROM freeholder_source_erasure_expected_objects()
   EXCEPT SELECT run_id,upload_id,chunk_index FROM import_source_erasure_objects WHERE request_id=NEW.request_id)
  OR EXISTS(SELECT run_id,upload_id,chunk_index FROM import_source_erasure_objects WHERE request_id=NEW.request_id
   EXCEPT SELECT run_id,upload_id,chunk_index FROM freeholder_source_erasure_expected_objects()) THEN
  RAISE EXCEPTION 'Original uploaded scope must include exactly its actual original objects, including known empty' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER import_source_erasure_scopes_complete AFTER INSERT ON import_source_erasure_scopes DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION freeholder_require_source_erasure_capture();
--> statement-breakpoint
CREATE FUNCTION freeholder_source_upload_held(original_run uuid,original_upload uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM privacy_retention_exceptions hold
  LEFT JOIN privacy_retention_source_snapshots snapshot ON snapshot.exception_id=hold.id AND snapshot.source_scope='imports.readerSources'
  WHERE hold.scope IN ('imports.readerSources','cms.readerComments') AND (hold.expires_at IS NULL OR hold.expires_at>clock_timestamp())
  AND (snapshot.exception_id IS NULL OR snapshot.capture_version<>1 OR snapshot.member_count<>(SELECT count(*) FROM privacy_retention_source_members m WHERE m.exception_id=hold.id AND m.source_scope='imports.readerSources')
   OR EXISTS(SELECT 1 FROM privacy_retention_source_members member WHERE member.exception_id=hold.id AND member.source_scope='imports.readerSources' AND member.source_id=original_run AND member.generation=original_upload)))
$$;
--> statement-breakpoint
CREATE FUNCTION freeholder_source_graph_projection_retired(original_graph uuid,original_request uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM import_source_erasure_members member JOIN import_source_graphs graph ON graph.id=member.graph_id JOIN import_runs root ON root.id=member.run_id
  WHERE member.request_id=original_request AND member.graph_id=original_graph AND graph.run_id=member.run_id AND graph.generation=member.graph_generation AND graph.source_revision=member.source_revision
   AND root.checkpoint->'retainedSource'->>'uploadId'=member.upload_id::text AND root.checkpoint->'retainedSource'->>'revision'=member.source_revision
   AND freeholder_source_erasure_scope_complete(member.request_id) AND graph.state='invalidated' AND graph.plan_digest IS NULL AND graph.lease_token IS NULL
   AND NOT freeholder_source_upload_held(member.run_id,member.upload_id)
   AND NOT EXISTS(SELECT 1 FROM import_source_batches batch WHERE batch.graph_id=graph.id)
   AND NOT EXISTS(SELECT 1 FROM import_source_entries entry WHERE entry.graph_id=graph.id AND entry.target_page_id IS NOT NULL)
   AND NOT EXISTS(SELECT 1 FROM import_source_media media WHERE media.graph_id=graph.id AND (media.asset_id IS NOT NULL OR media.digest IS NOT NULL OR media.bytes IS NOT NULL OR media.source_key_digest IS NULL))
   AND NOT EXISTS(SELECT 1 FROM import_source_erasure_objects original WHERE original.request_id=member.request_id AND original.run_id=member.run_id AND original.upload_id=member.upload_id
    AND (EXISTS(SELECT 1 FROM media_objects reservation WHERE encode(sha256(convert_to(reservation.key,'UTF8')),'hex')=original.key_digest)
      OR EXISTS(SELECT 1 FROM media_object_writes physical WHERE physical.key_digest=original.key_digest AND (physical.state IN ('unverified','started','unknown') OR physical.operation_kind='put' AND physical.deleted_at IS NULL)))))
$$;
--> statement-breakpoint
CREATE FUNCTION freeholder_refuse_erased_source_graph_admission() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM import_source_erasure_members original JOIN import_runs root ON root.id=original.run_id
  WHERE original.run_id=NEW.run_id AND root.checkpoint->'sourceUpload'->>'uploadId'=original.upload_id::text
   AND NOT freeholder_source_upload_held(original.run_id,original.upload_id)) THEN
  RAISE EXCEPTION 'This original upload entered erasure and cannot create another private index' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER import_source_graphs_erasure_admission BEFORE INSERT ON import_source_graphs FOR EACH ROW EXECUTE FUNCTION freeholder_refuse_erased_source_graph_admission();

--> statement-breakpoint
CREATE FUNCTION freeholder_source_task_objects_retired(original_request uuid,original_keys jsonb) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT freeholder_source_erasure_scope_complete(original_request) AND jsonb_typeof(original_keys)='array' AND jsonb_array_length(original_keys)>0
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(original_keys) requested(key)
   WHERE NOT EXISTS(SELECT 1 FROM import_source_erasure_objects original WHERE original.request_id=original_request
     AND original.key_digest=encode(sha256(convert_to(requested.key,'UTF8')),'hex')
     AND requested.key='imports/'||original.run_id::text||'/'||original.upload_id::text||'/'||lpad(original.chunk_index::text,5,'0')||'.part'
     AND NOT freeholder_source_upload_held(original.run_id,original.upload_id))
    OR EXISTS(SELECT 1 FROM media_objects reservation WHERE reservation.key=requested.key)
    OR EXISTS(SELECT 1 FROM media_object_writes physical WHERE physical.key_digest=encode(sha256(convert_to(requested.key,'UTF8')),'hex')
       AND (physical.state IN ('unverified','started','unknown') OR physical.operation_kind='put' AND physical.deleted_at IS NULL)))
$$;
--> statement-breakpoint
CREATE FUNCTION freeholder_source_upload_exactly_held(original_run uuid,original_upload uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM privacy_retention_source_members member
  JOIN privacy_retention_source_snapshots snapshot ON snapshot.exception_id=member.exception_id AND snapshot.source_scope=member.source_scope
  JOIN privacy_retention_exceptions hold ON hold.id=member.exception_id
  WHERE member.source_scope='imports.readerSources' AND member.source_id=original_run AND member.generation=original_upload
    AND hold.scope IN ('imports.readerSources','cms.readerComments') AND (hold.expires_at IS NULL OR hold.expires_at>clock_timestamp())
    AND snapshot.capture_version=1 AND snapshot.member_count=(SELECT count(*) FROM privacy_retention_source_members counted WHERE counted.exception_id=snapshot.exception_id AND counted.source_scope=snapshot.source_scope))
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION freeholder_guard_import_entry_identity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE minimize boolean; uploaded boolean;
BEGIN
 minimize:=current_setting('freeholder.import_crawl_projection_redaction',true)='v1'
  AND NEW.metadata='{"format":"http-originals","redacted":true}'::jsonb
  AND EXISTS(SELECT 1 FROM import_crawl_entry_originals witness JOIN import_crawl_graphs binding ON binding.graph_id=witness.graph_id
    WHERE witness.entry_id=OLD.id AND witness.graph_id=OLD.graph_id AND freeholder_crawl_projection_retired(binding.source_id,witness.response_id));
 uploaded:=current_setting('freeholder.import_source_projection_redaction',true) IS NOT NULL
   AND NEW.metadata='{"format":"uploaded-originals","redacted":true}'::jsonb
   AND NEW.target_slug IS NULL AND OLD.target_page_id IS NULL AND NEW.target_page_id IS NULL
   AND freeholder_source_graph_projection_retired(OLD.graph_id,nullif(current_setting('freeholder.import_source_projection_redaction',true),'')::uuid);
 minimize:=coalesce(minimize,false) OR coalesce(uploaded,false);
 IF NEW.graph_id IS DISTINCT FROM OLD.graph_id OR NEW.ordinal IS DISTINCT FROM OLD.ordinal
    OR NEW.source_identity IS DISTINCT FROM OLD.source_identity OR NEW.kind IS DISTINCT FROM OLD.kind
    OR NEW.start_byte IS DISTINCT FROM OLD.start_byte OR NEW.end_byte IS DISTINCT FROM OLD.end_byte
    OR NEW.digest IS DISTINCT FROM OLD.digest OR NEW.body_bytes IS DISTINCT FROM OLD.body_bytes
    OR (NEW.metadata IS DISTINCT FROM OLD.metadata AND NOT coalesce(minimize,false)) THEN
  RAISE EXCEPTION 'The original indexed entry identity is immutable' USING ERRCODE='23514';
 END IF;
 IF (NEW.target_slug IS DISTINCT FROM OLD.target_slug OR NEW.resolution IS DISTINCT FROM OLD.resolution)
    AND EXISTS(SELECT 1 FROM import_source_graphs WHERE id=OLD.graph_id AND plan_digest IS NOT NULL)
    AND NOT (coalesce(minimize,false) AND OLD.target_page_id IS NULL AND NEW.target_page_id IS NULL
      AND NEW.target_slug IS NULL AND NEW.resolution IS NOT DISTINCT FROM OLD.resolution) THEN
  RAISE EXCEPTION 'The accepted import plan is frozen' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION freeholder_guard_import_graph_identity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE minimize boolean; uploaded boolean;
BEGIN
 minimize:=current_setting('freeholder.import_crawl_projection_redaction',true)='v1'
  AND NEW.state='invalidated' AND NEW.header_metadata='{"format":"http-originals","redacted":true}'::jsonb
  AND NEW.plan_metadata='{"redacted":true}'::jsonb
  AND EXISTS(SELECT 1 FROM import_crawl_graphs binding WHERE binding.graph_id=OLD.id AND freeholder_crawl_projection_retired(binding.source_id,null::uuid));
 uploaded:=current_setting('freeholder.import_source_projection_redaction',true) IS NOT NULL
   AND NEW.state='invalidated' AND NEW.header_metadata='{"format":"uploaded-originals","redacted":true}'::jsonb
   AND NEW.plan_metadata='{"redacted":true}'::jsonb AND NEW.cursor IS NOT DISTINCT FROM OLD.cursor
   AND freeholder_source_graph_projection_retired(OLD.id,nullif(current_setting('freeholder.import_source_projection_redaction',true),'')::uuid);
 minimize:=coalesce(minimize,false) OR coalesce(uploaded,false);
 IF NEW.run_id IS DISTINCT FROM OLD.run_id OR NEW.generation IS DISTINCT FROM OLD.generation
    OR NEW.source_revision IS DISTINCT FROM OLD.source_revision OR NEW.parser_version IS DISTINCT FROM OLD.parser_version
    OR NEW.source_started_at IS DISTINCT FROM OLD.source_started_at OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR (OLD.header_metadata<>'{}'::jsonb AND NEW.header_metadata IS DISTINCT FROM OLD.header_metadata AND NOT coalesce(minimize,false))
    OR (OLD.plan_metadata IS NOT NULL AND NEW.plan_metadata IS DISTINCT FROM OLD.plan_metadata AND NOT coalesce(minimize,false))
    OR (OLD.plan_digest IS NOT NULL AND (NEW.plan_digest IS DISTINCT FROM OLD.plan_digest OR NEW.plan_revision IS DISTINCT FROM OLD.plan_revision)) THEN
  RAISE EXCEPTION 'The original source graph identity is immutable' USING ERRCODE='23514';
 END IF;
 IF (NEW.cursor->>'ordinal')::integer<(OLD.cursor->>'ordinal')::integer
    OR NEW.commit_ordinal<OLD.commit_ordinal OR NEW.batch_counter<OLD.batch_counter
    OR (OLD.state='invalidated' AND NEW.state<>'invalidated') OR (OLD.state='indexed' AND NEW.state='indexing') THEN
  RAISE EXCEPTION 'An accepted source graph cannot move backwards' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION freeholder_guard_import_media_identity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE minimize boolean; uploaded boolean;
BEGIN
 minimize:=current_setting('freeholder.import_crawl_projection_redaction',true)='v1'
  AND NEW.planned='{"redacted":true}'::jsonb
  AND freeholder_crawl_media_projection_retired(OLD.id);
 uploaded:=current_setting('freeholder.import_source_projection_redaction',true) IS NOT NULL
   AND NEW.planned='{"redacted":true}'::jsonb AND NEW.error IS NULL
   AND freeholder_source_graph_projection_retired(OLD.graph_id,nullif(current_setting('freeholder.import_source_projection_redaction',true),'')::uuid);
 minimize:=coalesce(minimize,false) OR coalesce(uploaded,false);
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.graph_id IS DISTINCT FROM OLD.graph_id
    OR NEW.source_key_digest IS DISTINCT FROM OLD.source_key_digest
    OR (NEW.key IS DISTINCT FROM OLD.key AND NOT coalesce(minimize,false))
    OR (NEW.planned IS DISTINCT FROM OLD.planned AND NOT coalesce(minimize,false))
    OR (OLD.digest IS NOT NULL AND (NEW.digest IS DISTINCT FROM OLD.digest OR NEW.bytes IS DISTINCT FROM OLD.bytes))
    OR (OLD.asset_id IS NOT NULL AND NEW.asset_id IS DISTINCT FROM OLD.asset_id) THEN
  RAISE EXCEPTION 'The original shared media identity and accepted receipt are immutable' USING ERRCODE='23514';
 END IF;
 IF NEW.key IS DISTINCT FROM OLD.key AND NOT (
   OLD.source_key_digest=encode(sha256(convert_to(OLD.key,'UTF8')),'hex') AND NEW.key='redacted:'||OLD.id::text AND NEW.error IS NULL
   AND OLD.asset_id IS NULL AND NEW.asset_id IS NULL AND OLD.digest IS NULL AND NEW.digest IS NULL AND OLD.bytes IS NULL AND NEW.bytes IS NULL
   AND (freeholder_crawl_media_projection_retired(OLD.id) OR coalesce(uploaded,false))
 ) THEN
  RAISE EXCEPTION 'Accepted or unresolved original HTTP file identity needs reviewed recovery before erasure' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION freeholder_require_source_erasure_completion() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE artifact jsonb; outcome text; original record; keys jsonb; retained boolean;
BEGIN
 IF NEW.kind<>'erasure' OR NEW.status NOT IN ('completed','partially_completed')
   OR (NEW.status IS NOT DISTINCT FROM OLD.status AND NEW.fulfilled_at IS NOT DISTINCT FROM OLD.fulfilled_at) THEN RETURN NEW; END IF;
 IF NOT freeholder_source_erasure_scope_complete(NEW.id) THEN
  RAISE EXCEPTION 'Uploaded-source completion needs its actual initial complete scope, including known empty' USING ERRCODE='55000';
 END IF;
 SELECT body INTO artifact FROM data_request_artifacts WHERE data_request_id=NEW.id;
 IF artifact->>'format' IS DISTINCT FROM 'freeholder.erasure-receipt' OR jsonb_typeof(artifact->'outcomes') IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'Uploaded-source completion needs its valid original receipt' USING ERRCODE='55000';
 END IF;
 SELECT value->>'outcome' INTO outcome FROM jsonb_array_elements(artifact->'outcomes') WHERE value->>'scope'='imports.readerSources' LIMIT 1;
 IF outcome IS NULL OR outcome NOT IN ('erased','retained') THEN
  RAISE EXCEPTION 'Uploaded-source work remains pending or missing' USING ERRCODE='55000';
 END IF;
 FOR original IN SELECT * FROM import_source_erasure_members WHERE request_id=NEW.id LOOP
  retained:=outcome='retained' AND NEW.status='partially_completed' AND freeholder_source_upload_exactly_held(original.run_id,original.upload_id);
  IF retained THEN CONTINUE; END IF;
  SELECT jsonb_agg('imports/'||run_id::text||'/'||upload_id::text||'/'||lpad(chunk_index::text,5,'0')||'.part' ORDER BY chunk_index) INTO keys
   FROM import_source_erasure_objects WHERE request_id=NEW.id AND run_id=original.run_id AND upload_id=original.upload_id;
  IF NOT freeholder_source_task_objects_retired(NEW.id,keys) THEN
   RAISE EXCEPTION 'Original uploaded bytes, ownership or physical facts still await retirement' USING ERRCODE='55000';
  END IF;
  IF original.graph_id IS NOT NULL AND (
     NOT freeholder_source_graph_projection_retired(original.graph_id,NEW.id)
     OR EXISTS(SELECT 1 FROM import_source_graphs graph WHERE graph.id=original.graph_id
       AND (graph.header_metadata IS DISTINCT FROM '{"format":"uploaded-originals","redacted":true}'::jsonb OR graph.plan_metadata IS DISTINCT FROM '{"redacted":true}'::jsonb))
     OR EXISTS(SELECT 1 FROM import_source_entries entry WHERE entry.graph_id=original.graph_id
       AND (entry.metadata IS DISTINCT FROM '{"format":"uploaded-originals","redacted":true}'::jsonb OR entry.target_slug IS NOT NULL))
     OR EXISTS(SELECT 1 FROM import_source_media media WHERE media.graph_id=original.graph_id
       AND (media.planned IS DISTINCT FROM '{"redacted":true}'::jsonb OR media.key IS DISTINCT FROM 'redacted:'||media.id::text OR media.error IS NOT NULL))
     OR EXISTS(SELECT 1 FROM import_runs root WHERE root.id=original.run_id
       AND (root.origin IS NOT NULL OR root.preview IS DISTINCT FROM '{"sourceFormat":"redacted-uploaded-input"}'::jsonb
         OR root.checkpoint ?| ARRAY['readerSourceSite','origin','report','source','pendingBlogPosts']))) THEN
   RAISE EXCEPTION 'Private uploaded index projections still require original-scope minimization' USING ERRCODE='55000';
  END IF;
  IF original.graph_id IS NULL AND EXISTS(SELECT 1 FROM import_source_graphs graph JOIN import_runs root ON root.id=graph.run_id
    WHERE graph.run_id=original.run_id AND (root.checkpoint->'retainedSource'->>'uploadId' IS NULL OR root.checkpoint->'retainedSource'->>'uploadId'=original.upload_id::text)) THEN
   RAISE EXCEPTION 'A missing original graph witness needs review, not adoption of a current graph' USING ERRCODE='55000';
  END IF;
 END LOOP;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER data_requests_uploaded_source_erasure_completion AFTER UPDATE ON data_requests DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION freeholder_require_source_erasure_completion();
