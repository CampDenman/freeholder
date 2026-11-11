-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- freeholder:schema-breaking Physical mail claims require the current guarded image. Old callers cannot mutate dispatch outcomes. Roll back only with the matching database, private wrapping keys and acknowledged-erasure inventory.
-- C3.31/C11.08: never invent old account or per-physical-call provenance.
ALTER TABLE mail_deliveries DROP CONSTRAINT mail_deliveries_status_allowed;
--> statement-breakpoint
ALTER TABLE mail_deliveries ADD CONSTRAINT mail_deliveries_status_allowed CHECK(status IN ('queued','submitted','unknown','delivered','bounced','complained','failed','suppressed','held'));
--> statement-breakpoint
CREATE TABLE mail_dispatch_requests (
 delivery_id uuid PRIMARY KEY REFERENCES mail_deliveries(id) ON DELETE RESTRICT,
 route_digest text NOT NULL CHECK(route_digest ~ '^[a-f0-9]{64}$'),
 payload_digest text NOT NULL CHECK(payload_digest ~ '^[a-f0-9]{64}$'),
 encrypted_route text, admitted_attempt integer NOT NULL DEFAULT 1 CHECK(admitted_attempt BETWEEN 1 AND 20),
 created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE mail_dispatches (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 delivery_id uuid NOT NULL REFERENCES mail_deliveries(id) ON DELETE RESTRICT,
 route_digest text NOT NULL CHECK(route_digest ~ '^[a-f0-9]{64}$'),
 payload_digest text NOT NULL CHECK(payload_digest ~ '^[a-f0-9]{64}$'),
 attempt integer NOT NULL CHECK(attempt BETWEEN 1 AND 20),
 state text NOT NULL CHECK(state IN ('running','unknown','submitted','not_submitted')),
 provider_ref text, resolution_digest text, reply_provider_ref text, reply_evidence_digest text,
 initial_review_digest text, initial_reviewed_at timestamptz,
 resolved_by uuid REFERENCES users(id) ON DELETE SET NULL,
 resolution_source text CHECK(resolution_source IN ('adapter','human_provider_confirmation')),
 finished_at timestamptz, redacted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT mail_dispatches_finished_consistent CHECK(
  (state IN ('running','unknown') AND finished_at IS NULL AND resolution_source IS NULL)
  OR (state IN ('submitted','not_submitted') AND finished_at IS NOT NULL AND resolution_source IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX mail_dispatches_physical_attempt_idx ON mail_dispatches(delivery_id,attempt);
--> statement-breakpoint
CREATE INDEX mail_dispatches_state_idx ON mail_dispatches(state,created_at);
--> statement-breakpoint
CREATE TABLE mail_legacy_resolutions (
 delivery_id uuid PRIMARY KEY REFERENCES mail_deliveries(id) ON DELETE RESTRICT,
 original_digest text NOT NULL CHECK(original_digest ~ '^[a-f0-9]{64}$'),
 outcome text NOT NULL CHECK(outcome IN ('submitted','not_submitted')),
 evidence_digest text NOT NULL CHECK(evidence_digest ~ '^[a-f0-9]{64}$'),
 provider_ref text, redacted_at timestamptz,
 resolved_by uuid REFERENCES users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
-- Admission happens before legacy row locks. Incomplete old rows remain
-- visible for explicit original-server/stopped-caller review; none are backfilled.
CREATE FUNCTION freeholder_mail_dispatch_admission() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_setting('freeholder.mail_dispatch_v1',true) IS DISTINCT FROM '1' THEN
  RAISE EXCEPTION 'Mail physical dispatch requires the current guarded writer' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER mail_deliveries_dispatch_insert_admission BEFORE INSERT OR DELETE ON mail_deliveries FOR EACH STATEMENT EXECUTE FUNCTION freeholder_mail_dispatch_admission();
--> statement-breakpoint
CREATE TRIGGER mail_delivery_dispatch_admission BEFORE UPDATE OF id,purpose,provider,recipient,subject,status,hold_reason,provider_ref,idempotency_key,requested_by,attempts,last_error,submitted_at,delivered_at,provider_status_at,created_at,updated_at,recipient_digest,idempotency_digest,provider_ref_digest,redacted_at ON mail_deliveries FOR EACH STATEMENT EXECUTE FUNCTION freeholder_mail_dispatch_admission();
--> statement-breakpoint
CREATE TRIGGER mail_outbox_dispatch_insert_admission BEFORE INSERT OR DELETE ON mail_outbox FOR EACH STATEMENT EXECUTE FUNCTION freeholder_mail_dispatch_admission();
--> statement-breakpoint
CREATE TRIGGER mail_outbox_dispatch_admission BEFORE UPDATE ON mail_outbox FOR EACH STATEMENT EXECUTE FUNCTION freeholder_mail_dispatch_admission();
--> statement-breakpoint
CREATE TRIGGER mail_provider_events_dispatch_admission BEFORE INSERT OR UPDATE OR DELETE ON mail_provider_events FOR EACH STATEMENT EXECUTE FUNCTION freeholder_mail_dispatch_admission();
--> statement-breakpoint
CREATE TRIGGER mail_suppressions_dispatch_admission BEFORE INSERT OR DELETE ON mail_suppressions FOR EACH STATEMENT EXECUTE FUNCTION freeholder_mail_dispatch_admission();
--> statement-breakpoint
CREATE TRIGGER mail_suppressions_dispatch_update_admission BEFORE UPDATE OF id,email,reason,provider,source_event_id,detail,active,released_at,created_at,updated_at,email_digest,redacted_at ON mail_suppressions FOR EACH STATEMENT EXECUTE FUNCTION freeholder_mail_dispatch_admission();
--> statement-breakpoint
CREATE TRIGGER mail_subjects_dispatch_admission BEFORE INSERT OR DELETE ON mail_record_subjects FOR EACH STATEMENT EXECUTE FUNCTION freeholder_mail_dispatch_admission();
--> statement-breakpoint
CREATE TRIGGER mail_subjects_dispatch_update_admission BEFORE UPDATE OF id,kind,record_id,basis,evidence_digest,created_at ON mail_record_subjects FOR EACH STATEMENT EXECUTE FUNCTION freeholder_mail_dispatch_admission();
--> statement-breakpoint
CREATE FUNCTION freeholder_mail_dispatch_metadata() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_setting('freeholder.mail_dispatch_v1',true)='1' THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='mail_deliveries' THEN
  IF NEW.sender_id IS NULL AND (to_jsonb(NEW)-'sender_id')=(to_jsonb(OLD)-'sender_id') THEN RETURN NEW; END IF;
 ELSIF TG_TABLE_NAME='mail_suppressions' THEN
  IF NEW.released_by IS NULL AND (to_jsonb(NEW)-'released_by')=(to_jsonb(OLD)-'released_by') THEN RETURN NEW; END IF;
 ELSIF TG_TABLE_NAME='mail_record_subjects' THEN
  IF NEW.verified_by IS NULL AND (to_jsonb(NEW)-'verified_by')=(to_jsonb(OLD)-'verified_by') THEN RETURN NEW; END IF;
 END IF;
 RAISE EXCEPTION 'Mail physical dispatch requires the current guarded writer' USING ERRCODE='23514';
END $$;
--> statement-breakpoint
CREATE TRIGGER mail_delivery_dispatch_metadata BEFORE UPDATE ON mail_deliveries FOR EACH ROW EXECUTE FUNCTION freeholder_mail_dispatch_metadata();
--> statement-breakpoint
CREATE TRIGGER mail_suppression_dispatch_metadata BEFORE UPDATE ON mail_suppressions FOR EACH ROW EXECUTE FUNCTION freeholder_mail_dispatch_metadata();
--> statement-breakpoint
CREATE TRIGGER mail_subject_dispatch_metadata BEFORE UPDATE ON mail_record_subjects FOR EACH ROW EXECUTE FUNCTION freeholder_mail_dispatch_metadata();
--> statement-breakpoint
CREATE FUNCTION freeholder_mail_dispatch_writer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_setting('freeholder.mail_dispatch_v1',true) IS DISTINCT FROM '1' THEN
  IF TG_OP='UPDATE' AND TG_TABLE_NAME IN ('mail_dispatches','mail_legacy_resolutions') THEN
   IF NEW.resolved_by IS NULL AND (to_jsonb(NEW)-'resolved_by')=(to_jsonb(OLD)-'resolved_by') THEN RETURN NEW; END IF;
  END IF;
  RAISE EXCEPTION 'Mail physical evidence requires the current guarded writer' USING ERRCODE='23514';
 END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Original mail physical evidence cannot be deleted' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND TG_TABLE_NAME='mail_dispatch_requests' THEN
  IF ROW(NEW.delivery_id,NEW.route_digest,NEW.payload_digest,NEW.created_at) IS DISTINCT FROM ROW(OLD.delivery_id,OLD.route_digest,OLD.payload_digest,OLD.created_at)
   OR (NEW.encrypted_route IS DISTINCT FROM OLD.encrypted_route AND NEW.encrypted_route IS NOT NULL)
   OR NEW.admitted_attempt NOT IN (OLD.admitted_attempt,OLD.admitted_attempt+1) THEN
   RAISE EXCEPTION 'The original mail route and request are immutable' USING ERRCODE='23514';
  END IF;
 END IF;
 IF TG_OP='UPDATE' AND TG_TABLE_NAME='mail_dispatches' THEN
  IF ROW(NEW.id,NEW.delivery_id,NEW.route_digest,NEW.payload_digest,NEW.attempt,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.delivery_id,OLD.route_digest,OLD.payload_digest,OLD.attempt,OLD.created_at) THEN
   RAISE EXCEPTION 'The original physical mail attempt is immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.initial_review_digest IS NOT NULL AND ROW(NEW.initial_review_digest,NEW.initial_reviewed_at) IS DISTINCT FROM ROW(OLD.initial_review_digest,OLD.initial_reviewed_at) THEN
   RAISE EXCEPTION 'The original human review receipt is immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.redacted_at IS NOT NULL THEN NEW.provider_ref:=NULL; NEW.reply_provider_ref:=NULL; NEW.redacted_at:=OLD.redacted_at; END IF;
 END IF;
 IF TG_OP='UPDATE' AND TG_TABLE_NAME='mail_legacy_resolutions' THEN
  IF (to_jsonb(NEW)-'resolved_by'-'provider_ref'-'redacted_at') IS DISTINCT FROM (to_jsonb(OLD)-'resolved_by'-'provider_ref'-'redacted_at')
   OR (NEW.provider_ref IS DISTINCT FROM OLD.provider_ref AND NEW.provider_ref IS NOT NULL)
   OR (OLD.redacted_at IS NOT NULL AND NEW.redacted_at IS DISTINCT FROM OLD.redacted_at) THEN
   RAISE EXCEPTION 'Original legacy mail evidence is immutable' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER mail_dispatch_requests_writer BEFORE INSERT OR UPDATE OR DELETE ON mail_dispatch_requests FOR EACH ROW EXECUTE FUNCTION freeholder_mail_dispatch_writer();
--> statement-breakpoint
CREATE TRIGGER mail_dispatches_writer BEFORE INSERT OR UPDATE OR DELETE ON mail_dispatches FOR EACH ROW EXECUTE FUNCTION freeholder_mail_dispatch_writer();
--> statement-breakpoint
CREATE TRIGGER mail_legacy_resolutions_writer BEFORE INSERT OR UPDATE OR DELETE ON mail_legacy_resolutions FOR EACH ROW EXECUTE FUNCTION freeholder_mail_dispatch_writer();
