-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- UNAPPLIED OWNED TAIL. Root must assemble the final contiguous migration/journal.
-- freeholder:schema-breaking Verified physical lineage requires a new writer. Stop/drain original writers; rollback with matching DB, private configuration and object snapshots, respecting every acknowledged erasure.
-- C1.12/C11.08: no history/birth/provider outcome is inferred by this migration.
-- Existing rows intentionally remain NULL. A volatile ADD COLUMN DEFAULT
-- would fabricate birth for history, so only future INSERTs get a default.
ALTER TABLE media_objects ADD COLUMN reservation_id uuid;
--> statement-breakpoint
ALTER TABLE media_objects ALTER COLUMN reservation_id SET DEFAULT gen_random_uuid();
--> statement-breakpoint
CREATE UNIQUE INDEX media_objects_reservation_idx ON media_objects(reservation_id);
--> statement-breakpoint
ALTER TABLE media_object_writes ADD COLUMN original_reservation_id uuid;
--> statement-breakpoint
ALTER TABLE media_multipart_resources ADD COLUMN original_reservation_id uuid;
--> statement-breakpoint
ALTER TABLE media_object_writes ADD COLUMN writer_runtime_id uuid, ADD COLUMN writer_finished_at timestamptz, ADD COLUMN writer_protocol text, ADD COLUMN provider_revision jsonb, ADD COLUMN provider_revision_digest text;
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
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid REFERENCES media_storage_transfer_objects(id) ON DELETE RESTRICT,
 object_receipt_id uuid REFERENCES media_object_writes(id) ON DELETE RESTRICT,multipart_operation_id uuid REFERENCES media_multipart_operations(id) ON DELETE RESTRICT,
 kind text NOT NULL,namespace text NOT NULL,physical_key text NOT NULL,quota_token uuid,request_digest text NOT NULL,caller_token_digest text NOT NULL,
 physical_receipt_id uuid REFERENCES media_object_writes(id) ON DELETE RESTRICT,runtime_id uuid NOT NULL,runtime_identity jsonb NOT NULL,expected_revision jsonb,state text NOT NULL DEFAULT 'admitted',
 observed_accepted_at timestamptz,returned_at timestamptz,stopped_at timestamptz,result_request_proof jsonb,result_digest text,result_revision jsonb,result_sha256 text,result_bytes bigint,result_absent timestamptz,stop_receipt_id uuid,
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
 ns:=(CASE WHEN TG_TABLE_NAME='media_object_writes' THEN NEW.storage_namespace ELSE NEW.storage_namespace END);
 IF TG_OP='INSERT' AND current_setting('freeholder.media_transfer_v1',true) IS DISTINCT FROM '1'
  AND (EXISTS(SELECT 1 FROM media_storage_writer_drains WHERE namespace=ns AND state<>'released')
   OR EXISTS(SELECT 1 FROM media_storage_transfer_plans WHERE source_namespace=ns AND state<>'cancelled')) THEN
  RAISE EXCEPTION 'The original storage namespace is fenced for a verified transfer' USING ERRCODE='23514';
 END IF;
 IF TG_OP='UPDATE' AND NEW.writer_runtime_id IS DISTINCT FROM OLD.writer_runtime_id THEN
  RAISE EXCEPTION 'Historical physical writer birth cannot be backfilled or rebound' USING ERRCODE='23514';
 END IF;
 IF TG_OP='UPDATE' AND NEW.writer_finished_at IS DISTINCT FROM OLD.writer_finished_at AND (OLD.writer_finished_at IS NOT NULL OR EXISTS(SELECT 1 FROM media_storage_transfer_calls caller JOIN media_storage_transfer_reviews review ON review.id=caller.stop_receipt_id WHERE caller.object_receipt_id=OLD.id AND review.outcome='applied' AND review.stop_drain_id IS NOT NULL)) THEN
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
 IF TG_OP='INSERT' AND (EXISTS(SELECT 1 FROM media_storage_writer_drains WHERE namespace=ns AND state<>'released')
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
  WHERE member.receipt_id=OLD.id AND (
   EXISTS(SELECT 1 FROM media_object_writes target WHERE target.key_digest=object.target_key_digest AND (target.deleted_at IS NULL OR target.state IN ('unverified','started','unknown')))
   OR EXISTS(SELECT 1 FROM media_storage_transfer_calls caller WHERE caller.object_id=object.id AND caller.state IN ('admitted','unknown')))) THEN
  RAISE EXCEPTION 'Every copy and original admitted caller must retire before original erasure' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER media_write_transfer_retirement BEFORE UPDATE ON media_object_writes FOR EACH ROW EXECUTE FUNCTION freeholder_media_transfer_retirement_guard();
--> statement-breakpoint

