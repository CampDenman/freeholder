-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- freeholder:schema-breaking Use only guarded images on this upgraded schema. Stale ownership writers are refused; privacy admission or first minimization fences legacy content writers. Full rollback requires the matching pre-upgrade database and private wrapping keys; acknowledged erasures must be respected before replay.
-- C3.31: minimize personal fields while retaining private replay and withdrawal receipts.
CREATE TABLE mail_receipt_keys (
 id integer PRIMARY KEY DEFAULT 1, encrypted_key text NOT NULL,
 wrapping_fingerprint text NOT NULL, sealed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT mail_receipt_keys_singleton CHECK(id=1)
);
--> statement-breakpoint
ALTER TABLE mail_deliveries ADD COLUMN recipient_digest text, ADD COLUMN idempotency_digest text,
 ADD COLUMN provider_ref_digest text, ADD COLUMN redacted_at timestamptz;
--> statement-breakpoint
ALTER TABLE mail_provider_events ADD COLUMN recipient_digest text, ADD COLUMN external_event_digest text,
 ADD COLUMN provider_ref_digest text, ADD COLUMN redacted_at timestamptz;
--> statement-breakpoint
ALTER TABLE mail_suppressions ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid(),
 ADD COLUMN email_digest text, ADD COLUMN redacted_at timestamptz;
--> statement-breakpoint
CREATE UNIQUE INDEX mail_deliveries_receipt_digest_idx ON mail_deliveries(idempotency_digest) WHERE idempotency_digest IS NOT NULL;
--> statement-breakpoint
CREATE INDEX mail_deliveries_provider_digest_idx ON mail_deliveries(provider,provider_ref_digest);
--> statement-breakpoint
CREATE UNIQUE INDEX mail_provider_events_receipt_digest_idx ON mail_provider_events(provider,external_event_digest) WHERE external_event_digest IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX mail_suppressions_id_idx ON mail_suppressions(id);
--> statement-breakpoint
CREATE UNIQUE INDEX mail_suppressions_receipt_digest_idx ON mail_suppressions(email_digest) WHERE email_digest IS NOT NULL;
--> statement-breakpoint
CREATE TABLE mail_record_subjects (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kind text NOT NULL,
 record_id uuid NOT NULL, contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
 basis text NOT NULL DEFAULT 'automatic', evidence_digest text, verified_by uuid REFERENCES users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(), CONSTRAINT mail_record_subjects_kind CHECK(kind IN ('delivery','event','suppression'))
);
--> statement-breakpoint
CREATE INDEX mail_record_subjects_owned_idx ON mail_record_subjects(kind,record_id,contact_id);
--> statement-breakpoint
CREATE INDEX mail_record_subjects_contact_idx ON mail_record_subjects(contact_id,kind,record_id);
--> statement-breakpoint

-- Legacy content writers must refuse once privacy begins or personal fields
-- are minimized, before sending or reconstructing an address-keyed receipt.
-- The shared/exclusive seal lock also covers a key row not yet initialized.
-- Statement admission precedes row locks, so a legacy writer cannot hold a
-- target row while waiting behind the erasure/retention seal lock.
CREATE FUNCTION freeholder_mail_receipt_admission() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_setting('freeholder.mail_receipts_v1',true) IS DISTINCT FROM '1' THEN
  PERFORM pg_advisory_xact_lock_shared(hashtext('freeholder-mail-receipt-seal-v1'));
  IF EXISTS(SELECT 1 FROM mail_receipt_keys WHERE id=1 AND sealed_at IS NOT NULL) THEN
   RAISE EXCEPTION 'Mail privacy requires the current guarded mail writer' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER mail_deliveries_receipt_admission BEFORE INSERT OR DELETE ON mail_deliveries FOR EACH STATEMENT EXECUTE FUNCTION freeholder_mail_receipt_admission();
