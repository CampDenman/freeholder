-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- UNAPPLIED OWNED TAIL. Root must assemble the final contiguous migration/journal.
-- freeholder:schema-breaking Verified physical lineage requires a new writer. Stop/drain original writers; rollback with matching DB, private configuration and object snapshots, respecting every acknowledged erasure.
-- C1.12/C11.08: no history/birth/provider outcome is inferred by this migration.
ALTER TABLE media_object_writes ADD COLUMN writer_runtime_id uuid, ADD COLUMN writer_finished_at timestamptz;
--> statement-breakpoint
ALTER TABLE media_multipart_operations ADD COLUMN writer_runtime_id uuid, ADD COLUMN writer_finished_at timestamptz;
--> statement-breakpoint
CREATE TABLE media_storage_writer_drains (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),namespace text NOT NULL,state text NOT NULL,source_revision text NOT NULL,executor_identity text NOT NULL,
 original_processes jsonb NOT NULL DEFAULT '{}',stop_proof_digest text,verified_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT media_storage_writer_drains_namespace CHECK(namespace ~ '^[a-f0-9]{64}$'),
 CONSTRAINT media_storage_writer_drains_state CHECK(state IN ('capturing','captured','verified')),
 CONSTRAINT media_storage_writer_drains_proof CHECK(state<>'verified' OR (verified_at IS NOT NULL AND stop_proof_digest ~ '^[a-f0-9]{64}$'))
);
--> statement-breakpoint
CREATE INDEX media_storage_writer_drains_namespace_idx ON media_storage_writer_drains(namespace,state);
--> statement-breakpoint
CREATE TABLE media_storage_transfer_plans (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),request_key uuid NOT NULL,original_source jsonb NOT NULL,original_target jsonb NOT NULL,
 source_namespace text NOT NULL,target_namespace text NOT NULL,manifest_digest text NOT NULL,source_stop_evidence_digest text NOT NULL,
 source_drain_id uuid,inventory_count bigint NOT NULL,inventory_bytes bigint NOT NULL,adopted_at timestamptz,state text NOT NULL DEFAULT 'planned',created_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT media_storage_transfer_plans_namespaces CHECK(source_namespace ~ '^[a-f0-9]{64}$' AND target_namespace ~ '^[a-f0-9]{64}$' AND source_namespace<>target_namespace),
 CONSTRAINT media_storage_transfer_plans_digests CHECK(manifest_digest ~ '^[a-f0-9]{64}$' AND source_stop_evidence_digest ~ '^[a-f0-9]{64}$'),
 CONSTRAINT media_storage_transfer_plans_state CHECK(state IN ('planned','copying','unknown','verified','adopted','cleanup_pending','complete','blocked','cancelled')),
 CONSTRAINT media_storage_transfer_plans_bindings CHECK((jsonb_typeof(original_source)='object' AND original_source->>'namespace'=source_namespace AND original_source->>'kind' IN ('s3','replit') AND jsonb_typeof(original_target)='object' AND original_target->>'namespace'=target_namespace AND original_target->>'kind' IN ('s3','replit')) IS TRUE)
);
--> statement-breakpoint
CREATE UNIQUE INDEX media_storage_transfer_plans_request_idx ON media_storage_transfer_plans(request_key);
--> statement-breakpoint
CREATE INDEX media_storage_transfer_plans_source_idx ON media_storage_transfer_plans(source_namespace,state);
--> statement-breakpoint
CREATE TABLE media_storage_transfer_objects (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),plan_id uuid NOT NULL REFERENCES media_storage_transfer_plans(id) ON DELETE RESTRICT,
 object_key text NOT NULL,key_digest text NOT NULL,target_object_key text NOT NULL,target_key_digest text NOT NULL,
 sha256 text NOT NULL,bytes bigint NOT NULL,content_type text NOT NULL,original_receipt_set_digest text NOT NULL,
 source_revision jsonb,target_revision jsonb,source_read_caller_id uuid,target_verify_caller_id uuid,state text NOT NULL DEFAULT 'planned',
 target_receipt_id uuid REFERENCES media_object_writes(id) ON DELETE RESTRICT,source_delete_receipt_id uuid REFERENCES media_object_writes(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT media_storage_transfer_objects_digests CHECK(key_digest ~ '^[a-f0-9]{64}$' AND target_key_digest ~ '^[a-f0-9]{64}$' AND target_key_digest<>key_digest AND sha256 ~ '^[a-f0-9]{64}$' AND original_receipt_set_digest ~ '^[a-f0-9]{64}$'),
 CONSTRAINT media_storage_transfer_objects_size CHECK(bytes>=0 AND bytes<=9007199254740991),
 CONSTRAINT media_storage_transfer_objects_key CHECK(length(object_key) BETWEEN 1 AND 2048 AND length(target_object_key) BETWEEN 1 AND 2048 AND target_object_key<>object_key AND length(content_type) BETWEEN 1 AND 255),
 CONSTRAINT media_storage_transfer_objects_state CHECK(state IN ('planned','copying','unknown','verified','adopted','cleanup_pending','complete','blocked','cancelled')),
 CONSTRAINT media_storage_transfer_objects_adoption_receipt CHECK(state NOT IN ('adopted','cleanup_pending','complete') OR target_receipt_id IS NOT NULL),
 CONSTRAINT media_storage_transfer_objects_cleanup_receipt CHECK(state<>'complete' OR source_delete_receipt_id IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX media_storage_transfer_objects_key_idx ON media_storage_transfer_objects(plan_id,key_digest);
--> statement-breakpoint
CREATE UNIQUE INDEX media_storage_transfer_objects_target_idx ON media_storage_transfer_objects(plan_id,target_key_digest);
--> statement-breakpoint
CREATE INDEX media_storage_transfer_objects_state_idx ON media_storage_transfer_objects(plan_id,state);
--> statement-breakpoint
CREATE INDEX media_storage_transfer_objects_target_receipt_idx ON media_storage_transfer_objects(target_receipt_id);
--> statement-breakpoint
CREATE INDEX media_storage_transfer_objects_source_delete_idx ON media_storage_transfer_objects(source_delete_receipt_id);
--> statement-breakpoint
CREATE TABLE media_storage_transfer_receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES media_storage_transfer_objects(id) ON DELETE RESTRICT,
 receipt_id uuid NOT NULL REFERENCES media_object_writes(id) ON DELETE RESTRICT,original_witness_digest text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT media_storage_transfer_receipts_witness CHECK(original_witness_digest ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX media_storage_transfer_receipts_original_idx ON media_storage_transfer_receipts(object_id,receipt_id);
--> statement-breakpoint
CREATE INDEX media_storage_transfer_receipts_receipt_idx ON media_storage_transfer_receipts(receipt_id);
--> statement-breakpoint
CREATE TABLE media_storage_transfer_subjects (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES media_storage_transfer_objects(id) ON DELETE RESTRICT,
 contact_id uuid REFERENCES contacts(id) ON DELETE RESTRICT,redacted_at timestamptz,created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX media_storage_transfer_subjects_contact_idx ON media_storage_transfer_subjects(object_id,contact_id);
--> statement-breakpoint
CREATE INDEX media_storage_transfer_subjects_owner_idx ON media_storage_transfer_subjects(contact_id);
--> statement-breakpoint
CREATE TABLE media_storage_transfer_calls (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES media_storage_transfer_objects(id) ON DELETE RESTRICT,
 kind text NOT NULL,namespace text NOT NULL,physical_key text NOT NULL,request_digest text NOT NULL,caller_token_digest text NOT NULL,
 physical_receipt_id uuid REFERENCES media_object_writes(id) ON DELETE RESTRICT,runtime_id uuid NOT NULL,runtime_identity jsonb NOT NULL,expected_revision jsonb,state text NOT NULL DEFAULT 'admitted',
 observed_accepted_at timestamptz,returned_at timestamptz,stopped_at timestamptz,result_digest text,result_revision jsonb,result_sha256 text,result_bytes bigint,result_absent timestamptz,stop_receipt_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT media_storage_transfer_calls_kind CHECK(kind IN ('source_read','target_probe','target_put','target_verify','target_current','source_delete','source_absence','privacy_read','privacy_delete','privacy_absence','privacy_source_read','privacy_source_delete','privacy_source_absence')),
 CONSTRAINT media_storage_transfer_calls_state CHECK(state IN ('admitted','returned','unknown','stopped')),
 CONSTRAINT media_storage_transfer_calls_digests CHECK(namespace ~ '^[a-f0-9]{64}$' AND request_digest ~ '^[a-f0-9]{64}$' AND caller_token_digest ~ '^[a-f0-9]{64}$'),
 CONSTRAINT media_storage_transfer_calls_return CHECK((state<>'returned' OR (returned_at IS NOT NULL AND result_digest ~ '^[a-f0-9]{64}$')) AND (state<>'stopped' OR (stopped_at IS NOT NULL AND stop_receipt_id IS NOT NULL)))
);
--> statement-breakpoint
CREATE INDEX media_storage_transfer_calls_object_idx ON media_storage_transfer_calls(object_id,created_at,id);
--> statement-breakpoint
CREATE INDEX media_storage_transfer_calls_runtime_idx ON media_storage_transfer_calls(runtime_id,state);
--> statement-breakpoint
-- Statement-level admission precedes all row/object locks, including cold/warm
-- previous processes. The capability is a writer ABI, not a DB-owner boundary.
CREATE FUNCTION freeholder_media_transfer_runtime_fence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_setting('freeholder.media_transfer_runtime_v1',true) IS DISTINCT FROM '1'
  AND current_setting('freeholder.media_transfer_operator_v1',true) IS DISTINCT FROM '1' THEN
  RAISE EXCEPTION 'Original media requires its verified-transfer writer' USING ERRCODE='23514';
 END IF;
 PERFORM pg_advisory_xact_lock_shared(1691709,82);
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER media_writes_transfer_runtime BEFORE INSERT OR UPDATE OR DELETE ON media_object_writes FOR EACH STATEMENT EXECUTE FUNCTION freeholder_media_transfer_runtime_fence();
--> statement-breakpoint
CREATE TRIGGER media_objects_transfer_runtime BEFORE INSERT OR UPDATE OR DELETE ON media_objects FOR EACH STATEMENT EXECUTE FUNCTION freeholder_media_transfer_runtime_fence();
--> statement-breakpoint
CREATE TRIGGER media_uploads_transfer_runtime BEFORE INSERT OR UPDATE OR DELETE ON media_uploads FOR EACH STATEMENT EXECUTE FUNCTION freeholder_media_transfer_runtime_fence();
--> statement-breakpoint
CREATE TRIGGER media_multipart_transfer_runtime BEFORE INSERT OR UPDATE OR DELETE ON media_multipart_resources FOR EACH STATEMENT EXECUTE FUNCTION freeholder_media_transfer_runtime_fence();
--> statement-breakpoint
CREATE TRIGGER media_multipart_calls_transfer_runtime BEFORE INSERT OR UPDATE OR DELETE ON media_multipart_operations FOR EACH STATEMENT EXECUTE FUNCTION freeholder_media_transfer_runtime_fence();
--> statement-breakpoint
CREATE FUNCTION freeholder_media_transfer_namespace_fence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ns text;
BEGIN
 ns:=CASE WHEN TG_TABLE_NAME='media_object_writes' THEN NEW.storage_namespace ELSE NEW.storage_namespace END;
 IF TG_OP='INSERT' AND current_setting('freeholder.media_transfer_v1',true) IS DISTINCT FROM '1'
  AND (EXISTS(SELECT 1 FROM media_storage_writer_drains WHERE namespace=ns)
   OR EXISTS(SELECT 1 FROM media_storage_transfer_plans WHERE source_namespace=ns AND state<>'cancelled')) THEN
  RAISE EXCEPTION 'The original storage namespace is fenced for a verified transfer' USING ERRCODE='23514';
 END IF;
 IF TG_OP='UPDATE' AND NEW.writer_runtime_id IS DISTINCT FROM OLD.writer_runtime_id THEN
  RAISE EXCEPTION 'Historical physical writer birth cannot be backfilled or rebound' USING ERRCODE='23514';
 END IF;
 IF TG_OP='UPDATE' AND OLD.writer_finished_at IS NOT NULL AND NEW.writer_finished_at IS DISTINCT FROM OLD.writer_finished_at THEN
  RAISE EXCEPTION 'Actual physical writer finish is immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER media_writes_transfer_namespace BEFORE INSERT OR UPDATE ON media_object_writes FOR EACH ROW EXECUTE FUNCTION freeholder_media_transfer_namespace_fence();
--> statement-breakpoint
-- A multipart intent is fenced by its resource's exact original namespace.
CREATE FUNCTION freeholder_media_transfer_multipart_fence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ns text;
BEGIN
 IF TG_TABLE_NAME='media_multipart_resources' THEN ns:=NEW.storage_namespace;
 ELSE SELECT storage_namespace INTO ns FROM media_multipart_resources WHERE id=NEW.resource_id;
 END IF;
 IF TG_OP='INSERT' AND (EXISTS(SELECT 1 FROM media_storage_writer_drains WHERE namespace=ns)
  OR EXISTS(SELECT 1 FROM media_storage_transfer_plans WHERE source_namespace=ns AND state<>'cancelled')) THEN
  RAISE EXCEPTION 'Original multipart writer admission is fenced for transfer' USING ERRCODE='23514';
 END IF;
 IF TG_TABLE_NAME='media_multipart_operations' AND TG_OP='UPDATE' AND
  (NEW.writer_runtime_id IS DISTINCT FROM OLD.writer_runtime_id OR OLD.writer_finished_at IS NOT NULL AND NEW.writer_finished_at IS DISTINCT FROM OLD.writer_finished_at) THEN
  RAISE EXCEPTION 'Original multipart writer birth and finish cannot be rebound' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER multipart_resource_transfer_namespace BEFORE INSERT OR UPDATE ON media_multipart_resources FOR EACH ROW EXECUTE FUNCTION freeholder_media_transfer_multipart_fence();
--> statement-breakpoint
CREATE TRIGGER multipart_call_transfer_namespace BEFORE INSERT OR UPDATE ON media_multipart_operations FOR EACH ROW EXECUTE FUNCTION freeholder_media_transfer_multipart_fence();
--> statement-breakpoint
CREATE FUNCTION freeholder_media_transfer_evidence_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='media_storage_writer_drains' THEN
  IF current_setting('freeholder.media_transfer_operator_v1',true) IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'Writer stop evidence belongs to the original operator executor' USING ERRCODE='23514'; END IF;
 ELSE
  IF current_setting('freeholder.media_transfer_v1',true) IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'Use the shared verified-transfer writer' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Original transfer evidence cannot be deleted' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
  IF TG_TABLE_NAME='media_storage_transfer_receipts' THEN RAISE EXCEPTION 'Original transfer receipt membership is immutable' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME='media_storage_transfer_plans' AND (to_jsonb(NEW)-ARRAY['state','updated_at','adopted_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','updated_at','adopted_at']) THEN RAISE EXCEPTION 'Original first transfer capture is immutable' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME='media_storage_transfer_objects' AND ROW(NEW.id,NEW.plan_id,NEW.object_key,NEW.key_digest,NEW.target_object_key,NEW.target_key_digest,NEW.sha256,NEW.bytes,NEW.content_type,NEW.original_receipt_set_digest,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.plan_id,OLD.object_key,OLD.key_digest,OLD.target_object_key,OLD.target_key_digest,OLD.sha256,OLD.bytes,OLD.content_type,OLD.original_receipt_set_digest,OLD.created_at) THEN RAISE EXCEPTION 'Original object transfer membership cannot be rebound' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME='media_storage_transfer_calls' THEN
   IF ROW(NEW.id,NEW.object_id,NEW.kind,NEW.namespace,NEW.physical_key,NEW.request_digest,NEW.caller_token_digest,NEW.runtime_id,NEW.runtime_identity,NEW.expected_revision,NEW.physical_receipt_id,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.object_id,OLD.kind,OLD.namespace,OLD.physical_key,OLD.request_digest,OLD.caller_token_digest,OLD.runtime_id,OLD.runtime_identity,OLD.expected_revision,OLD.physical_receipt_id,OLD.created_at) THEN RAISE EXCEPTION 'Original physical caller admission is immutable' USING ERRCODE='23514'; END IF;
   IF OLD.observed_accepted_at IS NOT NULL AND NEW.observed_accepted_at IS DISTINCT FROM OLD.observed_accepted_at THEN RAISE EXCEPTION 'A positive original provider fact cannot be erased' USING ERRCODE='23514'; END IF;
   IF OLD.result_digest IS NOT NULL AND ROW(NEW.returned_at,NEW.result_digest,NEW.result_revision,NEW.result_sha256,NEW.result_bytes,NEW.result_absent) IS DISTINCT FROM ROW(OLD.returned_at,OLD.result_digest,OLD.result_revision,OLD.result_sha256,OLD.result_bytes,OLD.result_absent) THEN RAISE EXCEPTION 'Actual original physical return cannot be replaced' USING ERRCODE='23514'; END IF;
  END IF;
  IF TG_TABLE_NAME='media_storage_writer_drains' AND (ROW(NEW.id,NEW.namespace,NEW.source_revision,NEW.executor_identity,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.namespace,OLD.source_revision,OLD.executor_identity,OLD.created_at) OR OLD.state<>'capturing' AND NEW.original_processes IS DISTINCT FROM OLD.original_processes OR OLD.state='verified' AND ROW(NEW.state,NEW.stop_proof_digest,NEW.verified_at) IS DISTINCT FROM ROW(OLD.state,OLD.stop_proof_digest,OLD.verified_at)) THEN RAISE EXCEPTION 'Original captured process and stop witness are immutable' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER transfer_plan_evidence BEFORE INSERT OR UPDATE OR DELETE ON media_storage_transfer_plans FOR EACH ROW EXECUTE FUNCTION freeholder_media_transfer_evidence_guard();
--> statement-breakpoint
CREATE TRIGGER transfer_object_evidence BEFORE INSERT OR UPDATE OR DELETE ON media_storage_transfer_objects FOR EACH ROW EXECUTE FUNCTION freeholder_media_transfer_evidence_guard();
--> statement-breakpoint
CREATE TRIGGER transfer_receipt_evidence BEFORE INSERT OR UPDATE OR DELETE ON media_storage_transfer_receipts FOR EACH ROW EXECUTE FUNCTION freeholder_media_transfer_evidence_guard();
--> statement-breakpoint
CREATE TRIGGER transfer_subject_evidence BEFORE INSERT OR UPDATE OR DELETE ON media_storage_transfer_subjects FOR EACH ROW EXECUTE FUNCTION freeholder_media_transfer_evidence_guard();
--> statement-breakpoint
CREATE TRIGGER transfer_call_evidence BEFORE INSERT OR UPDATE OR DELETE ON media_storage_transfer_calls FOR EACH ROW EXECUTE FUNCTION freeholder_media_transfer_evidence_guard();
--> statement-breakpoint
CREATE TRIGGER transfer_drain_evidence BEFORE INSERT OR UPDATE OR DELETE ON media_storage_writer_drains FOR EACH ROW EXECUTE FUNCTION freeholder_media_transfer_evidence_guard();
--> statement-breakpoint
-- Published old imports438/other original retirement predicates continue to
-- see the original PUT alive while ANY lineage target or caller remains.
CREATE FUNCTION freeholder_media_transfer_retirement_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL AND EXISTS(
  SELECT 1 FROM media_storage_transfer_receipts member JOIN media_storage_transfer_objects object ON object.id=member.object_id
  LEFT JOIN media_object_writes target ON target.id=object.target_receipt_id
  WHERE member.receipt_id=OLD.id AND ((target.id IS NOT NULL AND (target.deleted_at IS NULL OR target.state IN ('unverified','started','unknown')))
   OR EXISTS(SELECT 1 FROM media_storage_transfer_calls caller WHERE caller.object_id=object.id AND caller.state IN ('admitted','unknown')))) THEN
  RAISE EXCEPTION 'Every copy and original admitted caller must retire before original erasure' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER media_write_transfer_retirement BEFORE UPDATE ON media_object_writes FOR EACH ROW EXECUTE FUNCTION freeholder_media_transfer_retirement_guard();
--> statement-breakpoint
CREATE FUNCTION freeholder_media_transfer_capability_v1() RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT 'verified-original-transfer-v1'::text $$;