ALTER TABLE media_storage_transfer_plans ADD COLUMN redacted_at timestamptz;
--> statement-breakpoint
ALTER TABLE media_storage_transfer_objects ADD COLUMN redacted_at timestamptz;
--> statement-breakpoint
ALTER TABLE media_storage_transfer_calls ADD COLUMN redacted_at timestamptz;
--> statement-breakpoint
ALTER TABLE media_storage_transfer_calls DROP CONSTRAINT media_storage_transfer_calls_kind;
--> statement-breakpoint
ALTER TABLE media_storage_transfer_calls ADD CONSTRAINT media_storage_transfer_calls_kind CHECK(kind IN ('source_read','target_probe','target_put','target_verify','target_current','source_delete','source_absence','privacy_read','privacy_delete','privacy_absence','privacy_source_read','privacy_source_delete','privacy_source_absence','recovery_read'));
--> statement-breakpoint
CREATE TABLE media_storage_transfer_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid REFERENCES media_storage_transfer_objects(id) ON DELETE RESTRICT,
 object_receipt_id uuid REFERENCES media_object_writes(id) ON DELETE RESTRICT,multipart_operation_id uuid REFERENCES media_multipart_operations(id) ON DELETE RESTRICT,inventory_id uuid,
 call_id uuid NOT NULL REFERENCES media_storage_transfer_calls(id) ON DELETE RESTRICT,original_call_witness text NOT NULL,
 read_call_id uuid NOT NULL REFERENCES media_storage_transfer_calls(id) ON DELETE RESTRICT,outcome text NOT NULL,provider_evidence_digest text NOT NULL,
 stop_drain_id uuid REFERENCES media_storage_writer_drains(id) ON DELETE RESTRICT,permits_retry boolean NOT NULL DEFAULT false,
 reviewed_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT media_storage_transfer_reviews_outcome CHECK(outcome IN ('applied','not_applied','retired')),
 CONSTRAINT media_storage_transfer_reviews_digests CHECK(original_call_witness ~ '^[a-f0-9]{64}$' AND provider_evidence_digest ~ '^[a-f0-9]{64}$'),
 CONSTRAINT media_storage_transfer_reviews_retry CHECK(NOT permits_retry OR outcome='not_applied')
);
--> statement-breakpoint
CREATE INDEX media_storage_transfer_reviews_call_idx ON media_storage_transfer_reviews(call_id,created_at);
--> statement-breakpoint
CREATE TABLE media_storage_transfer_erasure_scopes (
 request_id uuid PRIMARY KEY REFERENCES data_requests(id) ON DELETE RESTRICT,object_count bigint NOT NULL,capture_digest text NOT NULL,
 complete boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT media_storage_transfer_erasure_scopes_count CHECK(object_count>=0 AND object_count<=10000),
 CONSTRAINT media_storage_transfer_erasure_scopes_digest CHECK(capture_digest ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE media_storage_transfer_erasure_members (
 request_id uuid NOT NULL REFERENCES media_storage_transfer_erasure_scopes(request_id) ON DELETE RESTRICT,
 object_id uuid NOT NULL REFERENCES media_storage_transfer_objects(id) ON DELETE RESTRICT,original_plan_digest text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(request_id,object_id),
 CONSTRAINT media_storage_transfer_erasure_members_digest CHECK(original_plan_digest ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE INDEX media_storage_transfer_erasure_members_object_idx ON media_storage_transfer_erasure_members(object_id);
--> statement-breakpoint
CREATE TABLE media_storage_transfer_jobs (
 job_id uuid PRIMARY KEY,request_key uuid NOT NULL,plan_id uuid NOT NULL REFERENCES media_storage_transfer_plans(id) ON DELETE RESTRICT,
 object_id uuid REFERENCES media_storage_transfer_objects(id) ON DELETE RESTRICT,action text NOT NULL,manifest_digest text NOT NULL,payload_digest text NOT NULL,
 created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT media_storage_transfer_jobs_action CHECK(action IN ('copy','adopt','retire')),
 CONSTRAINT media_storage_transfer_jobs_digests CHECK(manifest_digest ~ '^[a-f0-9]{64}$' AND payload_digest ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX media_storage_transfer_jobs_request_idx ON media_storage_transfer_jobs(request_key);
--> statement-breakpoint
CREATE INDEX media_storage_transfer_jobs_plan_idx ON media_storage_transfer_jobs(plan_id);
--> statement-breakpoint
CREATE FUNCTION freeholder_media_transfer_object_retired(original_object uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM media_storage_transfer_objects WHERE id=original_object)
 AND NOT EXISTS(SELECT 1 FROM media_storage_transfer_calls WHERE object_id=original_object AND state IN ('admitted','unknown'))
 AND NOT EXISTS(SELECT 1 FROM media_object_writes physical WHERE physical.id IN (SELECT receipt_id FROM media_storage_transfer_receipts WHERE object_id=original_object UNION SELECT physical_receipt_id FROM media_storage_transfer_calls WHERE object_id=original_object AND physical_receipt_id IS NOT NULL) AND (physical.deleted_at IS NULL OR physical.state NOT IN ('accepted','confirmed_absent')))
$$;
--> statement-breakpoint
-- First capture and original physical evidence stay immutable. Redaction is a
-- separate, one-way transition after every copy/caller actually retires.
CREATE OR REPLACE FUNCTION freeholder_media_transfer_evidence_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE minimizing boolean:=false; object_id uuid;
BEGIN
 IF TG_TABLE_NAME='media_storage_writer_drains' THEN
  IF current_setting('freeholder.media_transfer_operator_v1',true) IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'Writer stop evidence belongs to the original operator executor' USING ERRCODE='23514'; END IF;
 ELSE
  IF current_setting('freeholder.media_transfer_v1',true) IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'Use the shared verified-transfer writer' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Original transfer evidence cannot be deleted' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='media_storage_writer_drains' THEN
  IF TG_OP='INSERT' THEN
   IF NEW.state<>'capturing' OR NEW.original_processes<>'{}'::jsonb OR NEW.stop_proof_digest IS NOT NULL OR NEW.verified_at IS NOT NULL OR NEW.released_at IS NOT NULL THEN RAISE EXCEPTION 'A writer drain is born capturing, never stopped or released' USING ERRCODE='23514'; END IF;
  ELSE
   IF NEW.state<>OLD.state AND NOT(OLD.state='capturing' AND NEW.state='captured' OR OLD.state='captured' AND NEW.state='verified' OR OLD.state='verified' AND NEW.state='released') THEN RAISE EXCEPTION 'A writer drain cannot skip or rewind its actual capture, stop verification and release' USING ERRCODE='23514'; END IF;
   IF ROW(NEW.stop_proof_digest,NEW.verified_at) IS DISTINCT FROM ROW(OLD.stop_proof_digest,OLD.verified_at) AND NOT(OLD.state='captured' AND NEW.state='verified' AND NEW.stop_proof_digest ~ '^[a-f0-9]{64}$' AND NEW.verified_at IS NOT NULL AND NEW.verified_at>=NEW.created_at) THEN RAISE EXCEPTION 'Retain the first actual stop proof; a timeout or release cannot supply it' USING ERRCODE='23514'; END IF;
   IF NEW.released_at IS DISTINCT FROM OLD.released_at AND NOT(OLD.state='verified' AND NEW.state='released' AND NEW.released_at IS NOT NULL AND NEW.released_at>=OLD.verified_at) THEN RAISE EXCEPTION 'Only a previously verified stopped executor can acquire a release timestamp' USING ERRCODE='23514'; END IF;
  END IF;
 IF TG_OP='UPDATE' AND OLD.state='capturing' AND NEW.state='captured' AND NEW.original_processes->'recovery' IS NOT NULL THEN
  IF NEW.original_processes->'recovery'->>'format' IS DISTINCT FROM 'freeholder.media-transfer-drain/v1' OR NEW.original_processes->'recovery'->>'namespace' IS DISTINCT FROM NEW.namespace OR coalesce(NEW.original_processes->'recovery'->>'planId','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' THEN RAISE EXCEPTION 'Capture the exact versioned current-plan recovery association before stopping its executor' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT 1 FROM media_storage_transfer_plans plan WHERE plan.id=(NEW.original_processes->'recovery'->>'planId')::uuid AND plan.state NOT IN ('complete','cancelled')) OR NEW.original_processes->'recovery'->'snapshot' IS DISTINCT FROM freeholder_media_transfer_recovery_snapshot((NEW.original_processes->'recovery'->>'planId')::uuid,NEW.namespace) THEN RAISE EXCEPTION 'The complete original plan/caller cohort changed before actual executor capture; no subset or later association is accepted' USING ERRCODE='23514'; END IF;
 END IF;
 END IF;
 IF TG_OP='UPDATE' THEN
  IF TG_TABLE_NAME='media_storage_transfer_receipts' THEN
   IF NEW.original_snapshot='{}'::jsonb AND freeholder_media_transfer_object_retired(OLD.object_id) AND (to_jsonb(NEW)-'original_snapshot')=(to_jsonb(OLD)-'original_snapshot') THEN RETURN NEW; END IF;
   RAISE EXCEPTION 'Original receipt capture can only be minimized after all copies retire' USING ERRCODE='23514';
  END IF;
  IF TG_TABLE_NAME IN ('media_storage_transfer_reviews','media_storage_transfer_jobs','media_storage_transfer_erasure_members') THEN RAISE EXCEPTION 'Original transfer membership, jobs and reviews are immutable' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME='media_storage_transfer_plans' THEN
   minimizing:=OLD.redacted_at IS NULL AND NEW.redacted_at IS NOT NULL AND NEW.created_by='erased'
    AND NEW.original_source=jsonb_build_object('kind',OLD.original_source->>'kind','namespace',OLD.source_namespace,'location','{}'::jsonb)
    AND NEW.original_target=jsonb_build_object('kind',OLD.original_target->>'kind','namespace',OLD.target_namespace,'location','{}'::jsonb)
    AND NOT EXISTS(SELECT 1 FROM media_storage_transfer_objects WHERE plan_id=OLD.id AND (redacted_at IS NULL OR NOT freeholder_media_transfer_object_retired(id)));
   IF (to_jsonb(NEW)-ARRAY['state','updated_at','adopted_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','updated_at','adopted_at']) AND NOT(minimizing AND (to_jsonb(NEW)-ARRAY['state','updated_at','adopted_at','original_source','original_target','created_by','redacted_at'])=(to_jsonb(OLD)-ARRAY['state','updated_at','adopted_at','original_source','original_target','created_by','redacted_at'])) THEN RAISE EXCEPTION 'Original first transfer capture is immutable' USING ERRCODE='23514'; END IF;
   IF OLD.adopted_at IS NOT NULL AND NEW.adopted_at IS DISTINCT FROM OLD.adopted_at THEN RAISE EXCEPTION 'Original adoption fact is immutable' USING ERRCODE='23514'; END IF;
  ELSIF TG_TABLE_NAME='media_storage_transfer_objects' THEN
   minimizing:=OLD.redacted_at IS NULL AND NEW.redacted_at IS NOT NULL AND NEW.object_key='retained:'||OLD.key_digest AND NEW.target_object_key='retained:'||OLD.target_key_digest AND NEW.source_revision IS NULL AND NEW.target_revision IS NULL AND freeholder_media_transfer_object_retired(OLD.id);
   IF ROW(NEW.id,NEW.plan_id,NEW.key_digest,NEW.target_key_digest,NEW.sha256,NEW.bytes,NEW.content_type,NEW.original_receipt_set_digest,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.plan_id,OLD.key_digest,OLD.target_key_digest,OLD.sha256,OLD.bytes,OLD.content_type,OLD.original_receipt_set_digest,OLD.created_at)
    OR ROW(NEW.object_key,NEW.target_object_key,NEW.redacted_at) IS DISTINCT FROM ROW(OLD.object_key,OLD.target_object_key,OLD.redacted_at) AND NOT minimizing THEN RAISE EXCEPTION 'Original object transfer membership cannot be rebound' USING ERRCODE='23514'; END IF;
  ELSIF TG_TABLE_NAME='media_storage_transfer_calls' THEN
   minimizing:=(OLD.redacted_at IS NULL AND NEW.redacted_at IS NOT NULL OR OLD.redacted_at IS NOT NULL AND NEW.redacted_at=OLD.redacted_at) AND (freeholder_media_transfer_object_retired(OLD.object_id) OR freeholder_media_original_call_retired(OLD.id)) AND (NEW.physical_key=OLD.physical_key AND NEW.physical_key LIKE 'retained:%' OR NEW.physical_key='retained:'||encode(sha256(convert_to('freeholder:media-object-key:v1','UTF8')||decode('00','hex')||convert_to(OLD.physical_key,'UTF8')),'hex')) AND NEW.expected_revision IS NULL AND NEW.result_revision IS NULL;
   IF ROW(NEW.id,NEW.object_id,NEW.kind,NEW.namespace,NEW.request_digest,NEW.caller_token_digest,NEW.runtime_id,NEW.runtime_identity,NEW.physical_receipt_id,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.object_id,OLD.kind,OLD.namespace,OLD.request_digest,OLD.caller_token_digest,OLD.runtime_id,OLD.runtime_identity,OLD.physical_receipt_id,OLD.created_at)
    OR ROW(NEW.physical_key,NEW.expected_revision,NEW.redacted_at) IS DISTINCT FROM ROW(OLD.physical_key,OLD.expected_revision,OLD.redacted_at) AND NOT minimizing THEN RAISE EXCEPTION 'Original physical caller admission is immutable' USING ERRCODE='23514'; END IF;
   IF OLD.observed_accepted_at IS NOT NULL AND NEW.observed_accepted_at IS DISTINCT FROM OLD.observed_accepted_at THEN RAISE EXCEPTION 'A positive original provider fact cannot be erased' USING ERRCODE='23514'; END IF;
   IF OLD.result_digest IS NOT NULL AND (ROW(NEW.returned_at,NEW.result_digest,NEW.result_sha256,NEW.result_bytes,NEW.result_absent,NEW.result_request_proof) IS DISTINCT FROM ROW(OLD.returned_at,OLD.result_digest,OLD.result_sha256,OLD.result_bytes,OLD.result_absent,OLD.result_request_proof) OR NEW.result_revision IS DISTINCT FROM OLD.result_revision AND NOT minimizing) THEN RAISE EXCEPTION 'Actual original physical return cannot be replaced' USING ERRCODE='23514'; END IF;
   IF EXISTS(SELECT 1 FROM media_storage_transfer_reviews review WHERE review.id=OLD.stop_receipt_id AND review.object_receipt_id IS NOT NULL AND review.outcome='applied') AND ROW(NEW.stopped_at,NEW.stop_receipt_id,NEW.returned_at) IS DISTINCT FROM ROW(OLD.stopped_at,OLD.stop_receipt_id,OLD.returned_at) THEN RAISE EXCEPTION 'Keep the original affirmative review and actual missing or retained caller return' USING ERRCODE='23514'; END IF;
   IF NEW.state='stopped' AND OLD.state<>'stopped' AND NOT EXISTS(SELECT 1 FROM media_storage_transfer_reviews review WHERE review.id=NEW.stop_receipt_id AND review.call_id=OLD.id AND review.object_id IS NOT DISTINCT FROM OLD.object_id AND review.object_receipt_id IS NOT DISTINCT FROM OLD.object_receipt_id AND review.multipart_operation_id IS NOT DISTINCT FROM OLD.multipart_operation_id) THEN RAISE EXCEPTION 'Actual caller stop requires its exact original review receipt' USING ERRCODE='23514'; END IF;
  ELSIF TG_TABLE_NAME='media_storage_transfer_subjects' THEN
   IF ROW(NEW.id,NEW.object_id,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.object_id,OLD.created_at) OR OLD.redacted_at IS NOT NULL AND ROW(NEW.contact_id,NEW.redacted_at) IS DISTINCT FROM ROW(OLD.contact_id,OLD.redacted_at) OR NEW.redacted_at IS NOT NULL AND OLD.redacted_at IS NULL AND (NEW.contact_id IS NOT NULL OR NOT freeholder_media_transfer_object_retired(OLD.object_id)) THEN RAISE EXCEPTION 'Original subject membership cannot be rebound or erased before physical retirement' USING ERRCODE='23514'; END IF;
  ELSIF TG_TABLE_NAME='media_storage_writer_drains' THEN
   IF ROW(NEW.id,NEW.namespace,NEW.source_revision,NEW.executor_identity,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.namespace,OLD.source_revision,OLD.executor_identity,OLD.created_at) OR OLD.state<>'capturing' AND NEW.original_processes IS DISTINCT FROM OLD.original_processes OR OLD.state IN ('verified','released') AND (ROW(NEW.stop_proof_digest,NEW.verified_at) IS DISTINCT FROM ROW(OLD.stop_proof_digest,OLD.verified_at) OR NEW.state<>OLD.state AND NOT(OLD.state='verified' AND NEW.state='released' AND NEW.released_at IS NOT NULL AND (NOT EXISTS(SELECT 1 FROM media_storage_transfer_plans WHERE (source_namespace=OLD.namespace OR target_namespace=OLD.namespace) AND state<>'cancelled') AND OLD.original_processes->'recovery' IS NULL OR freeholder_media_transfer_recovery_drain_releasable(OLD.id)) AND NOT EXISTS(SELECT 1 FROM media_object_writes WHERE storage_namespace=OLD.namespace AND state IN ('unverified','started','unknown')))) THEN RAISE EXCEPTION 'Original captured process and stop witness are immutable' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER transfer_review_evidence BEFORE INSERT OR UPDATE OR DELETE ON media_storage_transfer_reviews FOR EACH ROW EXECUTE FUNCTION freeholder_media_transfer_evidence_guard();
--> statement-breakpoint
CREATE TRIGGER transfer_job_evidence BEFORE INSERT OR UPDATE OR DELETE ON media_storage_transfer_jobs FOR EACH ROW EXECUTE FUNCTION freeholder_media_transfer_evidence_guard();
--> statement-breakpoint
CREATE TRIGGER transfer_erasure_member_evidence BEFORE INSERT OR UPDATE OR DELETE ON media_storage_transfer_erasure_members FOR EACH ROW EXECUTE FUNCTION freeholder_media_transfer_evidence_guard();
--> statement-breakpoint
CREATE FUNCTION freeholder_media_transfer_erasure_capture_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original_contact uuid; expected text;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Original transfer erasure capture requires its guarded writer' USING ERRCODE='23514'; END IF;
 IF current_setting('freeholder.media_transfer_v1',true) IS DISTINCT FROM '1' THEN
  PERFORM pg_advisory_xact_lock(1691709,82);
  IF TG_TABLE_NAME='media_storage_transfer_erasure_scopes' THEN
   IF current_setting('freeholder.media_empty_scope_request_v1',true) IS DISTINCT FROM NEW.request_id::text
    OR current_setting('freeholder.media_empty_scope_name_v1',true) IS DISTINCT FROM 'media.storageTransfers'
    OR NOT EXISTS(SELECT 1 FROM data_requests request WHERE request.id=NEW.request_id AND request.kind='erasure' AND request.contact_id::text=current_setting('freeholder.media_empty_scope_contact_v1',true))
    OR NEW.object_count<>0 OR NEW.capture_digest<>freeholder_media_transfer_fact_digest('[]'::jsonb)
    OR NOT freeholder_media_empty_scope_graph_v1(NEW.request_id,'media.storageTransfers')
    OR TG_OP='INSERT' AND EXISTS(SELECT 1 FROM data_request_artifacts WHERE data_request_id=NEW.request_id)
   THEN RAISE EXCEPTION 'Empty transfer capture needs its exact actual request/contact and fenced empty graph; no provider privilege or old receipt refill' USING ERRCODE='23514'; END IF;
  ELSE RAISE EXCEPTION 'An empty metadata writer cannot acquire physical transfer members' USING ERRCODE='23514';
  END IF;
 END IF;
 IF TG_TABLE_NAME='media_storage_transfer_erasure_scopes' THEN
  IF TG_OP='UPDATE' AND (OLD.complete OR NOT NEW.complete OR (to_jsonb(NEW)-'complete') IS DISTINCT FROM (to_jsonb(OLD)-'complete')) THEN RAISE EXCEPTION 'The complete first transfer erasure capture is immutable' USING ERRCODE='23514'; END IF;
  IF NEW.complete THEN
   SELECT encode(sha256(convert_to('freeholder:verified-storage-transfer:v1','UTF8')||decode('00','hex')||convert_to(freeholder_source_receipt_canonical(coalesce(jsonb_agg(jsonb_build_object('id',member.object_id,'manifest',member.original_plan_digest) ORDER BY member.object_id),'[]'::jsonb)),'UTF8')),'hex') INTO expected FROM media_storage_transfer_erasure_members member WHERE member.request_id=NEW.request_id;
   IF NEW.object_count<>(SELECT count(*) FROM media_storage_transfer_erasure_members WHERE request_id=NEW.request_id) OR NEW.capture_digest<>expected THEN RAISE EXCEPTION 'The original transfer erasure membership is incomplete' USING ERRCODE='23514'; END IF;
  END IF;
 ELSE
  IF TG_OP<>'INSERT' OR NOT EXISTS(SELECT 1 FROM media_storage_transfer_erasure_scopes WHERE request_id=NEW.request_id AND NOT complete) THEN RAISE EXCEPTION 'Completed original transfer erasure membership cannot be expanded' USING ERRCODE='23514'; END IF;
  SELECT contact_id INTO original_contact FROM data_requests WHERE id=NEW.request_id AND kind='erasure';
  IF original_contact IS NULL OR NOT EXISTS(SELECT 1 FROM media_storage_transfer_subjects subject JOIN media_storage_transfer_objects object ON object.id=subject.object_id JOIN media_storage_transfer_plans plan ON plan.id=object.plan_id WHERE subject.object_id=NEW.object_id AND subject.contact_id=original_contact AND plan.manifest_digest=NEW.original_plan_digest) THEN RAISE EXCEPTION 'The original request does not own this transfer member' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER transfer_erasure_scope_capture BEFORE INSERT OR UPDATE OR DELETE ON media_storage_transfer_erasure_scopes FOR EACH ROW EXECUTE FUNCTION freeholder_media_transfer_erasure_capture_guard();
--> statement-breakpoint
CREATE TRIGGER transfer_erasure_member_capture BEFORE INSERT OR UPDATE OR DELETE ON media_storage_transfer_erasure_members FOR EACH ROW EXECUTE FUNCTION freeholder_media_transfer_erasure_capture_guard();
--> statement-breakpoint
CREATE FUNCTION freeholder_media_transfer_logical_intake_fence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_setting('freeholder.media_transfer_v1',true) IS DISTINCT FROM '1' AND EXISTS(SELECT 1 FROM media_storage_transfer_plans WHERE state IN ('planned','copying','unknown','verified','adopted','cleanup_pending','blocked')) THEN RAISE EXCEPTION 'Finish the complete original transfer before admitting new media' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER media_objects_transfer_intake BEFORE INSERT ON media_objects FOR EACH ROW EXECUTE FUNCTION freeholder_media_transfer_logical_intake_fence();
--> statement-breakpoint
CREATE FUNCTION freeholder_media_transfer_adoption_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE plan media_storage_transfer_plans; source media_storage_transfer_calls; target media_storage_transfer_calls;
BEGIN
 IF TG_TABLE_NAME='media_storage_transfer_objects' AND NEW.state IN ('verified','adopted') AND OLD.state IS DISTINCT FROM NEW.state THEN
  SELECT * INTO plan FROM media_storage_transfer_plans WHERE id=NEW.plan_id;
  SELECT * INTO source FROM media_storage_transfer_calls WHERE id=NEW.source_read_caller_id AND object_id=NEW.id AND kind='source_read';
  SELECT * INTO target FROM media_storage_transfer_calls WHERE id=NEW.target_verify_caller_id AND object_id=NEW.id AND kind='target_verify';
  IF source.id IS NULL OR target.id IS NULL OR source.state<>'returned' OR target.state<>'returned' OR source.returned_at IS NULL OR target.returned_at IS NULL OR source.namespace<>plan.source_namespace OR target.namespace<>plan.target_namespace OR source.physical_key<>NEW.object_key OR target.physical_key<>NEW.target_object_key OR source.result_sha256 IS DISTINCT FROM NEW.sha256 OR target.result_sha256 IS DISTINCT FROM NEW.sha256 OR source.result_bytes IS DISTINCT FROM NEW.bytes OR target.result_bytes IS DISTINCT FROM NEW.bytes OR source.result_revision IS NULL OR target.result_revision IS NULL OR source.result_absent IS NOT NULL OR target.result_absent IS NOT NULL OR NEW.source_revision IS DISTINCT FROM source.result_revision OR NEW.target_revision IS DISTINCT FROM target.result_revision THEN RAISE EXCEPTION 'Adoption requires finished exact source and target full-byte proofs' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT 1 FROM media_object_writes receipt WHERE receipt.id=NEW.target_receipt_id AND receipt.operation_kind='put' AND receipt.state='accepted' AND receipt.deleted_at IS NULL AND receipt.redacted_at IS NULL AND receipt.object_key=NEW.target_object_key AND receipt.key_digest=NEW.target_key_digest AND receipt.storage_namespace=plan.target_namespace AND receipt.sha256=NEW.sha256 AND receipt.bytes=NEW.bytes) OR EXISTS(SELECT 1 FROM media_storage_transfer_calls WHERE object_id=NEW.id AND state IN ('admitted','unknown')) THEN RAISE EXCEPTION 'The original target caller is unresolved or its byte receipt is missing' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM media_storage_transfer_subjects subject JOIN data_requests request ON request.contact_id=subject.contact_id WHERE subject.object_id=NEW.id AND request.kind='erasure' AND request.status IN ('verified','in_progress','completed','partially_completed')) THEN RAISE EXCEPTION 'The original owner privacy request prevents adoption' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_TABLE_NAME='media_storage_transfer_plans' AND NEW.adopted_at IS NOT NULL AND OLD.adopted_at IS NULL THEN
  IF NEW.inventory_count<>(SELECT count(*) FROM media_storage_transfer_objects WHERE plan_id=OLD.id) OR EXISTS(SELECT 1 FROM media_storage_transfer_objects WHERE plan_id=OLD.id AND state<>'adopted') OR EXISTS(SELECT 1 FROM media_objects physical WHERE NOT EXISTS(SELECT 1 FROM media_storage_transfer_objects member WHERE member.plan_id=OLD.id AND physical.key IN (member.object_key,member.target_object_key))) THEN RAISE EXCEPTION 'Only a complete unchanged original inventory can be adopted atomically' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER transfer_object_adoption BEFORE UPDATE ON media_storage_transfer_objects FOR EACH ROW EXECUTE FUNCTION freeholder_media_transfer_adoption_guard();
--> statement-breakpoint
CREATE TRIGGER transfer_plan_adoption BEFORE UPDATE ON media_storage_transfer_plans FOR EACH ROW EXECUTE FUNCTION freeholder_media_transfer_adoption_guard();
--> statement-breakpoint


--> statement-breakpoint
ALTER TABLE media_storage_writer_drains ADD COLUMN released_at timestamptz;
--> statement-breakpoint
ALTER TABLE media_storage_writer_drains DROP CONSTRAINT media_storage_writer_drains_state;
--> statement-breakpoint
ALTER TABLE media_storage_writer_drains ADD CONSTRAINT media_storage_writer_drains_state CHECK(state IN ('capturing','captured','verified','released'));
--> statement-breakpoint
ALTER TABLE media_storage_transfer_receipts ADD COLUMN original_snapshot jsonb NOT NULL,ADD COLUMN original_snapshot_digest text NOT NULL;
--> statement-breakpoint
ALTER TABLE media_storage_transfer_receipts DROP CONSTRAINT media_storage_transfer_receipts_witness;
--> statement-breakpoint
ALTER TABLE media_storage_transfer_receipts ADD CONSTRAINT media_storage_transfer_receipts_witness CHECK(original_witness_digest ~ '^[a-f0-9]{64}$' AND original_snapshot_digest ~ '^[a-f0-9]{64}$');
--> statement-breakpoint
CREATE FUNCTION freeholder_media_transfer_capability_v1() RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT 'verified-original-transfer-v1'::text $$;

--> statement-breakpoint
-- Owned continuation: original provider requests and complete immutable pages.
-- Existing writer/receipt rows deliberately retain NULL origin provenance.
CREATE TABLE media_storage_transfer_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),call_id uuid NOT NULL REFERENCES media_storage_transfer_calls(id) ON DELETE RESTRICT,
 key_digest text,redacted_at timestamptz,descriptor jsonb NOT NULL,descriptor_digest text NOT NULL,token_digest text NOT NULL,
 state text NOT NULL DEFAULT 'admitted',runtime_identity jsonb NOT NULL,returned_at timestamptz,
 stop_receipt_id uuid REFERENCES media_storage_transfer_reviews(id) ON DELETE RESTRICT,observation_count integer NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT media_storage_transfer_requests_state CHECK(state IN ('admitted','returned','failed','unknown','stopped')),
 CONSTRAINT media_storage_transfer_requests_digests CHECK(descriptor_digest ~ '^[a-f0-9]{64}$' AND token_digest ~ '^[a-f0-9]{64}$'),
 CONSTRAINT media_storage_transfer_requests_count CHECK(observation_count>=0 AND observation_count<=16),
 CONSTRAINT media_storage_transfer_requests_finish CHECK(state IN ('admitted','unknown') OR state='stopped' AND stop_receipt_id IS NOT NULL OR returned_at IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX media_storage_transfer_requests_call_idx ON media_storage_transfer_requests(call_id,created_at,id);
--> statement-breakpoint
CREATE INDEX media_storage_transfer_requests_state_idx ON media_storage_transfer_requests(state,created_at);
--> statement-breakpoint
CREATE TABLE media_storage_transfer_request_observations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),request_id uuid NOT NULL REFERENCES media_storage_transfer_requests(id) ON DELETE RESTRICT,
 redacted_at timestamptz,ordinal integer NOT NULL,facts jsonb NOT NULL,facts_digest text NOT NULL,bytes bigint,created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT media_storage_transfer_request_observations_ordinal CHECK(ordinal>0 AND ordinal<=16),
 CONSTRAINT media_storage_transfer_request_observations_digest CHECK(facts_digest ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX media_storage_transfer_request_observations_request_idx ON media_storage_transfer_request_observations(request_id,ordinal);
--> statement-breakpoint
CREATE TABLE media_storage_provider_inventories (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),plan_id uuid REFERENCES media_storage_transfer_plans(id) ON DELETE RESTRICT,
 object_receipt_id uuid REFERENCES media_object_writes(id) ON DELETE RESTRICT,multipart_operation_id uuid REFERENCES media_multipart_operations(id) ON DELETE RESTRICT,
 original_witness text,proof_call_id uuid REFERENCES media_storage_transfer_calls(id) ON DELETE RESTRICT,
 anchor_call_id uuid REFERENCES media_storage_transfer_calls(id) ON DELETE RESTRICT,object_id uuid REFERENCES media_storage_transfer_objects(id) ON DELETE RESTRICT,
 side text NOT NULL,purpose text NOT NULL,binding jsonb NOT NULL,namespace text NOT NULL,state text NOT NULL DEFAULT 'capturing',
 first_digest text,confirmed_digest text,configuration jsonb,entry_count integer NOT NULL DEFAULT 0,total_bytes bigint NOT NULL DEFAULT 0,
 blocker text,completed_at timestamptz,redacted_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT media_storage_provider_inventory_side CHECK(side IN ('source','target')),
 CONSTRAINT media_storage_provider_inventory_purpose CHECK(purpose IN ('baseline','retirement','erasure','recovery')),
 CONSTRAINT media_storage_provider_inventory_state CHECK(state IN ('capturing','complete','blocked')),
 CONSTRAINT media_storage_provider_inventory_namespace CHECK(namespace ~ '^[a-f0-9]{64}$'),
 CONSTRAINT media_storage_provider_inventory_complete CHECK(state<>'complete' OR completed_at IS NOT NULL AND first_digest ~ '^[a-f0-9]{64}$' AND first_digest=confirmed_digest)
);
--> statement-breakpoint
CREATE UNIQUE INDEX media_storage_provider_inventory_baseline_idx ON media_storage_provider_inventories(plan_id,side) WHERE purpose='baseline';
--> statement-breakpoint
CREATE UNIQUE INDEX media_storage_provider_inventory_anchor_idx ON media_storage_provider_inventories(object_id,side,purpose,anchor_call_id);
--> statement-breakpoint
CREATE INDEX media_storage_provider_inventory_object_idx ON media_storage_provider_inventories(object_id,created_at);
--> statement-breakpoint
CREATE TABLE media_storage_provider_inventory_pages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),inventory_id uuid NOT NULL REFERENCES media_storage_provider_inventories(id) ON DELETE RESTRICT,
 call_id uuid NOT NULL REFERENCES media_storage_transfer_calls(id) ON DELETE RESTRICT,pass integer NOT NULL,kind text NOT NULL,
 cursor jsonb,cursor_digest text NOT NULL,next_cursor jsonb,membership_digest text NOT NULL,page_digest text NOT NULL,entry_count integer NOT NULL,
 configuration jsonb,redacted_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT media_storage_provider_inventory_page_pass CHECK(pass IN (0,1)),
 CONSTRAINT media_storage_provider_inventory_page_kind CHECK(kind IN ('configuration','objects','versions','sessions','retained')),
 CONSTRAINT media_storage_provider_inventory_page_digests CHECK(cursor_digest ~ '^[a-f0-9]{64}$' AND page_digest ~ '^[a-f0-9]{64}$' AND membership_digest ~ '^[a-f0-9]{64}$'),
 CONSTRAINT media_storage_provider_inventory_page_count CHECK(entry_count>=0 AND entry_count<=250)
);
--> statement-breakpoint
CREATE UNIQUE INDEX media_storage_provider_inventory_page_idx ON media_storage_provider_inventory_pages(inventory_id,pass,kind,cursor_digest);
--> statement-breakpoint
CREATE TABLE media_storage_provider_inventory_entries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),page_id uuid NOT NULL REFERENCES media_storage_provider_inventory_pages(id) ON DELETE RESTRICT,
 inventory_id uuid NOT NULL REFERENCES media_storage_provider_inventories(id) ON DELETE RESTRICT,ordinal integer NOT NULL,pass integer NOT NULL,
 entry jsonb NOT NULL,entry_digest text NOT NULL,key_digest text NOT NULL,resource_digest text NOT NULL,
 original_object_id uuid REFERENCES media_storage_transfer_objects(id) ON DELETE RESTRICT,attribution text NOT NULL,
 redacted_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT media_storage_provider_inventory_entry_attribution CHECK(attribution IN ('original_current','preexisting_target','unattributed','retained_original')),
 CONSTRAINT media_storage_provider_inventory_entry_digests CHECK(key_digest ~ '^[a-f0-9]{64}$' AND resource_digest ~ '^[a-f0-9]{64}$' AND entry_digest ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX media_storage_provider_inventory_entry_ordinal_idx ON media_storage_provider_inventory_entries(page_id,ordinal);
--> statement-breakpoint
CREATE UNIQUE INDEX media_storage_provider_inventory_resource_idx ON media_storage_provider_inventory_entries(inventory_id,pass,resource_digest);
--> statement-breakpoint
CREATE INDEX media_storage_provider_inventory_entry_key_idx ON media_storage_provider_inventory_entries(key_digest,attribution);
--> statement-breakpoint
ALTER TABLE media_storage_transfer_calls DROP CONSTRAINT media_storage_transfer_calls_kind;
--> statement-breakpoint
ALTER TABLE media_storage_transfer_calls ADD CONSTRAINT media_storage_transfer_calls_kind CHECK(kind IN ('source_read','target_probe','target_put','target_verify','target_current','source_delete','source_absence','privacy_read','privacy_delete','privacy_absence','privacy_source_read','privacy_source_delete','privacy_source_absence','recovery_read','source_inventory','target_inventory','source_retirement_inventory','target_erasure_inventory','source_erasure_inventory'));
--> statement-breakpoint
CREATE FUNCTION freeholder_media_transfer_fact_digest(value jsonb) RETURNS text LANGUAGE sql IMMUTABLE STRICT AS $$
 SELECT encode(sha256(convert_to('freeholder:verified-storage-transfer:v1','UTF8')||decode('00','hex')||convert_to(freeholder_source_receipt_canonical(value),'UTF8')),'hex')
$$;
--> statement-breakpoint
CREATE FUNCTION freeholder_media_transfer_requests_drained(original_object uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT NOT EXISTS(SELECT 1 FROM media_storage_transfer_requests request JOIN media_storage_transfer_calls caller ON caller.id=request.call_id WHERE caller.object_id=original_object AND request.state IN ('admitted','unknown'))
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION freeholder_media_transfer_object_retired(original_object uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM media_storage_transfer_objects WHERE id=original_object)
 AND freeholder_media_transfer_requests_drained(original_object)
 AND NOT EXISTS(SELECT 1 FROM media_storage_transfer_calls WHERE object_id=original_object AND state IN ('admitted','unknown'))
 AND NOT EXISTS(SELECT 1 FROM media_object_writes physical WHERE physical.id IN (SELECT receipt_id FROM media_storage_transfer_receipts WHERE object_id=original_object UNION SELECT physical_receipt_id FROM media_storage_transfer_calls WHERE object_id=original_object AND physical_receipt_id IS NOT NULL) AND (physical.deleted_at IS NULL OR physical.state NOT IN ('accepted','confirmed_absent')))
 AND EXISTS(SELECT 1 FROM media_storage_provider_inventories proof WHERE proof.object_id=original_object AND proof.side='source' AND proof.purpose='erasure' AND proof.state='complete')
 AND (NOT EXISTS(SELECT 1 FROM media_storage_transfer_calls WHERE object_id=original_object AND kind='target_put') OR EXISTS(SELECT 1 FROM media_storage_provider_inventories proof WHERE proof.object_id=original_object AND proof.side='target' AND proof.purpose='erasure' AND proof.state='complete'))
$$;
--> statement-breakpoint
CREATE FUNCTION freeholder_media_transfer_request_evidence_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE caller media_storage_transfer_calls; original_object uuid; request media_storage_transfer_requests;
BEGIN
 IF current_setting('freeholder.media_transfer_v1',true) IS DISTINCT FROM '1' OR TG_OP='DELETE' THEN RAISE EXCEPTION 'Use the shared original provider request writer' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='media_storage_transfer_requests' THEN
  SELECT * INTO caller FROM media_storage_transfer_calls WHERE id=NEW.call_id;
  IF caller.id IS NULL OR NEW.runtime_identity IS DISTINCT FROM caller.runtime_identity THEN RAISE EXCEPTION 'Request belongs to its actual original caller/runtime' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' THEN
   IF caller.state<>'admitted' OR NEW.state<>'admitted' OR NEW.redacted_at IS NOT NULL OR NEW.returned_at IS NOT NULL OR NEW.stop_receipt_id IS NOT NULL OR NEW.observation_count<>0 OR NEW.descriptor_digest<>freeholder_media_transfer_fact_digest(NEW.descriptor) OR NEW.descriptor->'binding'->>'namespace'<>caller.namespace OR NEW.key_digest IS NOT NULL AND NEW.key_digest<>encode(sha256(convert_to('freeholder:media-object-key:v1','UTF8')||decode('00','hex')||convert_to(NEW.descriptor->>'key','UTF8')),'hex') THEN RAISE EXCEPTION 'Request must be admitted before its exact original physical I/O' USING ERRCODE='23514'; END IF;
  ELSE
   IF ROW(NEW.id,NEW.call_id,NEW.key_digest,NEW.descriptor_digest,NEW.token_digest,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.call_id,OLD.key_digest,OLD.descriptor_digest,OLD.token_digest,OLD.created_at) OR NEW.runtime_identity IS DISTINCT FROM OLD.runtime_identity OR OLD.returned_at IS NOT NULL AND NEW.returned_at IS DISTINCT FROM OLD.returned_at THEN RAISE EXCEPTION 'Original request admission and actual finish are immutable' USING ERRCODE='23514'; END IF;
   IF NEW.descriptor IS DISTINCT FROM OLD.descriptor AND NOT(OLD.redacted_at IS NULL AND NEW.redacted_at IS NOT NULL AND (freeholder_media_transfer_object_retired(caller.object_id) OR freeholder_media_original_call_retired(caller.id)) AND NEW.descriptor=jsonb_build_object('kind',OLD.descriptor->'kind','binding',jsonb_build_object('kind',OLD.descriptor->'binding'->'kind','namespace',caller.namespace,'location','{}'::jsonb))||(CASE WHEN OLD.key_digest IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('key','retained:'||OLD.key_digest) END)) THEN RAISE EXCEPTION 'Original request descriptor can only be minimized after every copy retires' USING ERRCODE='23514'; END IF;
   IF NEW.observation_count<OLD.observation_count OR NEW.observation_count>OLD.observation_count+1 OR NEW.observation_count<>(SELECT count(*) FROM media_storage_transfer_request_observations WHERE request_id=OLD.id) THEN RAISE EXCEPTION 'Original request observation count is exact and monotone' USING ERRCODE='23514'; END IF;
   IF EXISTS(SELECT 1 FROM media_storage_transfer_reviews review WHERE review.id=OLD.stop_receipt_id AND review.object_receipt_id IS NOT NULL AND review.outcome='applied') AND ROW(NEW.stop_receipt_id,NEW.returned_at) IS DISTINCT FROM ROW(OLD.stop_receipt_id,OLD.returned_at) THEN RAISE EXCEPTION 'An affirmative review never invents the original physical return or replaces its review' USING ERRCODE='23514'; END IF;
   IF NEW.state='stopped' AND OLD.state<>'stopped' AND NOT EXISTS(SELECT 1 FROM media_storage_transfer_reviews review WHERE review.id=NEW.stop_receipt_id AND review.call_id=OLD.call_id) THEN RAISE EXCEPTION 'Physical request stop requires its original caller review' USING ERRCODE='23514'; END IF;
  END IF;
 ELSE
  SELECT * INTO request FROM media_storage_transfer_requests WHERE id=NEW.request_id;
  SELECT * INTO caller FROM media_storage_transfer_calls WHERE id=request.call_id;
  IF caller.id IS NULL THEN RAISE EXCEPTION 'Original physical request is missing' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' THEN
   IF NEW.ordinal<>request.observation_count+1 OR NEW.facts_digest<>freeholder_media_transfer_fact_digest(NEW.facts) THEN RAISE EXCEPTION 'Append the exact original provider fact once in order' USING ERRCODE='23514'; END IF;
  ELSIF ROW(NEW.id,NEW.request_id,NEW.ordinal,NEW.facts_digest,NEW.bytes,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.request_id,OLD.ordinal,OLD.facts_digest,OLD.bytes,OLD.created_at) OR NOT(OLD.redacted_at IS NULL AND NEW.redacted_at IS NOT NULL AND (freeholder_media_transfer_object_retired(caller.object_id) OR freeholder_media_original_call_retired(caller.id)) AND NEW.facts=jsonb_build_object('stage',OLD.facts->'stage','status',OLD.facts->'status')) THEN RAISE EXCEPTION 'Original provider facts are append-only until scoped minimization' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER transfer_request_evidence BEFORE INSERT OR UPDATE OR DELETE ON media_storage_transfer_requests FOR EACH ROW EXECUTE FUNCTION freeholder_media_transfer_request_evidence_guard();
--> statement-breakpoint
CREATE TRIGGER transfer_request_observation_evidence BEFORE INSERT OR UPDATE OR DELETE ON media_storage_transfer_request_observations FOR EACH ROW EXECUTE FUNCTION freeholder_media_transfer_request_evidence_guard();
--> statement-breakpoint
CREATE FUNCTION freeholder_media_provider_inventory_evidence_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE header media_storage_provider_inventories; page media_storage_provider_inventory_pages; plan media_storage_transfer_plans; caller media_storage_transfer_calls; original_object uuid;
BEGIN
 IF current_setting('freeholder.media_transfer_v1',true) IS DISTINCT FROM '1' OR TG_OP='DELETE' THEN RAISE EXCEPTION 'Use the shared original provider inventory writer' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='media_storage_provider_inventories' THEN
  IF NEW.plan_id IS NULL THEN RETURN NEW; END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM media_storage_provider_inventories WHERE id=NEW.inventory_id AND plan_id IS NULL) THEN RETURN NEW; END IF;
 END IF;
 IF TG_TABLE_NAME='media_storage_provider_inventories' THEN
  SELECT * INTO plan FROM media_storage_transfer_plans WHERE id=NEW.plan_id;
  IF plan.id IS NULL OR NEW.namespace<>(CASE WHEN NEW.side='source' THEN plan.source_namespace ELSE plan.target_namespace END) OR NEW.binding IS DISTINCT FROM (CASE WHEN NEW.side='source' THEN plan.original_source ELSE plan.original_target END) THEN RAISE EXCEPTION 'Inventory belongs to the exact original private resource' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' THEN
   IF NEW.state<>'capturing' OR NEW.first_digest IS NOT NULL OR NEW.confirmed_digest IS NOT NULL OR NEW.completed_at IS NOT NULL OR NEW.purpose='baseline' AND (NEW.object_id IS NOT NULL OR NEW.anchor_call_id IS NOT NULL) OR NEW.purpose<>'baseline' AND NOT EXISTS(SELECT 1 FROM media_storage_transfer_calls WHERE id=NEW.anchor_call_id AND object_id=NEW.object_id AND namespace=NEW.namespace AND state='returned' AND returned_at IS NOT NULL) THEN RAISE EXCEPTION 'Capture the complete original inventory before provider enumeration' USING ERRCODE='23514'; END IF;
  ELSE
   IF ROW(NEW.id,NEW.plan_id,NEW.object_id,NEW.anchor_call_id,NEW.side,NEW.purpose,NEW.namespace,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.plan_id,OLD.object_id,OLD.anchor_call_id,OLD.side,OLD.purpose,OLD.namespace,OLD.created_at) OR NEW.binding IS DISTINCT FROM OLD.binding OR OLD.state<>'capturing' AND (to_jsonb(NEW)-'updated_at') IS DISTINCT FROM (to_jsonb(OLD)-'updated_at') OR OLD.first_digest IS NOT NULL AND NEW.first_digest IS DISTINCT FROM OLD.first_digest THEN RAISE EXCEPTION 'The complete first provider inventory is immutable' USING ERRCODE='23514'; END IF;
   IF NEW.state='complete' AND (NEW.first_digest IS DISTINCT FROM NEW.confirmed_digest OR EXISTS(SELECT 1 FROM media_storage_transfer_calls WHERE object_id IN (SELECT id FROM media_storage_transfer_objects WHERE plan_id=NEW.plan_id) AND state IN ('admitted','unknown')) OR EXISTS(SELECT 1 FROM media_storage_transfer_requests request JOIN media_storage_transfer_calls caller ON caller.id=request.call_id WHERE caller.object_id IN (SELECT id FROM media_storage_transfer_objects WHERE plan_id=NEW.plan_id) AND request.state IN ('admitted','unknown')) OR EXISTS(SELECT required.pass_number FROM generate_series(0,1) AS required(pass_number) WHERE NOT EXISTS(SELECT 1 FROM media_storage_provider_inventory_pages WHERE inventory_id=OLD.id AND media_storage_provider_inventory_pages.pass=required.pass_number AND kind='configuration'))) THEN RAISE EXCEPTION 'Every actual original caller and both complete provider passes must finish' USING ERRCODE='23514'; END IF;
  END IF;
 ELSIF TG_TABLE_NAME='media_storage_provider_inventory_pages' THEN
  SELECT * INTO header FROM media_storage_provider_inventories WHERE id=NEW.inventory_id;
  SELECT * INTO caller FROM media_storage_transfer_calls WHERE id=NEW.call_id;
  IF header.id IS NULL THEN RAISE EXCEPTION 'Original provider inventory header is missing' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' THEN
   IF header.state<>'capturing' OR caller.state<>'returned' OR caller.returned_at IS NULL OR caller.namespace<>header.namespace OR caller.kind<>(CASE WHEN header.purpose='baseline' THEN (CASE WHEN header.side='source' THEN 'source_inventory' ELSE 'target_inventory' END) WHEN header.purpose='retirement' THEN 'source_retirement_inventory' WHEN header.side='source' THEN 'source_erasure_inventory' ELSE 'target_erasure_inventory' END) OR NEW.cursor_digest<>freeholder_media_transfer_fact_digest(coalesce(NEW.cursor,'null'::jsonb)) OR NEW.kind<>'configuration' AND NEW.cursor IS NOT NULL AND NOT EXISTS(SELECT 1 FROM media_storage_provider_inventory_pages prior WHERE prior.inventory_id=header.id AND prior.pass=NEW.pass AND prior.kind=NEW.kind AND prior.next_cursor=NEW.cursor) THEN RAISE EXCEPTION 'Append a finished original provider page to its exact cursor chain' USING ERRCODE='23514'; END IF;
  ELSIF (to_jsonb(NEW)-ARRAY['cursor','next_cursor','redacted_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['cursor','next_cursor','redacted_at']) OR OLD.redacted_at IS NOT NULL OR NEW.redacted_at IS NULL OR NEW.cursor IS NOT NULL OR NEW.next_cursor IS NOT NULL OR NOT EXISTS(SELECT 1 FROM media_storage_transfer_objects object WHERE object.plan_id=header.plan_id AND freeholder_media_transfer_object_retired(object.id) AND (OLD.cursor->>'key'=object.object_key OR OLD.next_cursor->>'key'=object.object_key OR OLD.cursor->>'key'=object.target_object_key OR OLD.next_cursor->>'key'=object.target_object_key)) THEN RAISE EXCEPTION 'Original page facts are immutable except scoped locator minimization' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT * INTO header FROM media_storage_provider_inventories WHERE id=NEW.inventory_id;
  SELECT * INTO page FROM media_storage_provider_inventory_pages WHERE id=NEW.page_id;
  IF header.id IS NULL OR page.id IS NULL OR page.inventory_id<>header.id OR page.pass<>NEW.pass THEN RAISE EXCEPTION 'Provider resource belongs to its original inventory page' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' THEN
   IF header.state<>'capturing' OR NEW.original_object_id IS NOT NULL OR NEW.ordinal<0 OR NEW.ordinal>=page.entry_count OR NEW.entry_digest<>freeholder_media_transfer_fact_digest(NEW.entry) OR NEW.key_digest<>encode(sha256(convert_to('freeholder:media-object-key:v1','UTF8')||decode('00','hex')||convert_to(NEW.entry->>'key','UTF8')),'hex') THEN RAISE EXCEPTION 'Original provider resource is observation, never guessed ownership' USING ERRCODE='23514'; END IF;
  ELSIF ROW(NEW.id,NEW.page_id,NEW.inventory_id,NEW.pass,NEW.ordinal,NEW.entry_digest,NEW.key_digest,NEW.resource_digest,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.page_id,OLD.inventory_id,OLD.pass,OLD.ordinal,OLD.entry_digest,OLD.key_digest,OLD.resource_digest,OLD.created_at) THEN RAISE EXCEPTION 'Original provider inventory resource identity is immutable' USING ERRCODE='23514';
  ELSIF NEW.entry IS DISTINCT FROM OLD.entry THEN
   IF OLD.redacted_at IS NOT NULL OR NEW.redacted_at IS NULL OR NOT EXISTS(SELECT 1 FROM media_storage_transfer_objects object WHERE object.plan_id=header.plan_id AND NEW.key_digest=(CASE WHEN header.side='source' THEN object.key_digest ELSE object.target_key_digest END) AND freeholder_media_transfer_object_retired(object.id)) OR NEW.entry<>jsonb_build_object('kind',OLD.entry->'kind','key','retained:'||OLD.key_digest,'bytes',OLD.entry->'bytes','current',OLD.entry->'current') THEN RAISE EXCEPTION 'Provider locator minimization requires exact completed original lineage' USING ERRCODE='23514'; END IF;
  ELSIF ROW(NEW.original_object_id,NEW.attribution) IS DISTINCT FROM ROW(OLD.original_object_id,OLD.attribution) AND NOT(header.state='capturing' AND header.side='source' AND header.purpose='baseline' AND OLD.original_object_id IS NULL AND NEW.attribution='original_current' AND EXISTS(SELECT 1 FROM media_storage_transfer_receipts receipt JOIN media_storage_transfer_objects object ON object.id=receipt.object_id WHERE object.id=NEW.original_object_id AND object.plan_id=header.plan_id AND receipt.original_snapshot->'providerRevision'=NEW.entry->'revision')) THEN RAISE EXCEPTION 'Only the actual captured original provider result can attribute a version' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER provider_inventory_evidence BEFORE INSERT OR UPDATE OR DELETE ON media_storage_provider_inventories FOR EACH ROW EXECUTE FUNCTION freeholder_media_provider_inventory_evidence_guard();
--> statement-breakpoint
CREATE TRIGGER provider_inventory_page_evidence BEFORE INSERT OR UPDATE OR DELETE ON media_storage_provider_inventory_pages FOR EACH ROW EXECUTE FUNCTION freeholder_media_provider_inventory_evidence_guard();
--> statement-breakpoint
CREATE TRIGGER provider_inventory_entry_evidence BEFORE INSERT OR UPDATE OR DELETE ON media_storage_provider_inventory_entries FOR EACH ROW EXECUTE FUNCTION freeholder_media_provider_inventory_evidence_guard();
--> statement-breakpoint
CREATE FUNCTION freeholder_media_provider_origin_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.writer_protocol IS DISTINCT FROM OLD.writer_protocol THEN RAISE EXCEPTION 'Historical provider protocol cannot be backfilled or rebound' USING ERRCODE='23514'; END IF;
  IF OLD.provider_revision_digest IS NOT NULL AND NEW.provider_revision_digest IS DISTINCT FROM OLD.provider_revision_digest THEN RAISE EXCEPTION 'Actual original provider revision digest is immutable' USING ERRCODE='23514'; END IF;
  IF NEW.provider_revision IS DISTINCT FROM OLD.provider_revision THEN
   IF NEW.provider_revision IS NULL THEN
    IF NEW.redacted_at IS NULL OR NEW.deleted_at IS NULL THEN RAISE EXCEPTION 'Keep original provider revision until completed physical erasure' USING ERRCODE='23514'; END IF;
   ELSIF OLD.writer_runtime_id IS NULL OR NEW.provider_revision_digest<>freeholder_media_transfer_fact_digest(NEW.provider_revision) OR NEW.provider_revision->>'namespace'<>NEW.storage_namespace OR encode(sha256(convert_to('freeholder:media-object-key:v1','UTF8')||decode('00','hex')||convert_to(NEW.provider_revision->>'key','UTF8')),'hex')<>NEW.key_digest THEN RAISE EXCEPTION 'Only an actual tracked original provider result supplies revision provenance' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER media_provider_origin BEFORE INSERT OR UPDATE ON media_object_writes FOR EACH ROW EXECUTE FUNCTION freeholder_media_provider_origin_guard();
-- No request capability is published in this intermediate owned tail yet.
-- Root must retain fail-closed request availability until final SQL, original
-- recovery/stop proof and ordinary-media integration have been completed.

--> statement-breakpoint
-- Only explicitly admitted copy receipts belong to this original lineage.
-- Equal keys in another namespace/generation confer no deletion authority.
CREATE OR REPLACE FUNCTION freeholder_media_transfer_retirement_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL AND EXISTS(
  SELECT 1 FROM media_storage_transfer_receipts member JOIN media_storage_transfer_objects object ON object.id=member.object_id
  WHERE member.receipt_id=OLD.id AND (
   EXISTS(SELECT 1 FROM media_object_writes target JOIN media_storage_transfer_calls caller ON caller.physical_receipt_id=target.id WHERE caller.object_id=object.id AND caller.kind='target_put' AND (target.deleted_at IS NULL OR target.state IN ('unverified','started','unknown')))
   OR EXISTS(SELECT 1 FROM media_storage_transfer_calls caller WHERE caller.object_id=object.id AND caller.state IN ('admitted','unknown'))
   OR NOT freeholder_media_transfer_requests_drained(object.id))) THEN
  RAISE EXCEPTION 'Every exact admitted copy and actual original request must retire before original erasure' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION freeholder_media_transfer_subrequest_retirement_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL AND EXISTS(
  SELECT 1 FROM media_storage_transfer_calls caller JOIN media_storage_transfer_requests request ON request.call_id=caller.id
  WHERE caller.physical_receipt_id=OLD.id AND request.state IN ('admitted','unknown')) THEN
  RAISE EXCEPTION 'An original physical request still lacks actual finish or exact reviewed stop proof' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER media_transfer_subrequest_retirement BEFORE UPDATE ON media_object_writes FOR EACH ROW EXECUTE FUNCTION freeholder_media_transfer_subrequest_retirement_guard();
-- Deliberately no request capability yet: ordinary/recovery/stop integration
-- remains unfinished and root must not activate this intermediate source.

--> statement-breakpoint
-- A warm process that knows only the earlier transfer ABI is still old.
-- Readiness checks cannot fence its already-admitted work or mint stop proof.
CREATE OR REPLACE FUNCTION freeholder_media_transfer_runtime_fence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (current_setting('freeholder.media_transfer_runtime_v1',true) IS DISTINCT FROM '1'
  OR current_setting('freeholder.media_transfer_requests_runtime_v1',true) IS DISTINCT FROM '1')
  AND current_setting('freeholder.media_transfer_operator_v1',true) IS DISTINCT FROM '1' THEN
  RAISE EXCEPTION 'Original media requires its verified original request writer' USING ERRCODE='23514';
 END IF;
 PERFORM pg_advisory_xact_lock_shared(1691709,82);
 RETURN NULL;
END $$;
-- The complete request capability remains UNPUBLISHED. Do not activate this
-- intermediate source by adding an alias/placeholder capability function.

--> statement-breakpoint
-- Ordinary/multipart callers use the same actual request ledger, with one
-- immutable original context. No fake transfer object is created for them.
ALTER TABLE media_storage_transfer_calls DROP CONSTRAINT media_storage_transfer_calls_kind;
--> statement-breakpoint
ALTER TABLE media_storage_transfer_calls ADD CONSTRAINT media_storage_transfer_calls_kind CHECK(kind IN ('source_read','target_probe','target_put','target_verify','target_current','source_delete','source_absence','privacy_read','privacy_delete','privacy_absence','privacy_source_read','privacy_source_delete','privacy_source_absence','recovery_read','source_inventory','target_inventory','source_retirement_inventory','target_erasure_inventory','source_erasure_inventory','ordinary_put','ordinary_delete','multipart_create','multipart_complete','multipart_abort','ordinary_recovery_read','multipart_recovery_inspect','ordinary_retirement_inventory','multipart_retirement_inventory'));
--> statement-breakpoint
ALTER TABLE media_storage_transfer_calls ADD CONSTRAINT media_storage_calls_original_parent CHECK(num_nonnulls(object_id,object_receipt_id,multipart_operation_id)=1);
--> statement-breakpoint
CREATE INDEX media_storage_calls_receipt_idx ON media_storage_transfer_calls(object_receipt_id,created_at,id);
--> statement-breakpoint
CREATE INDEX media_storage_calls_multipart_idx ON media_storage_transfer_calls(multipart_operation_id,created_at,id);
--> statement-breakpoint
CREATE UNIQUE INDEX media_storage_calls_original_write_idx ON media_storage_transfer_calls(object_receipt_id) WHERE kind IN ('ordinary_put','ordinary_delete');
--> statement-breakpoint
CREATE UNIQUE INDEX media_storage_calls_original_multipart_idx ON media_storage_transfer_calls(multipart_operation_id) WHERE kind IN ('multipart_create','multipart_complete','multipart_abort');
--> statement-breakpoint
CREATE FUNCTION freeholder_media_original_caller_context_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE receipt media_object_writes; operation media_multipart_operations; resource media_multipart_resources;
BEGIN
 IF current_setting('freeholder.media_transfer_requests_runtime_v1',true) IS DISTINCT FROM '1' OR current_setting('freeholder.media_transfer_v1',true) IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'Original physical callers require the current shared request writer' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
  IF ROW(NEW.object_id,NEW.object_receipt_id,NEW.multipart_operation_id) IS DISTINCT FROM ROW(OLD.object_id,OLD.object_receipt_id,OLD.multipart_operation_id) OR OLD.quota_token IS NOT NULL AND NEW.quota_token IS DISTINCT FROM OLD.quota_token THEN RAISE EXCEPTION 'An original caller cannot change its captured resource context' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF NEW.redacted_at IS NOT NULL OR NEW.state<>'admitted' OR NEW.returned_at IS NOT NULL OR NEW.stopped_at IS NOT NULL OR NEW.stop_receipt_id IS NOT NULL OR NEW.result_digest IS NOT NULL OR NEW.observed_accepted_at IS NOT NULL THEN RAISE EXCEPTION 'A new original caller cannot be born returned, reviewed or already minimized' USING ERRCODE='23514'; END IF;
 IF coalesce(NEW.runtime_identity->>'kind','') NOT IN ('linux','node') OR NEW.runtime_identity->>'instance' IS DISTINCT FROM NEW.runtime_id::text OR NEW.runtime_id::text IS DISTINCT FROM current_setting('freeholder.media_caller_runtime_uuid',true) OR coalesce(NEW.runtime_identity->>'pid','') !~ '^[1-9][0-9]*$' THEN RAISE EXCEPTION 'New caller identity must come from its actual server runtime, not a historical birth' USING ERRCODE='23514'; END IF;
 IF NEW.object_receipt_id IS NOT NULL THEN
  SELECT * INTO receipt FROM media_object_writes WHERE id=NEW.object_receipt_id;
  IF receipt.id IS NULL OR NEW.namespace IS DISTINCT FROM receipt.storage_namespace OR encode(sha256(convert_to('freeholder:media-object-key:v1','UTF8')||decode('00','hex')||convert_to(NEW.physical_key,'UTF8')),'hex') IS DISTINCT FROM receipt.key_digest OR NEW.kind NOT IN ('ordinary_put','ordinary_delete','ordinary_recovery_read','ordinary_retirement_inventory') THEN RAISE EXCEPTION 'Ordinary caller must name its exact captured original receipt' USING ERRCODE='23514'; END IF;
  IF NEW.kind IN ('ordinary_put','ordinary_delete') AND (receipt.created_at<>transaction_timestamp() OR receipt.writer_runtime_id IS DISTINCT FROM NEW.runtime_id OR receipt.state<>'started' OR NEW.physical_receipt_id IS DISTINCT FROM receipt.id OR NEW.kind IS DISTINCT FROM (CASE WHEN receipt.operation_kind='put' THEN 'ordinary_put' ELSE 'ordinary_delete' END)) THEN RAISE EXCEPTION 'An earlier intent cannot acquire a new original dispatch admission' USING ERRCODE='23514'; END IF;
 ELSIF NEW.multipart_operation_id IS NOT NULL THEN
  SELECT * INTO operation FROM media_multipart_operations WHERE id=NEW.multipart_operation_id;
  SELECT * INTO resource FROM media_multipart_resources WHERE id=operation.resource_id;
  IF operation.id IS NULL OR resource.id IS NULL OR NEW.namespace IS DISTINCT FROM resource.storage_namespace OR encode(sha256(convert_to('freeholder:media-object-key:v1','UTF8')||decode('00','hex')||convert_to(NEW.physical_key,'UTF8')),'hex') IS DISTINCT FROM resource.key_digest OR NEW.kind NOT IN ('multipart_create','multipart_complete','multipart_abort','multipart_recovery_inspect','multipart_retirement_inventory') THEN RAISE EXCEPTION 'Multipart caller must name its exact original operation and namespace' USING ERRCODE='23514'; END IF;
  IF NEW.kind IN ('multipart_create','multipart_complete','multipart_abort') AND (operation.created_at<>transaction_timestamp() OR operation.writer_runtime_id IS DISTINCT FROM NEW.runtime_id OR operation.state<>'started' OR NEW.kind IS DISTINCT FROM 'multipart_'||operation.operation_kind) THEN RAISE EXCEPTION 'An earlier multipart intent cannot acquire a new original caller birth' USING ERRCODE='23514'; END IF;
 ELSIF NEW.kind IN ('ordinary_put','ordinary_delete','ordinary_recovery_read','ordinary_retirement_inventory','multipart_create','multipart_complete','multipart_abort','multipart_recovery_inspect','multipart_retirement_inventory') THEN RAISE EXCEPTION 'Ordinary work cannot borrow a transfer context' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER media_original_caller_context BEFORE INSERT OR UPDATE ON media_storage_transfer_calls FOR EACH ROW EXECUTE FUNCTION freeholder_media_original_caller_context_guard();
-- Request capability remains unpublished until ordinary/multipart recovery,
-- exact stop review and physical retirement/minimization are fully integrated.

--> statement-breakpoint
CREATE OR REPLACE FUNCTION freeholder_media_transfer_runtime_fence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (current_setting('freeholder.media_transfer_runtime_v1',true) IS DISTINCT FROM '1'
  OR current_setting('freeholder.media_transfer_requests_runtime_v1',true) IS DISTINCT FROM '1'
  OR current_setting('freeholder.media_original_scope_runtime_v1',true) IS DISTINCT FROM '1'
  OR coalesce(current_setting('freeholder.media_caller_runtime_uuid',true),'') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
  AND current_setting('freeholder.media_transfer_operator_v1',true) IS DISTINCT FROM '1' THEN
  RAISE EXCEPTION 'Original media requires its verified original request writer' USING ERRCODE='23514';
 END IF;
 PERFORM pg_advisory_xact_lock_shared(1691709,82);
 RETURN NULL;
END $$;
-- No completed request capability is published by this continuation.

--> statement-breakpoint
CREATE FUNCTION freeholder_media_original_quota_reservation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.quota_token IS NULL AND NEW.quota_token IS NOT NULL THEN
  IF NEW.kind<>'ordinary_put' OR NEW.state<>'admitted' OR NOT EXISTS(SELECT 1 FROM storage_quota_objects quota JOIN media_object_writes receipt ON receipt.id=NEW.object_receipt_id WHERE quota.namespace=NEW.namespace AND quota.object_key=NEW.physical_key AND quota.pending_token=NEW.quota_token AND quota.bytes>=receipt.bytes) THEN RAISE EXCEPTION 'Quota and its exact original caller reservation must commit together' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER media_original_quota_reservation AFTER UPDATE ON media_storage_transfer_calls DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION freeholder_media_original_quota_reservation_guard();
-- Full semantics are still unfinished. No request capability is published.

--> statement-breakpoint
-- One original context, never a fabricated transfer plan for ordinary work.
ALTER TABLE media_storage_provider_inventories ADD CONSTRAINT media_storage_provider_inventory_parent CHECK(num_nonnulls(plan_id,object_receipt_id,multipart_operation_id)=1 AND (plan_id IS NULL OR original_witness IS NULL AND proof_call_id IS NULL));
--> statement-breakpoint
CREATE UNIQUE INDEX media_storage_provider_inventory_original_idx ON media_storage_provider_inventories(anchor_call_id,proof_call_id,purpose) WHERE plan_id IS NULL;
--> statement-breakpoint
-- Independent stop is not a caller return or proof of remote non-application.
-- Only fresh affirmative original nonce/body/inventory review consumes it.
CREATE FUNCTION freeholder_media_original_executor_stopped(original_call uuid, original_drain uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(
  SELECT 1 FROM media_storage_transfer_calls caller JOIN media_storage_writer_drains drain ON drain.id=original_drain AND drain.namespace=caller.namespace
  WHERE caller.id=original_call AND caller.object_id IS NULL AND caller.multipart_operation_id IS NULL AND caller.object_receipt_id IS NOT NULL AND caller.kind='ordinary_put'
   AND drain.state IN ('verified','released') AND drain.verified_at IS NOT NULL AND drain.verified_at>=drain.created_at AND caller.created_at<=drain.created_at
   AND (drain.state='verified' AND drain.released_at IS NULL OR drain.state='released' AND drain.released_at>=drain.verified_at)
   AND drain.stop_proof_digest ~ '^[a-f0-9]{64}$' AND drain.source_revision ~ '^[a-f0-9]{40}$'
   AND caller.runtime_identity->>'kind'='linux' AND caller.runtime_identity->>'instance'=caller.runtime_id::text
   AND caller.runtime_identity->>'boot' ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
   AND caller.runtime_identity->>'pid' ~ '^[1-9][0-9]*$' AND caller.runtime_identity->>'startTicks' ~ '^[0-9]+$'
   AND drain.executor_identity='linux-systemd:'||(caller.runtime_identity->>'boot')
   AND drain.original_processes->>'format'='freeholder.media-writer-drain/v1' AND drain.original_processes->>'boot'=caller.runtime_identity->>'boot'
   AND drain.original_processes->>'unit'='freeholder.service' AND drain.original_processes->>'invocation' ~ '^[a-f0-9]{32}$'
   AND drain.original_processes->>'group' ~ '^/[A-Za-z0-9_./-]+$' AND position('..' in drain.original_processes->>'group')=0
   AND jsonb_typeof(drain.original_processes->'processes')='array'
   AND jsonb_array_length(drain.original_processes->'processes') BETWEEN 1 AND 4096
   AND (SELECT count(*) FROM jsonb_array_elements(drain.original_processes->'processes'))=(SELECT count(DISTINCT process->>'pid') FROM jsonb_array_elements(drain.original_processes->'processes') process)
   AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(drain.original_processes->'processes') process WHERE coalesce(process->>'pid','') !~ '^[1-9][0-9]*$' OR coalesce(process->>'startTicks','') !~ '^[0-9]+$')
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(drain.original_processes->'processes') process WHERE process->>'pid'=caller.runtime_identity->>'pid' AND process->>'startTicks'=caller.runtime_identity->>'startTicks')
   AND (SELECT count(*) FROM media_storage_transfer_requests request WHERE request.call_id=caller.id AND request.descriptor->>'kind'='object.put')=1
   AND EXISTS(SELECT 1 FROM media_storage_transfer_requests request WHERE request.call_id=caller.id AND request.descriptor->>'kind'='object.put' AND request.created_at<=drain.created_at AND request.descriptor->'createOnly'='true'::jsonb AND request.descriptor->>'key'=caller.physical_key AND request.descriptor->>'sha256' ~ '^[a-f0-9]{64}$' AND request.descriptor->>'bytes' ~ '^[0-9]+$')
   AND NOT EXISTS(SELECT 1 FROM media_storage_transfer_requests request WHERE request.call_id=caller.id AND (request.created_at>drain.verified_at OR request.runtime_identity IS DISTINCT FROM caller.runtime_identity OR request.descriptor_digest IS DISTINCT FROM freeholder_media_transfer_fact_digest(request.descriptor) OR request.descriptor->'binding'->>'namespace' IS DISTINCT FROM caller.namespace OR request.descriptor->>'kind' IN ('object.delete','multipart.create','multipart.complete','multipart.abort')))
 )
$$;
--> statement-breakpoint
-- A completed affirmative review is a DISTINCT quiescence/identity authority.
-- It never supplies an actual return/writer finish. Immutable birth, nonce,
-- reviewed full-byte result and complete original positive pages stay linked.
CREATE FUNCTION freeholder_media_original_applied_review(original_call uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 WITH RECURSIVE authority AS (
  SELECT caller.id AS call_id,original.id AS receipt_id,review.id AS review_id,review.stop_drain_id,inventory.id AS inventory_id,inventory.binding,inventory.redacted_at AS inventory_redacted
  FROM media_storage_transfer_calls caller JOIN media_object_writes original ON original.id=caller.object_receipt_id
  JOIN media_storage_transfer_reviews review ON review.id=caller.stop_receipt_id
  JOIN media_storage_provider_inventories inventory ON inventory.id=review.inventory_id
  JOIN media_storage_transfer_calls proof ON proof.id=review.read_call_id
  WHERE caller.id=original_call AND caller.kind='ordinary_put' AND caller.object_id IS NULL AND caller.multipart_operation_id IS NULL
   AND caller.state='stopped' AND caller.stopped_at IS NOT NULL AND original.operation_kind='put' AND original.original_reservation_id IS NOT NULL AND original.state='accepted'
   AND original.writer_runtime_id=caller.runtime_id AND original.storage_namespace=caller.namespace
   AND review.call_id=caller.id AND review.object_receipt_id=original.id AND review.object_id IS NULL AND review.multipart_operation_id IS NULL AND review.outcome='applied' AND NOT review.permits_retry
   AND review.original_call_witness ~ '^[a-f0-9]{64}$' AND review.provider_evidence_digest=original.evidence_digest
   AND inventory.plan_id IS NULL AND inventory.object_receipt_id=original.id AND inventory.anchor_call_id=caller.id AND inventory.proof_call_id=proof.id
   AND inventory.purpose='recovery' AND inventory.side='source' AND inventory.state='complete' AND inventory.completed_at IS NOT NULL
   AND inventory.original_witness ~ '^[a-f0-9]{64}$' AND inventory.first_digest ~ '^[a-f0-9]{64}$' AND inventory.first_digest=inventory.confirmed_digest
   AND proof.object_receipt_id=original.id AND proof.kind='ordinary_recovery_read' AND proof.namespace=caller.namespace AND proof.state='returned' AND proof.returned_at IS NOT NULL AND proof.result_absent IS NULL
   AND proof.result_sha256=original.sha256 AND proof.result_bytes=original.bytes
   AND (proof.redacted_at IS NOT NULL OR freeholder_media_transfer_fact_digest(proof.result_revision)=original.provider_revision_digest)
   AND (SELECT count(*) FROM media_storage_transfer_requests request WHERE request.call_id=caller.id AND request.descriptor->>'kind'='object.put')=1
   AND EXISTS(SELECT 1 FROM media_storage_transfer_requests request WHERE request.call_id=caller.id AND request.descriptor->>'kind'='object.put'
    AND request.id::text=proof.result_request_proof->>'id' AND request.token_digest=proof.result_request_proof->>'tokenDigest')
   AND NOT EXISTS(SELECT 1 FROM media_storage_transfer_requests request WHERE request.call_id=caller.id AND (request.state NOT IN ('returned','stopped') OR request.state='stopped' AND request.stop_receipt_id IS DISTINCT FROM review.id OR request.runtime_identity IS DISTINCT FROM caller.runtime_identity OR request.descriptor->>'kind' IN ('object.delete','multipart.create','multipart.complete','multipart.abort')))
   AND (review.stop_drain_id IS NULL AND original.writer_finished_at IS NOT NULL AND caller.returned_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM media_storage_transfer_requests request WHERE request.call_id=caller.id AND request.returned_at IS NULL)
    OR review.stop_drain_id IS NOT NULL AND (caller.redacted_at IS NOT NULL OR EXISTS(SELECT 1 FROM media_storage_transfer_requests request WHERE request.call_id=caller.id AND request.redacted_at IS NOT NULL) OR freeholder_media_original_executor_stopped(caller.id,review.stop_drain_id)))
   AND EXISTS(SELECT 1 FROM media_storage_transfer_requests request WHERE request.call_id=proof.id)
   AND NOT EXISTS(SELECT 1 FROM media_storage_transfer_requests request WHERE request.call_id=proof.id AND (request.state<>'returned' OR request.returned_at IS NULL))
 ), walked(id,inventory_id,pass,kind,next_cursor) AS (
  SELECT page.id,page.inventory_id,page.pass,page.kind,page.next_cursor FROM media_storage_provider_inventory_pages page JOIN authority ON authority.inventory_id=page.inventory_id WHERE page.cursor IS NULL OR EXISTS(SELECT 1 FROM media_storage_provider_inventory_pages minimized WHERE minimized.inventory_id=page.inventory_id AND minimized.redacted_at IS NOT NULL)
  UNION
  SELECT page.id,page.inventory_id,page.pass,page.kind,page.next_cursor FROM walked prior JOIN media_storage_provider_inventory_pages page ON page.inventory_id=prior.inventory_id AND page.pass=prior.pass AND page.kind=prior.kind AND page.cursor=prior.next_cursor WHERE prior.next_cursor IS NOT NULL
 ), required AS (
  SELECT authority.*,pass_number,kind FROM authority CROSS JOIN generate_series(0,1) passes(pass_number)
   CROSS JOIN LATERAL unnest(CASE WHEN binding->>'kind'='s3' THEN ARRAY['configuration','objects','versions','sessions'] ELSE ARRAY['configuration','objects','versions','retained'] END) kinds(kind)
 )
 SELECT EXISTS(SELECT 1 FROM authority WHERE binding->>'kind' IN ('s3','replit'))
 AND NOT EXISTS(SELECT 1 FROM required WHERE NOT EXISTS(SELECT 1 FROM media_storage_provider_inventory_pages page WHERE page.inventory_id=required.inventory_id AND page.pass=required.pass_number AND page.kind=required.kind AND page.next_cursor IS NULL))
 AND NOT EXISTS(SELECT 1 FROM authority WHERE (SELECT count(*) FROM media_storage_provider_inventory_pages page WHERE page.inventory_id=authority.inventory_id AND page.kind='configuration')<>2)
 AND NOT EXISTS(SELECT 1 FROM media_storage_provider_inventory_pages page JOIN authority ON authority.inventory_id=page.inventory_id WHERE authority.inventory_redacted IS NULL AND NOT EXISTS(SELECT 1 FROM walked WHERE walked.id=page.id))
 AND NOT EXISTS(SELECT 1 FROM media_storage_provider_inventory_pages page JOIN authority ON authority.inventory_id=page.inventory_id JOIN media_storage_transfer_calls caller ON caller.id=page.call_id
  WHERE caller.object_receipt_id IS DISTINCT FROM authority.receipt_id OR caller.kind<>'ordinary_retirement_inventory' OR caller.state<>'returned' OR caller.returned_at IS NULL
   OR page.entry_count<>(SELECT count(*) FROM media_storage_provider_inventory_entries WHERE page_id=page.id)
   OR NOT EXISTS(SELECT 1 FROM media_storage_transfer_requests WHERE call_id=caller.id)
   OR EXISTS(SELECT 1 FROM media_storage_transfer_requests WHERE call_id=caller.id AND (state<>'returned' OR returned_at IS NULL)))
$$;
--> statement-breakpoint
CREATE FUNCTION freeholder_media_original_inventory_evidence_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE header media_storage_provider_inventories; receipt media_object_writes; original media_storage_transfer_calls; proof media_storage_transfer_calls; caller media_storage_transfer_calls; page media_storage_provider_inventory_pages;
BEGIN
 IF TG_OP='DELETE' OR current_setting('freeholder.media_transfer_v1',true) IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'Keep immutable original provider inventory evidence' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
  IF TG_TABLE_NAME='media_storage_provider_inventories' THEN header:=OLD;
  ELSE SELECT * INTO header FROM media_storage_provider_inventories WHERE id=NEW.inventory_id;
  END IF;
  SELECT * INTO receipt FROM media_object_writes WHERE id=header.object_receipt_id;
  IF header.plan_id IS NULL AND receipt.id IS NOT NULL AND freeholder_media_original_reservation_retired(receipt.original_reservation_id) THEN
   IF TG_TABLE_NAME='media_storage_provider_inventories' THEN
    IF OLD.redacted_at IS NULL AND NEW.redacted_at IS NOT NULL AND NEW.binding=jsonb_build_object('kind',OLD.binding->'kind','namespace',OLD.namespace,'location','{}'::jsonb)
     AND (to_jsonb(NEW)-ARRAY['binding','redacted_at','updated_at','state','blocker'])=(to_jsonb(OLD)-ARRAY['binding','redacted_at','updated_at','state','blocker']) AND (NEW.state=OLD.state AND NEW.blocker IS NOT DISTINCT FROM OLD.blocker OR OLD.state='capturing' AND NEW.state='blocked' AND NEW.blocker=coalesce(OLD.blocker,'original_resource_retired')) THEN RETURN NEW; END IF;
   ELSIF TG_TABLE_NAME='media_storage_provider_inventory_pages' THEN
    IF OLD.redacted_at IS NULL AND NEW.redacted_at IS NOT NULL AND NEW.cursor IS NULL AND NEW.next_cursor IS NULL AND (to_jsonb(NEW)-ARRAY['cursor','next_cursor','redacted_at'])=(to_jsonb(OLD)-ARRAY['cursor','next_cursor','redacted_at']) THEN RETURN NEW; END IF;
   ELSE
    IF OLD.redacted_at IS NULL AND NEW.redacted_at IS NOT NULL AND NEW.entry=jsonb_build_object('kind',OLD.entry->'kind','key','retained:'||OLD.key_digest,'bytes',OLD.entry->'bytes','current',OLD.entry->'current') AND (to_jsonb(NEW)-ARRAY['entry','redacted_at'])=(to_jsonb(OLD)-ARRAY['entry','redacted_at']) THEN RETURN NEW; END IF;
   END IF;
  END IF;
 END IF;
 IF TG_TABLE_NAME='media_storage_provider_inventories' THEN
  IF NEW.plan_id IS NOT NULL THEN RETURN NEW; END IF;
  SELECT * INTO receipt FROM media_object_writes WHERE id=NEW.object_receipt_id;
  SELECT * INTO original FROM media_storage_transfer_calls WHERE id=NEW.anchor_call_id;
  SELECT * INTO proof FROM media_storage_transfer_calls WHERE id=NEW.proof_call_id;
  IF NEW.multipart_operation_id IS NOT NULL OR NEW.object_id IS NOT NULL OR receipt.id IS NULL OR receipt.operation_kind<>'put' OR receipt.redacted_at IS NOT NULL OR receipt.deleted_at IS NOT NULL OR (receipt.writer_finished_at IS NULL AND NOT freeholder_media_original_applied_review(NEW.anchor_call_id) AND (NEW.purpose<>'recovery' OR NOT EXISTS(SELECT 1 FROM media_storage_writer_drains stop WHERE freeholder_media_original_executor_stopped(NEW.anchor_call_id,stop.id)))) OR NEW.side<>'source' OR NEW.purpose NOT IN ('recovery','retirement') OR coalesce(NEW.original_witness,'') !~ '^[a-f0-9]{64}$' OR NEW.namespace IS DISTINCT FROM receipt.storage_namespace OR NEW.binding->>'namespace' IS DISTINCT FROM receipt.storage_namespace OR NEW.binding->>'kind' IS DISTINCT FROM receipt.storage_kind OR NEW.binding->'location' IS DISTINCT FROM receipt.storage_location THEN RAISE EXCEPTION 'Ordinary inventory must capture its exact intact original receipt/resource; multipart retirement remains unavailable' USING ERRCODE='23514'; END IF;
  IF original.id IS NULL OR original.object_receipt_id IS DISTINCT FROM receipt.id OR original.kind<>'ordinary_put' OR original.runtime_id IS DISTINCT FROM receipt.writer_runtime_id OR original.namespace IS DISTINCT FROM NEW.namespace OR original.physical_key IS DISTINCT FROM receipt.object_key OR NOT EXISTS(SELECT 1 FROM media_storage_transfer_requests WHERE call_id=original.id) THEN RAISE EXCEPTION 'Keep the exact original originating caller and request birth' USING ERRCODE='23514'; END IF;
  IF original.returned_at IS NULL OR EXISTS(SELECT 1 FROM media_storage_transfer_requests WHERE call_id=original.id AND returned_at IS NULL) THEN
   IF NOT freeholder_media_original_applied_review(original.id) AND (NEW.purpose<>'recovery' OR NOT EXISTS(SELECT 1 FROM media_storage_writer_drains stop WHERE freeholder_media_original_executor_stopped(original.id,stop.id))) THEN RAISE EXCEPTION 'Actual original finishes or exact independent executor stop plus affirmative applied proof are required; stop never proves absence' USING ERRCODE='23514'; END IF;
  END IF;
  IF proof.id IS NULL OR proof.object_receipt_id IS DISTINCT FROM receipt.id OR proof.kind<>'ordinary_recovery_read' OR proof.state<>'returned' OR proof.returned_at IS NULL OR proof.namespace IS DISTINCT FROM NEW.namespace OR proof.physical_key IS DISTINCT FROM receipt.object_key THEN RAISE EXCEPTION 'Fresh original provider proof must finish in the exact original resource' USING ERRCODE='23514'; END IF;
  IF NEW.purpose='recovery' THEN
   IF proof.result_revision IS NULL OR proof.result_request_proof IS NULL OR proof.result_absent IS NOT NULL OR proof.result_sha256 IS DISTINCT FROM receipt.sha256 OR proof.result_bytes IS DISTINCT FROM receipt.bytes OR NOT EXISTS(SELECT 1 FROM media_storage_transfer_requests request WHERE request.call_id=original.id AND request.descriptor->>'kind'='object.put' AND request.id::text=proof.result_request_proof->>'id' AND request.token_digest=proof.result_request_proof->>'tokenDigest') THEN RAISE EXCEPTION 'Fresh full-byte provider proof must name this exact original physical request nonce' USING ERRCODE='23514'; END IF;
  ELSE
   IF receipt.provider_revision IS NULL OR receipt.provider_revision_digest IS DISTINCT FROM freeholder_media_transfer_fact_digest(receipt.provider_revision) OR proof.expected_revision IS DISTINCT FROM receipt.provider_revision OR proof.result_absent IS NULL OR NOT EXISTS(SELECT 1 FROM media_storage_transfer_requests request JOIN media_storage_transfer_request_observations fact ON fact.request_id=request.id WHERE request.call_id=proof.id AND request.state='returned' AND request.returned_at IS NOT NULL AND fact.facts->>'stage'='absence') OR EXISTS(SELECT 1 FROM media_storage_transfer_requests request WHERE request.call_id=proof.id AND (request.state<>'returned' OR request.returned_at IS NULL OR request.descriptor->>'kind' NOT IN ('object.metadata','object.read','object.body') OR request.descriptor->'expectedRevision' IS DISTINCT FROM receipt.provider_revision)) THEN RAISE EXCEPTION 'Retirement inventory requires a finished actual pinned absence read, never logical404 alone' USING ERRCODE='23514'; END IF;
  END IF;
  IF TG_OP='INSERT' THEN
   IF NEW.state<>'capturing' OR NEW.redacted_at IS NOT NULL OR NEW.first_digest IS NOT NULL OR NEW.confirmed_digest IS NOT NULL OR NEW.completed_at IS NOT NULL THEN RAISE EXCEPTION 'Capture the immutable original inventory before reading pages' USING ERRCODE='23514'; END IF;
  ELSE
   IF (to_jsonb(NEW)-ARRAY['state','first_digest','confirmed_digest','configuration','entry_count','total_bytes','blocker','completed_at','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','first_digest','confirmed_digest','configuration','entry_count','total_bytes','blocker','completed_at','updated_at']) OR OLD.state<>'capturing' AND (to_jsonb(NEW)-'updated_at') IS DISTINCT FROM (to_jsonb(OLD)-'updated_at') OR OLD.first_digest IS NOT NULL AND NEW.first_digest IS DISTINCT FROM OLD.first_digest THEN RAISE EXCEPTION 'First original recovery inventory context and proof cannot change' USING ERRCODE='23514'; END IF;
   IF NEW.state='complete' AND (NEW.first_digest IS DISTINCT FROM NEW.confirmed_digest OR EXISTS(SELECT 1 FROM media_storage_provider_inventory_pages item JOIN media_storage_transfer_calls actual ON actual.id=item.call_id WHERE item.inventory_id=OLD.id AND (actual.state<>'returned' OR actual.returned_at IS NULL OR actual.object_receipt_id IS DISTINCT FROM receipt.id OR EXISTS(SELECT 1 FROM media_storage_transfer_requests request WHERE request.call_id=actual.id AND request.state IN ('admitted','unknown')))) OR EXISTS(SELECT required.pass_number FROM generate_series(0,1) required(pass_number) WHERE NOT EXISTS(SELECT 1 FROM media_storage_provider_inventory_pages WHERE inventory_id=OLD.id AND pass=required.pass_number AND kind='configuration'))) THEN RAISE EXCEPTION 'Both complete original recovery inventories and all actual page requests must finish' USING ERRCODE='23514'; END IF;
  END IF;
 ELSIF TG_TABLE_NAME='media_storage_provider_inventory_pages' THEN
  SELECT * INTO header FROM media_storage_provider_inventories WHERE id=NEW.inventory_id;
  IF header.plan_id IS NOT NULL THEN RETURN NEW; END IF;
  SELECT * INTO caller FROM media_storage_transfer_calls WHERE id=NEW.call_id;
  IF TG_OP<>'INSERT' OR NEW.redacted_at IS NOT NULL OR header.id IS NULL OR header.state<>'capturing' OR caller.id IS NULL OR caller.object_receipt_id IS DISTINCT FROM header.object_receipt_id OR caller.kind<>'ordinary_retirement_inventory' OR caller.state<>'returned' OR caller.returned_at IS NULL OR caller.namespace IS DISTINCT FROM header.namespace OR NEW.cursor_digest<>freeholder_media_transfer_fact_digest(coalesce(NEW.cursor,'null'::jsonb)) THEN RAISE EXCEPTION 'Append only the actual original returned page to its original receipt inventory' USING ERRCODE='23514'; END IF;
  IF NEW.kind<>'configuration' AND NEW.cursor IS NOT NULL AND NOT EXISTS(SELECT 1 FROM media_storage_provider_inventory_pages prior WHERE prior.inventory_id=header.id AND prior.pass=NEW.pass AND prior.kind=NEW.kind AND prior.next_cursor=NEW.cursor) THEN RAISE EXCEPTION 'The original provider cursor chain is incomplete' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT * INTO header FROM media_storage_provider_inventories WHERE id=NEW.inventory_id;
  IF header.plan_id IS NOT NULL THEN RETURN NEW; END IF;
  SELECT * INTO page FROM media_storage_provider_inventory_pages WHERE id=NEW.page_id;
  IF TG_OP<>'INSERT' OR NEW.redacted_at IS NOT NULL OR header.id IS NULL OR header.state<>'capturing' OR page.id IS NULL OR page.inventory_id IS DISTINCT FROM header.id OR page.pass<>NEW.pass OR NEW.original_object_id IS NOT NULL OR NEW.attribution<>'unattributed' OR NEW.ordinal<0 OR NEW.ordinal>=page.entry_count OR NEW.entry_digest<>freeholder_media_transfer_fact_digest(NEW.entry) OR NEW.key_digest<>encode(sha256(convert_to('freeholder:media-object-key:v1','UTF8')||decode('00','hex')||convert_to(NEW.entry->>'key','UTF8')),'hex') THEN RAISE EXCEPTION 'Original recovery resource observations are immutable and never guessed ownership' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER original_provider_inventory_evidence BEFORE INSERT OR UPDATE OR DELETE ON media_storage_provider_inventories FOR EACH ROW EXECUTE FUNCTION freeholder_media_original_inventory_evidence_guard();
--> statement-breakpoint
CREATE TRIGGER original_provider_inventory_page_evidence BEFORE INSERT OR UPDATE OR DELETE ON media_storage_provider_inventory_pages FOR EACH ROW EXECUTE FUNCTION freeholder_media_original_inventory_evidence_guard();
--> statement-breakpoint
CREATE TRIGGER original_provider_inventory_entry_evidence BEFORE INSERT OR UPDATE OR DELETE ON media_storage_provider_inventory_entries FOR EACH ROW EXECUTE FUNCTION freeholder_media_original_inventory_evidence_guard();
-- Recovery service orchestration, exact stop review, physical retirement and
-- ordinary privacy composition remain incomplete. NO capability is published.

--> statement-breakpoint
-- An original caller cannot issue an invisible second mutating request. Every
-- retry must have an explicit new authorized original intent/recovery plan.
CREATE UNIQUE INDEX media_storage_original_mutating_request_idx ON media_storage_transfer_requests(call_id) WHERE descriptor->>'kind' IN ('object.put','object.delete','multipart.create','multipart.complete','multipart.abort');
--> statement-breakpoint
ALTER TABLE storage_quota_objects ADD COLUMN last_settled_token uuid;
--> statement-breakpoint
CREATE FUNCTION freeholder_media_original_quota_settlement_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.last_settled_token IS NOT NULL THEN RAISE EXCEPTION 'A historical quota settlement cannot be invented' USING ERRCODE='23514'; END IF;
 ELSIF NEW.last_settled_token IS DISTINCT FROM OLD.last_settled_token AND (NEW.last_settled_token IS NULL OR NEW.last_settled_token IS DISTINCT FROM OLD.pending_token OR NEW.pending_token IS NOT NULL OR NEW.bytes>OLD.bytes) THEN RAISE EXCEPTION 'Settle only the exact originally reserved quota token and byte bound' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER media_original_quota_settlement BEFORE INSERT OR UPDATE ON storage_quota_objects FOR EACH ROW EXECUTE FUNCTION freeholder_media_original_quota_settlement_guard();
-- Exact physical quota retirement and key minimization remain unfinished;
-- this records actual settlement identity without enabling a release path.

--> statement-breakpoint
ALTER TABLE media_storage_transfer_reviews ADD CONSTRAINT media_storage_transfer_review_parent CHECK(num_nonnulls(object_id,object_receipt_id,multipart_operation_id)=1);
--> statement-breakpoint
ALTER TABLE media_storage_transfer_reviews ADD CONSTRAINT media_storage_transfer_review_inventory_fk FOREIGN KEY(inventory_id) REFERENCES media_storage_provider_inventories(id) ON DELETE RESTRICT;
--> statement-breakpoint
CREATE FUNCTION freeholder_media_original_review_context_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE caller media_storage_transfer_calls; proof media_storage_transfer_calls; inventory media_storage_provider_inventories; deletion media_object_writes; original media_object_writes;
BEGIN
 IF NEW.object_id IS NOT NULL THEN
  IF NEW.inventory_id IS NOT NULL THEN RAISE EXCEPTION 'Original transfer review cannot borrow an ordinary inventory' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO caller FROM media_storage_transfer_calls WHERE id=NEW.call_id;
 SELECT * INTO proof FROM media_storage_transfer_calls WHERE id=NEW.read_call_id;
 SELECT * INTO inventory FROM media_storage_provider_inventories WHERE id=NEW.inventory_id;
 IF caller.kind='ordinary_delete' THEN
  SELECT * INTO deletion FROM media_object_writes WHERE id=caller.object_receipt_id;
  SELECT * INTO original FROM media_object_writes WHERE original_reservation_id=deletion.original_reservation_id AND operation_kind='put';
  IF NEW.object_receipt_id IS DISTINCT FROM deletion.id OR NEW.multipart_operation_id IS NOT NULL OR NEW.stop_drain_id IS NOT NULL OR NEW.permits_retry OR NEW.outcome<>'retired' OR NEW.reviewed_by<>'system:media-cleanup'
   OR deletion.id IS NULL OR original.id IS NULL OR deletion.original_reservation_id IS NULL OR deletion.writer_finished_at IS NULL OR original.writer_finished_at IS NULL AND NOT EXISTS(SELECT 1 FROM media_storage_transfer_calls writer WHERE writer.object_receipt_id=original.id AND freeholder_media_original_applied_review(writer.id)) OR original.state<>'accepted' OR original.provider_revision IS NULL OR original.provider_revision_digest IS DISTINCT FROM freeholder_media_transfer_fact_digest(original.provider_revision)
   OR caller.state<>'unknown' OR caller.returned_at IS NULL OR caller.stopped_at IS NOT NULL OR caller.stop_receipt_id IS NOT NULL OR caller.observed_accepted_at IS NULL
   OR caller.namespace IS DISTINCT FROM original.storage_namespace OR caller.physical_key IS DISTINCT FROM original.object_key OR deletion.key_digest IS DISTINCT FROM original.key_digest OR caller.expected_revision IS DISTINCT FROM original.provider_revision
   OR caller.result_digest IS NULL OR caller.result_digest NOT IN (freeholder_media_transfer_fact_digest(jsonb_build_object('failed',true)),freeholder_media_transfer_fact_digest(jsonb_build_object('failed',true,'accepted',true)))
   OR (SELECT count(*) FROM media_storage_transfer_requests WHERE call_id=caller.id)<>1
   OR NOT EXISTS(SELECT 1 FROM media_storage_transfer_requests request JOIN media_storage_transfer_request_observations fact ON fact.request_id=request.id WHERE request.call_id=caller.id AND request.descriptor->>'kind'='object.delete' AND request.state IN ('returned','unknown') AND request.returned_at IS NOT NULL AND request.runtime_identity=caller.runtime_identity AND request.descriptor_digest=freeholder_media_transfer_fact_digest(request.descriptor) AND request.descriptor->'expectedRevision'=original.provider_revision AND fact.facts->>'stage'='accepted' AND fact.facts->>'status' ~ '^2[0-9]{2}$')
   OR proof.id IS NULL OR proof.object_receipt_id IS DISTINCT FROM original.id OR proof.kind<>'ordinary_recovery_read' OR proof.state<>'returned' OR proof.returned_at IS NULL OR proof.result_absent IS NULL OR proof.expected_revision IS DISTINCT FROM original.provider_revision
   OR inventory.id IS NULL OR inventory.object_receipt_id IS DISTINCT FROM original.id OR inventory.proof_call_id IS DISTINCT FROM proof.id OR inventory.purpose<>'retirement' OR NOT freeholder_media_original_absence_inventory_complete(inventory.id)
  THEN RAISE EXCEPTION 'A finished failed DELETE review needs its actual successful provider ACK, original pinned absence and complete physical inventory; never replay or invent return' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF NEW.multipart_operation_id IS NOT NULL OR caller.id IS NULL OR caller.kind<>'ordinary_put' OR caller.object_receipt_id IS DISTINCT FROM NEW.object_receipt_id OR NEW.permits_retry OR NEW.outcome<>'applied' THEN RAISE EXCEPTION 'Original review closes only affirmative exact applied PUT proof, never absence/retry/multipart' USING ERRCODE='23514'; END IF;
 IF NEW.stop_drain_id IS NULL THEN
  IF caller.returned_at IS NULL OR caller.result_digest IS NULL OR EXISTS(SELECT 1 FROM media_storage_transfer_requests WHERE call_id=caller.id AND returned_at IS NULL) THEN RAISE EXCEPTION 'Portable review requires all actual original finishes' USING ERRCODE='23514'; END IF;
 ELSE
  IF NOT freeholder_media_original_executor_stopped(caller.id,NEW.stop_drain_id) THEN RAISE EXCEPTION 'The retained exact original executor stop does not cover this caller and every physical admission' USING ERRCODE='23514'; END IF;
 END IF;
 IF proof.id IS NULL OR proof.object_receipt_id IS DISTINCT FROM NEW.object_receipt_id OR proof.kind<>'ordinary_recovery_read' OR proof.state<>'returned' OR proof.returned_at IS NULL OR proof.result_request_proof IS NULL OR inventory.id IS NULL OR inventory.object_receipt_id IS DISTINCT FROM NEW.object_receipt_id OR inventory.anchor_call_id IS DISTINCT FROM caller.id OR inventory.proof_call_id IS DISTINCT FROM proof.id OR inventory.state<>'complete' OR inventory.purpose<>'recovery' THEN RAISE EXCEPTION 'The original review must retain the exact actual nonce-bound read and complete immutable inventory' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER media_original_review_context BEFORE INSERT ON media_storage_transfer_reviews FOR EACH ROW EXECUTE FUNCTION freeholder_media_original_review_context_guard();
-- Known-finished applied PUT review is prepared. Crash/stop, retirement,
-- multipart/ordinary privacy closure remain incomplete; capability UNPUBLISHED.

--> statement-breakpoint
CREATE UNIQUE INDEX media_storage_original_quota_token_idx ON media_storage_transfer_calls(namespace,quota_token) WHERE quota_token IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX storage_quota_original_pending_idx ON storage_quota_objects(namespace,pending_token) WHERE pending_token IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX storage_quota_original_settled_idx ON storage_quota_objects(namespace,last_settled_token) WHERE last_settled_token IS NOT NULL;
--> statement-breakpoint
CREATE FUNCTION freeholder_media_original_quota_origin_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.pending_token IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM media_storage_transfer_calls caller JOIN media_object_writes original ON original.id=coalesce(caller.physical_receipt_id,caller.object_receipt_id)
  WHERE caller.quota_token=NEW.pending_token AND caller.namespace=NEW.namespace AND caller.kind IN ('ordinary_put','target_put') AND original.storage_namespace=NEW.namespace AND original.bytes<=NEW.bytes
   AND encode(sha256(convert_to('freeholder:media-object-key:v1','UTF8')||decode('00','hex')||convert_to(NEW.object_key,'UTF8')),'hex')=original.key_digest
 ) THEN RAISE EXCEPTION 'Quota reservation belongs to its exact immutable original caller token/resource; equal current keys cannot rebind it' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER media_original_quota_origin AFTER INSERT OR UPDATE ON storage_quota_objects DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION freeholder_media_original_quota_origin_guard();
-- Actual late facts commit independently. Exact-token charge restoration or
-- namespace admission refusal preserves capacity debt without rebinding any
-- different current quota row. Physical retirement capability stays unpublished.

--> statement-breakpoint
CREATE TABLE media_original_erasure_scopes (
 request_id uuid NOT NULL REFERENCES data_requests(id) ON DELETE RESTRICT,scope text NOT NULL,
 membership jsonb NOT NULL,capture_digest text NOT NULL,complete boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(request_id,scope),
 CONSTRAINT media_original_erasure_scope CHECK(scope IN ('media.storageOperations','media.multipartOperations')),
 CONSTRAINT media_original_erasure_digest CHECK(capture_digest ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TRIGGER media_original_scope_runtime BEFORE INSERT OR UPDATE OR DELETE ON media_original_erasure_scopes FOR EACH STATEMENT EXECUTE FUNCTION freeholder_media_transfer_runtime_fence();
--> statement-breakpoint
CREATE FUNCTION freeholder_media_original_scope_contains(first_membership jsonb,reservation uuid) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT reservation IS NOT NULL AND (
  EXISTS(SELECT 1 FROM jsonb_array_elements(first_membership->'reservations') member WHERE member->>'id'=reservation::text)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(first_membership->'receipts') member WHERE member->>'reservationId'=reservation::text)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(first_membership->'resources') member WHERE member->>'reservationId'=reservation::text))
$$;
--> statement-breakpoint
CREATE FUNCTION freeholder_media_original_scope_descendant(first_membership jsonb,receipt uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 WITH RECURSIVE ancestry(id,depth,path) AS (
  SELECT receipt,0,ARRAY[receipt]
  UNION ALL
  SELECT parent.receipt_id,ancestor.depth+1,ancestor.path||parent.receipt_id FROM ancestry ancestor JOIN media_storage_transfer_calls caller ON caller.physical_receipt_id=ancestor.id AND caller.kind='target_put' JOIN media_storage_transfer_receipts parent ON parent.object_id=caller.object_id
  WHERE ancestor.depth<10000 AND NOT parent.receipt_id=ANY(ancestor.path) AND parent.original_snapshot_digest=freeholder_media_transfer_fact_digest(parent.original_snapshot)
 )
 SELECT EXISTS(SELECT 1 FROM ancestry ancestor WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(first_membership->'receipts') member WHERE member->>'id'=ancestor.id::text) OR EXISTS(SELECT 1 FROM media_object_writes original WHERE original.id=ancestor.id AND freeholder_media_original_scope_contains(first_membership,original.original_reservation_id)))
$$;
--> statement-breakpoint
CREATE FUNCTION freeholder_media_original_scope_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE first_media media_original_erasure_scopes;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Keep complete first original media scope through its shared writer' USING ERRCODE='23514'; END IF;
 IF current_setting('freeholder.media_transfer_v1',true) IS DISTINCT FROM '1' THEN
  PERFORM pg_advisory_xact_lock(1691709,82);
  IF TG_TABLE_NAME='media_original_erasure_scopes' THEN
   IF current_setting('freeholder.media_empty_scope_request_v1',true) IS DISTINCT FROM NEW.request_id::text
    OR current_setting('freeholder.media_empty_scope_name_v1',true) IS DISTINCT FROM NEW.scope
    OR NOT EXISTS(SELECT 1 FROM data_requests request WHERE request.id=NEW.request_id AND request.kind='erasure' AND request.contact_id::text=current_setting('freeholder.media_empty_scope_contact_v1',true))
    OR NEW.membership<>'{"format":"freeholder.original-media-erasure/v1","legacyScopes":[],"receipts":[],"resources":[],"uploads":[],"reservations":[],"legacyReservations":[]}'::jsonb
    OR NOT freeholder_media_empty_scope_graph_v1(NEW.request_id,NEW.scope)
   THEN RAISE EXCEPTION 'Empty original capture needs its exact actual request/scope/contact and complete fenced empty ancestry; no birth or provider privilege can be inferred' USING ERRCODE='23514'; END IF;
  ELSE RAISE EXCEPTION 'Empty metadata authority cannot acquire original physical erasure cohort members' USING ERRCODE='23514';
  END IF;
 END IF;
 IF TG_TABLE_NAME='media_original_erasure_scopes' THEN
  IF TG_OP='INSERT' THEN
   IF NEW.complete OR NEW.capture_digest<>freeholder_media_transfer_fact_digest(NEW.membership) OR NEW.membership->>'format' IS DISTINCT FROM 'freeholder.original-media-erasure/v1' OR EXISTS(SELECT name FROM unnest(ARRAY['legacyScopes','receipts','resources','uploads','reservations','legacyReservations']) name WHERE jsonb_typeof(NEW.membership->name) IS DISTINCT FROM 'array') OR NOT EXISTS(SELECT 1 FROM data_requests WHERE id=NEW.request_id AND kind='erasure') OR EXISTS(SELECT 1 FROM data_request_artifacts WHERE data_request_id=NEW.request_id) THEN RAISE EXCEPTION 'Capture the complete original source once before first erasure; an old receipt cannot acquire a new first snapshot' USING ERRCODE='23514'; END IF;
  ELSIF NOT(OLD.complete=false AND NEW.complete=true AND (to_jsonb(NEW)-'complete')=(to_jsonb(OLD)-'complete')) THEN RAISE EXCEPTION 'First original media membership, including empty membership, is immutable' USING ERRCODE='23514'; END IF;
 ELSE
  IF TG_OP='UPDATE' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Original erasure cohort identities are immutable' USING ERRCODE='23514'; END IF;
  SELECT * INTO first_media FROM media_original_erasure_scopes WHERE request_id=NEW.request_id AND scope=NEW.scope;
  IF first_media.request_id IS NULL THEN RAISE EXCEPTION 'Restore the complete original media scope; current rows cannot backfill earlier membership' USING ERRCODE='23514'; END IF;
  IF NEW.object_receipt_id IS NOT NULL THEN
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(first_media.membership->'receipts') member WHERE member->>'id'=NEW.object_receipt_id::text) AND NOT(first_media.complete AND freeholder_media_original_scope_descendant(first_media.membership,NEW.object_receipt_id)) THEN RAISE EXCEPTION 'An equal current key cannot add another generation to original erasure; require exact original descendant lineage' USING ERRCODE='23514'; END IF;
  ELSIF NEW.multipart_resource_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(first_media.membership->'resources') member WHERE member->>'id'=NEW.multipart_resource_id::text) THEN RAISE EXCEPTION 'A new multipart session cannot expand first erasure membership' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER media_original_first_scope BEFORE INSERT OR UPDATE OR DELETE ON media_original_erasure_scopes FOR EACH ROW EXECUTE FUNCTION freeholder_media_original_scope_guard();
