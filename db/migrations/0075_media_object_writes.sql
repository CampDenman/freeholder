-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- freeholder:schema-breaking Use a guarded writer. Rollback needs the matching pre-upgrade DB/object snapshot and must respect acknowledged erasures.
-- C1.12/C3.22/C11.08: never equate a rejected client PUT with provider absence.
CREATE TABLE media_object_writes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), operation_kind text NOT NULL DEFAULT 'put', object_key text NOT NULL, key_digest text NOT NULL,
 storage_namespace text, storage_kind text, storage_location jsonb NOT NULL DEFAULT '{}',
 sha256 text, bytes bigint, content_type text NOT NULL, actor text NOT NULL,
 contact_id uuid REFERENCES contacts(id) ON DELETE RESTRICT,
 state text NOT NULL, observed_accepted_at timestamptz,
 reviewed_at timestamptz, reviewed_by text, evidence_digest text, deleted_at timestamptz, redacted_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT media_object_writes_state CHECK(state IN ('unverified','started','accepted','unknown','confirmed_absent')),
 CONSTRAINT media_object_writes_operation CHECK(operation_kind IN ('put','delete')),
 CONSTRAINT media_object_writes_namespace CHECK(storage_namespace IS NULL OR storage_namespace ~ '^[a-f0-9]{64}$'),
 CONSTRAINT media_object_writes_digest CHECK(sha256 IS NULL OR sha256 ~ '^[a-f0-9]{64}$'),
 CONSTRAINT media_object_writes_bytes CHECK(bytes IS NULL OR bytes>=0)
);
--> statement-breakpoint
CREATE INDEX media_object_writes_key_idx ON media_object_writes(object_key,created_at);
--> statement-breakpoint
CREATE INDEX media_object_writes_digest_idx ON media_object_writes(key_digest);
--> statement-breakpoint
CREATE INDEX media_object_writes_contact_idx ON media_object_writes(contact_id,state);
--> statement-breakpoint
CREATE INDEX media_object_writes_open_idx ON media_object_writes(state,created_at);
--> statement-breakpoint
-- Drain old row writers before recording the legacy uncertainty. A present
-- key is not evidence for its original provider/account or completed PUT.
LOCK TABLE media_objects IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
INSERT INTO media_object_writes(object_key,key_digest,bytes,content_type,actor,contact_id,state)
 SELECT object.key,encode(sha256(convert_to('freeholder:media-object-key:v1','UTF8')||decode('00','hex')||convert_to(object.key,'UTF8')),'hex'),object.bytes,object.content_type,'legacy-unverified',contact.id,'unverified'
 FROM media_objects object LEFT JOIN assets asset ON asset.id=object.asset_id
 LEFT JOIN contacts contact ON asset.uploaded_by='user:'||contact.user_id::text;
