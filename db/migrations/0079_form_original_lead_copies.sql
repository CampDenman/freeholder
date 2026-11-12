-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- freeholder:schema-breaking Original lead intents require the guarded image. Restore matching database and private keys for rollback; legacy destinations are not backfilled.
-- C3.34/C11.08: old lead workers must fail their first read before provider I/O.
ALTER TABLE form_submissions RENAME COLUMN data TO submitted_data;
--> statement-breakpoint
CREATE TABLE form_lead_copies (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 submission_id uuid REFERENCES form_submissions(id) ON DELETE SET NULL,
 kind text NOT NULL CHECK(kind IN ('site_notice','legacy_review')),
 provider text NOT NULL DEFAULT 'paradise' CHECK(provider='paradise'),
 original_base_url text, resource_digest text, request_digest text, notice_digest text,
 encrypted_request text,
 state text NOT NULL CHECK(state IN ('ready','running','unknown','copied','not_copied','cancelled')),
 attempts jsonb NOT NULL DEFAULT '[]'::jsonb,
 admitted_attempt integer NOT NULL DEFAULT 1 CHECK(admitted_attempt BETWEEN 1 AND 20),
 revision integer NOT NULL DEFAULT 0, retired_at timestamptz, remote_erased_at timestamptz, remote_erasure_digest text, privacy_pending boolean NOT NULL DEFAULT false, last_reconciled_at timestamptz, legacy_outcome text CHECK(legacy_outcome IN ('copied','not_copied')), legacy_reviews jsonb NOT NULL DEFAULT '[]'::jsonb, erasure_requests jsonb NOT NULL DEFAULT '[]'::jsonb, erasure_request_id uuid REFERENCES data_requests(id) ON DELETE RESTRICT,
 review_digest text, provider_ref text, provider_ref_digest text, last_error text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(kind='legacy_review' OR (original_base_url IS NOT NULL AND resource_digest IS NOT NULL AND request_digest IS NOT NULL AND notice_digest IS NOT NULL AND resource_digest ~ '^[a-f0-9]{64}$' AND request_digest ~ '^[a-f0-9]{64}$' AND notice_digest ~ '^[a-f0-9]{64}$'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX form_lead_copies_submission_idx ON form_lead_copies(submission_id);
--> statement-breakpoint
CREATE INDEX form_lead_copies_state_idx ON form_lead_copies(state,created_at);
--> statement-breakpoint
CREATE INDEX form_lead_copies_privacy_idx ON form_lead_copies(last_reconciled_at ASC NULLS FIRST,id) WHERE privacy_pending;
--> statement-breakpoint
CREATE FUNCTION freeholder_lead_copy_writer() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_attempt jsonb; new_attempt jsonb; position integer; review_position integer;
BEGIN
 IF jsonb_typeof(NEW.attempts) IS DISTINCT FROM 'array' OR jsonb_array_length(NEW.attempts)>20 THEN RAISE EXCEPTION 'Invalid lead operation journal' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Original lead-copy witnesses cannot be deleted' USING ERRCODE='23514'; END IF;
 IF current_setting('freeholder.lead_copy_v1',true) IS DISTINCT FROM '1' THEN
  RAISE EXCEPTION 'Original lead copies require the current guarded writer' USING ERRCODE='23514';
 END IF;
 IF TG_OP='INSERT' AND NEW.attempts<>'[]'::jsonb THEN RAISE EXCEPTION 'New lead witnesses cannot invent HTTP outcomes' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
  IF jsonb_array_length(NEW.attempts)>jsonb_array_length(OLD.attempts) AND (
    jsonb_array_length(NEW.attempts)<>jsonb_array_length(OLD.attempts)+1
    OR NEW.attempts->-1->>'observed' IS DISTINCT FROM 'running'
    OR NEW.attempts->-1->>'attempt' IS DISTINCT FROM OLD.admitted_attempt::text
    OR NEW.attempts->-1 ? 'humanOutcome'
    OR NEW.attempts->-1 ? 'responseDigest') THEN RAISE EXCEPTION 'Lead HTTP outcomes require a durable prior intent' USING ERRCODE='23514'; END IF;
  NEW.revision:=OLD.revision+1;
  IF ROW(NEW.id,NEW.kind,NEW.provider,NEW.original_base_url,NEW.resource_digest,NEW.request_digest,NEW.notice_digest,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.kind,OLD.provider,OLD.original_base_url,OLD.resource_digest,OLD.request_digest,OLD.notice_digest,OLD.created_at)
    OR (NEW.encrypted_request IS DISTINCT FROM OLD.encrypted_request AND NEW.encrypted_request IS NOT NULL)
    OR (NEW.submission_id IS DISTINCT FROM OLD.submission_id AND NEW.submission_id IS NOT NULL)
    OR (OLD.retired_at IS NOT NULL AND NEW.retired_at IS DISTINCT FROM OLD.retired_at)
    OR (NEW.submission_id IS NULL AND NEW.encrypted_request IS NOT NULL) THEN
   RAISE EXCEPTION 'Original lead request and resource are immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.remote_erased_at IS NOT NULL AND NEW.remote_erased_at IS DISTINCT FROM OLD.remote_erased_at THEN RAISE EXCEPTION 'Original erasure proof is immutable' USING ERRCODE='23514'; END IF;
  IF OLD.erasure_request_id IS NOT NULL AND NEW.erasure_request_id IS DISTINCT FROM OLD.erasure_request_id THEN RAISE EXCEPTION 'Original erasure owner cannot change' USING ERRCODE='23514'; END IF;
  IF jsonb_typeof(NEW.legacy_reviews) IS DISTINCT FROM 'array' OR jsonb_typeof(NEW.erasure_requests) IS DISTINCT FROM 'array'
    OR jsonb_array_length(NEW.legacy_reviews)<jsonb_array_length(OLD.legacy_reviews)
    OR jsonb_array_length(NEW.erasure_requests)<jsonb_array_length(OLD.erasure_requests) THEN RAISE EXCEPTION 'Original lead review and erasure cohorts cannot shrink' USING ERRCODE='23514'; END IF;
  FOR position IN 0..jsonb_array_length(OLD.legacy_reviews)-1 LOOP
    IF NEW.legacy_reviews->position IS DISTINCT FROM OLD.legacy_reviews->position THEN RAISE EXCEPTION 'Original lead reviews cannot change' USING ERRCODE='23514'; END IF;
  END LOOP;
  FOR position IN 0..jsonb_array_length(OLD.erasure_requests)-1 LOOP
    IF NEW.erasure_requests->position IS DISTINCT FROM OLD.erasure_requests->position THEN RAISE EXCEPTION 'Original erasure cohorts cannot change' USING ERRCODE='23514'; END IF;
  END LOOP;
  IF NEW.legacy_outcome IS DISTINCT FROM OLD.legacy_outcome AND (NEW.kind<>'legacy_review' OR jsonb_array_length(NEW.legacy_reviews)<>jsonb_array_length(OLD.legacy_reviews)+1 OR NEW.legacy_reviews->-1->>'outcome' IS DISTINCT FROM NEW.legacy_outcome) THEN RAISE EXCEPTION 'Legacy outcome requires an appended human review' USING ERRCODE='23514'; END IF;
  IF jsonb_array_length(NEW.attempts)<jsonb_array_length(OLD.attempts) THEN RAISE EXCEPTION 'Original lead journal cannot shrink' USING ERRCODE='23514'; END IF;
  FOR position IN 0..jsonb_array_length(OLD.attempts)-1 LOOP
   old_attempt:=OLD.attempts->position; new_attempt:=NEW.attempts->position;
   IF ROW(old_attempt->>'id',old_attempt->>'attempt') IS DISTINCT FROM ROW(new_attempt->>'id',new_attempt->>'attempt')
    OR (old_attempt->>'observed' IN ('copied','not_copied') AND (new_attempt - 'humanOutcome' - 'reviewDigest' - 'reviewHistory') IS DISTINCT FROM (old_attempt - 'humanOutcome' - 'reviewDigest' - 'reviewHistory'))
    OR jsonb_array_length(coalesce(new_attempt->'reviewHistory','[]'::jsonb))<jsonb_array_length(coalesce(old_attempt->'reviewHistory','[]'::jsonb))
    OR ((new_attempt->'humanOutcome' IS DISTINCT FROM old_attempt->'humanOutcome' OR new_attempt->'reviewDigest' IS DISTINCT FROM old_attempt->'reviewDigest') AND (
      jsonb_array_length(coalesce(new_attempt->'reviewHistory','[]'::jsonb))<>jsonb_array_length(coalesce(old_attempt->'reviewHistory','[]'::jsonb))+1
      OR new_attempt->'reviewHistory'->-1->>'outcome' IS DISTINCT FROM new_attempt->>'humanOutcome'
      OR new_attempt->'reviewHistory'->-1->>'digest' IS DISTINCT FROM new_attempt->>'reviewDigest')) THEN
    RAISE EXCEPTION 'Observed provider outcomes and review proofs cannot be replaced' USING ERRCODE='23514';
   END IF;
   FOR review_position IN 0..jsonb_array_length(coalesce(old_attempt->'reviewHistory','[]'::jsonb))-1 LOOP
    IF new_attempt->'reviewHistory'->review_position IS DISTINCT FROM old_attempt->'reviewHistory'->review_position THEN RAISE EXCEPTION 'Original human review history cannot change' USING ERRCODE='23514'; END IF;
   END LOOP;
  END LOOP;
  IF (OLD.retired_at IS NOT NULL AND NEW.provider_ref IS DISTINCT FROM OLD.provider_ref AND NEW.provider_ref IS NOT NULL) THEN NEW.provider_ref:=OLD.provider_ref; END IF;
  IF NEW.submission_id IS NULL THEN NEW.provider_ref:=NULL; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER form_lead_copy_writer BEFORE INSERT OR UPDATE OR DELETE ON form_lead_copies FOR EACH ROW EXECUTE FUNCTION freeholder_lead_copy_writer();

--> statement-breakpoint
-- Unknown historical inventory, not a claim that a request ran or a destination was known.
SELECT set_config('freeholder.lead_copy_v1','1',true);
--> statement-breakpoint
INSERT INTO form_lead_copies(submission_id,kind,state)
SELECT submission.id,'legacy_review','unknown' FROM form_submissions submission
WHERE submission.status='received' AND NOT (
 EXISTS(SELECT 1 FROM outbox_events proof WHERE proof.event_name='forms.submitted' AND proof.payload->>'submissionId'=submission.id::text AND proof.payload->'fromSiteForm'='false'::jsonb)
 AND NOT EXISTS(SELECT 1 FROM outbox_events uncertain WHERE uncertain.event_name='forms.submitted' AND uncertain.payload->>'submissionId'=submission.id::text AND uncertain.payload->'fromSiteForm' IS DISTINCT FROM 'false'::jsonb)
);