--> statement-breakpoint
CREATE TRIGGER media_original_first_cohort BEFORE INSERT OR UPDATE OR DELETE ON media_erasure_cohorts FOR EACH ROW EXECUTE FUNCTION freeholder_media_original_scope_guard();
--> statement-breakpoint
CREATE FUNCTION freeholder_media_original_scope_complete_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE first_media media_original_erasure_scopes;
BEGIN
 SELECT * INTO first_media FROM media_original_erasure_scopes WHERE request_id=NEW.request_id AND scope=NEW.scope;
 IF first_media.request_id IS NULL OR NOT first_media.complete OR first_media.capture_digest<>freeholder_media_transfer_fact_digest(first_media.membership)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(first_media.membership->'receipts') member WHERE NOT EXISTS(SELECT 1 FROM media_erasure_cohorts cohort JOIN media_object_writes original ON original.id=cohort.object_receipt_id WHERE cohort.request_id=first_media.request_id AND cohort.scope=first_media.scope AND original.id::text=member->>'id' AND coalesce(to_jsonb(original.original_reservation_id),'null'::jsonb) IS NOT DISTINCT FROM member->'reservationId'))
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(first_media.membership->'resources') member WHERE NOT EXISTS(SELECT 1 FROM media_erasure_cohorts cohort JOIN media_multipart_resources original ON original.id=cohort.multipart_resource_id WHERE cohort.request_id=first_media.request_id AND cohort.scope=first_media.scope AND original.id::text=member->>'id' AND coalesce(to_jsonb(original.original_reservation_id),'null'::jsonb) IS NOT DISTINCT FROM member->'reservationId'))
 THEN RAISE EXCEPTION 'Seal every exact original media member in the first transaction, including an empty scope' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER media_original_first_scope_complete AFTER INSERT OR UPDATE ON media_original_erasure_scopes DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION freeholder_media_original_scope_complete_guard();
