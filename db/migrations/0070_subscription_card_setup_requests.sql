-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- freeholder:schema-breaking New zero-fee card trials require exact setup proof, durable provider outcomes and setup-aware merge undo. Prior images fail closed at these boundaries. Restore the pre-upgrade database and objects for full rollback.
-- C12.38: freeze customer/setup input before any provider creation request.
CREATE TABLE subscription_card_setups (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 subscription_id uuid NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
 provider text NOT NULL,
 provider_account_id text NOT NULL DEFAULT '',
 request jsonb NOT NULL,
 request_hash text NOT NULL,
 provider_checkout_ref text,
 provider_customer_ref text,
 provider_setup_intent_ref text,
 checkout_url text,
 expires_at timestamptz,
 -- A retained setup keeps a historical ID without preventing credential erasure.
 confirmed_method_id uuid,
 confirmed_at timestamptz,
 closed_at timestamptz,
 closed_reason text,
 erasure_request_id uuid,
 erasure_job_id uuid,
 cleanup_completed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT subscription_card_setups_cleanup_check CHECK (cleanup_completed_at IS NULL OR (erasure_request_id IS NOT NULL AND erasure_job_id IS NOT NULL)),
 CONSTRAINT subscription_card_setups_erasure_pair_check CHECK ((erasure_request_id IS NULL AND erasure_job_id IS NULL) OR (erasure_request_id IS NOT NULL AND erasure_job_id IS NOT NULL)),
 CONSTRAINT subscription_card_setups_closure_check CHECK ((closed_at IS NULL AND closed_reason IS NULL) OR (closed_at IS NOT NULL AND confirmed_at IS NULL AND closed_reason IS NOT NULL AND ((closed_reason='expired' AND provider_checkout_ref IS NOT NULL AND provider_customer_ref IS NOT NULL) OR closed_reason='provider_cancelled'))),
 CONSTRAINT subscription_card_setups_provider_check CHECK (length(trim(provider)) BETWEEN 1 AND 100),
 CONSTRAINT subscription_card_setups_account_check CHECK (provider_account_id='' OR (provider='stripe' AND provider_account_id ~ '^acct_[A-Za-z0-9]+$')),
 CONSTRAINT subscription_card_setups_request_check CHECK (jsonb_typeof(request)='object' AND length(request_hash)=64),
 CONSTRAINT subscription_card_setups_confirmation_check CHECK ((confirmed_method_id IS NULL AND confirmed_at IS NULL) OR (confirmed_method_id IS NOT NULL AND confirmed_at IS NOT NULL AND provider_checkout_ref IS NOT NULL AND provider_customer_ref IS NOT NULL AND provider_setup_intent_ref IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX subscription_card_setups_pending_idx ON subscription_card_setups(subscription_id) WHERE confirmed_at IS NULL AND closed_at IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX subscription_card_setups_checkout_idx ON subscription_card_setups(provider,provider_account_id,provider_checkout_ref);
--> statement-breakpoint
CREATE FUNCTION guard_subscription_card_setup_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.subscription_id IS DISTINCT FROM OLD.subscription_id
  OR NEW.provider IS DISTINCT FROM OLD.provider OR NEW.provider_account_id IS DISTINCT FROM OLD.provider_account_id
  OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
  RAISE EXCEPTION 'The original card-setup request identity is immutable.' USING ERRCODE='23514';
 END IF;
 IF NEW.request IS DISTINCT FROM OLD.request OR NEW.request_hash IS DISTINCT FROM OLD.request_hash THEN
  RAISE EXCEPTION 'Retry the exact original card-setup request.' USING ERRCODE='23514';
 END IF;
 IF (OLD.provider_checkout_ref IS NOT NULL AND NEW.provider_checkout_ref IS DISTINCT FROM OLD.provider_checkout_ref)
  OR (OLD.provider_customer_ref IS NOT NULL AND NEW.provider_customer_ref IS DISTINCT FROM OLD.provider_customer_ref)
  OR (OLD.provider_setup_intent_ref IS NOT NULL AND NEW.provider_setup_intent_ref IS DISTINCT FROM OLD.provider_setup_intent_ref)
  OR (OLD.confirmed_method_id IS NOT NULL AND NEW.confirmed_method_id IS DISTINCT FROM OLD.confirmed_method_id) THEN
  RAISE EXCEPTION 'The original card-setup provider binding is immutable.' USING ERRCODE='23514';
 END IF;
 IF OLD.erasure_request_id IS NOT NULL AND (NEW.erasure_request_id IS DISTINCT FROM OLD.erasure_request_id OR NEW.erasure_job_id IS DISTINCT FROM OLD.erasure_job_id) THEN
  RAISE EXCEPTION 'The original setup erasure task is immutable.' USING ERRCODE='23514';
 END IF;
 IF OLD.cleanup_completed_at IS NOT NULL AND NEW.cleanup_completed_at IS DISTINCT FROM OLD.cleanup_completed_at THEN
  RAISE EXCEPTION 'Acknowledged setup cleanup is immutable.' USING ERRCODE='23514';
 END IF;
 IF OLD.confirmed_at IS NOT NULL AND NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at THEN
  RAISE EXCEPTION 'The original verified setup time is immutable.' USING ERRCODE='23514';
 END IF;
 IF NEW.closed_reason='provider_cancelled' AND OLD.closed_at IS NULL AND (
  NEW.provider_checkout_ref IS NOT NULL OR NEW.provider_setup_intent_ref IS NOT NULL OR NEW.confirmed_at IS NOT NULL
  OR EXISTS (SELECT 1 FROM subscription_setup_dispatches WHERE setup_id=NEW.id AND (state IN ('running','unknown') OR (kind='session' AND state IN ('succeeded','provider_completed'))))
  OR NOT EXISTS (SELECT 1 FROM subscription_setup_dispatches WHERE setup_id=NEW.id AND state='provider_cancelled')
 ) THEN
  RAISE EXCEPTION 'Only settled final cancellation evidence can close this original setup.' USING ERRCODE='23514';
 END IF;
 IF OLD.closed_at IS NOT NULL AND (NEW.closed_at IS DISTINCT FROM OLD.closed_at OR NEW.closed_reason IS DISTINCT FROM OLD.closed_reason) THEN
  RAISE EXCEPTION 'A reconciled setup closure is immutable.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER subscription_card_setup_request_immutable BEFORE UPDATE ON subscription_card_setups
 FOR EACH ROW EXECUTE FUNCTION guard_subscription_card_setup_request();

--> statement-breakpoint
CREATE FUNCTION guard_trial_card_setup_confirmation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.signup_pending AND NOT NEW.signup_pending AND NEW.status='trialing'
  AND OLD.signup_invoice_id IS NULL AND NEW.billing_mode <> 'manual'
  AND NOT EXISTS (
   SELECT 1 FROM (SELECT * FROM subscription_card_setups WHERE subscription_id=NEW.id ORDER BY created_at DESC,id DESC LIMIT 1) setup
   JOIN payment_methods method ON method.id=setup.confirmed_method_id
   WHERE setup.confirmed_at IS NOT NULL AND setup.confirmed_method_id=NEW.payment_method_id
    AND setup.provider=NEW.provider AND setup.provider=method.provider
    AND setup.provider_account_id=method.provider_account_id AND setup.provider_customer_ref=method.provider_customer_ref
    AND method.contact_id=NEW.contact_id AND method.status='active' AND method.consent_source='provider_checkout'
  ) THEN
  RAISE EXCEPTION 'This trial requires its exact verified card-setup method.' USING ERRCODE='23514',CONSTRAINT='subscription_trial_setup_confirmation';
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER subscription_trial_setup_confirmation BEFORE UPDATE ON subscriptions
 FOR EACH ROW EXECUTE FUNCTION guard_trial_card_setup_confirmation();

--> statement-breakpoint
CREATE TABLE subscription_setup_dispatches (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 setup_id uuid NOT NULL REFERENCES subscription_card_setups(id) ON DELETE CASCADE,
 kind text NOT NULL,
 state text NOT NULL DEFAULT 'running',
 request_hash text NOT NULL,
 customer_at_start text,
 initiated_by text NOT NULL,
 provider_ref text,
 provider_customer_ref text,
 unverified_evidence jsonb NOT NULL DEFAULT '{}',
 resolution jsonb NOT NULL DEFAULT '{}',
 started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 finished_at timestamptz,
 CONSTRAINT subscription_setup_dispatches_kind_check CHECK (kind IN ('customer','session')),
 CONSTRAINT subscription_setup_dispatches_state_check CHECK (state IN ('running','succeeded','unknown','provider_completed','provider_cancelled')),
 CONSTRAINT subscription_setup_dispatches_request_check CHECK (request_hash ~ '^[a-f0-9]{64}$'),
 CONSTRAINT subscription_setup_dispatches_resolution_check CHECK (state NOT IN ('provider_completed','provider_cancelled') OR coalesce((jsonb_typeof(resolution)='object' AND resolution->>'source'='human_provider_confirmation' AND length(resolution->>'providerOperationRef')>=8 AND length(resolution->>'providerEvidence')>=20 AND length(resolution->>'callerStopEvidence')>=20 AND resolution->>'originalRequestHash'=request_hash AND resolution->>'actor' LIKE 'user:%'),false)),
 CONSTRAINT subscription_setup_dispatches_completion_check CHECK ((state='running' AND finished_at IS NULL) OR (state<>'running' AND finished_at IS NOT NULL)),
 CONSTRAINT subscription_setup_dispatches_success_check CHECK (state NOT IN ('succeeded','provider_completed') OR (provider_customer_ref IS NOT NULL AND (kind='customer' OR provider_ref IS NOT NULL)))
);
--> statement-breakpoint
CREATE INDEX subscription_setup_dispatches_setup_idx ON subscription_setup_dispatches(setup_id,started_at,id);
--> statement-breakpoint
CREATE FUNCTION guard_subscription_setup_dispatch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.setup_id IS DISTINCT FROM OLD.setup_id
  OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.request_hash IS DISTINCT FROM OLD.request_hash
  OR NEW.customer_at_start IS DISTINCT FROM OLD.customer_at_start OR NEW.initiated_by IS DISTINCT FROM OLD.initiated_by
  OR NEW.started_at IS DISTINCT FROM OLD.started_at THEN
  RAISE EXCEPTION 'The original physical setup dispatch is immutable.' USING ERRCODE='23514';
 END IF;
 IF OLD.state IN ('succeeded','provider_completed','provider_cancelled') AND NEW IS DISTINCT FROM OLD THEN
  RAISE EXCEPTION 'A settled physical setup outcome is immutable.' USING ERRCODE='23514';
 END IF;
 IF OLD.state='unknown' AND NEW.state NOT IN ('unknown','provider_completed','provider_cancelled') THEN
  RAISE EXCEPTION 'An unknown outcome requires verified provider reconciliation.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER subscription_setup_dispatch_immutable BEFORE UPDATE ON subscription_setup_dispatches
 FOR EACH ROW EXECUTE FUNCTION guard_subscription_setup_dispatch();
--> statement-breakpoint
CREATE FUNCTION guard_unsettled_setup_erasure() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM subscription_setup_dispatches WHERE setup_id=OLD.id AND state IN ('running','unknown')) THEN
  RAISE EXCEPTION 'Every physical setup dispatch must settle before its private copies can be erased.' USING ERRCODE='23514';
 END IF;
 IF OLD.cleanup_completed_at IS NULL AND (OLD.provider_customer_ref IS NOT NULL OR EXISTS (SELECT 1 FROM subscription_setup_dispatches WHERE setup_id=OLD.id AND provider_customer_ref IS NOT NULL)) THEN
  RAISE EXCEPTION 'Actual original-account customer cleanup must finish before setup evidence is deleted.' USING ERRCODE='23514';
 END IF;
 RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER subscription_setup_unsettled_erasure BEFORE DELETE ON subscription_card_setups
 FOR EACH ROW EXECUTE FUNCTION guard_unsettled_setup_erasure();

--> statement-breakpoint
CREATE FUNCTION guard_pending_setup_privacy_completion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.kind='erasure' AND NEW.status IN ('completed','partially_completed')
  AND EXISTS (SELECT 1 FROM subscription_card_setups WHERE erasure_request_id=NEW.id) THEN
  RAISE EXCEPTION 'Original card-setup privacy work is still pending.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER subscription_setup_privacy_completion BEFORE UPDATE ON data_requests
 FOR EACH ROW EXECUTE FUNCTION guard_pending_setup_privacy_completion();

--> statement-breakpoint
CREATE FUNCTION guard_setup_merge_witness() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 -- A prior application image cannot omit this family's undo boundary. A
 -- current image supplies its exact fingerprint witness and keeps it intact.
 IF NOT (NEW.reference_state @> '[{"table":"subscription_card_setups"}]'::jsonb) THEN
  NEW.reference_state=NEW.reference_state || jsonb_build_array(jsonb_build_object('table','subscription_card_setups','before','[]'::jsonb,'after','[]'::jsonb));
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER subscription_setup_merge_witness BEFORE INSERT ON contact_merge_operations
 FOR EACH ROW EXECUTE FUNCTION guard_setup_merge_witness();

--> statement-breakpoint
-- Install the INSERT fence first: its DDL lock drains prior writers before
-- this backfill observes every still-active merge. No provider rows existed.
UPDATE contact_merge_operations
 SET reference_state=reference_state || jsonb_build_array(jsonb_build_object('table','subscription_card_setups','before','[]'::jsonb,'after','[]'::jsonb))
 WHERE undone_at IS NULL AND NOT (reference_state @> '[{"table":"subscription_card_setups"}]'::jsonb);
