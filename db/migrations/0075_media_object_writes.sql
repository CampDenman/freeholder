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
