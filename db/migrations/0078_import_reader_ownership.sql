-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- freeholder:schema-breaking Source reader ownership requires guarded writers. Previous images cannot preserve these receipts; recovery restores the pre-upgrade database and original private objects together.
CREATE TABLE import_reader_ownership_keys (
 id integer PRIMARY KEY DEFAULT 1 CHECK (id=1),
 encrypted_key text NOT NULL,
 wrapping_fingerprint text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE import_reader_ownership_receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 key_id integer NOT NULL DEFAULT 1 REFERENCES import_reader_ownership_keys(id),
 source_digest text NOT NULL CHECK (source_digest ~ '^[a-f0-9]{64}$'),
 address_digest text CHECK (address_digest IS NULL OR address_digest ~ '^[a-f0-9]{64}$'),
 first_run_id uuid NOT NULL,
 created_by text NOT NULL,
 created_by_key_id uuid,
 contact_id uuid REFERENCES contacts(id),
 state text NOT NULL CHECK (state IN ('unbound','bound','erased') AND ((state='unbound')=(contact_id IS NULL))),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX import_reader_source_unique ON import_reader_ownership_receipts(source_digest);
--> statement-breakpoint
CREATE INDEX import_reader_contact_idx ON import_reader_ownership_receipts(contact_id);
--> statement-breakpoint
CREATE INDEX import_reader_address_idx ON import_reader_ownership_receipts(address_digest);
--> statement-breakpoint
CREATE TABLE import_reader_merge_witnesses (
 id uuid PRIMARY KEY,
 duplicate_subject_id uuid NOT NULL,
 surviving_subject_id uuid NOT NULL,
 phase text NOT NULL CHECK (phase IN ('captured','applied')),
 created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE import_reader_merge_items (
 witness_id uuid NOT NULL REFERENCES import_reader_merge_witnesses(id) ON DELETE CASCADE,
 receipt_id uuid NOT NULL REFERENCES import_reader_ownership_receipts(id),
 before_contact_id uuid,
 before_state text NOT NULL,
 after_contact_id uuid,
 after_state text,
 PRIMARY KEY(witness_id,receipt_id)
);
--> statement-breakpoint
CREATE FUNCTION freeholder_guard_reader_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_setting('freeholder.import_reader_owner_v1',true) IS DISTINCT FROM '1' THEN
  RAISE EXCEPTION 'This source requires the guarded reader ownership writer' USING ERRCODE='55000';
 END IF;
 IF TG_OP='DELETE' THEN
  RAISE EXCEPTION 'Reader ownership receipts retire through erasure, never deletion' USING ERRCODE='55000';
 END IF;
 IF TG_OP='UPDATE' AND (ROW(NEW.source_digest,NEW.address_digest,NEW.key_id,NEW.created_at,NEW.first_run_id,NEW.created_by,NEW.created_by_key_id) IS DISTINCT FROM ROW(OLD.source_digest,OLD.address_digest,OLD.key_id,OLD.created_at,OLD.first_run_id,OLD.created_by,OLD.created_by_key_id)
    OR (OLD.state='erased' AND NEW.state<>'erased')) THEN
  RAISE EXCEPTION 'Original reader identity and erased receipts are immutable' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER import_reader_receipt_guard BEFORE INSERT OR UPDATE OR DELETE ON import_reader_ownership_receipts FOR EACH ROW EXECUTE FUNCTION freeholder_guard_reader_receipt();
--> statement-breakpoint
CREATE FUNCTION freeholder_import_contains_readers(preview jsonb, checkpoint jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT EXISTS (
  SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(preview->'pages')='array' THEN preview->'pages' ELSE '[]'::jsonb END) page
   WHERE jsonb_typeof(page->'readerComments')='array' AND page->'readerComments'<>'[]'::jsonb
  UNION ALL
  SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(checkpoint->'pendingBlogPosts')='array' THEN checkpoint->'pendingBlogPosts' ELSE '[]'::jsonb END) post
   WHERE jsonb_typeof(post->'comments')='array' AND post->'comments'<>'[]'::jsonb
 )
$$;
--> statement-breakpoint
CREATE FUNCTION freeholder_guard_import_reader_writer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_setting('freeholder.import_reader_owner_v1',true) IS DISTINCT FROM '1'
    AND (freeholder_import_contains_readers(OLD.preview,OLD.checkpoint)
      OR (TG_OP='UPDATE' AND freeholder_import_contains_readers(NEW.preview,NEW.checkpoint))) THEN
  RAISE EXCEPTION 'This source requires the guarded reader ownership writer' USING ERRCODE='55000';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER import_reader_writer_guard BEFORE UPDATE OR DELETE ON import_runs FOR EACH ROW EXECUTE FUNCTION freeholder_guard_import_reader_writer();
--> statement-breakpoint
CREATE FUNCTION freeholder_guard_imported_comment_writer() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original_source text;
BEGIN
 original_source:=CASE WHEN TG_OP='INSERT' THEN NEW.source ELSE OLD.source END;
 IF original_source LIKE 'import:%' AND current_setting('freeholder.import_reader_owner_v1',true) IS DISTINCT FROM '1' THEN
  RAISE EXCEPTION 'Imported comments require the guarded reader ownership writer' USING ERRCODE='55000';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER imported_comment_writer_guard BEFORE INSERT OR UPDATE OR DELETE ON blog_reader_comments FOR EACH ROW EXECUTE FUNCTION freeholder_guard_imported_comment_writer();
