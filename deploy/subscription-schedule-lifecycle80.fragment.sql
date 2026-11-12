-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C12.38: unapplied additive80 fragment; assemble after original scope/tax tables.
CREATE TABLE subscription_provider_schedule_resources (
 subscription_id uuid PRIMARY KEY REFERENCES subscription_merchant_scopes(subscription_id) ON DELETE RESTRICT,
 provider_subscription_ref text, provider_customer_ref text, operation_revision integer NOT NULL DEFAULT 0, evidence_revision integer NOT NULL DEFAULT 0,
 state text NOT NULL DEFAULT 'uncreated', stopped_proof jsonb, recovery_pending boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT subscription_schedule_resource_revision CHECK(operation_revision>=0 AND evidence_revision>=0),
 CONSTRAINT subscription_schedule_resource_state CHECK(state IN('uncreated','active','quiescing','quiesced','unknown')),
 CONSTRAINT subscription_schedule_resource_stop CHECK(state<>'quiesced' OR(stopped_proof IS NOT NULL AND provider_subscription_ref IS NOT NULL AND provider_customer_ref IS NOT NULL AND recovery_pending=false))
);
--> statement-breakpoint
CREATE TABLE subscription_provider_schedule_operations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), subscription_id uuid NOT NULL REFERENCES subscription_provider_schedule_resources(subscription_id) ON DELETE RESTRICT,
 operation_revision integer NOT NULL, kind text NOT NULL, provider_api_version text NOT NULL,
 original_request jsonb NOT NULL, request_digest text NOT NULL, idempotency_key text NOT NULL,
 state text NOT NULL DEFAULT 'running', positive_observed boolean NOT NULL DEFAULT false,
 provider_observation jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
 CONSTRAINT subscription_schedule_operations_revision_check CHECK(operation_revision>0),
 CONSTRAINT subscription_schedule_operations_kind CHECK(kind IN('create','update','pause','resume','cancel','void_invoice','delete_draft')),
 CONSTRAINT subscription_schedule_operations_api CHECK(provider_api_version='2026-10-28.endive'),
 CONSTRAINT subscription_schedule_operations_state CHECK(state IN('running','unknown','confirmed','refused')),
 CONSTRAINT subscription_schedule_operations_digest CHECK(request_digest ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX subscription_schedule_operations_revision ON subscription_provider_schedule_operations(subscription_id,operation_revision);
--> statement-breakpoint
CREATE UNIQUE INDEX subscription_schedule_operations_key ON subscription_provider_schedule_operations(idempotency_key);
--> statement-breakpoint
CREATE INDEX subscription_schedule_operations_resource ON subscription_provider_schedule_operations(subscription_id);
--> statement-breakpoint
CREATE TABLE subscription_provider_schedule_erasures (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), profile_id uuid NOT NULL REFERENCES merchant_tax_profiles(id) ON DELETE RESTRICT,
 subscription_id uuid REFERENCES subscription_merchant_scopes(subscription_id) ON DELETE RESTRICT,
 privacy_scope text NOT NULL, request_id uuid NOT NULL REFERENCES data_requests(id) ON DELETE RESTRICT,
 original_job_id uuid NOT NULL, job_id uuid NOT NULL, job_key text NOT NULL, job_ids jsonb NOT NULL, state text NOT NULL DEFAULT 'pending',
 created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
 CONSTRAINT subscription_schedule_erasures_state CHECK(state IN('pending','completed')),
 CONSTRAINT subscription_schedule_erasures_scope CHECK((privacy_scope='commerce.merchantTax' AND subscription_id IS NULL) OR(privacy_scope='subscriptions.agreements' AND subscription_id IS NOT NULL)),
 CONSTRAINT subscription_schedule_erasures_complete CHECK(state<>'completed' OR completed_at IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX subscription_schedule_erasures_original ON subscription_provider_schedule_erasures(profile_id,request_id,coalesce(subscription_id::text,''));
--> statement-breakpoint
CREATE INDEX subscription_schedule_erasures_profile ON subscription_provider_schedule_erasures(profile_id);
--> statement-breakpoint
CREATE INDEX subscription_schedule_erasures_request ON subscription_provider_schedule_erasures(request_id);
--> statement-breakpoint
CREATE FUNCTION freeholder_subscription_schedule_receipts() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original subscription_merchant_scopes%ROWTYPE; resource subscription_provider_schedule_resources%ROWTYPE; old_history jsonb; new_history jsonb;
BEGIN
 IF current_setting('freeholder.subscription_schedule_v1',true) IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'Original subscription provider work requires its guarded current writer' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Original subscription provider facts cannot be deleted' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='subscription_provider_schedule_resources' THEN
  IF TG_OP='UPDATE' AND(NEW.subscription_id IS DISTINCT FROM OLD.subscription_id OR NEW.created_at IS DISTINCT FROM OLD.created_at
   OR OLD.provider_subscription_ref IS NOT NULL AND NEW.provider_subscription_ref IS DISTINCT FROM OLD.provider_subscription_ref
   OR OLD.provider_customer_ref IS NOT NULL AND NEW.provider_customer_ref IS DISTINCT FROM OLD.provider_customer_ref
   OR NEW.operation_revision<OLD.operation_revision OR NEW.operation_revision>OLD.operation_revision+1
   OR NEW.evidence_revision<OLD.evidence_revision OR NEW.evidence_revision>OLD.evidence_revision+1) THEN
   RAISE EXCEPTION 'Original subscription resource and evidence revisions cannot be replaced' USING ERRCODE='23514';
  END IF;
  IF NEW.state='quiesced' AND(
   NEW.stopped_proof->>'operationRevision' IS DISTINCT FROM NEW.operation_revision::text
   OR NEW.stopped_proof->>'evidenceRevision' IS DISTINCT FROM NEW.evidence_revision::text
   OR NOT coalesce(NEW.stopped_proof->>'journalDigest' ~ '^[a-f0-9]{64}$',false)
   OR jsonb_typeof(NEW.stopped_proof->'resources') IS DISTINCT FROM 'array'
   OR EXISTS(SELECT 1 FROM subscription_provider_schedule_operations o WHERE o.subscription_id=NEW.subscription_id AND o.state IN('running','unknown'))) THEN
   RAISE EXCEPTION 'Quiescence requires the current settled original operation history' USING ERRCODE='23514';
  END IF;
 ELSIF TG_TABLE_NAME='subscription_provider_schedule_operations' THEN
  SELECT * INTO original FROM subscription_merchant_scopes WHERE subscription_id=NEW.subscription_id;
  SELECT * INTO resource FROM subscription_provider_schedule_resources WHERE subscription_id=NEW.subscription_id;
  IF original.subscription_id IS NULL OR resource.subscription_id IS NULL OR NEW.provider_api_version IS DISTINCT FROM original.provider_schedule_api_version
   OR NEW.original_request->>'providerPlatformAccountId' IS DISTINCT FROM original.provider_platform_account_id
   OR nullif(NEW.original_request->>'providerAccountId','') IS DISTINCT FROM original.charge_account_id THEN
   RAISE EXCEPTION 'The physical subscription operation lost its original charge namespace' USING ERRCODE='23514';
  END IF;
  IF TG_OP='INSERT' AND(NEW.state<>'running' OR NEW.positive_observed OR NEW.operation_revision<>resource.operation_revision OR NEW.provider_observation<>'{}'::jsonb) THEN
   RAISE EXCEPTION 'Commit one unresolved original intent before physical provider I/O' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' THEN
   IF(to_jsonb(NEW)-ARRAY['state','positive_observed','provider_observation','finished_at']) IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['state','positive_observed','provider_observation','finished_at'])
    OR OLD.positive_observed AND NOT NEW.positive_observed THEN RAISE EXCEPTION 'Original subscription intent and positive facts are immutable' USING ERRCODE='23514'; END IF;
   old_history=coalesce(OLD.provider_observation->'history','[]'::jsonb); new_history=NEW.provider_observation->'history';
   IF jsonb_typeof(new_history) IS DISTINCT FROM 'array' OR jsonb_array_length(new_history)<jsonb_array_length(old_history)
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(old_history) WITH ORDINALITY entry(value,position) WHERE new_history->(entry.position::integer-1) IS DISTINCT FROM entry.value) THEN
    RAISE EXCEPTION 'Observed provider history is append-only' USING ERRCODE='23514';
   END IF;
  END IF;
 ELSE
  IF TG_OP='UPDATE' AND(to_jsonb(NEW)-ARRAY['state','job_id','job_key','job_ids','completed_at']) IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['state','job_id','job_key','job_ids','completed_at']) THEN
   RAISE EXCEPTION 'The original subscription erasure request and first job cannot change' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER subscription_schedule_resource_facts BEFORE INSERT OR UPDATE OR DELETE ON subscription_provider_schedule_resources FOR EACH ROW EXECUTE FUNCTION freeholder_subscription_schedule_receipts();
--> statement-breakpoint
CREATE TRIGGER subscription_schedule_operation_facts BEFORE INSERT OR UPDATE OR DELETE ON subscription_provider_schedule_operations FOR EACH ROW EXECUTE FUNCTION freeholder_subscription_schedule_receipts();
--> statement-breakpoint
CREATE TRIGGER subscription_schedule_erasure_facts BEFORE INSERT OR UPDATE OR DELETE ON subscription_provider_schedule_erasures FOR EACH ROW EXECUTE FUNCTION freeholder_subscription_schedule_receipts();