--> statement-breakpoint
CREATE TRIGGER mail_deliveries_receipt_update_admission BEFORE UPDATE OF id,purpose,provider,recipient,subject,status,hold_reason,provider_ref,idempotency_key,requested_by,attempts,last_error,submitted_at,delivered_at,provider_status_at,created_at,updated_at,recipient_digest,idempotency_digest,provider_ref_digest,redacted_at ON mail_deliveries FOR EACH STATEMENT EXECUTE FUNCTION freeholder_mail_receipt_admission();
--> statement-breakpoint
CREATE TRIGGER mail_provider_events_receipt_admission BEFORE INSERT OR DELETE ON mail_provider_events FOR EACH STATEMENT EXECUTE FUNCTION freeholder_mail_receipt_admission();
--> statement-breakpoint
CREATE TRIGGER mail_provider_events_receipt_update_admission BEFORE UPDATE OF id,provider,external_event_id,provider_ref,recipient,event_type,detail,raw_digest,delivery_id,occurred_at,created_at,recipient_digest,external_event_digest,provider_ref_digest,redacted_at ON mail_provider_events FOR EACH STATEMENT EXECUTE FUNCTION freeholder_mail_receipt_admission();
--> statement-breakpoint
CREATE TRIGGER mail_suppressions_receipt_admission BEFORE INSERT OR DELETE ON mail_suppressions FOR EACH STATEMENT EXECUTE FUNCTION freeholder_mail_receipt_admission();
--> statement-breakpoint
CREATE TRIGGER mail_suppressions_receipt_update_admission BEFORE UPDATE OF id,email,reason,provider,source_event_id,detail,active,released_at,created_at,updated_at,email_digest,redacted_at ON mail_suppressions FOR EACH STATEMENT EXECUTE FUNCTION freeholder_mail_receipt_admission();
--> statement-breakpoint
CREATE TRIGGER mail_outbox_receipt_admission BEFORE INSERT OR DELETE ON mail_outbox FOR EACH STATEMENT EXECUTE FUNCTION freeholder_mail_receipt_admission();
--> statement-breakpoint
CREATE TRIGGER mail_outbox_receipt_update_admission BEFORE UPDATE OF delivery_id,encrypted_message,created_at,updated_at ON mail_outbox FOR EACH STATEMENT EXECUTE FUNCTION freeholder_mail_receipt_admission();
--> statement-breakpoint
CREATE FUNCTION freeholder_mail_receipt_writer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='mail_record_subjects' AND current_setting('freeholder.mail_receipts_v1',true) IS DISTINCT FROM '1' THEN
  -- Reviewer login deletion may null its reference, without changing either
  -- the original subject attribution or its immutable private evidence.
  IF TG_OP='UPDATE' THEN
   IF NEW.verified_by IS NULL AND ROW(NEW.id,NEW.kind,NEW.record_id,NEW.contact_id,NEW.basis,NEW.evidence_digest,NEW.created_at)
    IS NOT DISTINCT FROM ROW(OLD.id,OLD.kind,OLD.record_id,OLD.contact_id,OLD.basis,OLD.evidence_digest,OLD.created_at) THEN RETURN NEW; END IF;
  END IF;
  RAISE EXCEPTION 'Mail ownership changes require the current guarded writer' USING ERRCODE='23514';
 END IF;
 -- Declared nullable FK metadata may be anonymized without altering the
 -- receipt, its ownership or provider outcome. Statement guards exclude only
 -- these columns; a content/outcome UPDATE is still refused before row locks.
 IF TG_OP='UPDATE' AND current_setting('freeholder.mail_receipts_v1',true) IS DISTINCT FROM '1' THEN
  IF TG_TABLE_NAME='mail_suppressions' THEN
   IF NEW.released_by IS NULL AND (to_jsonb(NEW)-'released_by') IS NOT DISTINCT FROM (to_jsonb(OLD)-'released_by') THEN RETURN NEW; END IF;
  ELSIF TG_TABLE_NAME='mail_deliveries' THEN
   IF NEW.sender_id IS NULL AND (to_jsonb(NEW)-'sender_id') IS NOT DISTINCT FROM (to_jsonb(OLD)-'sender_id') THEN RETURN NEW; END IF;
  END IF;
 END IF;
 IF current_setting('freeholder.mail_receipts_v1',true) IS DISTINCT FROM '1' THEN
  PERFORM pg_advisory_xact_lock_shared(hashtext('freeholder-mail-receipt-seal-v1'));
  IF EXISTS(SELECT 1 FROM mail_receipt_keys WHERE id=1 AND sealed_at IS NOT NULL) THEN
   RAISE EXCEPTION 'Mail receipt redaction requires the current guarded mail writer' USING ERRCODE='23514';
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF TG_TABLE_NAME='mail_outbox' THEN
  PERFORM 1 FROM mail_deliveries WHERE id=NEW.delivery_id FOR SHARE;
  IF EXISTS(SELECT 1 FROM mail_deliveries WHERE id=NEW.delivery_id AND redacted_at IS NOT NULL) THEN
   RAISE EXCEPTION 'A minimized delivery cannot acquire a new private payload' USING ERRCODE='23514';
  END IF;
 ELSIF TG_TABLE_NAME='mail_deliveries' THEN
  IF TG_OP='UPDATE' AND OLD.redacted_at IS NOT NULL THEN
   NEW.redacted_at:=OLD.redacted_at; NEW.recipient_digest:=OLD.recipient_digest;
  END IF;
  IF TG_OP='INSERT' AND current_setting('freeholder.mail_receipts_v1',true)='1' AND NEW.recipient_digest IS NULL THEN
   RAISE EXCEPTION 'New mail delivery needs a keyed receipt' USING ERRCODE='23514';
  END IF;
  IF NEW.redacted_at IS NOT NULL THEN
   IF NEW.recipient_digest IS NULL OR NEW.status IN ('queued','submitted','held') OR EXISTS(SELECT 1 FROM mail_outbox WHERE delivery_id=NEW.id) THEN
    RAISE EXCEPTION 'Unresolved mail cannot be redacted' USING ERRCODE='23514';
   END IF;
   NEW.recipient:='redacted-'||NEW.id||'@retained.invalid'; NEW.subject:=''; NEW.last_error:=NULL;
   NEW.idempotency_key:=NULL; NEW.provider_ref:=NULL;
  END IF;
 ELSIF TG_TABLE_NAME='mail_provider_events' THEN
  IF TG_OP='UPDATE' AND OLD.redacted_at IS NOT NULL THEN
   NEW.redacted_at:=OLD.redacted_at; NEW.recipient_digest:=OLD.recipient_digest; NEW.external_event_digest:=OLD.external_event_digest;
  END IF;
  IF TG_OP='INSERT' AND current_setting('freeholder.mail_receipts_v1',true)='1' AND (NEW.recipient_digest IS NULL OR NEW.external_event_digest IS NULL) THEN
   RAISE EXCEPTION 'New mail event needs keyed receipts' USING ERRCODE='23514';
  END IF;
  IF TG_OP='INSERT' AND EXISTS(
   SELECT 1 FROM mail_deliveries WHERE recipient_digest=NEW.recipient_digest AND redacted_at IS NOT NULL
   UNION ALL SELECT 1 FROM mail_provider_events WHERE recipient_digest=NEW.recipient_digest AND redacted_at IS NOT NULL
   UNION ALL SELECT 1 FROM mail_suppressions WHERE email_digest=NEW.recipient_digest AND redacted_at IS NOT NULL
  ) THEN NEW.redacted_at:=COALESCE(NEW.redacted_at,clock_timestamp()); END IF;
  IF NEW.delivery_id IS NOT NULL THEN
   PERFORM 1 FROM mail_deliveries WHERE id=NEW.delivery_id FOR SHARE;
   IF EXISTS(SELECT 1 FROM mail_deliveries WHERE id=NEW.delivery_id AND redacted_at IS NOT NULL) THEN
    NEW.redacted_at:=COALESCE(NEW.redacted_at,clock_timestamp());
   END IF;
  END IF;
  IF NEW.redacted_at IS NOT NULL THEN
   IF NEW.recipient_digest IS NULL OR NEW.external_event_digest IS NULL THEN
    RAISE EXCEPTION 'Redacted mail event needs keyed receipts' USING ERRCODE='23514';
   END IF;
   NEW.recipient:='redacted-'||NEW.id||'@retained.invalid'; NEW.detail:=NULL;
   NEW.external_event_id:='retained:'||NEW.id; NEW.provider_ref:=NULL;
  END IF;
 ELSIF TG_TABLE_NAME='mail_suppressions' THEN
  IF TG_OP='INSERT' AND current_setting('freeholder.mail_receipts_v1',true)='1' AND NEW.email_digest IS NULL THEN
   RAISE EXCEPTION 'New suppression needs a keyed address receipt' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' AND OLD.redacted_at IS NOT NULL AND NOT OLD.active AND NEW.active THEN
   IF NEW.email_digest IS DISTINCT FROM OLD.email_digest OR NEW.source_event_id IS NULL OR NOT EXISTS(
     SELECT 1 FROM mail_provider_events WHERE id=NEW.source_event_id
      AND recipient_digest=OLD.email_digest AND occurred_at>=OLD.released_at
      AND event_type IN ('hard_bounce','complaint','suppressed')
   ) THEN RAISE EXCEPTION 'A retained suppression requires a new authenticated provider fact' USING ERRCODE='23514'; END IF;
  END IF;
  IF TG_OP='UPDATE' AND OLD.redacted_at IS NOT NULL THEN
   NEW.redacted_at:=OLD.redacted_at; NEW.email_digest:=OLD.email_digest;
  END IF;
  IF NEW.redacted_at IS NOT NULL THEN
   IF NEW.email_digest IS NULL THEN
    RAISE EXCEPTION 'A minimized suppression needs its keyed address receipt' USING ERRCODE='23514';
   END IF;
   NEW.email:='redacted-'||NEW.id||'@retained.invalid'; NEW.detail:=NULL;
  END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER mail_outbox_receipt_writer BEFORE INSERT OR UPDATE OR DELETE ON mail_outbox FOR EACH ROW EXECUTE FUNCTION freeholder_mail_receipt_writer();
