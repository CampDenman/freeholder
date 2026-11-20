-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C12.38/C9.38: OWNED UNAPPLIED suffix AFTER ea555f146b73fc8112c57150c9a661f489ad61f8af4c7938c809536e1aa86672.
-- Root owns final composition/new hash/new DB. Preserve ea555/173/old goldens.
CREATE TABLE subscription_commercial_amendments (
 terms_id uuid PRIMARY KEY REFERENCES subscription_commercial_terms(id) ON DELETE RESTRICT,
 subscription_id uuid NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
 plan_id uuid NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
 previous_terms_id uuid NOT NULL REFERENCES subscription_commercial_terms(id) ON DELETE RESTRICT,
 accepted_by text NOT NULL, accepted_quote_digest text NOT NULL, state text NOT NULL,
 original_job_id uuid, job_claim_digest text, activated_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT subscription_commercial_amendments_acceptance CHECK(accepted_quote_digest ~ '^[a-f0-9]{64}$' AND accepted_by ~ '^(user:|agent:|plugin:)'),
 CONSTRAINT subscription_commercial_amendments_state CHECK((state='pending_stop' AND activated_at IS NULL AND original_job_id IS NOT NULL AND job_claim_digest ~ '^[a-f0-9]{64}$') OR(state='activated' AND activated_at IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX subscription_commercial_amendments_parent ON subscription_commercial_amendments(subscription_id);
--> statement-breakpoint
CREATE INDEX subscription_commercial_amendments_plan ON subscription_commercial_amendments(plan_id);
--> statement-breakpoint
CREATE INDEX subscription_commercial_amendments_previous ON subscription_commercial_amendments(previous_terms_id);
--> statement-breakpoint
CREATE UNIQUE INDEX subscription_commercial_amendments_job ON subscription_commercial_amendments(original_job_id);
--> statement-breakpoint
CREATE TABLE subscription_provider_generations (
 id uuid PRIMARY KEY, subscription_id uuid NOT NULL REFERENCES subscription_provider_schedule_resources(subscription_id) ON DELETE RESTRICT,
 sequence integer NOT NULL, previous_generation_id uuid REFERENCES subscription_provider_generations(id) ON DELETE RESTRICT,
 terms_id uuid NOT NULL REFERENCES subscription_commercial_terms(id) ON DELETE RESTRICT,
 first_operation_id uuid NOT NULL REFERENCES subscription_provider_schedule_operations(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
 predecessor_proof_digest text, provider_customer_ref text NOT NULL, provider_schedule_ref text, provider_subscription_ref text,
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT subscription_provider_generations_sequence_check CHECK(sequence>0 AND((sequence=1 AND previous_generation_id IS NULL AND predecessor_proof_digest IS NULL)OR(sequence>1 AND previous_generation_id IS NOT NULL AND predecessor_proof_digest ~ '^[a-f0-9]{64}$'))),
 CONSTRAINT subscription_provider_generations_refs CHECK(provider_customer_ref ~ '^cus_[A-Za-z0-9]+$' AND(provider_schedule_ref IS NULL OR provider_schedule_ref ~ '^sub_sched_[A-Za-z0-9]+$')AND(provider_subscription_ref IS NULL OR provider_subscription_ref ~ '^sub_[A-Za-z0-9]+$'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX subscription_provider_generations_sequence ON subscription_provider_generations(subscription_id,sequence);
--> statement-breakpoint
CREATE UNIQUE INDEX subscription_provider_generations_first_operation ON subscription_provider_generations(first_operation_id);
--> statement-breakpoint
CREATE INDEX subscription_provider_generations_terms ON subscription_provider_generations(terms_id);
--> statement-breakpoint
CREATE INDEX subscription_provider_generations_previous ON subscription_provider_generations(previous_generation_id);
--> statement-breakpoint
CREATE FUNCTION freeholder_subscription_amendment_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE accepted subscription_commercial_terms%ROWTYPE; parent subscriptions%ROWTYPE; resource subscription_provider_schedule_resources%ROWTYPE; claim job_idempotency_keys%ROWTYPE; job_data jsonb;
BEGIN
 IF TG_OP='DELETE' OR current_setting('freeholder.subscription_amendment_v1',true) IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'Explicit amendment receipts require their guarded original writer' USING ERRCODE='23514'; END IF;
 SELECT * INTO accepted FROM subscription_commercial_terms WHERE id=NEW.terms_id;
 SELECT * INTO parent FROM subscriptions WHERE id=NEW.subscription_id;
 SELECT * INTO resource FROM subscription_provider_schedule_resources WHERE subscription_id=NEW.subscription_id;
 IF accepted.id IS NULL OR parent.id IS NULL OR accepted.subscription_id IS DISTINCT FROM parent.id OR accepted.revision<2 OR accepted.previous_terms_id IS DISTINCT FROM NEW.previous_terms_id
  OR accepted.acceptance_source<>'amendment' OR accepted.accepted_quote_digest IS DISTINCT FROM NEW.accepted_quote_digest
  OR NOT EXISTS(SELECT 1 FROM plans p JOIN product_variants v ON v.product_id=p.product_id WHERE p.id=NEW.plan_id AND v.id=(accepted.snapshot->>'productVariantId')::uuid)
  OR accepted.snapshot->>'billingMode' IS DISTINCT FROM parent.billing_mode THEN RAISE EXCEPTION 'An amendment needs its exact accepted offer and original billing contract' USING ERRCODE='23514'; END IF;
 IF NEW.original_job_id IS NOT NULL THEN
  SELECT * INTO claim FROM job_idempotency_keys WHERE job_id=NEW.original_job_id AND job_name='subscriptions.activateMerchantAmendment';
  SELECT data INTO job_data FROM pgboss.job WHERE id=NEW.original_job_id AND name='subscriptions.activateMerchantAmendment';
  IF claim.id IS NULL OR claim.payload_hash IS DISTINCT FROM NEW.job_claim_digest OR job_data->>'purpose' IS DISTINCT FROM 'amendment'
   OR job_data->>'amendmentId' IS DISTINCT FROM NEW.terms_id::text OR job_data->>'subscriptionId' IS DISTINCT FROM parent.id::text OR job_data->>'originalJobId' IS DISTINCT FROM NEW.original_job_id::text
   OR NOT EXISTS(SELECT 1 FROM subscription_merchant_scopes s WHERE s.subscription_id=parent.id AND s.tax_profile_id::text=job_data->>'profileId') THEN
   RAISE EXCEPTION 'The amendment lost its actual original queue claim and payload' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='UPDATE' AND((to_jsonb(NEW)-ARRAY['state','activated_at'])IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['state','activated_at']) OR OLD.state<>'pending_stop' OR NEW.state<>'activated') THEN
  RAISE EXCEPTION 'Accepted amendment history is immutable' USING ERRCODE='23514'; END IF;
 IF NEW.state='activated' AND parent.billing_mode='provider' AND NOT((resource.state='uncreated' AND resource.provider_subscription_ref IS NULL
  AND NOT EXISTS(SELECT 1 FROM subscription_provider_schedule_operations o WHERE o.subscription_id=parent.id AND o.kind<>'create_product')
  AND NOT EXISTS(SELECT 1 FROM subscription_provider_charge_receipts r WHERE r.subscription_id=parent.id)
  AND NOT EXISTS(SELECT 1 FROM subscription_provider_charge_observations o WHERE o.subscription_id=parent.id))
  OR(resource.state='quiesced' AND NOT resource.recovery_pending AND resource.stopped_proof IS NOT NULL
   AND resource.stopped_proof->>'operationRevision'=resource.operation_revision::text AND resource.stopped_proof->>'evidenceRevision'=resource.evidence_revision::text
   AND NOT EXISTS(SELECT 1 FROM subscription_provider_schedule_operations o WHERE o.subscription_id=parent.id AND o.state NOT IN('confirmed','refused')))) THEN
  RAISE EXCEPTION 'Activate an accepted amendment only after current original provider quiescence' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER subscription_commercial_amendment_facts BEFORE INSERT OR UPDATE OR DELETE ON subscription_commercial_amendments FOR EACH ROW EXECUTE FUNCTION freeholder_subscription_amendment_receipt();
--> statement-breakpoint
CREATE FUNCTION freeholder_subscription_generation_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prior subscription_provider_generations%ROWTYPE; resource subscription_provider_schedule_resources%ROWTYPE; accepted subscription_commercial_terms%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' OR current_setting('freeholder.subscription_generation_v1',true) IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'Original provider generations require their guarded writer' USING ERRCODE='23514'; END IF;
 SELECT * INTO accepted FROM subscription_commercial_terms WHERE id=NEW.terms_id;
 SELECT * INTO resource FROM subscription_provider_schedule_resources WHERE subscription_id=NEW.subscription_id;
 IF accepted.id IS NULL OR accepted.subscription_id IS DISTINCT FROM NEW.subscription_id OR resource.subscription_id IS NULL THEN RAISE EXCEPTION 'The generation lost its accepted original agreement' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
  IF(to_jsonb(NEW)-ARRAY['provider_schedule_ref','provider_subscription_ref'])IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['provider_schedule_ref','provider_subscription_ref'])
   OR OLD.provider_schedule_ref IS NOT NULL AND NEW.provider_schedule_ref IS DISTINCT FROM OLD.provider_schedule_ref
   OR OLD.provider_subscription_ref IS NOT NULL AND NEW.provider_subscription_ref IS DISTINCT FROM OLD.provider_subscription_ref THEN RAISE EXCEPTION 'An original generation cannot replace its first actual resource' USING ERRCODE='23514'; END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM subscription_provider_schedule_operations o WHERE o.subscription_id=NEW.subscription_id AND o.original_request->>'resourceKind'='phase_schedule')
   AND NOT freeholder_phase_schedule_stop_covers(NEW.subscription_id,resource.stopped_proof) THEN RAISE EXCEPTION 'Every predecessor primary needs its original actual stop and caller proof' USING ERRCODE='23514'; END IF;
  SELECT * INTO prior FROM subscription_provider_generations WHERE subscription_id=NEW.subscription_id ORDER BY sequence DESC LIMIT 1;
  IF NEW.provider_schedule_ref IS NOT NULL OR NEW.provider_subscription_ref IS NOT NULL OR NEW.sequence<>coalesce(prior.sequence,0)+1 OR NEW.previous_generation_id IS DISTINCT FROM prior.id THEN RAISE EXCEPTION 'Admit a fresh generation before observing actual resources' USING ERRCODE='23514'; END IF;
  IF prior.id IS NOT NULL AND(prior.terms_id=NEW.terms_id OR resource.state<>'quiesced' OR resource.recovery_pending OR resource.stopped_proof IS NULL
   OR NEW.predecessor_proof_digest IS DISTINCT FROM encode(sha256(convert_to(resource.stopped_proof::text,'UTF8')),'hex')
   OR NOT EXISTS(SELECT 1 FROM subscription_commercial_amendments a WHERE a.terms_id=NEW.terms_id AND a.state='activated')) THEN RAISE EXCEPTION 'A new generation requires another activated acceptance and current predecessor proof' USING ERRCODE='23514'; END IF;
  IF prior.id IS NULL AND EXISTS(SELECT 1 FROM subscription_provider_schedule_operations o WHERE o.subscription_id=NEW.subscription_id AND o.original_request->>'resourceKind'='phase_schedule') THEN RAISE EXCEPTION 'Never infer a fresh generation over historical provider work' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER subscription_provider_generation_facts BEFORE INSERT OR UPDATE OR DELETE ON subscription_provider_generations FOR EACH ROW EXECUTE FUNCTION freeholder_subscription_generation_receipt();
--> statement-breakpoint
CREATE FUNCTION freeholder_subscription_generation_operation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE operation subscription_provider_schedule_operations%ROWTYPE;
BEGIN
 SELECT * INTO operation FROM subscription_provider_schedule_operations WHERE id=NEW.first_operation_id;
 IF operation.id IS NULL OR operation.subscription_id IS DISTINCT FROM NEW.subscription_id OR operation.kind<>'create' OR operation.original_request->>'resourceKind' IS DISTINCT FROM 'phase_schedule'
  OR operation.original_request->>'generationId' IS DISTINCT FROM NEW.id::text OR operation.original_request->>'providerCustomerRef' IS DISTINCT FROM NEW.provider_customer_ref THEN
  RAISE EXCEPTION 'A generation requires its exact admitted first physical operation' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER subscription_provider_generation_operation_facts AFTER INSERT ON subscription_provider_generations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION freeholder_subscription_generation_operation();
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
   OR NEW.effective_period_start IS DISTINCT FROM parent.current_period_end OR NEW.effective_period_start<=prior.effective_period_start
   OR EXISTS(SELECT 1 FROM subscription_commercial_terms other WHERE other.subscription_id=NEW.subscription_id AND other.revision>prior.revision)
   OR EXISTS(SELECT 1 FROM invoices invoice WHERE invoice.source_type='subscription' AND invoice.source_id=parent.id::text||':'||to_char(NEW.effective_period_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) THEN
   RAISE EXCEPTION 'An amendment needs its exact previous acceptance and an unbilled next period' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;

--> statement-breakpoint
CREATE FUNCTION freeholder_subscription_terms_amendment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.revision>1 AND NOT EXISTS(SELECT 1 FROM subscription_commercial_amendments a WHERE a.terms_id=NEW.id AND a.subscription_id=NEW.subscription_id AND a.previous_terms_id=NEW.previous_terms_id AND a.accepted_quote_digest=NEW.accepted_quote_digest) THEN
  RAISE EXCEPTION 'Accepted amended terms require their explicit original consent receipt' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER subscription_terms_amendment_facts AFTER INSERT ON subscription_commercial_terms DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION freeholder_subscription_terms_amendment();
--> statement-breakpoint
CREATE TABLE subscription_provider_invoice_observations (
 id uuid PRIMARY KEY, subscription_id uuid NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
 evidence_revision integer NOT NULL, evidence_digest text NOT NULL, provider_operation_id uuid REFERENCES subscription_provider_schedule_operations(id) ON DELETE RESTRICT,
 terms_id uuid REFERENCES subscription_commercial_terms(id) ON DELETE RESTRICT, phase_digest text,
 provider_invoice_ref text NOT NULL, provider_subscription_ref text NOT NULL, provider_customer_ref text,
 currency text, subtotal_minor bigint, total_minor bigint, paid_minor bigint, remaining_minor bigint, paid boolean NOT NULL, unadjusted boolean NOT NULL,
 line_count integer NOT NULL, verified boolean NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT subscription_provider_invoice_observations_refs CHECK(provider_invoice_ref ~ '^in_[A-Za-z0-9_]{1,195}$' AND provider_subscription_ref ~ '^sub_[A-Za-z0-9_]{1,195}$' AND(provider_customer_ref IS NULL OR provider_customer_ref ~ '^cus_[A-Za-z0-9_]{1,195}$')),
 CONSTRAINT subscription_provider_invoice_observations_shape CHECK(evidence_revision>0 AND evidence_digest ~ '^[a-f0-9]{64}$' AND line_count BETWEEN 0 AND 2000 AND(phase_digest IS NULL OR phase_digest ~ '^[a-f0-9]{64}$'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX subscription_provider_invoice_observations_digest ON subscription_provider_invoice_observations(subscription_id,evidence_digest);
--> statement-breakpoint
CREATE UNIQUE INDEX subscription_provider_invoice_observations_revision ON subscription_provider_invoice_observations(subscription_id,evidence_revision);
--> statement-breakpoint
CREATE INDEX subscription_provider_invoice_observations_invoice ON subscription_provider_invoice_observations(subscription_id,provider_invoice_ref,evidence_revision);
--> statement-breakpoint
CREATE INDEX subscription_provider_invoice_observations_operation ON subscription_provider_invoice_observations(provider_operation_id);
--> statement-breakpoint
CREATE INDEX subscription_provider_invoice_observations_terms ON subscription_provider_invoice_observations(terms_id);
--> statement-breakpoint
CREATE TABLE subscription_provider_invoice_lines (
 id uuid PRIMARY KEY, observation_id uuid NOT NULL REFERENCES subscription_provider_invoice_observations(id) ON DELETE RESTRICT, position integer NOT NULL,
 provider_line_ref text NOT NULL, provider_price_ref text, provider_product_ref text, quantity bigint, quantity_decimal text, amount_minor bigint, currency text,
 period_start timestamptz, period_end timestamptz, subscription_line boolean NOT NULL, proration boolean, unadjusted boolean NOT NULL,
 price_amount_minor bigint, price_currency text, price_interval text, price_interval_count integer,
 licensed boolean NOT NULL, per_unit boolean NOT NULL, inclusive boolean NOT NULL, no_transform boolean NOT NULL,
 CONSTRAINT subscription_provider_invoice_lines_refs CHECK(provider_line_ref ~ '^il_[A-Za-z0-9_]{1,195}$' AND(provider_price_ref IS NULL OR provider_price_ref ~ '^price_[A-Za-z0-9_]{1,195}$')AND(provider_product_ref IS NULL OR provider_product_ref ~ '^prod_[A-Za-z0-9_]{1,195}$')),
 CONSTRAINT subscription_provider_invoice_lines_position_check CHECK(position>=0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX subscription_provider_invoice_lines_position ON subscription_provider_invoice_lines(observation_id,position);
--> statement-breakpoint
CREATE UNIQUE INDEX subscription_provider_invoice_lines_ref ON subscription_provider_invoice_lines(observation_id,provider_line_ref);
--> statement-breakpoint
CREATE FUNCTION freeholder_subscription_period_receipts() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE resource subscription_provider_schedule_resources%ROWTYPE; parent subscription_provider_invoice_observations%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' OR current_setting('freeholder.subscription_period_v1',true) IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'Actual original provider invoice observations are append-only through their guarded writer' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='subscription_provider_invoice_observations' THEN
  SELECT * INTO resource FROM subscription_provider_schedule_resources WHERE subscription_id=NEW.subscription_id;
  IF resource.subscription_id IS NULL OR resource.evidence_revision<>NEW.evidence_revision OR NOT resource.recovery_pending OR resource.stopped_proof IS NOT NULL THEN RAISE EXCEPTION 'Retain a new actual invoice observation with current original recovery debt' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT * INTO parent FROM subscription_provider_invoice_observations WHERE id=NEW.observation_id;
  IF parent.id IS NULL OR NEW.position>=parent.line_count THEN RAISE EXCEPTION 'Actual invoice lines must fit their complete original observation' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER subscription_provider_invoice_observation_facts BEFORE INSERT OR UPDATE OR DELETE ON subscription_provider_invoice_observations FOR EACH ROW EXECUTE FUNCTION freeholder_subscription_period_receipts();
--> statement-breakpoint
CREATE TRIGGER subscription_provider_invoice_line_facts BEFORE INSERT OR UPDATE OR DELETE ON subscription_provider_invoice_lines FOR EACH ROW EXECUTE FUNCTION freeholder_subscription_period_receipts();
--> statement-breakpoint
CREATE FUNCTION freeholder_subscription_period_verified(target uuid) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE observation subscription_provider_invoice_observations%ROWTYPE; operation subscription_provider_schedule_operations%ROWTYPE; phase jsonb; line subscription_provider_invoice_lines%ROWTYPE; scope subscription_merchant_scopes%ROWTYPE; accepted subscription_commercial_terms%ROWTYPE; known_price text;
BEGIN
 SELECT * INTO observation FROM subscription_provider_invoice_observations WHERE id=target;
 IF observation.id IS NULL OR NOT observation.verified OR observation.line_count<>1 OR NOT observation.paid OR NOT observation.unadjusted THEN RETURN false; END IF;
 SELECT * INTO operation FROM subscription_provider_schedule_operations WHERE id=observation.provider_operation_id;
 SELECT * INTO scope FROM subscription_merchant_scopes WHERE subscription_id=observation.subscription_id;
 SELECT * INTO accepted FROM subscription_commercial_terms WHERE id=observation.terms_id;
 IF operation.id IS NULL OR scope.subscription_id IS NULL OR accepted.id IS NULL OR operation.subscription_id<>observation.subscription_id OR accepted.subscription_id<>observation.subscription_id
  OR operation.original_request->>'resourceKind' IS DISTINCT FROM 'phase_schedule' OR operation.original_request->>'providerPlatformAccountId' IS DISTINCT FROM scope.provider_platform_account_id
  OR nullif(operation.original_request->>'providerAccountId','') IS DISTINCT FROM scope.charge_account_id OR operation.provider_api_version<>scope.provider_schedule_api_version THEN RETURN false; END IF;
 SELECT value INTO phase FROM jsonb_array_elements(operation.original_request->'phases') WHERE value->>'phaseDigest'=observation.phase_digest AND value->>'termsId'=observation.terms_id::text;
 SELECT * INTO line FROM subscription_provider_invoice_lines WHERE observation_id=observation.id AND position=0;
 IF phase IS NULL OR line.id IS NULL OR accepted.profile_id::text IS DISTINCT FROM phase->>'profileId' OR accepted.profile_version::text IS DISTINCT FROM phase->>'profileVersion'
  OR observation.provider_customer_ref IS DISTINCT FROM operation.original_request->>'providerCustomerRef' OR observation.currency IS DISTINCT FROM phase->>'currency'
  OR observation.subtotal_minor IS DISTINCT FROM(phase->>'totalMinor')::bigint OR observation.total_minor IS DISTINCT FROM(phase->>'totalMinor')::bigint
  OR observation.paid_minor IS DISTINCT FROM(phase->>'totalMinor')::bigint OR observation.remaining_minor IS DISTINCT FROM 0
  OR NOT line.subscription_line OR line.proration IS DISTINCT FROM false OR NOT line.unadjusted OR line.quantity IS DISTINCT FROM 1
  OR NOT coalesce(line.quantity_decimal ~ '^1(\.0{1,12})?$',false) OR line.amount_minor IS DISTINCT FROM(phase->>'totalMinor')::bigint OR line.currency IS DISTINCT FROM phase->>'currency'
  OR line.period_start IS DISTINCT FROM(phase->>'start')::timestamptz OR line.period_end IS DISTINCT FROM(phase->>'end')::timestamptz
  OR line.provider_price_ref IS NULL OR line.provider_product_ref IS DISTINCT FROM operation.original_request->>'providerProductRef'
  OR line.price_amount_minor IS DISTINCT FROM(phase->>'totalMinor')::bigint OR line.price_currency IS DISTINCT FROM phase->>'currency'
  OR line.price_interval IS DISTINCT FROM phase->>'interval' OR line.price_interval_count IS DISTINCT FROM(phase->>'intervalCount')::integer
  OR NOT line.licensed OR NOT line.per_unit OR NOT line.inclusive OR NOT line.no_transform THEN RETURN false; END IF;
 IF operation.provider_observation->'phaseInventory'->>'operationId'=operation.id::text AND operation.provider_observation->'phaseInventory'->>'requestDigest'=operation.request_digest THEN
  SELECT value->>'providerPriceRef' INTO known_price FROM jsonb_array_elements(operation.provider_observation->'phaseInventory'->'phases') WHERE value->>'phaseDigest'=observation.phase_digest;
  IF known_price IS NOT NULL AND line.provider_price_ref IS DISTINCT FROM known_price THEN RETURN false; END IF;
 END IF;
 RETURN true;
EXCEPTION WHEN invalid_text_representation OR invalid_parameter_value OR datetime_field_overflow OR invalid_datetime_format THEN RETURN false;
END $$;
--> statement-breakpoint
CREATE FUNCTION freeholder_subscription_period_complete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF(SELECT count(*) FROM subscription_provider_invoice_lines WHERE observation_id=NEW.id)<>NEW.line_count OR NEW.verified AND NOT freeholder_subscription_period_verified(NEW.id) THEN
  RAISE EXCEPTION 'An actual provider invoice needs every immutable line and its complete admitted price/period proof' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER subscription_provider_invoice_complete AFTER INSERT ON subscription_provider_invoice_observations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION freeholder_subscription_period_complete();
--> statement-breakpoint
CREATE FUNCTION freeholder_subscription_period_cash_application() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE observed subscription_provider_invoice_observations%ROWTYPE; operation subscription_provider_schedule_operations%ROWTYPE; phase jsonb; payment payments%ROWTYPE; invoice invoices%ROWTYPE; policy invoice_market_policies%ROWTYPE;
BEGIN
 IF NEW.origin_kind<>'provider_schedule' THEN RETURN NEW; END IF;
 SELECT * INTO payment FROM payments WHERE id=NEW.payment_id;
 SELECT * INTO invoice FROM invoices WHERE id=payment.invoice_id;
 SELECT * INTO policy FROM invoice_market_policies WHERE invoice_id=invoice.id;
 SELECT * INTO observed FROM subscription_provider_invoice_observations WHERE subscription_id=NEW.subscription_id AND provider_invoice_ref=NEW.provider_invoice_ref ORDER BY evidence_revision DESC LIMIT 1;
 IF observed.id IS NULL OR NOT freeholder_subscription_period_verified(observed.id) OR observed.provider_subscription_ref IS DISTINCT FROM NEW.provider_subscription_ref THEN RAISE EXCEPTION 'Apply scheduled cash only through its latest complete admitted invoice lineage' USING ERRCODE='23514'; END IF;
 SELECT * INTO operation FROM subscription_provider_schedule_operations WHERE id=observed.provider_operation_id;
 SELECT value INTO phase FROM jsonb_array_elements(operation.original_request->'phases') WHERE value->>'phaseDigest'=observed.phase_digest;
 IF invoice.source_type<>'subscription' OR split_part(invoice.source_id,':',1) IS DISTINCT FROM NEW.subscription_id::text
  OR substring(invoice.source_id FROM 38) IS DISTINCT FROM to_char((phase->>'start')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  OR invoice.currency IS DISTINCT FROM phase->>'currency' OR invoice.total_minor IS DISTINCT FROM(phase->>'totalMinor')::bigint OR invoice.tax_minor IS DISTINCT FROM(phase->>'taxMinor')::bigint
  OR invoice.shipping_minor<>0 OR invoice.discount_minor<>0 OR policy.fee_minor IS DISTINCT FROM(phase->>'applicationFeeMinor')::bigint OR policy.site_fee_bps IS DISTINCT FROM(phase->>'siteFeeBps')::integer
  OR(SELECT count(*) FROM invoice_merchant_tax_quotes q WHERE q.invoice_id=invoice.id AND q.profile_id::text=phase->>'profileId' AND q.profile_version::text=phase->>'profileVersion' AND q.occurred_at=(phase->>'taxOccurredAt')::timestamptz AND q.tax_minor=(phase->>'taxMinor')::bigint AND q.shipping_minor=0 AND q.shipping_tax_minor=0)<>1
  OR(SELECT count(*) FROM invoice_merchant_tax_quotes q WHERE q.invoice_id=invoice.id)<>1
  OR(SELECT count(*) FROM invoice_lines l WHERE l.invoice_id=invoice.id)<>(CASE WHEN(phase->>'setupFeeMinor')::bigint>0 THEN 2 ELSE 1 END)
  OR(SELECT count(*) FROM invoice_lines l WHERE l.invoice_id=invoice.id AND l.snapshot->>'subscriptionComponent'='period' AND l.unit_amount_minor=(phase->>'periodAmountMinor')::bigint)<>1
  OR((phase->>'setupFeeMinor')::bigint>0 AND(SELECT count(*) FROM invoice_lines l WHERE l.invoice_id=invoice.id AND l.snapshot->>'subscriptionComponent'='setup' AND l.unit_amount_minor=(phase->>'setupFeeMinor')::bigint)<>1)
  OR EXISTS(SELECT 1 FROM invoice_lines l WHERE l.invoice_id=invoice.id AND(l.source_type IS DISTINCT FROM 'subscription' OR l.source_id IS DISTINCT FROM NEW.subscription_id::text OR l.quantity_micros IS DISTINCT FROM 1000000 OR l.discount_minor IS DISTINCT FROM 0
   OR l.snapshot->>'subscriptionTermsId' IS DISTINCT FROM phase->>'termsId' OR l.snapshot->>'subscriptionPeriodStart' IS DISTINCT FROM phase->>'start' OR l.snapshot->>'subscriptionPeriodEnd' IS DISTINCT FROM phase->>'end'
   OR(l.snapshot ? 'subscriptionPhaseDigest' AND l.snapshot->>'subscriptionPhaseDigest' IS DISTINCT FROM phase->>'phaseDigest'))) THEN
  RAISE EXCEPTION 'The canonical net/setup/tax/fee lines must match the actual admitted original provider period' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER merchant_agreement_period_lineage BEFORE INSERT ON merchant_agreement_payment_routes FOR EACH ROW EXECUTE FUNCTION freeholder_subscription_period_cash_application();

--> statement-breakpoint
CREATE FUNCTION freeholder_subscription_generation_observed_refs() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM subscription_provider_generations prior WHERE prior.subscription_id=NEW.subscription_id AND prior.id<>NEW.id
  AND(NEW.provider_schedule_ref IS NOT NULL AND prior.provider_schedule_ref=NEW.provider_schedule_ref OR NEW.provider_subscription_ref IS NOT NULL AND prior.provider_subscription_ref=NEW.provider_subscription_ref)) THEN
  RAISE EXCEPTION 'Another original generation already owns this actual resource' USING ERRCODE='23514'; END IF;
 IF NEW.provider_schedule_ref IS NOT NULL AND OLD.provider_schedule_ref IS NULL AND NOT EXISTS(
  SELECT 1 FROM subscription_provider_schedule_operations o CROSS JOIN LATERAL jsonb_array_elements(coalesce(o.provider_observation->'history','[]'::jsonb)) h(value)
  WHERE o.subscription_id=NEW.subscription_id AND o.original_request->>'generationId'=NEW.id::text AND h.value->>'operationId'=o.id::text AND h.value->>'requestDigest'=o.request_digest
   AND h.value->>'source' IN('phase_schedule_ack','phase_schedule_read_verified','phase_schedule_read_stale') AND h.value->>'providerScheduleRef'=NEW.provider_schedule_ref) THEN
  RAISE EXCEPTION 'A generation primary reference requires its original actual ACK/read' USING ERRCODE='23514'; END IF;
 IF NEW.provider_subscription_ref IS NOT NULL AND OLD.provider_subscription_ref IS NULL AND NOT(
  EXISTS(SELECT 1 FROM subscription_provider_schedule_operations o CROSS JOIN LATERAL jsonb_array_elements(coalesce(o.provider_observation->'history','[]'::jsonb)) h(value)
   WHERE o.subscription_id=NEW.subscription_id AND o.original_request->>'generationId'=NEW.id::text AND h.value->>'operationId'=o.id::text AND h.value->>'requestDigest'=o.request_digest
    AND h.value->>'source'='phase_schedule_read_verified' AND h.value->>'providerSubscriptionRef'=NEW.provider_subscription_ref AND h.value->'inventory'->>'providerCustomerRef'=NEW.provider_customer_ref)
  OR EXISTS(SELECT 1 FROM subscription_provider_schedule_operations o CROSS JOIN LATERAL jsonb_array_elements(coalesce(o.provider_observation->'history','[]'::jsonb)) h(value)
   JOIN subscription_provider_charge_observations cash ON cash.subscription_id=o.subscription_id AND cash.provider_subscription_ref=h.value->>'providerSubscriptionRef'
    AND cash.provider_invoice_ref=h.value->>'providerInvoiceRef' AND cash.provider_payment_intent_ref=h.value->>'providerPaymentIntentRef' AND cash.customer_charge_verified
   WHERE o.subscription_id=NEW.subscription_id AND o.original_request->>'generationId'=NEW.id::text AND h.value->>'source'='authenticated_invoice_payment'
    AND h.value->>'providerCustomerRef'=NEW.provider_customer_ref AND h.value->>'providerSubscriptionRef'=NEW.provider_subscription_ref)
  OR EXISTS(SELECT 1 FROM subscription_provider_invoice_observations invoice JOIN subscription_provider_schedule_operations o ON o.id=invoice.provider_operation_id
   WHERE invoice.subscription_id=NEW.subscription_id AND o.original_request->>'generationId'=NEW.id::text AND invoice.provider_subscription_ref=NEW.provider_subscription_ref
    AND invoice.provider_customer_ref=NEW.provider_customer_ref AND freeholder_subscription_period_verified(invoice.id))) THEN
  RAISE EXCEPTION 'A generation subscription reference requires actual original invoice/read/cash binding' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER subscription_provider_generation_observed_facts BEFORE UPDATE ON subscription_provider_generations FOR EACH ROW EXECUTE FUNCTION freeholder_subscription_generation_observed_refs();