--> statement-breakpoint
CREATE FUNCTION freeholder_media_write_receipt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='media_object_writes' THEN
  IF current_setting('freeholder.media_writes_v1',true) IS DISTINCT FROM '1' THEN
   RAISE EXCEPTION 'Media operation receipts require the guarded writer' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN
   RAISE EXCEPTION 'Original media operation receipts cannot be deleted' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' AND (ROW(NEW.id,NEW.operation_kind,NEW.key_digest,NEW.content_type,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id,OLD.operation_kind,OLD.key_digest,OLD.content_type,OLD.created_at)
    OR (NEW.bytes IS DISTINCT FROM OLD.bytes AND NOT(OLD.storage_namespace IS NULL AND OLD.bytes IS NULL AND NEW.storage_namespace IS NOT NULL))) THEN
   RAISE EXCEPTION 'Original media operation intent is immutable' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' AND ROW(NEW.object_key,NEW.actor) IS DISTINCT FROM ROW(OLD.object_key,OLD.actor)
   AND NOT(OLD.redacted_at IS NULL AND NEW.redacted_at IS NOT NULL AND NEW.deleted_at IS NOT NULL
    AND NEW.object_key='retained:'||OLD.key_digest AND NEW.actor='erased' AND NEW.contact_id IS NULL
    AND NEW.state NOT IN ('unverified','started','unknown') AND NEW.storage_location='{}'::jsonb
    AND NOT EXISTS(SELECT 1 FROM media_object_writes WHERE key_digest=OLD.key_digest AND state IN ('unverified','started','unknown'))) THEN
   RAISE EXCEPTION 'Original media evidence may only be minimized after settled cleanup' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' AND OLD.storage_namespace IS NOT NULL AND
    (ROW(NEW.storage_namespace,NEW.storage_kind,NEW.sha256) IS DISTINCT FROM ROW(OLD.storage_namespace,OLD.storage_kind,OLD.sha256)
    OR (NEW.storage_location IS DISTINCT FROM OLD.storage_location AND NOT(NEW.redacted_at IS NOT NULL AND NEW.storage_location='{}'::jsonb))) THEN
   RAISE EXCEPTION 'Original media storage binding is immutable' USING ERRCODE='23514';
  END IF;
 ELSIF TG_OP IN ('INSERT','UPDATE') AND current_setting('freeholder.media_writes_v1',true) IS DISTINCT FROM '1'
  AND EXISTS(SELECT 1 FROM media_object_writes WHERE object_key=NEW.key AND operation_kind='delete'
    AND state IN ('started','unknown','accepted')) THEN
  RAISE EXCEPTION 'An original media deletion fences older object writers' USING ERRCODE='23514';
 ELSIF TG_OP='DELETE' THEN
  IF EXISTS(SELECT 1 FROM media_object_writes WHERE object_key=OLD.key AND deleted_at IS NULL)
   AND current_setting('freeholder.media_writes_v1',true) IS DISTINCT FROM '1' THEN
   RAISE EXCEPTION 'Media ownership cannot be dropped before original write recovery' USING ERRCODE='23514';
  END IF;
 ELSIF NEW.state='attached' AND EXISTS(
   SELECT 1 FROM media_object_writes WHERE object_key=NEW.key AND state IN ('unverified','started','unknown')
 ) THEN
  RAISE EXCEPTION 'Unsettled media writes cannot be attached' USING ERRCODE='23514';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER media_object_writes_guard BEFORE INSERT OR UPDATE OR DELETE ON media_object_writes
 FOR EACH ROW EXECUTE FUNCTION freeholder_media_write_receipt_guard();
--> statement-breakpoint
CREATE TRIGGER media_objects_write_receipt_guard BEFORE INSERT OR UPDATE OR DELETE ON media_objects
 FOR EACH ROW EXECUTE FUNCTION freeholder_media_write_receipt_guard();
--> statement-breakpoint
-- Historical merge snapshots cannot reconstruct ownership introduced later.
UPDATE contact_merge_operations operation SET undoable=false,
 undo_blockers=undo_blockers||ARRAY['Media operation ownership was not captured by this historical merge.']::text[]
 WHERE operation.undone_at IS NULL AND operation.undoable
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(operation.reference_state) ref WHERE ref->>'table'='media_object_writes')
 AND EXISTS(SELECT 1 FROM media_object_writes receipt WHERE receipt.contact_id=operation.surviving_contact_id);
--> statement-breakpoint
CREATE FUNCTION freeholder_media_merge_receipt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.undone_at IS DISTINCT FROM OLD.undone_at AND NEW.undone_at IS NOT NULL
 AND EXISTS(SELECT 1 FROM media_object_writes WHERE contact_id IN(OLD.surviving_contact_id,OLD.duplicate_contact_id))
 AND (current_setting('freeholder.media_writes_v1',true) IS DISTINCT FROM '1'
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(OLD.reference_state) ref WHERE ref->>'table'='media_object_writes')) THEN
  RAISE EXCEPTION 'Media ownership requires its original guarded merge witness' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER contact_merge_media_receipt_guard BEFORE UPDATE ON contact_merge_operations
 FOR EACH ROW EXECUTE FUNCTION freeholder_media_merge_receipt_guard();
--> statement-breakpoint
-- Original reservation ownership is not the later executor's identity.
ALTER TABLE media_uploads ADD COLUMN owner_contact_id uuid REFERENCES contacts(id) ON DELETE RESTRICT;
--> statement-breakpoint
UPDATE media_uploads upload SET owner_contact_id=contact.id FROM contacts contact
 WHERE upload.uploaded_by='user:'||contact.user_id::text;
--> statement-breakpoint
CREATE INDEX media_uploads_owner_idx ON media_uploads(owner_contact_id);
--> statement-breakpoint
ALTER TABLE media_objects ADD COLUMN owner_contact_id uuid REFERENCES contacts(id) ON DELETE RESTRICT;
--> statement-breakpoint
UPDATE media_objects object SET owner_contact_id=upload.owner_contact_id FROM media_uploads upload
 WHERE upload.id=object.upload_id AND upload.owner_contact_id IS NOT NULL;
