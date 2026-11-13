-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C12.38/C9.38: OWNED UNAPPLIED suffix AFTER fcfe7f1bddfe288691c6325ece22763d96dd81cdb8c901b08e3ff690ed90df97.
-- Root owns composition/new SQL hash/new normal DB; earlier fragments stay frozen.
CREATE FUNCTION freeholder_subscription_resumption_callers_closed(target uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT NOT EXISTS(SELECT 1 FROM subscription_provider_schedule_operations o WHERE o.subscription_id=target AND(
  o.state NOT IN('confirmed','refused') OR jsonb_typeof(o.provider_observation->'history') IS DISTINCT FROM 'array'
  OR jsonb_array_length(o.provider_observation->'history')>5000
  OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(o.provider_observation->'history') h(value)
   WHERE h.value->>'operationId'=o.id::text AND h.value->>'requestDigest'=o.request_digest AND(
    (h.value->>'source'='physical_caller_finished' AND h.value->>'completionDigest'=o.original_request->>'callerCompletionDigest' AND h.value->>'outcome' IN('returned','threw'))
    OR(h.value->>'source'='human_stopped_caller' AND h.value->>'actor' ~ '^user:[a-f0-9-]{36}$' AND h.value->>'stoppedCallerEvidenceDigest' ~ '^[a-f0-9]{64}$' AND h.value->>'providerFinalEvidenceDigest' ~ '^[a-f0-9]{64}$')))
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(o.provider_observation->'history') admission(value)
   WHERE admission.value->>'source' IN('schedule_read_admitted','phase_product_read_admitted') AND(
    admission.value->>'operationId' IS DISTINCT FROM o.id::text OR admission.value->>'requestDigest' IS DISTINCT FROM o.request_digest
    OR NOT coalesce(admission.value->>'readId' ~ '^[a-f0-9-]{36}$',false)
    OR NOT coalesce(admission.value->>'completionDigest' ~ '^[a-f0-9]{64}$',false)
    OR admission.value->>'completionDigest' IS NOT DISTINCT FROM o.original_request->>'callerCompletionDigest'
    OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(o.provider_observation->'history') finish(value)
     WHERE finish.value->>'source'=CASE admission.value->>'source' WHEN 'schedule_read_admitted' THEN 'schedule_read_finished' ELSE 'phase_product_read_finished' END
      AND finish.value->>'operationId'=o.id::text AND finish.value->>'requestDigest'=o.request_digest
      AND finish.value->>'readId'=admission.value->>'readId' AND finish.value->>'completionDigest'=admission.value->>'completionDigest'
      AND finish.value->>'outcome' IN('returned','threw'))))))
