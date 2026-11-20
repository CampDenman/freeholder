-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C12.38: unpublished80 fragment, after original scope/lifecycle and tax tables.
-- No existing agreement or payment receives inferred terms or profile versions.
CREATE TABLE subscription_commercial_terms (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 subscription_id uuid NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
 revision integer NOT NULL, previous_terms_id uuid,
 snapshot jsonb NOT NULL,
 profile_id uuid NOT NULL REFERENCES merchant_tax_profiles(id) ON DELETE RESTRICT,
 profile_version integer NOT NULL, tax_liability text NOT NULL, tax_destination jsonb,
 accepted_quote_digest text NOT NULL, initial_tax_quote jsonb NOT NULL, first_period_tax_quote jsonb NOT NULL, renewal_tax_quote jsonb NOT NULL,
 notice_digest text NOT NULL, notice_snapshot jsonb NOT NULL,
 quote_occurred_at timestamptz NOT NULL, effective_period_start timestamptz NOT NULL, accepted_at timestamptz NOT NULL,
 acceptance_source text NOT NULL, redacted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT subscription_commercial_terms_profile_version_fk FOREIGN KEY(profile_id,profile_version) REFERENCES merchant_tax_profile_versions(profile_id,version) ON DELETE RESTRICT,
 CONSTRAINT subscription_commercial_terms_previous_fk FOREIGN KEY(previous_terms_id) REFERENCES subscription_commercial_terms(id) ON DELETE RESTRICT,
 CONSTRAINT subscription_commercial_terms_revision_check CHECK(revision>0 AND((revision=1 AND previous_terms_id IS NULL)OR(revision>1 AND previous_terms_id IS NOT NULL))),
 CONSTRAINT subscription_commercial_terms_acceptance CHECK(acceptance_source IN('public_join','owner_subscription','amendment')AND accepted_quote_digest ~ '^[a-f0-9]{64}$' AND notice_digest ~ '^[a-f0-9]{64}$'),
 CONSTRAINT subscription_commercial_terms_tax CHECK((profile_version>0 AND tax_liability IN('platform','seller') AND((tax_destination IS NULL AND redacted_at IS NOT NULL)OR(tax_destination IS NOT NULL AND redacted_at IS NULL AND jsonb_typeof(tax_destination)='object' AND(tax_destination->>'country') ~ '^[A-Z]{2}$')))IS TRUE)
);
--> statement-breakpoint
CREATE UNIQUE INDEX subscription_commercial_terms_revision ON subscription_commercial_terms(subscription_id,revision);
--> statement-breakpoint
CREATE INDEX subscription_commercial_terms_profile ON subscription_commercial_terms(profile_id);
--> statement-breakpoint
CREATE FUNCTION freeholder_subscription_commercial_terms() RETURNS trigger LANGUAGE plpgsql AS $$
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
   OR NOT((resource.state='uncreated' AND resource.operation_revision=0 AND resource.provider_subscription_ref IS NULL)
    OR(resource.state='quiesced' AND resource.stopped_proof IS NOT NULL AND NOT resource.recovery_pending))
   OR EXISTS(SELECT 1 FROM subscription_provider_schedule_operations o WHERE o.subscription_id=NEW.subscription_id AND o.state IN('running','unknown')) THEN
   RAISE EXCEPTION 'An amendment needs its previous original acceptance and resolved provider work' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER subscription_commercial_terms_facts BEFORE INSERT OR UPDATE OR DELETE ON subscription_commercial_terms FOR EACH ROW EXECUTE FUNCTION freeholder_subscription_commercial_terms();
