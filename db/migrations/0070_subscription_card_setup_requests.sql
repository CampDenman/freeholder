-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- freeholder:schema-breaking New zero-fee card trials require exact setup proof; old images cannot start them from an unrelated fresh card. Restore the pre-upgrade database and objects for full rollback.
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
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT subscription_card_setups_closure_check CHECK ((closed_at IS NULL AND closed_reason IS NULL) OR (closed_at IS NOT NULL AND confirmed_at IS NULL AND closed_reason='expired' AND provider_checkout_ref IS NOT NULL AND provider_customer_ref IS NOT NULL)),
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
 IF OLD.confirmed_at IS NOT NULL AND NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at THEN
  RAISE EXCEPTION 'The original verified setup time is immutable.' USING ERRCODE='23514';
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
  AND EXISTS (SELECT 1 FROM subscription_card_setups WHERE subscription_id=NEW.id)
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