$$;
--> statement-breakpoint
CREATE TABLE subscription_commercial_resumptions (
 terms_id uuid PRIMARY KEY REFERENCES subscription_commercial_terms(id) ON DELETE RESTRICT,
 subscription_id uuid NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
 previous_terms_id uuid NOT NULL REFERENCES subscription_commercial_terms(id) ON DELETE RESTRICT,
 original_period_end timestamptz NOT NULL, previous_effective_start timestamptz NOT NULL, accepted_period_start timestamptz NOT NULL,
 generation_id uuid REFERENCES subscription_provider_generations(id) ON DELETE RESTRICT,
 generation_digest text NOT NULL, operation_revision integer NOT NULL, evidence_revision integer NOT NULL,
 journal_digest text NOT NULL, stopped_proof_digest text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT subscription_commercial_resumptions_calendar CHECK(accepted_period_start>original_period_end AND accepted_period_start>previous_effective_start),
 CONSTRAINT subscription_commercial_resumptions_stamps CHECK(operation_revision>=0 AND evidence_revision>=0 AND generation_digest ~ '^[a-f0-9]{64}$' AND journal_digest ~ '^[a-f0-9]{64}$' AND stopped_proof_digest ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE INDEX subscription_commercial_resumptions_parent ON subscription_commercial_resumptions(subscription_id);
--> statement-breakpoint
CREATE INDEX subscription_commercial_resumptions_previous ON subscription_commercial_resumptions(previous_terms_id);
--> statement-breakpoint
CREATE INDEX subscription_commercial_resumptions_generation ON subscription_commercial_resumptions(generation_id);
--> statement-breakpoint
CREATE FUNCTION freeholder_subscription_resumption_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent subscriptions%ROWTYPE; accepted subscription_commercial_terms%ROWTYPE; previous subscription_commercial_terms%ROWTYPE; resource subscription_provider_schedule_resources%ROWTYPE; generation subscription_provider_generations%ROWTYPE; actual_journal text;
BEGIN
 IF TG_OP<>'INSERT' OR current_setting('freeholder.subscription_resumption_v1',true) IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'Explicit fresh calendar consent is immutable through its guarded original writer' USING ERRCODE='23514'; END IF;
 SELECT * INTO parent FROM subscriptions WHERE id=NEW.subscription_id;
 SELECT * INTO accepted FROM subscription_commercial_terms WHERE id=NEW.terms_id;
 SELECT * INTO previous FROM subscription_commercial_terms WHERE id=NEW.previous_terms_id;
 SELECT * INTO resource FROM subscription_provider_schedule_resources WHERE subscription_id=NEW.subscription_id;
 SELECT * INTO generation FROM subscription_provider_generations WHERE subscription_id=NEW.subscription_id ORDER BY sequence DESC LIMIT 1;
 SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(o) order by o.operation_revision),'[]'::jsonb)::text,'UTF8')),'hex') INTO actual_journal FROM subscription_provider_schedule_operations o WHERE o.subscription_id=NEW.subscription_id;
 IF parent.id IS NULL OR accepted.id IS NULL OR previous.id IS NULL OR resource.subscription_id IS NULL
  OR accepted.subscription_id IS DISTINCT FROM parent.id OR previous.subscription_id IS DISTINCT FROM parent.id OR accepted.previous_terms_id IS DISTINCT FROM previous.id
  OR accepted.revision<>previous.revision+1 OR accepted.acceptance_source<>'amendment' OR parent.merchant_scope_version<>1
  OR NEW.original_period_end IS DISTINCT FROM parent.current_period_end OR NEW.original_period_end>clock_timestamp()
  OR NEW.previous_effective_start IS DISTINCT FROM previous.effective_period_start OR NEW.accepted_period_start IS DISTINCT FROM accepted.effective_period_start OR NEW.accepted_period_start<=clock_timestamp()
  OR NEW.generation_id IS DISTINCT FROM generation.id OR NEW.generation_digest IS DISTINCT FROM encode(sha256(convert_to(CASE WHEN generation.id IS NULL THEN 'null'::jsonb ELSE to_jsonb(generation) END::text,'UTF8')),'hex')
  OR NEW.operation_revision IS DISTINCT FROM resource.operation_revision OR NEW.evidence_revision IS DISTINCT FROM resource.evidence_revision
  OR NEW.journal_digest IS DISTINCT FROM actual_journal OR NEW.stopped_proof_digest IS DISTINCT FROM encode(sha256(convert_to(coalesce(resource.stopped_proof,'null'::jsonb)::text,'UTF8')),'hex')
  OR (SELECT count(*) FROM subscription_provider_schedule_operations o WHERE o.subscription_id=parent.id)<>resource.operation_revision
  OR NOT freeholder_subscription_resumption_callers_closed(parent.id)
  OR EXISTS(SELECT 1 FROM invoices i WHERE i.source_type='subscription' AND i.source_id IN(parent.id::text||':'||to_char(NEW.original_period_end AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),CASE WHEN NEW.previous_effective_start>=NEW.original_period_end THEN parent.id::text||':'||to_char(NEW.previous_effective_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') ELSE NULL END) AND(i.status<>'void' OR i.paid_minor<>0))
  OR NOT((resource.state='uncreated' AND NOT resource.recovery_pending AND resource.provider_subscription_ref IS NULL AND resource.provider_customer_ref IS NULL AND parent.provider_ref IS NULL
    AND NOT EXISTS(SELECT 1 FROM subscription_provider_schedule_operations o WHERE o.subscription_id=parent.id AND(o.kind<>'create_product' OR o.state<>'confirmed'
     OR o.original_request->>'resourceKind' IS DISTINCT FROM 'phase_product' OR o.original_request->'physical'->>'method' IS DISTINCT FROM 'POST' OR o.original_request->'physical'->>'path' IS DISTINCT FROM '/v1/products'
     OR o.provider_observation->'productProof'->>'operationId' IS DISTINCT FROM o.id::text OR o.provider_observation->'productProof'->>'requestDigest' IS DISTINCT FROM o.request_digest
     OR NOT coalesce(o.provider_observation->'productProof'->>'providerProductRef' ~ '^prod_[A-Za-z0-9]{1,195}$',false)
     OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(o.provider_observation->'history') h(value) WHERE h.value->>'source'='phase_product_read_verified' AND h.value->>'operationId'=o.id::text AND h.value->>'requestDigest'=o.request_digest AND h.value->>'providerProductRef'=o.provider_observation->'productProof'->>'providerProductRef')))
    AND NOT EXISTS(SELECT 1 FROM subscription_provider_charge_observations c WHERE c.subscription_id=parent.id) AND NOT EXISTS(SELECT 1 FROM subscription_provider_charge_receipts c WHERE c.subscription_id=parent.id))
   OR(resource.state='quiesced' AND NOT resource.recovery_pending AND resource.stopped_proof IS NOT NULL AND resource.stopped_proof->>'operationRevision'=resource.operation_revision::text AND resource.stopped_proof->>'evidenceRevision'=resource.evidence_revision::text AND freeholder_phase_schedule_stop_covers(parent.id,resource.stopped_proof))) THEN
  RAISE EXCEPTION 'A replacement future calendar needs the exact current original generation, quiescent history and unbilled gap' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER subscription_commercial_resumption_facts BEFORE INSERT OR UPDATE OR DELETE ON subscription_commercial_resumptions FOR EACH ROW EXECUTE FUNCTION freeholder_subscription_resumption_receipt();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION freeholder_subscription_commercial_terms() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent subscriptions%ROWTYPE; original subscription_merchant_scopes%ROWTYPE; prior subscription_commercial_terms%ROWTYPE; business merchant_tax_profiles%ROWTYPE; resource subscription_provider_schedule_resources%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Accepted subscription promises cannot be deleted' USING ERRCODE='23514'; END IF;
 IF current_setting('freeholder.subscription_terms_v1',true) IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'Accepted subscription promises require their guarded current writer' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
  IF current_setting('freeholder.subscription_terms_privacy_v1',true) IS DISTINCT FROM '1'
   OR(to_jsonb(NEW)-ARRAY['tax_destination','redacted_at'])IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['tax_destination','redacted_at'])
   OR OLD.redacted_at IS NOT NULL OR NEW.tax_destination IS NOT NULL OR NEW.redacted_at IS NULL THEN
   RAISE EXCEPTION 'Accepted subscription promises permit only guarded personal-destination minimization' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO parent FROM subscriptions WHERE id=NEW.subscription_id;
 SELECT * INTO original FROM subscription_merchant_scopes WHERE subscription_id=NEW.subscription_id;
 SELECT * INTO business FROM merchant_tax_profiles WHERE id=NEW.profile_id;
 SELECT * INTO resource FROM subscription_provider_schedule_resources WHERE subscription_id=NEW.subscription_id;
 IF parent.id IS NULL OR parent.merchant_scope_version<>1 OR original.subscription_id IS NULL
  OR NEW.profile_id IS DISTINCT FROM original.tax_profile_id OR NEW.tax_liability IS DISTINCT FROM original.tax_liability
  OR business.state IS DISTINCT FROM 'active' OR business.current_version IS DISTINCT FROM NEW.profile_version
  OR NEW.snapshot->>'version' IS DISTINCT FROM '1' OR NEW.snapshot->>'currency' IS DISTINCT FROM parent.currency
  OR jsonb_typeof(NEW.snapshot) IS DISTINCT FROM 'object' OR jsonb_typeof(NEW.notice_snapshot) IS DISTINCT FROM 'object'
  OR resource.subscription_id IS NULL OR NEW.redacted_at IS NOT NULL THEN
  RAISE EXCEPTION 'A new acceptance needs its actual original agreement, business and current declared policy' USING ERRCODE='23514';
 END IF;
 IF NEW.revision=1 THEN
  IF resource.operation_revision<>0 OR resource.provider_subscription_ref IS NOT NULL OR resource.state<>'uncreated' OR NEW.effective_period_start IS DISTINCT FROM parent.current_period_start
   OR EXISTS(SELECT 1 FROM subscription_card_setups setup WHERE setup.subscription_id=parent.id)
   OR EXISTS(SELECT 1 FROM invoices invoice WHERE invoice.source_type='subscription' AND split_part(invoice.source_id,':',1)=parent.id::text) THEN
   RAISE EXCEPTION 'Accept original commercial terms before admitting provider schedule work' USING ERRCODE='23514';
  END IF;
 ELSE
  SELECT * INTO prior FROM subscription_commercial_terms WHERE id=NEW.previous_terms_id;
  IF prior.id IS NULL OR prior.subscription_id IS DISTINCT FROM NEW.subscription_id OR prior.revision+1<>NEW.revision
   OR current_setting('freeholder.subscription_amendment_v1',true) IS DISTINCT FROM '1' OR NEW.acceptance_source<>'amendment'
   OR NEW.effective_period_start<parent.current_period_end OR NEW.effective_period_start<=prior.effective_period_start
   OR(NEW.effective_period_start>parent.current_period_end AND(current_setting('freeholder.subscription_resumption_v1',true) IS DISTINCT FROM '1' OR parent.current_period_end>clock_timestamp() OR NEW.effective_period_start<=clock_timestamp()))
   OR EXISTS(SELECT 1 FROM subscription_commercial_terms other WHERE other.subscription_id=NEW.subscription_id AND other.revision>prior.revision)
   OR EXISTS(SELECT 1 FROM invoices invoice WHERE invoice.source_type='subscription' AND invoice.source_id=parent.id::text||':'||to_char(NEW.effective_period_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) THEN
   RAISE EXCEPTION 'An amendment needs its exact previous acceptance and an unbilled next period' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;

--> statement-breakpoint
CREATE FUNCTION freeholder_subscription_resumption_consent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_setting('freeholder.subscription_resumption_v1',true)='1' AND NOT EXISTS(SELECT 1 FROM subscription_commercial_resumptions r WHERE r.terms_id=NEW.id AND r.subscription_id=NEW.subscription_id AND r.previous_terms_id=NEW.previous_terms_id AND r.accepted_period_start=NEW.effective_period_start) THEN
  RAISE EXCEPTION 'A replacement calendar requires its fresh immutable consent receipt' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER subscription_resumption_consent_facts AFTER INSERT ON subscription_commercial_terms DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION freeholder_subscription_resumption_consent();