--> statement-breakpoint
UPDATE media_objects object SET owner_contact_id=contact.id FROM assets asset JOIN contacts contact ON asset.uploaded_by='user:'||contact.user_id::text
 WHERE object.asset_id=asset.id AND object.owner_contact_id IS NULL;
--> statement-breakpoint
CREATE INDEX media_objects_owner_idx ON media_objects(owner_contact_id);
--> statement-breakpoint
SELECT set_config('freeholder.media_writes_v1','1',true);
--> statement-breakpoint
UPDATE media_object_writes receipt SET contact_id=object.owner_contact_id FROM media_objects object
 WHERE receipt.object_key=object.key AND receipt.actor='legacy-unverified' AND receipt.storage_namespace IS NULL
 AND receipt.contact_id IS NULL AND object.owner_contact_id IS NOT NULL;
--> statement-breakpoint
CREATE TABLE media_multipart_resources (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), upload_id uuid NOT NULL, object_key text NOT NULL, key_digest text NOT NULL,
 storage_namespace text, storage_kind text, storage_location jsonb NOT NULL DEFAULT '{}', provider_upload_id text,
 content_type text NOT NULL, expected_bytes bigint NOT NULL, actor text NOT NULL,
 contact_id uuid REFERENCES contacts(id) ON DELETE RESTRICT, state text NOT NULL,
 object_receipt_id uuid REFERENCES media_object_writes(id) ON DELETE RESTRICT,
 completed_at timestamptz, abort_acknowledged_at timestamptz, retired_at timestamptz, redacted_at timestamptz,
 reviewed_at timestamptz, reviewed_by text, evidence_digest text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT media_multipart_state CHECK(state IN ('unverified','creating','open','completing','completed','aborting','aborted','unknown')),
 CONSTRAINT media_multipart_namespace CHECK(storage_namespace IS NULL OR storage_namespace ~ '^[a-f0-9]{64}$'),
 CONSTRAINT media_multipart_size CHECK(expected_bytes>0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX media_multipart_upload_idx ON media_multipart_resources(upload_id);
--> statement-breakpoint
CREATE UNIQUE INDEX media_multipart_key_idx ON media_multipart_resources(key_digest);
--> statement-breakpoint
CREATE INDEX media_multipart_contact_idx ON media_multipart_resources(contact_id,state);
--> statement-breakpoint
CREATE INDEX media_multipart_state_idx ON media_multipart_resources(state,created_at);
--> statement-breakpoint
CREATE TABLE media_multipart_operations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), resource_id uuid NOT NULL REFERENCES media_multipart_resources(id) ON DELETE RESTRICT,
 operation_kind text NOT NULL, state text NOT NULL, provider_upload_id text, parts jsonb NOT NULL DEFAULT '[]', parts_digest text,
 actor text NOT NULL, provider_accepted_at timestamptz, verified_at timestamptz, observed_provider_upload_id text,
 reviewed_at timestamptz, reviewed_by text, evidence_digest text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT media_multipart_operation_kind CHECK(operation_kind IN ('create','complete','abort')),
 CONSTRAINT media_multipart_operation_state CHECK(state IN ('started','accepted','unknown','not_applied')),
 CONSTRAINT media_multipart_parts_digest CHECK(parts_digest IS NULL OR parts_digest ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE INDEX media_multipart_operations_resource_idx ON media_multipart_operations(resource_id,created_at);
--> statement-breakpoint
CREATE INDEX media_multipart_operations_open_idx ON media_multipart_operations(state,created_at);
--> statement-breakpoint
-- Legacy IDs are facts; a current bucket and successful CREATE are not.
INSERT INTO media_multipart_resources(upload_id,object_key,key_digest,provider_upload_id,content_type,expected_bytes,actor,contact_id,state)
 SELECT upload.id,upload.storage_key,encode(sha256(convert_to('freeholder:media-object-key:v1','UTF8')||decode('00','hex')||convert_to(upload.storage_key,'UTF8')),'hex'),
 upload.provider_upload_id,upload.declared_mime,upload.expected_bytes,coalesce(upload.uploaded_by,'legacy-unverified'),upload.owner_contact_id,'unverified'
 FROM media_uploads upload WHERE upload.strategy='direct_multipart';
--> statement-breakpoint
CREATE FUNCTION freeholder_media_multipart_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_setting('freeholder.media_writes_v1',true) IS DISTINCT FROM '1' THEN
  RAISE EXCEPTION 'Multipart resources require the guarded original writer' USING ERRCODE='23514';
 END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Original multipart receipts cannot be deleted' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND TG_TABLE_NAME='media_multipart_resources' THEN
  IF ROW(NEW.id,NEW.upload_id,NEW.key_digest,NEW.content_type,NEW.expected_bytes,NEW.created_at)
   IS DISTINCT FROM ROW(OLD.id,OLD.upload_id,OLD.key_digest,OLD.content_type,OLD.expected_bytes,OLD.created_at)
   OR (OLD.provider_upload_id IS NOT NULL AND NEW.provider_upload_id IS DISTINCT FROM OLD.provider_upload_id)
   OR (OLD.object_receipt_id IS NOT NULL AND NEW.object_receipt_id IS DISTINCT FROM OLD.object_receipt_id) THEN
   RAISE EXCEPTION 'Original multipart resource identity is immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.storage_namespace IS NOT NULL AND
   (ROW(NEW.storage_namespace,NEW.storage_kind) IS DISTINCT FROM ROW(OLD.storage_namespace,OLD.storage_kind)
    OR (NEW.storage_location IS DISTINCT FROM OLD.storage_location AND NOT(NEW.redacted_at IS NOT NULL AND NEW.storage_location='{}'::jsonb))) THEN
   RAISE EXCEPTION 'Original multipart namespace is immutable' USING ERRCODE='23514';
  END IF;
  IF ROW(NEW.object_key,NEW.actor) IS DISTINCT FROM ROW(OLD.object_key,OLD.actor) AND NOT(
   OLD.redacted_at IS NULL AND NEW.redacted_at IS NOT NULL AND NEW.retired_at IS NOT NULL
   AND NEW.object_key='retained:'||OLD.key_digest AND NEW.actor='erased' AND NEW.contact_id IS NULL
   AND NEW.storage_location='{}'::jsonb AND NEW.state IN('completed','aborted')
   AND NOT EXISTS(SELECT 1 FROM media_multipart_operations WHERE resource_id=OLD.id AND state IN('started','unknown'))
   AND (NEW.object_receipt_id IS NULL OR EXISTS(SELECT 1 FROM media_object_writes WHERE id=NEW.object_receipt_id AND deleted_at IS NOT NULL))) THEN
   RAISE EXCEPTION 'Multipart personal identity requires settled original cleanup' USING ERRCODE='23514';
  END IF;
 ELSIF TG_OP='UPDATE' AND TG_TABLE_NAME='media_multipart_operations' THEN
  IF ROW(NEW.id,NEW.resource_id,NEW.operation_kind,NEW.provider_upload_id,NEW.parts_digest,NEW.created_at)
   IS DISTINCT FROM ROW(OLD.id,OLD.resource_id,OLD.operation_kind,OLD.provider_upload_id,OLD.parts_digest,OLD.created_at)
   OR (NEW.parts IS DISTINCT FROM OLD.parts AND NOT(NEW.parts='[]'::jsonb AND EXISTS(SELECT 1 FROM media_multipart_resources WHERE id=OLD.resource_id AND redacted_at IS NOT NULL)))
   OR (OLD.provider_accepted_at IS NOT NULL AND NEW.provider_accepted_at IS DISTINCT FROM OLD.provider_accepted_at)
   OR (OLD.observed_provider_upload_id IS NOT NULL AND NEW.observed_provider_upload_id IS DISTINCT FROM OLD.observed_provider_upload_id)
   OR (NEW.actor IS DISTINCT FROM OLD.actor AND NOT(NEW.actor='erased' AND EXISTS(SELECT 1 FROM media_multipart_resources WHERE id=OLD.resource_id AND redacted_at IS NOT NULL))) THEN
   RAISE EXCEPTION 'Original multipart call intent and positive facts are immutable' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER media_multipart_resources_guard BEFORE INSERT OR UPDATE OR DELETE ON media_multipart_resources
 FOR EACH ROW EXECUTE FUNCTION freeholder_media_multipart_guard();
--> statement-breakpoint
CREATE TRIGGER media_multipart_operations_guard BEFORE INSERT OR UPDATE OR DELETE ON media_multipart_operations
 FOR EACH ROW EXECUTE FUNCTION freeholder_media_multipart_guard();
--> statement-breakpoint
CREATE FUNCTION freeholder_media_upload_admission() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_setting('freeholder.media_writes_v1',true) IS DISTINCT FROM '1' THEN
  RAISE EXCEPTION 'Media reservation requires the guarded original writer' USING ERRCODE='23514';
 END IF;
 IF TG_OP='DELETE' THEN
  IF EXISTS(SELECT 1 FROM media_multipart_resources WHERE upload_id=OLD.id AND retired_at IS NULL)
   OR EXISTS(SELECT 1 FROM media_object_writes WHERE object_key=OLD.storage_key AND state IN('unverified','started','unknown')) THEN
   RAISE EXCEPTION 'Original media work is unresolved; preserve its reservation' USING ERRCODE='23514';
  END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' AND ROW(NEW.storage_key,NEW.uploaded_by,NEW.declared_mime,NEW.expected_bytes,NEW.strategy)
  IS DISTINCT FROM ROW(OLD.storage_key,OLD.uploaded_by,OLD.declared_mime,OLD.expected_bytes,OLD.strategy)
  AND NOT(NEW.uploaded_by='erased' AND NEW.owner_contact_id IS NULL AND NEW.state IN('complete','failed','aborted','expired')
   AND NEW.filename='[erased]' AND NEW.provenance='{}'::jsonb AND NEW.media_metadata='{}'::jsonb
   AND NOT EXISTS(SELECT 1 FROM media_object_writes WHERE object_key=OLD.storage_key AND deleted_at IS NULL)
   AND NOT EXISTS(SELECT 1 FROM media_multipart_resources WHERE upload_id=OLD.id AND redacted_at IS NULL)) THEN
  RAISE EXCEPTION 'Original media reservation intent is immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER media_uploads_admission BEFORE INSERT OR UPDATE OR DELETE ON media_uploads
 FOR EACH ROW EXECUTE FUNCTION freeholder_media_upload_admission();
--> statement-breakpoint
CREATE FUNCTION freeholder_media_object_admission() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' AND NEW.state='pending' AND current_setting('freeholder.media_writes_v1',true) IS DISTINCT FROM '1' THEN
  RAISE EXCEPTION 'Media reservation requires admission before provider I/O' USING ERRCODE='23514';
 END IF;
 IF TG_OP='DELETE' AND (
  EXISTS(SELECT 1 FROM media_object_writes WHERE key_digest=encode(sha256(convert_to('freeholder:media-object-key:v1','UTF8')||decode('00','hex')||convert_to(OLD.key,'UTF8')),'hex') AND deleted_at IS NULL)
  OR EXISTS(SELECT 1 FROM media_multipart_resources WHERE object_key=OLD.key AND retired_at IS NULL)) THEN
  RAISE EXCEPTION 'Original physical media ownership is still unresolved' USING ERRCODE='23514';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER media_objects_pre_io_admission BEFORE INSERT OR DELETE ON media_objects
 FOR EACH ROW EXECUTE FUNCTION freeholder_media_object_admission();
--> statement-breakpoint
-- Cold old runtimes stay unready; warm/in-flight old direct I/O must first be
-- drained and stopped by the breaking-deployment protocol, never inferred away.
CREATE FUNCTION freeholder_media_runtime_admission() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_setting('freeholder.media_runtime_v1',true) IS DISTINCT FROM '1' THEN
  RAISE EXCEPTION 'The storage schema requires the current runtime writer' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER media_runtime_admission BEFORE INSERT OR UPDATE ON deployment_admission_runtimes
 FOR EACH ROW EXECUTE FUNCTION freeholder_media_runtime_admission();
--> statement-breakpoint
UPDATE contact_merge_operations operation SET undoable=false,
 undo_blockers=undo_blockers||ARRAY['Original upload and multipart ownership was introduced after this historical merge.']::text[]
 WHERE operation.undone_at IS NULL AND operation.undoable
 AND ((NOT EXISTS(SELECT 1 FROM jsonb_array_elements(operation.reference_state) ref WHERE ref->>'table'='media_uploads')
  AND EXISTS(SELECT 1 FROM media_uploads upload WHERE upload.owner_contact_id=operation.surviving_contact_id))
 OR (NOT EXISTS(SELECT 1 FROM jsonb_array_elements(operation.reference_state) ref WHERE ref->>'table'='media_multipart_resources')
  AND EXISTS(SELECT 1 FROM media_multipart_resources resource WHERE resource.contact_id=operation.surviving_contact_id))
 OR (NOT EXISTS(SELECT 1 FROM jsonb_array_elements(operation.reference_state) ref WHERE ref->>'table'='media_objects')
  AND EXISTS(SELECT 1 FROM media_objects object WHERE object.owner_contact_id=operation.surviving_contact_id)));
