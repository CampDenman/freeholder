-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- freeholder:schema-breaking Physical mail claims require the current guarded image. Old callers cannot mutate dispatch outcomes. Roll back only with the matching database, private wrapping keys and acknowledged-erasure inventory.
-- C3.31/C11.08: never invent old account or per-physical-call provenance.
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
 provider_ref text, resolution_digest text,
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
CREATE TRIGGER mail_delivery_dispatch_admission BEFORE UPDATE OF attempts,status,provider_ref,submitted_at ON mail_deliveries FOR EACH STATEMENT EXECUTE FUNCTION freeholder_mail_dispatch_admission();
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
 END IF;
 IF TG_OP='UPDATE' AND TG_TABLE_NAME='mail_legacy_resolutions' AND (to_jsonb(NEW)-'resolved_by') IS DISTINCT FROM (to_jsonb(OLD)-'resolved_by') THEN
  RAISE EXCEPTION 'Original legacy mail evidence is immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER mail_dispatch_requests_writer BEFORE INSERT OR UPDATE OR DELETE ON mail_dispatch_requests FOR EACH ROW EXECUTE FUNCTION freeholder_mail_dispatch_writer();
--> statement-breakpoint
CREATE TRIGGER mail_dispatches_writer BEFORE INSERT OR UPDATE OR DELETE ON mail_dispatches FOR EACH ROW EXECUTE FUNCTION freeholder_mail_dispatch_writer();
--> statement-breakpoint
CREATE TRIGGER mail_legacy_resolutions_writer BEFORE INSERT OR UPDATE OR DELETE ON mail_legacy_resolutions FOR EACH ROW EXECUTE FUNCTION freeholder_mail_dispatch_writer();