--> statement-breakpoint
CREATE FUNCTION freeholder_media_original_reservation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='media_objects' THEN
  IF TG_OP='UPDATE' THEN
   IF NEW.reservation_id IS DISTINCT FROM OLD.reservation_id OR NEW.key IS DISTINCT FROM OLD.key THEN RAISE EXCEPTION 'Original reservation identity, including legacy NULL, cannot be rebound or backfilled' USING ERRCODE='23514'; END IF;
  ELSIF NEW.reservation_id IS NULL THEN RAISE EXCEPTION 'New reservations require their actual originating birth identity' USING ERRCODE='23514';
  ELSIF EXISTS(SELECT 1 FROM media_original_erasure_scopes first_media WHERE freeholder_media_original_scope_contains(first_media.membership,NEW.reservation_id)) AND NOT (
   EXISTS(SELECT 1 FROM media_object_writes original WHERE original.original_reservation_id=NEW.reservation_id AND original.key_digest=encode(sha256(convert_to('freeholder:media-object-key:v1','UTF8')||decode('00','hex')||convert_to(NEW.key,'UTF8')),'hex') AND original.observed_accepted_at IS NOT NULL AND original.redacted_at IS NULL)
   OR EXISTS(SELECT 1 FROM media_multipart_resources original JOIN media_multipart_operations operation ON operation.resource_id=original.id WHERE original.original_reservation_id=NEW.reservation_id AND original.key_digest=encode(sha256(convert_to('freeholder:media-object-key:v1','UTF8')||decode('00','hex')||convert_to(NEW.key,'UTF8')),'hex') AND operation.provider_accepted_at IS NOT NULL AND original.redacted_at IS NULL)
  ) THEN RAISE EXCEPTION 'Only an actual admitted original positive caller can restore its captured pointer; never create a later birth in that scope' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='media_object_writes' THEN
  IF TG_OP='UPDATE' THEN
   IF NEW.original_reservation_id IS DISTINCT FROM OLD.original_reservation_id THEN RAISE EXCEPTION 'Keep the original write reservation, including unknown legacy birth' USING ERRCODE='23514'; END IF;
   IF ROW(NEW.operation_kind,NEW.key_digest,NEW.storage_namespace,NEW.sha256,NEW.bytes,NEW.content_type) IS DISTINCT FROM ROW(OLD.operation_kind,OLD.key_digest,OLD.storage_namespace,OLD.sha256,OLD.bytes,OLD.content_type) THEN RAISE EXCEPTION 'The original write payload and namespace are immutable' USING ERRCODE='23514'; END IF;
  ELSE
   IF NEW.original_reservation_id IS NULL THEN RAISE EXCEPTION 'A new physical write cannot invent an unknown historical reservation' USING ERRCODE='23514'; END IF;
   IF NEW.operation_kind='put' THEN
    IF NOT (EXISTS(SELECT 1 FROM media_objects pointer WHERE pointer.reservation_id=NEW.original_reservation_id AND pointer.key=NEW.object_key) AND NOT EXISTS(SELECT 1 FROM media_original_erasure_scopes first_media JOIN data_requests request ON request.id=first_media.request_id WHERE request.kind='erasure' AND request.verified_at IS NOT NULL AND freeholder_media_original_scope_contains(first_media.membership,NEW.original_reservation_id)))
     AND NOT (NEW.state='accepted' AND NEW.writer_protocol='multipart-receipts-v1' AND EXISTS(
      SELECT 1 FROM media_multipart_resources resource JOIN media_multipart_operations operation ON operation.resource_id=resource.id JOIN media_storage_transfer_calls caller ON caller.multipart_operation_id=operation.id
      WHERE resource.original_reservation_id=NEW.original_reservation_id AND resource.key_digest=NEW.key_digest AND resource.storage_namespace=NEW.storage_namespace AND operation.operation_kind='complete'
       AND operation.writer_runtime_id=NEW.writer_runtime_id AND operation.writer_finished_at=NEW.writer_finished_at AND operation.provider_accepted_at=NEW.observed_accepted_at
       AND operation.writer_finished_at IS NOT NULL AND operation.provider_accepted_at IS NOT NULL AND caller.kind='multipart_complete' AND caller.returned_at IS NOT NULL AND caller.observed_accepted_at IS NOT NULL AND caller.result_revision IS NOT NULL AND caller.result_digest IS NOT NULL
     )) THEN RAISE EXCEPTION 'A new PUT needs its actual uncaptured birth; only a finished already-admitted multipart caller can retain a late original object fact' USING ERRCODE='23514'; END IF;
    IF EXISTS(SELECT 1 FROM media_object_writes retirement WHERE retirement.original_reservation_id=NEW.original_reservation_id AND retirement.operation_kind='delete') AND NEW.writer_protocol IS DISTINCT FROM 'multipart-receipts-v1' THEN RAISE EXCEPTION 'An original retirement intent fences every future ordinary PUT admission' USING ERRCODE='23514'; END IF;
    IF EXISTS(SELECT 1 FROM media_object_writes original WHERE original.original_reservation_id=NEW.original_reservation_id AND original.operation_kind='put' AND ROW(original.key_digest,original.storage_namespace,original.sha256,original.bytes,original.content_type) IS DISTINCT FROM ROW(NEW.key_digest,NEW.storage_namespace,NEW.sha256,NEW.bytes,NEW.content_type)) THEN RAISE EXCEPTION 'A retry cannot change the first original reservation payload or resource generation' USING ERRCODE='23514'; END IF;
   ELSIF NOT EXISTS(SELECT 1 FROM media_object_writes original WHERE original.original_reservation_id=NEW.original_reservation_id AND original.operation_kind='put' AND original.key_digest=NEW.key_digest AND original.storage_namespace=NEW.storage_namespace) THEN RAISE EXCEPTION 'A DELETE requires the exact original PUT lineage' USING ERRCODE='23514'; END IF;
  END IF;
 ELSE
  IF TG_OP='UPDATE' THEN
   IF NEW.original_reservation_id IS DISTINCT FROM OLD.original_reservation_id THEN RAISE EXCEPTION 'Keep original multipart birth; unknown legacy sessions remain unknown' USING ERRCODE='23514'; END IF;
  ELSIF NEW.original_reservation_id IS NULL OR NOT EXISTS(SELECT 1 FROM media_objects pointer WHERE pointer.reservation_id=NEW.original_reservation_id AND pointer.key=NEW.object_key AND pointer.upload_id=NEW.upload_id)
   OR EXISTS(SELECT 1 FROM media_object_writes retirement WHERE retirement.original_reservation_id=NEW.original_reservation_id AND retirement.operation_kind='delete')
   OR EXISTS(SELECT 1 FROM media_original_erasure_scopes first_media JOIN data_requests request ON request.id=first_media.request_id WHERE request.kind='erasure' AND request.verified_at IS NOT NULL AND freeholder_media_original_scope_contains(first_media.membership,NEW.original_reservation_id)) THEN RAISE EXCEPTION 'A new multipart session requires its exact new uncaptured upload reservation; never infer legacy session birth' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER media_object_original_reservation BEFORE INSERT OR UPDATE ON media_objects FOR EACH ROW EXECUTE FUNCTION freeholder_media_original_reservation_guard();