--> statement-breakpoint
CREATE TRIGGER mail_record_subjects_receipt_writer BEFORE INSERT OR UPDATE OR DELETE ON mail_record_subjects FOR EACH ROW EXECUTE FUNCTION freeholder_mail_receipt_writer();
--> statement-breakpoint
CREATE TRIGGER mail_deliveries_receipt_writer BEFORE INSERT OR UPDATE OR DELETE ON mail_deliveries FOR EACH ROW EXECUTE FUNCTION freeholder_mail_receipt_writer();
--> statement-breakpoint
CREATE TRIGGER mail_provider_events_receipt_writer BEFORE INSERT OR UPDATE OR DELETE ON mail_provider_events FOR EACH ROW EXECUTE FUNCTION freeholder_mail_receipt_writer();
--> statement-breakpoint
CREATE TRIGGER mail_suppressions_receipt_writer BEFORE INSERT OR UPDATE OR DELETE ON mail_suppressions FOR EACH ROW EXECUTE FUNCTION freeholder_mail_receipt_writer();
--> statement-breakpoint

-- A new named hold and a mail purge linearize at the same boundary.
CREATE FUNCTION freeholder_mail_hold_writer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (TG_OP<>'DELETE' AND NEW.scope='mail.records') OR (TG_OP<>'INSERT' AND OLD.scope='mail.records') THEN
  PERFORM pg_advisory_xact_lock_shared(hashtext('freeholder-mail-retention-holds-v1'));
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER mail_retention_hold_writer BEFORE INSERT OR UPDATE OR DELETE ON privacy_retention_exceptions FOR EACH ROW EXECUTE FUNCTION freeholder_mail_hold_writer();
