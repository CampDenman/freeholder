-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
-- C1.08/C3.47/C11.14: a NEW verified request may reuse only a proven
-- immutable retained original scope after actual physical retirement.
CREATE FUNCTION freeholder_source_receipt_canonical(value jsonb) RETURNS text LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE result text;
BEGIN
 CASE jsonb_typeof(value)
 WHEN 'object' THEN
  SELECT '{'||coalesce(string_agg(to_jsonb(key)::text||':'||freeholder_source_receipt_canonical(item),',' ORDER BY key COLLATE "C"),'')||'}'
   INTO result FROM jsonb_each(value) entry(key,item);
 WHEN 'array' THEN
  SELECT '['||coalesce(string_agg(freeholder_source_receipt_canonical(item),',' ORDER BY ordinal),'')||']'
   INTO result FROM jsonb_array_elements(value) WITH ORDINALITY entry(item,ordinal);
 ELSE result:=value::text;
 END CASE;
 RETURN result;
END $$;
--> statement-breakpoint
CREATE FUNCTION freeholder_source_erasure_prior_members(next_request uuid)
RETURNS TABLE(prior_request_id uuid,run_id uuid,upload_id uuid,chunk_count integer,graph_id uuid,graph_generation uuid,source_revision text)
LANGUAGE sql STABLE AS $$
 SELECT old.id,member.run_id,member.upload_id,member.chunk_count,member.graph_id,member.graph_generation,member.source_revision
 FROM data_requests fresh JOIN data_requests old ON old.contact_id=fresh.contact_id AND old.id<>fresh.id
 JOIN data_request_artifacts artifact ON artifact.data_request_id=old.id
 JOIN import_source_erasure_members member ON member.request_id=old.id
 WHERE fresh.id=next_request AND fresh.kind='erasure' AND fresh.verified_at IS NOT NULL
  AND old.kind='erasure' AND old.status='partially_completed' AND old.verified_at IS NOT NULL AND old.fulfilled_at IS NOT NULL
  AND artifact.body->>'format'='freeholder.erasure-receipt' AND artifact.body->>'requestId'=old.id::text
  AND artifact.body->>'contactId'=old.contact_id::text
  AND artifact.sha256=encode(sha256(convert_to(freeholder_source_receipt_canonical(artifact.body),'UTF8')),'hex')
  AND EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(artifact.body->'outcomes')='array' THEN artifact.body->'outcomes' ELSE '[]'::jsonb END) outcome
   WHERE outcome->>'scope'='imports.readerSources' AND outcome->>'outcome'='retained'
    AND coalesce(outcome->'pendingJobs','[]'::jsonb)='[]'::jsonb)
  AND EXISTS(SELECT 1 FROM audit_log WHERE action='contacts.fulfillDataRequest' AND subject_type='dataRequest' AND subject_id=old.id::text)
  AND member.graph_id IS NOT NULL AND freeholder_source_erasure_scope_complete(old.id)
  AND freeholder_source_graph_projection_retired(member.graph_id,old.id)
  AND NOT EXISTS(SELECT 1 FROM import_crawl_graphs http WHERE http.graph_id=member.graph_id)
  AND NOT EXISTS(SELECT 1 FROM import_source_erasure_objects original WHERE original.request_id=old.id AND original.run_id=member.run_id AND original.upload_id=member.upload_id
   AND (original.chunk_index>=member.chunk_count OR NOT EXISTS(
    SELECT 1 FROM media_object_writes put WHERE put.object_key='imports/'||original.run_id::text||'/'||original.upload_id::text||'/'||lpad(original.chunk_index::text,5,'0')||'.part'
     AND put.operation_kind='put' AND put.state='accepted' AND put.deleted_at IS NOT NULL
     AND put.sha256 ~ '^[a-f0-9]{64}$' AND put.bytes>0 AND put.storage_namespace ~ '^[a-f0-9]{64}$'
     AND EXISTS(SELECT 1 FROM media_object_writes deletion WHERE deletion.object_key=put.object_key
      AND deletion.key_digest=put.key_digest AND deletion.operation_kind='delete' AND deletion.state='accepted' AND deletion.deleted_at IS NOT NULL
      AND deletion.storage_namespace=put.storage_namespace AND deletion.storage_kind=put.storage_kind AND deletion.storage_location=put.storage_location
      AND deletion.sha256=put.sha256 AND deletion.bytes=put.bytes))))
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION freeholder_guard_source_erasure_capture() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Original uploaded-source membership cannot be rewritten or removed' USING ERRCODE='55000'; END IF;
 IF current_setting('freeholder.import_source_erasure_request',true) IS DISTINCT FROM NEW.request_id::text
  OR NOT EXISTS(SELECT 1 FROM data_requests request WHERE request.id=NEW.request_id AND request.kind='erasure' AND request.status='verified' AND request.verified_at IS NOT NULL)
  OR EXISTS(SELECT 1 FROM data_request_artifacts WHERE data_request_id=NEW.request_id)
  OR EXISTS(SELECT 1 FROM audit_log WHERE action='contacts.fulfillDataRequest' AND subject_type='dataRequest' AND subject_id=NEW.request_id::text) THEN
  RAISE EXCEPTION 'Original uploaded-source scope needs its actual first verified fulfilment transaction' USING ERRCODE='55000';
 END IF;
 IF TG_TABLE_NAME='import_source_erasure_members' THEN
 IF NEW.graph_id IS NULL AND EXISTS(SELECT 1 FROM import_source_graphs graph WHERE graph.run_id=NEW.run_id
   AND NOT EXISTS(SELECT 1 FROM import_crawl_graphs http WHERE http.graph_id=graph.id)) THEN
  RAISE EXCEPTION 'An actual uploaded graph requires its exact original graph witness' USING ERRCODE='55000';
 END IF;
 IF NEW.graph_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM import_source_graphs graph JOIN import_runs root ON root.id=graph.run_id
  WHERE graph.id=NEW.graph_id AND graph.run_id=NEW.run_id AND graph.generation=NEW.graph_generation AND graph.source_revision=NEW.source_revision
   AND NOT EXISTS(SELECT 1 FROM import_crawl_graphs http WHERE http.graph_id=graph.id)
   AND ((root.checkpoint->'retainedSource'->>'uploadId'=NEW.upload_id::text AND root.checkpoint->'retainedSource'->>'revision'=NEW.source_revision)
    OR EXISTS(SELECT 1 FROM freeholder_source_erasure_prior_members(NEW.request_id) prior
      WHERE prior.run_id=NEW.run_id AND prior.upload_id=NEW.upload_id AND prior.chunk_count=NEW.chunk_count
       AND prior.graph_id=NEW.graph_id AND prior.graph_generation=NEW.graph_generation AND prior.source_revision=NEW.source_revision))) THEN
  RAISE EXCEPTION 'Original uploaded graph must match its actual upload, revision and generation or proven retained original capture' USING ERRCODE='55000';
 END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION freeholder_require_source_erasure_capture() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT freeholder_source_erasure_scope_complete(NEW.request_id)
  OR EXISTS(WITH expected AS (
    SELECT run_id,upload_id,chunk_index FROM freeholder_source_erasure_expected_objects()
    UNION SELECT original.run_id,original.upload_id,original.chunk_index
     FROM freeholder_source_erasure_prior_members(NEW.request_id) prior JOIN import_source_erasure_objects original
      ON original.request_id=prior.prior_request_id AND original.run_id=prior.run_id AND original.upload_id=prior.upload_id)
   SELECT run_id,upload_id,chunk_index FROM expected
   EXCEPT SELECT run_id,upload_id,chunk_index FROM import_source_erasure_objects WHERE request_id=NEW.request_id)
  OR EXISTS(SELECT run_id,upload_id,chunk_index FROM import_source_erasure_objects WHERE request_id=NEW.request_id
   EXCEPT (SELECT run_id,upload_id,chunk_index FROM freeholder_source_erasure_expected_objects()
    UNION SELECT original.run_id,original.upload_id,original.chunk_index
     FROM freeholder_source_erasure_prior_members(NEW.request_id) prior JOIN import_source_erasure_objects original
      ON original.request_id=prior.prior_request_id AND original.run_id=prior.run_id AND original.upload_id=prior.upload_id)) THEN
  RAISE EXCEPTION 'Original uploaded scope must include exactly current originals and proven physically retired retained originals' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