--> statement-breakpoint
CREATE TRIGGER media_write_original_reservation BEFORE INSERT OR UPDATE ON media_object_writes FOR EACH ROW EXECUTE FUNCTION freeholder_media_original_reservation_guard();
--> statement-breakpoint
CREATE TRIGGER media_multipart_original_reservation BEFORE INSERT OR UPDATE ON media_multipart_resources FOR EACH ROW EXECUTE FUNCTION freeholder_media_original_reservation_guard();
-- Legacy NULLs remain debt. Completed multipart admission/original callers and
-- standalone physical retirement still require final complete semantics.

--> statement-breakpoint
-- A shared full-writer tag is necessary, never sufficient, for mutation.
-- Parent checks are deferred only so the exact real transfer caller can be
-- inserted in the SAME admission transaction, not inferred from an equal key.
-- Mutation belongs to the current controlling plan, not merely any genuine
-- historical transfer ancestry. Additional executor recovery association and
-- release remain explicit protocol work; no new drain is silently adopted.
CREATE FUNCTION freeholder_media_transfer_namespace_control(original_object uuid, original_namespace text, original_kind text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(
  SELECT 1 FROM media_storage_transfer_objects object JOIN media_storage_transfer_plans plan ON plan.id=object.plan_id
  WHERE object.id=original_object AND plan.source_namespace<>plan.target_namespace
   AND ((original_kind='target_put' AND original_namespace=plan.target_namespace AND plan.state IN ('planned','copying') AND object.state IN ('planned','copying'))
    OR (original_kind='source_delete' AND original_namespace=plan.source_namespace AND plan.state IN ('adopted','cleanup_pending') AND object.state IN ('adopted','cleanup_pending'))
    OR (original_kind='privacy_delete' AND original_namespace=plan.target_namespace)
    OR (original_kind='privacy_source_delete' AND original_namespace=plan.source_namespace))
   AND NOT EXISTS(SELECT 1 FROM media_storage_transfer_plans other WHERE other.id<>plan.id AND other.source_namespace=original_namespace AND other.state NOT IN ('complete','cancelled'))
   AND NOT EXISTS(SELECT 1 FROM media_storage_writer_drains drain WHERE drain.namespace=original_namespace AND drain.state<>'released' AND NOT coalesce(
    original_kind IN ('source_delete','privacy_source_delete') AND plan.source_namespace=original_namespace AND plan.source_drain_id=drain.id AND drain.state='verified' AND drain.verified_at IS NOT NULL AND drain.verified_at<=plan.created_at AND drain.stop_proof_digest IS NOT NULL AND drain.stop_proof_digest=plan.source_stop_evidence_digest,false))
 )
$$;
--> statement-breakpoint
CREATE FUNCTION freeholder_media_original_parent_namespace_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock_shared(1691709,82);
 IF EXISTS(SELECT 1 FROM media_storage_writer_drains WHERE namespace=NEW.storage_namespace AND state<>'released')
  OR EXISTS(SELECT 1 FROM media_storage_transfer_plans WHERE source_namespace=NEW.storage_namespace AND state<>'cancelled') THEN
  IF NOT EXISTS(
   SELECT 1 FROM media_storage_transfer_calls caller JOIN media_storage_transfer_objects object ON object.id=caller.object_id JOIN media_storage_transfer_plans plan ON plan.id=object.plan_id
   WHERE freeholder_media_transfer_namespace_control(object.id,caller.namespace,caller.kind) AND caller.physical_receipt_id=NEW.id AND caller.created_at=NEW.created_at AND caller.created_at=transaction_timestamp() AND caller.state='admitted' AND caller.returned_at IS NULL
    AND caller.object_receipt_id IS NULL AND caller.multipart_operation_id IS NULL AND caller.namespace=NEW.storage_namespace AND caller.physical_key=NEW.object_key AND NEW.sha256=object.sha256 AND NEW.bytes=object.bytes AND NEW.content_type=object.content_type
    AND ((NEW.operation_kind='put' AND caller.kind='target_put' AND object.target_receipt_id=NEW.id AND plan.target_namespace=NEW.storage_namespace AND object.target_key_digest=NEW.key_digest AND object.target_object_key=NEW.object_key)
     OR (NEW.operation_kind='delete' AND caller.kind IN ('source_delete','privacy_source_delete') AND plan.source_namespace=NEW.storage_namespace AND object.key_digest=NEW.key_digest AND object.object_key=NEW.object_key AND EXISTS(SELECT 1 FROM media_storage_transfer_receipts member JOIN media_object_writes original ON original.id=member.receipt_id WHERE member.object_id=object.id AND original.original_reservation_id=NEW.original_reservation_id AND original.provider_revision_digest=freeholder_media_transfer_fact_digest(caller.expected_revision)))
     OR (NEW.operation_kind='delete' AND caller.kind='privacy_delete' AND plan.target_namespace=NEW.storage_namespace AND object.target_key_digest=NEW.key_digest AND object.target_object_key=NEW.object_key AND EXISTS(SELECT 1 FROM media_object_writes target WHERE target.id=object.target_receipt_id AND target.original_reservation_id=NEW.original_reservation_id AND target.provider_revision_digest=freeholder_media_transfer_fact_digest(caller.expected_revision)))))
  THEN RAISE EXCEPTION 'A captured drain/active source claim admits only its exact genuine transfer caller ancestry, never an ordinary flag or equal key' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER media_original_parent_namespace AFTER INSERT ON media_object_writes DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION freeholder_media_original_parent_namespace_guard();
--> statement-breakpoint
CREATE FUNCTION freeholder_media_original_mutation_namespace_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE caller media_storage_transfer_calls; mutating boolean;
BEGIN
 IF TG_TABLE_NAME='media_storage_transfer_calls' THEN
  caller:=NEW;
  mutating:=caller.kind IN ('ordinary_put','ordinary_delete','multipart_create','multipart_complete','multipart_abort','target_put','source_delete','privacy_delete','privacy_source_delete');
 ELSE
  SELECT * INTO caller FROM media_storage_transfer_calls WHERE id=NEW.call_id;
  mutating:=NEW.descriptor->>'kind' IN ('object.put','object.delete','multipart.create','multipart.complete','multipart.abort');
 END IF;
 IF caller.id IS NULL THEN RAISE EXCEPTION 'An actual physical mutation needs its exact original caller' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock_shared(1691709,82);
 IF mutating THEN
  IF caller.object_id IS NULL THEN
   IF EXISTS(SELECT 1 FROM media_storage_writer_drains WHERE namespace=caller.namespace AND state<>'released') OR EXISTS(SELECT 1 FROM media_storage_transfer_plans WHERE source_namespace=caller.namespace AND state<>'cancelled') THEN RAISE EXCEPTION 'Ordinary mutation remains fenced independently of writer flags' USING ERRCODE='23514'; END IF;
  ELSE
   IF NOT freeholder_media_transfer_namespace_control(caller.object_id,caller.namespace,caller.kind) THEN RAISE EXCEPTION 'This genuine transfer does not control the current namespace claim/drain or mutation phase' USING ERRCODE='23514'; END IF;
   IF NOT EXISTS(
   SELECT 1 FROM media_object_writes physical JOIN media_storage_transfer_objects object ON object.id=caller.object_id JOIN media_storage_transfer_plans plan ON plan.id=object.plan_id
   WHERE physical.id=caller.physical_receipt_id AND physical.created_at=caller.created_at AND caller.state='admitted' AND caller.returned_at IS NULL
    AND physical.storage_namespace=caller.namespace AND physical.object_key=caller.physical_key AND caller.object_receipt_id IS NULL AND caller.multipart_operation_id IS NULL AND physical.sha256=object.sha256 AND physical.bytes=object.bytes AND physical.content_type=object.content_type
    AND ((physical.operation_kind='put' AND caller.kind='target_put' AND object.target_receipt_id=physical.id AND plan.target_namespace=caller.namespace AND object.target_key_digest=physical.key_digest AND object.target_object_key=physical.object_key)
     OR (physical.operation_kind='delete' AND caller.kind IN ('source_delete','privacy_source_delete') AND plan.source_namespace=caller.namespace AND object.key_digest=physical.key_digest AND object.object_key=physical.object_key AND EXISTS(SELECT 1 FROM media_storage_transfer_receipts member JOIN media_object_writes original ON original.id=member.receipt_id WHERE member.object_id=object.id AND original.original_reservation_id=physical.original_reservation_id AND original.provider_revision_digest=freeholder_media_transfer_fact_digest(caller.expected_revision)))
     OR (physical.operation_kind='delete' AND caller.kind='privacy_delete' AND plan.target_namespace=caller.namespace AND object.target_key_digest=physical.key_digest AND object.target_object_key=physical.object_key AND EXISTS(SELECT 1 FROM media_object_writes target WHERE target.id=object.target_receipt_id AND target.original_reservation_id=physical.original_reservation_id AND target.provider_revision_digest=freeholder_media_transfer_fact_digest(caller.expected_revision)))))
  THEN RAISE EXCEPTION 'Ordinary logical/physical mutations and mismatched transfer children remain fenced; GET and flags do not grant dispatch' USING ERRCODE='23514'; END IF;
   IF TG_TABLE_NAME='media_storage_transfer_requests' THEN
    IF NEW.descriptor->>'kind' NOT IN ('object.put','object.delete') THEN RAISE EXCEPTION 'A transfer parent cannot authorize another physical mutation kind' USING ERRCODE='23514'; END IF;
   END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER media_original_logical_namespace BEFORE INSERT ON media_storage_transfer_calls FOR EACH ROW EXECUTE FUNCTION freeholder_media_original_mutation_namespace_guard();
--> statement-breakpoint
CREATE TRIGGER media_original_physical_namespace BEFORE INSERT ON media_storage_transfer_requests FOR EACH ROW EXECUTE FUNCTION freeholder_media_original_mutation_namespace_guard();
--> statement-breakpoint
-- Source continuation only: no request capability is published here.
CREATE FUNCTION freeholder_media_original_absence_inventory_complete(original_inventory uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 WITH RECURSIVE header AS (
  SELECT * FROM media_storage_provider_inventories WHERE id=original_inventory AND plan_id IS NULL AND purpose='retirement' AND state='complete' AND completed_at IS NOT NULL AND first_digest=confirmed_digest
 ), walked(id,pass,kind,next_cursor) AS (
  SELECT page.id,page.pass,page.kind,page.next_cursor FROM media_storage_provider_inventory_pages page JOIN header ON header.id=page.inventory_id WHERE page.cursor IS NULL OR EXISTS(SELECT 1 FROM media_storage_provider_inventory_pages minimized WHERE minimized.inventory_id=page.inventory_id AND minimized.redacted_at IS NOT NULL)
  UNION
  SELECT page.id,page.pass,page.kind,page.next_cursor FROM walked prior JOIN media_storage_provider_inventory_pages page ON page.inventory_id=original_inventory AND page.pass=prior.pass AND page.kind=prior.kind AND page.cursor=prior.next_cursor WHERE prior.next_cursor IS NOT NULL
 ), required AS (
  SELECT pass_number,kind FROM header CROSS JOIN generate_series(0,1) passes(pass_number) CROSS JOIN LATERAL unnest(CASE WHEN header.binding->>'kind'='s3' THEN ARRAY['configuration','objects','versions','sessions'] ELSE ARRAY['configuration','objects','versions','retained'] END) kinds(kind)
 )
 SELECT EXISTS(SELECT 1 FROM header WHERE binding->>'kind' IN ('s3','replit'))
 AND NOT EXISTS(SELECT 1 FROM required WHERE NOT EXISTS(SELECT 1 FROM walked WHERE walked.pass=required.pass_number AND walked.kind=required.kind AND walked.next_cursor IS NULL))
 AND (SELECT count(*) FROM media_storage_provider_inventory_pages WHERE inventory_id=original_inventory AND kind='configuration')=2
 AND NOT EXISTS(SELECT 1 FROM media_storage_provider_inventory_pages page JOIN header ON header.id=page.inventory_id WHERE page.kind='configuration' AND (page.cursor IS NOT NULL OR page.next_cursor IS NOT NULL OR page.configuration IS NULL OR page.configuration IS DISTINCT FROM header.configuration OR page.entry_count<>0))
 AND NOT EXISTS(SELECT 1 FROM media_storage_provider_inventory_pages page WHERE page.inventory_id=original_inventory AND (NOT EXISTS(SELECT 1 FROM walked WHERE walked.id=page.id) OR NOT EXISTS(SELECT 1 FROM required WHERE required.pass_number=page.pass AND required.kind=page.kind)))
 AND NOT EXISTS(SELECT 1 FROM media_storage_provider_inventory_pages page JOIN media_storage_transfer_calls caller ON caller.id=page.call_id WHERE page.inventory_id=original_inventory AND (caller.state<>'returned' OR caller.returned_at IS NULL OR caller.kind<>'ordinary_retirement_inventory' OR NOT EXISTS(SELECT 1 FROM media_storage_transfer_requests WHERE call_id=caller.id) OR EXISTS(SELECT 1 FROM media_storage_transfer_requests WHERE call_id=caller.id AND (state<>'returned' OR returned_at IS NULL)) OR page.entry_count<>(SELECT count(*) FROM media_storage_provider_inventory_entries WHERE page_id=page.id)))
 AND NOT EXISTS(SELECT 1 FROM media_storage_provider_inventory_entries entry JOIN header ON header.id=entry.inventory_id JOIN media_object_writes original ON original.id=header.object_receipt_id WHERE entry.key_digest=original.key_digest)
$$;
--> statement-breakpoint
CREATE FUNCTION freeholder_media_ordinary_retirement_proven(reservation uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 WITH original AS (
  SELECT * FROM media_object_writes WHERE original_reservation_id=reservation AND operation_kind='put'
 ), family AS (
  SELECT * FROM media_object_writes WHERE original_reservation_id=reservation
 ), callers AS (
  SELECT * FROM media_storage_transfer_calls WHERE object_receipt_id IN (SELECT id FROM family) OR physical_receipt_id IN (SELECT id FROM family)
 )
 SELECT reservation IS NOT NULL AND (SELECT count(*) FROM original)=1 AND (SELECT count(*) FROM family)>=2
 AND NOT EXISTS(SELECT 1 FROM family item WHERE writer_runtime_id IS NULL OR storage_namespace IS NULL OR writer_finished_at IS NULL AND NOT(item.operation_kind='put' AND EXISTS(SELECT 1 FROM media_storage_transfer_calls writer WHERE writer.object_receipt_id=item.id AND freeholder_media_original_applied_review(writer.id))))
 AND NOT EXISTS(SELECT 1 FROM original WHERE state<>'accepted' OR provider_revision_digest IS NULL OR sha256 IS NULL OR bytes IS NULL OR storage_kind NOT IN ('s3','replit'))
 AND NOT EXISTS(SELECT 1 FROM family item JOIN original ON true WHERE ROW(item.key_digest,item.storage_namespace,item.sha256,item.bytes,item.content_type) IS DISTINCT FROM ROW(original.key_digest,original.storage_namespace,original.sha256,original.bytes,original.content_type))
 AND NOT EXISTS(SELECT 1 FROM media_object_writes other JOIN original ON other.key_digest=original.key_digest WHERE other.original_reservation_id IS DISTINCT FROM reservation)
 AND NOT EXISTS(SELECT 1 FROM media_multipart_resources resource JOIN original ON resource.key_digest=original.key_digest OR resource.original_reservation_id=reservation)
 AND NOT EXISTS(SELECT 1 FROM media_storage_transfer_receipts WHERE receipt_id IN (SELECT id FROM family))
 AND NOT EXISTS(SELECT 1 FROM media_storage_transfer_objects copy JOIN original ON original.key_digest IN (copy.key_digest,copy.target_key_digest))
 AND NOT EXISTS(SELECT 1 FROM media_objects pointer JOIN original ON pointer.key=original.object_key WHERE pointer.reservation_id IS DISTINCT FROM reservation OR pointer.state='attached')
 AND NOT EXISTS(SELECT 1 FROM privacy_retention_exceptions hold JOIN data_requests request ON request.id=hold.data_request_id WHERE hold.scope IN ('media.storageOperations','media.multipartOperations','media.storageTransfers','members') AND (hold.expires_at IS NULL OR hold.expires_at>clock_timestamp()) AND EXISTS(SELECT 1 FROM family WHERE contact_id IS NULL OR contact_id=request.contact_id))
 AND NOT EXISTS(SELECT 1 FROM callers WHERE state IN ('admitted','unknown') OR returned_at IS NULL AND NOT freeholder_media_original_applied_review(id))
 AND NOT EXISTS(SELECT 1 FROM media_storage_transfer_requests request JOIN callers ON callers.id=request.call_id WHERE request.state IN ('admitted','unknown') OR request.returned_at IS NULL AND NOT freeholder_media_original_applied_review(callers.id))
 AND EXISTS(SELECT 1 FROM original JOIN callers writer ON writer.object_receipt_id=original.id AND writer.kind='ordinary_put' WHERE (writer.returned_at IS NOT NULL AND writer.state='returned' AND writer.observed_accepted_at IS NOT NULL OR freeholder_media_original_applied_review(writer.id)) AND EXISTS(SELECT 1 FROM media_storage_transfer_requests WHERE call_id=writer.id))
 AND NOT EXISTS(SELECT 1 FROM family deletion JOIN original ON true WHERE deletion.operation_kind='delete' AND NOT EXISTS(
  SELECT 1 FROM callers actual WHERE actual.object_receipt_id=deletion.id AND actual.kind='ordinary_delete' AND actual.returned_at IS NOT NULL AND (actual.state='returned' OR actual.state='stopped' AND EXISTS(SELECT 1 FROM media_storage_transfer_reviews reviewed WHERE reviewed.id=actual.stop_receipt_id AND reviewed.call_id=actual.id AND reviewed.object_receipt_id=deletion.id AND reviewed.outcome='retired' AND reviewed.stop_drain_id IS NULL))
   AND (actual.redacted_at IS NOT NULL OR freeholder_media_transfer_fact_digest(actual.expected_revision)=original.provider_revision_digest)
   AND (
    actual.result_digest=freeholder_media_transfer_fact_digest(jsonb_build_object('notAttempted',true)) AND actual.observed_accepted_at IS NULL
     AND NOT EXISTS(SELECT 1 FROM media_storage_transfer_requests request WHERE request.call_id=actual.id AND (NOT EXISTS(SELECT 1 FROM media_storage_transfer_request_observations fact WHERE fact.request_id=request.id AND fact.facts->>'stage'='not_attempted') OR EXISTS(SELECT 1 FROM media_storage_transfer_request_observations fact WHERE fact.request_id=request.id AND fact.facts->>'stage'<>'not_attempted')))
    OR (actual.result_digest=freeholder_media_transfer_fact_digest(jsonb_build_object('accepted',true)) OR actual.state='stopped' AND actual.result_digest IN (freeholder_media_transfer_fact_digest(jsonb_build_object('failed',true)),freeholder_media_transfer_fact_digest(jsonb_build_object('failed',true,'accepted',true)))) AND actual.observed_accepted_at IS NOT NULL
     AND (SELECT count(*) FROM media_storage_transfer_requests WHERE call_id=actual.id)=1
     AND EXISTS(SELECT 1 FROM media_storage_transfer_requests request JOIN media_storage_transfer_request_observations fact ON fact.request_id=request.id WHERE request.call_id=actual.id AND request.descriptor->>'kind'='object.delete' AND request.returned_at IS NOT NULL AND fact.facts->>'stage'='accepted')
   )))
 AND (SELECT count(*) FROM media_storage_transfer_requests request JOIN callers caller ON caller.id=request.call_id WHERE caller.kind='ordinary_delete' AND EXISTS(SELECT 1 FROM media_storage_transfer_request_observations fact WHERE fact.request_id=request.id AND fact.facts->>'stage'='accepted'))<=1
 AND NOT EXISTS(SELECT 1 FROM media_storage_transfer_requests request JOIN callers caller ON caller.id=request.call_id WHERE request.descriptor->>'kind' IN ('object.put','object.delete','multipart.create','multipart.complete','multipart.abort') AND NOT EXISTS(SELECT 1 FROM media_storage_transfer_request_observations fact WHERE fact.request_id=request.id AND fact.facts->>'stage' IN ('accepted','not_attempted')) AND NOT(request.descriptor->>'kind'='object.put' AND freeholder_media_original_applied_review(caller.id)))
 AND EXISTS(SELECT 1 FROM original JOIN callers writer ON writer.object_receipt_id=original.id AND writer.kind='ordinary_put'
  JOIN media_storage_provider_inventories inventory ON inventory.object_receipt_id=original.id AND inventory.anchor_call_id=writer.id
  JOIN callers absence ON absence.id=inventory.proof_call_id
  WHERE absence.kind='ordinary_recovery_read' AND absence.state='returned' AND absence.returned_at IS NOT NULL AND absence.result_absent IS NOT NULL AND (absence.redacted_at IS NOT NULL OR freeholder_media_transfer_fact_digest(absence.expected_revision)=original.provider_revision_digest)
   AND freeholder_media_original_absence_inventory_complete(inventory.id))
$$;
--> statement-breakpoint
CREATE FUNCTION freeholder_media_ordinary_delete_request_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE caller media_storage_transfer_calls; deletion media_object_writes; original media_object_writes;
BEGIN
 IF NEW.descriptor->>'kind'<>'object.delete' THEN RETURN NEW; END IF;
 SELECT * INTO caller FROM media_storage_transfer_calls WHERE id=NEW.call_id;
 IF caller.kind<>'ordinary_delete' THEN RETURN NEW; END IF;
 SELECT * INTO deletion FROM media_object_writes WHERE id=caller.object_receipt_id;
 SELECT * INTO original FROM media_object_writes WHERE original_reservation_id=deletion.original_reservation_id AND operation_kind='put';
 IF deletion.id IS NULL OR original.id IS NULL OR caller.state<>'admitted' OR original.writer_finished_at IS NULL AND NOT EXISTS(SELECT 1 FROM media_storage_transfer_calls writer WHERE writer.object_receipt_id=original.id AND freeholder_media_original_applied_review(writer.id)) OR original.state<>'accepted' OR caller.expected_revision IS DISTINCT FROM original.provider_revision OR NEW.descriptor->'expectedRevision' IS DISTINCT FROM original.provider_revision
  OR EXISTS(SELECT 1 FROM media_storage_transfer_requests WHERE call_id=caller.id)
  OR EXISTS(SELECT 1 FROM media_multipart_resources WHERE original_reservation_id=original.original_reservation_id OR key_digest=original.key_digest)
  OR EXISTS(SELECT 1 FROM media_objects WHERE key=original.object_key AND (reservation_id IS DISTINCT FROM original.original_reservation_id OR state='attached'))
  OR EXISTS(SELECT 1 FROM media_storage_transfer_receipts WHERE receipt_id IN (original.id,deletion.id))
  OR EXISTS(SELECT 1 FROM media_storage_transfer_objects WHERE original.key_digest IN (key_digest,target_key_digest))
  OR EXISTS(SELECT 1 FROM media_object_writes WHERE key_digest=original.key_digest AND id NOT IN (original.id,deletion.id) AND (original_reservation_id IS DISTINCT FROM original.original_reservation_id OR operation_kind<>'delete'))
  OR EXISTS(SELECT 1 FROM media_object_writes earlier WHERE earlier.original_reservation_id=original.original_reservation_id AND earlier.operation_kind='delete' AND earlier.id<>deletion.id AND (earlier.writer_finished_at IS NULL OR NOT EXISTS(
   SELECT 1 FROM media_storage_transfer_calls prior WHERE prior.object_receipt_id=earlier.id AND prior.kind='ordinary_delete' AND prior.state='returned' AND prior.returned_at IS NOT NULL AND prior.observed_accepted_at IS NULL AND prior.result_digest=freeholder_media_transfer_fact_digest(jsonb_build_object('notAttempted',true))
    AND NOT EXISTS(SELECT 1 FROM media_storage_transfer_requests request WHERE request.call_id=prior.id AND (request.state<>'returned' OR request.returned_at IS NULL OR NOT EXISTS(SELECT 1 FROM media_storage_transfer_request_observations fact WHERE fact.request_id=request.id AND fact.facts->>'stage'='not_attempted') OR EXISTS(SELECT 1 FROM media_storage_transfer_request_observations fact WHERE fact.request_id=request.id AND fact.facts->>'stage'<>'not_attempted'))))))
  OR EXISTS(SELECT 1 FROM privacy_retention_exceptions hold JOIN data_requests request ON request.id=hold.data_request_id WHERE hold.scope IN ('media.storageOperations','media.multipartOperations','media.storageTransfers','members') AND (hold.expires_at IS NULL OR hold.expires_at>clock_timestamp()) AND (original.contact_id IS NULL OR original.contact_id=request.contact_id OR deletion.contact_id IS NULL OR deletion.contact_id=request.contact_id))
  OR NOT EXISTS(SELECT 1 FROM media_storage_provider_inventories inventory JOIN media_storage_transfer_calls proof ON proof.id=inventory.proof_call_id JOIN media_storage_transfer_calls writer ON writer.id=inventory.anchor_call_id WHERE inventory.object_receipt_id=original.id AND inventory.plan_id IS NULL AND inventory.purpose='recovery' AND inventory.state='complete' AND inventory.created_at>=deletion.created_at AND inventory.first_digest=inventory.confirmed_digest AND inventory.completed_at IS NOT NULL AND writer.object_receipt_id=original.id AND writer.kind='ordinary_put' AND (writer.state='returned' AND writer.returned_at IS NOT NULL OR freeholder_media_original_applied_review(writer.id)) AND proof.object_receipt_id=original.id AND proof.kind='ordinary_recovery_read' AND proof.state='returned' AND proof.returned_at IS NOT NULL AND proof.created_at>=deletion.created_at AND proof.result_revision=original.provider_revision AND proof.result_sha256=original.sha256 AND proof.result_bytes=original.bytes AND EXISTS(SELECT 1 FROM media_storage_transfer_requests write WHERE write.call_id=writer.id AND write.descriptor->>'kind'='object.put' AND write.id::text=proof.result_request_proof->>'id' AND write.token_digest=proof.result_request_proof->>'tokenDigest'))
 THEN RAISE EXCEPTION 'Original conditional DELETE needs a fresh exact nonce-bound complete proof, no holds/other lineage and no earlier physical dispatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER media_ordinary_delete_request BEFORE INSERT ON media_storage_transfer_requests FOR EACH ROW EXECUTE FUNCTION freeholder_media_ordinary_delete_request_guard();
--> statement-breakpoint
CREATE FUNCTION freeholder_media_ordinary_retirement_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM media_storage_transfer_receipts WHERE receipt_id=OLD.id) AND NOT EXISTS(SELECT 1 FROM media_storage_transfer_calls WHERE physical_receipt_id=OLD.id AND object_id IS NOT NULL) THEN
  IF NOT freeholder_media_ordinary_retirement_proven(OLD.original_reservation_id) THEN RAISE EXCEPTION 'Retain all original caller, pinned absence and complete physical-version/session evidence before standalone retirement' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER media_ordinary_retirement BEFORE UPDATE ON media_object_writes FOR EACH ROW EXECUTE FUNCTION freeholder_media_ordinary_retirement_guard();
--> statement-breakpoint
-- Minimal locator authority requires real original finishes and a complete
-- actual all-copy physical proof. The standalone producer requires its own
-- complete proof; unknown/crashed/multipart debt never closes through404/TTL.
CREATE FUNCTION freeholder_media_original_reservation_retired(reservation uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 WITH RECURSIVE original_writes AS (
  SELECT * FROM media_object_writes WHERE original_reservation_id=reservation
 ), original_resources AS (
  SELECT * FROM media_multipart_resources WHERE original_reservation_id=reservation
 ), lineage_receipts(id) AS (
  SELECT id FROM original_writes
  UNION
  SELECT copy.physical_receipt_id FROM lineage_receipts ancestor JOIN media_storage_transfer_receipts member ON member.receipt_id=ancestor.id JOIN media_storage_transfer_calls copy ON copy.object_id=member.object_id AND copy.kind='target_put' WHERE copy.physical_receipt_id IS NOT NULL
 ), related_objects AS (
  SELECT DISTINCT object.id FROM media_storage_transfer_objects object WHERE object.target_receipt_id IN (SELECT id FROM lineage_receipts)
   OR EXISTS(SELECT 1 FROM media_storage_transfer_receipts member WHERE member.object_id=object.id AND member.receipt_id IN (SELECT id FROM lineage_receipts))
 ), original_calls AS (
  SELECT caller.* FROM media_storage_transfer_calls caller WHERE caller.object_id IN (SELECT id FROM related_objects) OR caller.object_receipt_id IN (SELECT id FROM original_writes)
   OR caller.physical_receipt_id IN (SELECT id FROM original_writes)
   OR caller.multipart_operation_id IN (SELECT operation.id FROM media_multipart_operations operation JOIN original_resources resource ON resource.id=operation.resource_id)
 ), physical AS (
  SELECT request.* FROM media_storage_transfer_requests request JOIN original_calls caller ON caller.id=request.call_id
 )
 SELECT reservation IS NOT NULL AND EXISTS(SELECT 1 FROM original_writes WHERE operation_kind='put')
 AND NOT EXISTS(SELECT 1 FROM original_writes original WHERE deleted_at IS NULL OR state NOT IN ('accepted','confirmed_absent') OR writer_runtime_id IS NULL OR writer_finished_at IS NULL AND NOT(original.operation_kind='put' AND EXISTS(SELECT 1 FROM media_storage_transfer_calls writer WHERE writer.object_receipt_id=original.id AND freeholder_media_original_applied_review(writer.id))))
 AND NOT EXISTS(SELECT 1 FROM lineage_receipts member LEFT JOIN media_object_writes original ON original.id=member.id WHERE original.id IS NULL OR original.deleted_at IS NULL OR original.state NOT IN ('accepted','confirmed_absent') OR original.writer_runtime_id IS NULL OR original.writer_finished_at IS NULL AND NOT(original.operation_kind='put' AND EXISTS(SELECT 1 FROM media_storage_transfer_calls writer WHERE writer.object_receipt_id=original.id AND freeholder_media_original_applied_review(writer.id))))
 AND NOT EXISTS(SELECT 1 FROM original_resources WHERE retired_at IS NULL OR state NOT IN ('completed','aborted'))
 AND NOT EXISTS(SELECT 1 FROM original_calls WHERE state IN ('admitted','unknown') OR returned_at IS NULL AND NOT freeholder_media_original_applied_review(id))
 AND NOT EXISTS(SELECT 1 FROM physical WHERE state IN ('admitted','unknown') OR returned_at IS NULL AND NOT freeholder_media_original_applied_review(call_id))
 AND NOT EXISTS(SELECT 1 FROM physical request WHERE request.descriptor->>'kind' IN ('object.put','multipart.create','multipart.complete','multipart.abort','object.delete')
  AND NOT EXISTS(SELECT 1 FROM media_storage_transfer_request_observations fact WHERE fact.request_id=request.id AND fact.facts->>'stage' IN ('accepted','not_attempted'))
  AND NOT(request.descriptor->>'kind'='object.put' AND EXISTS(
   SELECT 1 FROM media_storage_transfer_reviews review JOIN media_storage_provider_inventories inventory ON inventory.id=review.inventory_id JOIN media_storage_transfer_calls proof ON proof.id=review.read_call_id
   WHERE review.call_id=request.call_id AND review.outcome='applied' AND inventory.state='complete' AND proof.state='returned' AND proof.returned_at IS NOT NULL AND proof.result_request_proof->>'id'=request.id::text AND proof.result_request_proof->>'tokenDigest'=request.token_digest)))
 AND (EXISTS(SELECT 1 FROM related_objects) AND NOT EXISTS(SELECT 1 FROM related_objects object WHERE NOT freeholder_media_transfer_object_retired(object.id))
  OR NOT EXISTS(SELECT 1 FROM related_objects) AND freeholder_media_ordinary_retirement_proven(reservation))
$$;
--> statement-breakpoint
CREATE FUNCTION freeholder_media_original_call_retired(original_call uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM media_storage_transfer_calls caller WHERE caller.id=original_call AND caller.object_id IS NULL AND
  (EXISTS(SELECT 1 FROM media_object_writes original WHERE original.id=coalesce(caller.physical_receipt_id,caller.object_receipt_id) AND freeholder_media_original_reservation_retired(original.original_reservation_id))
   OR EXISTS(SELECT 1 FROM media_multipart_operations operation JOIN media_multipart_resources resource ON resource.id=operation.resource_id WHERE operation.id=caller.multipart_operation_id AND freeholder_media_original_reservation_retired(resource.original_reservation_id))))
$$;
--> statement-breakpoint
CREATE FUNCTION freeholder_media_original_quota_retirement_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE reservation uuid;
BEGIN
 IF current_setting('freeholder.media_transfer_v1',true) IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'Original quota locators require the shared physical retirement authority' USING ERRCODE='23514'; END IF;
 SELECT original.original_reservation_id INTO reservation FROM media_storage_transfer_calls caller JOIN media_object_writes original ON original.id=coalesce(caller.physical_receipt_id,caller.object_receipt_id)
 WHERE caller.namespace=OLD.namespace AND (caller.quota_token=OLD.pending_token OR caller.quota_token=OLD.last_settled_token)
  AND original.key_digest=encode(sha256(convert_to('freeholder:media-object-key:v1','UTF8')||decode('00','hex')||convert_to(OLD.object_key,'UTF8')),'hex') LIMIT 1;
 IF reservation IS NULL OR NOT freeholder_media_original_reservation_retired(reservation)
  OR EXISTS(SELECT token FROM unnest(ARRAY[OLD.pending_token,OLD.last_settled_token]) token WHERE token IS NOT NULL AND NOT EXISTS(SELECT 1 FROM media_storage_transfer_calls caller JOIN media_object_writes original ON original.id=coalesce(caller.physical_receipt_id,caller.object_receipt_id) WHERE caller.quota_token=token AND caller.namespace=OLD.namespace AND original.original_reservation_id=reservation)) THEN RAISE EXCEPTION 'Only the exact fully retired original token/resource cohort can remove its quota locator; never rebind current equal keys' USING ERRCODE='23514'; END IF;
 RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER media_original_quota_retirement BEFORE DELETE ON storage_quota_objects FOR EACH ROW EXECUTE FUNCTION freeholder_media_original_quota_retirement_guard();

--> statement-breakpoint
-- Metadata-only first empty captures. The full provider/request capability
-- remains deliberately unpublished; this function never sets its writer tag.
CREATE FUNCTION freeholder_media_empty_scope_graph_v1(capturing_request uuid,capturing_scope text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT NOT EXISTS(SELECT 1 FROM assets)
 AND NOT EXISTS(SELECT 1 FROM media_capture_sessions)
 AND NOT EXISTS(SELECT 1 FROM media_capture_chunks)
 AND NOT EXISTS(SELECT 1 FROM media_capture_items)
 AND NOT EXISTS(SELECT 1 FROM media_objects)
 AND NOT EXISTS(SELECT 1 FROM media_uploads)
 AND NOT EXISTS(SELECT 1 FROM media_object_writes)
 AND NOT EXISTS(SELECT 1 FROM media_multipart_resources)
 AND NOT EXISTS(SELECT 1 FROM media_multipart_operations)
 AND NOT EXISTS(SELECT 1 FROM storage_quota_state)
 AND NOT EXISTS(SELECT 1 FROM storage_quota_objects)
 AND NOT EXISTS(SELECT 1 FROM media_erasure_cohorts)
 AND NOT EXISTS(SELECT 1 FROM media_storage_transfer_plans)
 AND NOT EXISTS(SELECT 1 FROM media_storage_transfer_objects)
 AND NOT EXISTS(SELECT 1 FROM media_storage_transfer_receipts)
 AND NOT EXISTS(SELECT 1 FROM media_storage_transfer_subjects)
 AND NOT EXISTS(SELECT 1 FROM media_storage_transfer_calls)
 AND NOT EXISTS(SELECT 1 FROM media_storage_writer_drains)
 AND NOT EXISTS(SELECT 1 FROM media_storage_transfer_reviews)
 AND NOT EXISTS(SELECT 1 FROM media_storage_transfer_jobs)
 AND NOT EXISTS(SELECT 1 FROM media_storage_transfer_requests)
 AND NOT EXISTS(SELECT 1 FROM media_storage_transfer_request_observations)
 AND NOT EXISTS(SELECT 1 FROM media_storage_provider_inventories)
 AND NOT EXISTS(SELECT 1 FROM media_storage_provider_inventory_pages)
 AND NOT EXISTS(SELECT 1 FROM media_storage_provider_inventory_entries)
 AND NOT EXISTS(SELECT 1 FROM media_storage_transfer_erasure_members)
 AND NOT EXISTS(SELECT 1 FROM media_storage_transfer_erasure_scopes first_scope WHERE
  first_scope.object_count<>0 OR first_scope.capture_digest<>freeholder_media_transfer_fact_digest('[]'::jsonb)
  OR NOT EXISTS(SELECT 1 FROM data_requests request WHERE request.id=first_scope.request_id AND request.kind='erasure')
  OR NOT first_scope.complete AND NOT(first_scope.created_at=transaction_timestamp() AND first_scope.request_id IS NOT DISTINCT FROM capturing_request AND capturing_scope IS NOT DISTINCT FROM 'media.storageTransfers'))
 AND NOT EXISTS(SELECT 1 FROM media_original_erasure_scopes first_scope WHERE
  first_scope.membership<>'{"format":"freeholder.original-media-erasure/v1","legacyScopes":[],"receipts":[],"resources":[],"uploads":[],"reservations":[],"legacyReservations":[]}'::jsonb
  OR first_scope.capture_digest<>freeholder_media_transfer_fact_digest(first_scope.membership)
  OR NOT EXISTS(SELECT 1 FROM data_requests request WHERE request.id=first_scope.request_id AND request.kind='erasure')
  OR NOT first_scope.complete AND NOT(first_scope.created_at=transaction_timestamp() AND first_scope.request_id IS NOT DISTINCT FROM capturing_request AND first_scope.scope IS NOT DISTINCT FROM capturing_scope))
 -- Retained historical membership is birth debt even when live rows vanished.
 AND NOT EXISTS(SELECT 1 FROM privacy_retention_source_members WHERE source_scope IN('media.storageTransfers','media.storageOperations','media.multipartOperations'))
 AND NOT EXISTS(SELECT 1 FROM privacy_retention_source_snapshots WHERE source_scope IN('media.storageTransfers','media.storageOperations','media.multipartOperations') AND member_count<>0)
 AND NOT EXISTS(SELECT 1 FROM privacy_retention_exceptions hold WHERE hold.scope IN('media.storageTransfers','media.storageOperations','media.multipartOperations','members')
  AND hold.data_request_id IS DISTINCT FROM capturing_request
  AND (NOT EXISTS(SELECT 1 FROM media_storage_transfer_erasure_scopes first_scope WHERE first_scope.request_id=hold.data_request_id AND first_scope.complete AND first_scope.object_count=0)
   OR (SELECT count(*) FROM media_original_erasure_scopes first_scope WHERE first_scope.request_id=hold.data_request_id AND first_scope.complete AND first_scope.scope IN('media.storageOperations','media.multipartOperations'))<>2))
 -- An old media outcome without its actual immutable first header is unknown,
 -- including an old claimed-empty receipt. It cannot acquire a new header now.
 AND NOT EXISTS(SELECT 1 FROM data_request_artifacts artifact JOIN data_requests request ON request.id=artifact.data_request_id
  WHERE request.kind='erasure' AND
   (NOT EXISTS(SELECT 1 FROM media_storage_transfer_erasure_scopes first_scope WHERE first_scope.request_id=request.id AND first_scope.complete AND first_scope.object_count=0)
    OR (SELECT count(*) FROM media_original_erasure_scopes first_scope WHERE first_scope.request_id=request.id AND first_scope.complete AND first_scope.scope IN('media.storageOperations','media.multipartOperations'))<>2))
$$;
--> statement-breakpoint
CREATE FUNCTION freeholder_media_empty_scope_writer_v1(capture_request uuid,capture_scope text,capture_contact uuid) RETURNS boolean LANGUAGE plpgsql VOLATILE AS $$
BEGIN
 IF current_setting('freeholder.media_original_scope_runtime_v1',true) IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'Empty capture requires the actual original scope runtime; no historical writer birth or finish can be minted' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(1691709,82);
 IF coalesce(capture_scope,'') NOT IN('media.storageTransfers','media.storageOperations','media.multipartOperations')
  OR NOT EXISTS(SELECT 1 FROM data_requests request WHERE request.id=capture_request AND request.kind='erasure' AND request.contact_id=capture_contact)
  OR NOT freeholder_media_empty_scope_graph_v1(capture_request,capture_scope) THEN RETURN false; END IF;
 PERFORM set_config('freeholder.media_empty_scope_request_v1',capture_request::text,true);
 PERFORM set_config('freeholder.media_empty_scope_name_v1',capture_scope,true);
 PERFORM set_config('freeholder.media_empty_scope_contact_v1',capture_contact::text,true);
 RETURN true;
END $$;

--> statement-breakpoint
-- SOURCE ONLY. An additional operator stop can record the exact CURRENT plan
-- and complete immutable namespace mutation cohort. This never rewrites the
-- plan's first source drain and never grants mutation through an active drain.
CREATE FUNCTION freeholder_media_transfer_recovery_snapshot(original_plan uuid,original_namespace text) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT jsonb_build_object(
  'plan',jsonb_build_object('id',plan.id,'manifestDigest',plan.manifest_digest,'sourceNamespace',plan.source_namespace,'targetNamespace',plan.target_namespace,'sourceDrainId',plan.source_drain_id,'sourceStopEvidenceDigest',plan.source_stop_evidence_digest,'createdAtEpoch',extract(epoch from plan.created_at)::text),
  'objects',coalesce((SELECT jsonb_agg(jsonb_build_object('id',object.id,'keyDigest',object.key_digest,'targetKeyDigest',object.target_key_digest,'sha256',object.sha256,'bytes',object.bytes,'originalReceiptSetDigest',object.original_receipt_set_digest,'createdAtEpoch',extract(epoch from object.created_at)::text) ORDER BY object.id) FROM media_storage_transfer_objects object WHERE object.plan_id=plan.id),'[]'::jsonb),
  'callers',coalesce((SELECT jsonb_agg(jsonb_build_object('id',caller.id,'objectId',caller.object_id,'objectReceiptId',caller.object_receipt_id,'multipartOperationId',caller.multipart_operation_id,'physicalReceiptId',caller.physical_receipt_id,'kind',caller.kind,'namespace',caller.namespace,'requestDigest',caller.request_digest,'callerTokenDigest',caller.caller_token_digest,'runtimeId',caller.runtime_id,'runtimeIdentity',caller.runtime_identity,'createdAtEpoch',extract(epoch from caller.created_at)::text) ORDER BY caller.id) FROM media_storage_transfer_calls caller WHERE caller.namespace=original_namespace AND caller.kind IN ('ordinary_put','ordinary_delete','target_put','source_delete','privacy_delete','privacy_source_delete','multipart_create','multipart_complete','multipart_abort')),'[]'::jsonb),
  'requests',coalesce((SELECT jsonb_agg(jsonb_build_object('id',request.id,'callId',request.call_id,'descriptorDigest',request.descriptor_digest,'tokenDigest',request.token_digest,'keyDigest',request.key_digest,'runtimeIdentity',request.runtime_identity,'createdAtEpoch',extract(epoch from request.created_at)::text) ORDER BY request.id) FROM media_storage_transfer_requests request JOIN media_storage_transfer_calls caller ON caller.id=request.call_id WHERE caller.namespace=original_namespace AND request.descriptor->>'kind' IN ('object.put','object.delete','multipart.create','multipart.complete','multipart.abort')),'[]'::jsonb),
  'receipts',coalesce((SELECT jsonb_agg(jsonb_build_object('id',receipt.id,'reservationId',receipt.original_reservation_id,'keyDigest',receipt.key_digest,'runtimeId',receipt.writer_runtime_id,'operation',receipt.operation_kind,'createdAtEpoch',extract(epoch from receipt.created_at)::text) ORDER BY receipt.id) FROM media_object_writes receipt WHERE receipt.storage_namespace=original_namespace),'[]'::jsonb)
 ) FROM media_storage_transfer_plans plan
 WHERE plan.id=original_plan AND original_namespace IN (plan.source_namespace,plan.target_namespace) AND plan.redacted_at IS NULL
  AND EXISTS(SELECT 1 FROM media_storage_transfer_objects WHERE plan_id=plan.id)
  AND (SELECT count(*) FROM media_storage_transfer_objects WHERE plan_id=plan.id)<=10000
  AND (SELECT count(*) FROM media_storage_transfer_calls WHERE namespace=original_namespace)<=10000
  AND (SELECT count(*) FROM media_storage_transfer_requests request JOIN media_storage_transfer_calls caller ON caller.id=request.call_id WHERE caller.namespace=original_namespace)<=100000
  AND (SELECT count(*) FROM media_object_writes WHERE storage_namespace=original_namespace)<=10000
  AND NOT EXISTS(SELECT 1 FROM media_storage_transfer_plans other WHERE other.id<>plan.id AND original_namespace IN (other.source_namespace,other.target_namespace) AND other.state NOT IN ('complete','cancelled'))
$$;
--> statement-breakpoint
CREATE FUNCTION freeholder_media_transfer_recovery_drain_releasable(original_drain uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(
  SELECT 1 FROM media_storage_writer_drains drain
  WHERE drain.id=original_drain AND drain.state='verified' AND drain.verified_at IS NOT NULL AND drain.verified_at>=drain.created_at AND drain.released_at IS NULL
   AND drain.stop_proof_digest ~ '^[a-f0-9]{64}$' AND drain.executor_identity='linux-systemd:'||(drain.original_processes->>'boot')
   AND drain.original_processes->>'format'='freeholder.media-writer-drain/v1' AND drain.original_processes->>'unit'='freeholder.service'
   AND drain.original_processes->'recovery'->>'format'='freeholder.media-transfer-drain/v1'
   AND drain.original_processes->'recovery'->>'namespace'=drain.namespace
   AND coalesce(drain.original_processes->'recovery'->>'planId','') ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
   AND drain.original_processes->'recovery'->'snapshot'=freeholder_media_transfer_recovery_snapshot((CASE WHEN coalesce(drain.original_processes->'recovery'->>'planId','') ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' THEN (drain.original_processes->'recovery'->>'planId')::uuid ELSE NULL END),drain.namespace)
   AND NOT EXISTS(SELECT 1 FROM media_object_writes receipt WHERE receipt.storage_namespace=drain.namespace AND (receipt.writer_runtime_id IS NULL OR receipt.writer_finished_at IS NULL OR receipt.original_reservation_id IS NULL OR receipt.state NOT IN ('accepted','confirmed_absent') OR NOT EXISTS(SELECT 1 FROM media_storage_transfer_calls caller WHERE coalesce(caller.physical_receipt_id,caller.object_receipt_id)=receipt.id AND caller.kind IN ('ordinary_put','ordinary_delete','target_put','source_delete','privacy_delete','privacy_source_delete') AND caller.runtime_id=receipt.writer_runtime_id)))
   AND NOT EXISTS(SELECT 1 FROM media_multipart_resources resource WHERE resource.storage_namespace=drain.namespace AND resource.retired_at IS NULL)
   AND NOT EXISTS(SELECT 1 FROM media_storage_transfer_calls caller WHERE caller.namespace=drain.namespace AND caller.kind IN ('ordinary_put','ordinary_delete','target_put','source_delete','privacy_delete','privacy_source_delete','multipart_create','multipart_complete','multipart_abort') AND (caller.state<>'returned' OR caller.returned_at IS NULL OR caller.result_digest IS NULL OR caller.created_at>drain.created_at OR EXISTS(SELECT 1 FROM media_storage_transfer_objects object JOIN media_storage_transfer_plans other ON other.id=object.plan_id WHERE object.id=caller.object_id AND object.plan_id::text IS DISTINCT FROM drain.original_processes->'recovery'->>'planId' AND other.state NOT IN ('complete','cancelled'))))
   AND NOT EXISTS(SELECT 1 FROM media_storage_transfer_requests request JOIN media_storage_transfer_calls caller ON caller.id=request.call_id WHERE caller.namespace=drain.namespace AND request.descriptor->>'kind' IN ('object.put','object.delete','multipart.create','multipart.complete','multipart.abort') AND (request.state<>'returned' OR request.returned_at IS NULL OR request.created_at>drain.created_at OR request.descriptor_digest IS DISTINCT FROM freeholder_media_transfer_fact_digest(request.descriptor) OR request.runtime_identity IS DISTINCT FROM caller.runtime_identity OR caller.kind NOT IN ('ordinary_put','ordinary_delete','target_put','source_delete','privacy_delete','privacy_source_delete','multipart_create','multipart_complete','multipart_abort')))
 )
$$;
-- This narrow finished-cohort release does not resolve any missing physical
-- finish, stopped-applied target review, presigned part/session or legacy debt.
-- Full request and multipart part capabilities remain UNPUBLISHED.
