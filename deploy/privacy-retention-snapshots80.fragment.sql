-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
-- C1.08/C3.47: unpublished80 fragment; no historical capture is backfilled.
CREATE TABLE privacy_retention_source_snapshots (
 exception_id uuid NOT NULL REFERENCES privacy_retention_exceptions(id) ON DELETE CASCADE,
 source_scope text NOT NULL,
 capture_version integer NOT NULL DEFAULT 1,
 member_count integer NOT NULL,
 captured_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT privacy_retention_source_snapshots_pk PRIMARY KEY(exception_id,source_scope),
 CONSTRAINT privacy_retention_source_snapshots_scope CHECK(length(source_scope) BETWEEN 1 AND 200),
 CONSTRAINT privacy_retention_source_snapshots_version CHECK(capture_version=1),
 CONSTRAINT privacy_retention_source_snapshots_count CHECK(member_count BETWEEN 0 AND 10000)
);
--> statement-breakpoint
CREATE TABLE privacy_retention_source_members (
 exception_id uuid NOT NULL,
 source_scope text NOT NULL,
 source_id uuid NOT NULL,
 generation uuid NOT NULL,
 CONSTRAINT privacy_retention_source_members_pk PRIMARY KEY(exception_id,source_scope,source_id,generation),
 CONSTRAINT privacy_retention_source_members_snapshot_fk FOREIGN KEY(exception_id,source_scope)
  REFERENCES privacy_retention_source_snapshots(exception_id,source_scope) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX privacy_retention_source_members_lookup_idx ON privacy_retention_source_members(source_scope,source_id,generation,exception_id);
--> statement-breakpoint
CREATE INDEX privacy_retention_exceptions_name_expiry_idx ON privacy_retention_exceptions(scope,expires_at);
--> statement-breakpoint
CREATE FUNCTION freeholder_guard_retention_source_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF EXISTS(SELECT 1 FROM privacy_retention_exceptions WHERE id=OLD.exception_id) THEN
   RAISE EXCEPTION 'Original retention capture receipts survive until their actual hold is removed' USING ERRCODE='55000';
  END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' OR current_setting('freeholder.retention_snapshot_v1',true) IS DISTINCT FROM '1'
  OR NOT EXISTS(SELECT 1 FROM privacy_retention_exceptions h JOIN data_requests r ON r.id=h.data_request_id WHERE h.id=NEW.exception_id AND r.kind='erasure') THEN
  RAISE EXCEPTION 'Original retention capture requires its real original hold transaction' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER privacy_retention_source_snapshot_identity BEFORE INSERT OR UPDATE OR DELETE ON privacy_retention_source_snapshots
 FOR EACH ROW EXECUTE FUNCTION freeholder_guard_retention_source_snapshot();
--> statement-breakpoint
CREATE TRIGGER privacy_retention_source_member_identity BEFORE INSERT OR UPDATE OR DELETE ON privacy_retention_source_members
 FOR EACH ROW EXECUTE FUNCTION freeholder_guard_retention_source_snapshot();
--> statement-breakpoint
CREATE FUNCTION freeholder_require_retention_member_count() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original_exception uuid; original_scope text; expected_count integer;
BEGIN
 IF TG_OP='DELETE' THEN original_exception:=OLD.exception_id;original_scope:=OLD.source_scope;
 ELSE original_exception:=NEW.exception_id;original_scope:=NEW.source_scope; END IF;
 SELECT member_count INTO expected_count FROM privacy_retention_source_snapshots WHERE exception_id=original_exception AND source_scope=original_scope;
 IF FOUND AND expected_count<>(SELECT count(*) FROM privacy_retention_source_members WHERE exception_id=original_exception AND source_scope=original_scope) THEN
  RAISE EXCEPTION 'The original retention membership is incomplete; do not infer an empty capture' USING ERRCODE='55000';
 END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER privacy_retention_source_snapshot_complete AFTER INSERT ON privacy_retention_source_snapshots
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION freeholder_require_retention_member_count();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER privacy_retention_source_members_complete AFTER INSERT OR DELETE ON privacy_retention_source_members
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION freeholder_require_retention_member_count();
--> statement-breakpoint
CREATE FUNCTION freeholder_require_legacy_retention_capture() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM privacy_retention_exceptions h WHERE h.id=NEW.id AND h.scope IN('cms.readerComments','imports.readerSources')
    AND (h.expires_at IS NULL OR h.expires_at>clock_timestamp()))
  AND NOT EXISTS(SELECT 1 FROM privacy_retention_source_snapshots s WHERE s.exception_id=NEW.id AND s.source_scope='imports.readerSources' AND s.capture_version=1) THEN
  RAISE EXCEPTION 'This reader hold needs its original source snapshot or explicit legacy review' USING ERRCODE='55000';
 END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER privacy_retention_legacy_capture_complete AFTER INSERT OR UPDATE ON privacy_retention_exceptions
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION freeholder_require_legacy_retention_capture();
--> statement-breakpoint
CREATE FUNCTION freeholder_guard_legacy_source_retention_delete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original_run uuid; original_upload uuid;
BEGIN
 IF NEW.operation_kind<>'delete' OR NEW.object_key !~ '^imports/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9]{5}\.part$' THEN RETURN NEW; END IF;
 original_run:=split_part(NEW.object_key,'/',2)::uuid;
 original_upload:=split_part(NEW.object_key,'/',3)::uuid;
 IF EXISTS(SELECT 1 FROM privacy_retention_exceptions h
    LEFT JOIN privacy_retention_source_snapshots s ON s.exception_id=h.id AND s.source_scope='imports.readerSources'
    WHERE h.scope IN('cms.readerComments','imports.readerSources') AND (h.expires_at IS NULL OR h.expires_at>clock_timestamp())
     AND (s.exception_id IS NULL OR s.capture_version<>1 OR s.member_count<>(SELECT count(*) FROM privacy_retention_source_members m WHERE m.exception_id=s.exception_id AND m.source_scope=s.source_scope)))
  OR EXISTS(SELECT 1 FROM privacy_retention_source_members m JOIN privacy_retention_exceptions h ON h.id=m.exception_id
    WHERE m.source_scope='imports.readerSources' AND m.source_id=original_run AND m.generation=original_upload AND h.scope IN('cms.readerComments','imports.readerSources')
     AND (h.expires_at IS NULL OR h.expires_at>clock_timestamp())) THEN
  RAISE EXCEPTION 'This original source is held or requires original retention review' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER media_writes_legacy_source_retention BEFORE INSERT ON media_object_writes
 FOR EACH ROW EXECUTE FUNCTION freeholder_guard_legacy_source_retention_delete();
