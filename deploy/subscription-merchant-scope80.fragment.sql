-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C12.38: fragment for commerce-owned0080; do not apply before full composition.
-- Existing0 is an explicit legacy epoch, not reconstructed routing evidence.
ALTER TABLE subscriptions ADD COLUMN merchant_scope_version integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE subscriptions ALTER COLUMN merchant_scope_version SET DEFAULT 1;
--> statement-breakpoint
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_merchant_scope_version CHECK(merchant_scope_version IN(0,1));
--> statement-breakpoint
ALTER TABLE subscription_card_setups ADD COLUMN provider_platform_account_id text;
--> statement-breakpoint
ALTER TABLE subscription_card_setups ADD CONSTRAINT subscription_card_setups_original_platform CHECK(provider_platform_account_id IS NULL OR provider_platform_account_id ~ '^acct_[A-Za-z0-9]+$');
--> statement-breakpoint
CREATE TABLE subscription_merchant_scopes (
 subscription_id uuid PRIMARY KEY REFERENCES subscriptions(id) ON DELETE RESTRICT,
 agreement_routing_version integer NOT NULL DEFAULT 1,
 collection_kind text NOT NULL, provider_platform_account_id text NOT NULL,
 charge_account_id text, recipient_account_id text NOT NULL, settlement_merchant_account_id text NOT NULL,
 tax_profile_id uuid NOT NULL REFERENCES merchant_tax_profiles(id) ON DELETE RESTRICT, tax_profile_version integer NOT NULL, tax_liability text NOT NULL,
 tax_destination jsonb, redacted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT subscription_merchant_scopes_version CHECK(agreement_routing_version=1),
 CONSTRAINT subscription_merchant_scopes_tax_version_fk FOREIGN KEY(tax_profile_id,tax_profile_version) REFERENCES merchant_tax_profile_versions(profile_id,version) ON DELETE RESTRICT,
 CONSTRAINT subscription_merchant_scopes_accounts CHECK(provider_platform_account_id ~ '^acct_[A-Za-z0-9]+$' AND recipient_account_id ~ '^acct_[A-Za-z0-9]+$'
  AND recipient_account_id<>provider_platform_account_id AND settlement_merchant_account_id=recipient_account_id
  AND ((collection_kind='direct' AND charge_account_id IS NOT NULL AND charge_account_id=recipient_account_id) OR (collection_kind='destination' AND charge_account_id IS NULL))),
 CONSTRAINT subscription_merchant_scopes_tax CHECK((tax_profile_version>0 AND tax_liability IN('platform','seller')
  AND ((tax_destination IS NULL AND redacted_at IS NOT NULL) OR (tax_destination IS NOT NULL AND redacted_at IS NULL AND jsonb_typeof(tax_destination)='object' AND (tax_destination->>'country') ~ '^[A-Z]{2}$'))) IS TRUE)
);
--> statement-breakpoint
CREATE FUNCTION freeholder_subscription_scope_receipts() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='subscriptions' THEN
  IF TG_OP='UPDATE' AND NEW.merchant_scope_version IS DISTINCT FROM OLD.merchant_scope_version THEN RAISE EXCEPTION 'The original agreement epoch cannot change' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF TG_TABLE_NAME='subscription_card_setups' THEN
  IF TG_OP='UPDATE' AND NEW.provider_platform_account_id IS DISTINCT FROM OLD.provider_platform_account_id THEN RAISE EXCEPTION 'The original setup platform cannot be reassigned or backfilled' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Original agreement scope receipts cannot be deleted' USING ERRCODE='23514'; END IF;
 IF current_setting('freeholder.subscription_scope_v1',true) IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'Agreement scope requires its current guarded writer' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NOT EXISTS(SELECT 1 FROM subscriptions WHERE id=NEW.subscription_id AND merchant_scope_version=1) THEN RAISE EXCEPTION 'A legacy agreement cannot acquire invented new routing evidence' USING ERRCODE='23514'; END IF;
 ELSE
  IF (to_jsonb(NEW)-'tax_destination'-'redacted_at') IS DISTINCT FROM (to_jsonb(OLD)-'tax_destination'-'redacted_at') OR OLD.redacted_at IS NOT NULL OR NEW.tax_destination IS NOT NULL OR NEW.redacted_at IS NULL THEN
   RAISE EXCEPTION 'Original agreement facts permit only guarded personal-destination minimization' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER subscriptions_original_scope_epoch BEFORE UPDATE ON subscriptions FOR EACH ROW EXECUTE FUNCTION freeholder_subscription_scope_receipts();
--> statement-breakpoint
CREATE TRIGGER subscription_setups_original_platform BEFORE UPDATE ON subscription_card_setups FOR EACH ROW EXECUTE FUNCTION freeholder_subscription_scope_receipts();
--> statement-breakpoint
CREATE TRIGGER subscription_original_merchant_scope BEFORE INSERT OR UPDATE OR DELETE ON subscription_merchant_scopes FOR EACH ROW EXECUTE FUNCTION freeholder_subscription_scope_receipts();
--> statement-breakpoint
CREATE TABLE subscription_provider_charge_receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 subscription_id uuid NOT NULL REFERENCES subscription_merchant_scopes(subscription_id) ON DELETE RESTRICT,
 provider_platform_account_id text NOT NULL, charge_account_id text,
 provider_subscription_ref text NOT NULL, provider_invoice_ref text NOT NULL,
 provider_payment_intent_ref text NOT NULL, provider_charge_ref text NOT NULL,
 amount_minor bigint NOT NULL, currency text NOT NULL, application_fee_ref text,
 observed_application_fee_minor bigint, observed_application_fee_currency text,
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT subscription_provider_charge_receipts_money CHECK(amount_minor BETWEEN 1 AND 9007199254740991 AND currency ~ '^[A-Z]{3}$'
  AND (observed_application_fee_minor IS NULL OR observed_application_fee_minor BETWEEN 0 AND 9007199254740991)
  AND (observed_application_fee_currency IS NULL OR observed_application_fee_currency ~ '^[A-Z]{3}$'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX subscription_provider_charge_receipts_intent ON subscription_provider_charge_receipts(provider_platform_account_id,coalesce(charge_account_id,''),provider_payment_intent_ref);
--> statement-breakpoint
CREATE INDEX subscription_provider_charge_receipts_agreement ON subscription_provider_charge_receipts(subscription_id);
--> statement-breakpoint
CREATE FUNCTION freeholder_subscription_charge_receipts() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Observed original subscription money cannot be deleted' USING ERRCODE='23514'; END IF;
 IF current_setting('freeholder.subscription_scope_v1',true) IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'Subscription money requires its authenticated current writer' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-'application_fee_ref'-'observed_application_fee_minor'-'observed_application_fee_currency') IS DISTINCT FROM (to_jsonb(OLD)-'application_fee_ref'-'observed_application_fee_minor'-'observed_application_fee_currency')
   OR OLD.application_fee_ref IS NOT NULL AND NEW.application_fee_ref IS DISTINCT FROM OLD.application_fee_ref
   OR OLD.observed_application_fee_minor IS NOT NULL AND NEW.observed_application_fee_minor IS DISTINCT FROM OLD.observed_application_fee_minor
   OR OLD.observed_application_fee_currency IS NOT NULL AND NEW.observed_application_fee_currency IS DISTINCT FROM OLD.observed_application_fee_currency THEN
   RAISE EXCEPTION 'Original subscription money is immutable; only missing authenticated fee facts may be completed' USING ERRCODE='23514';
  END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM subscription_merchant_scopes scope WHERE scope.subscription_id=NEW.subscription_id
  AND scope.provider_platform_account_id=NEW.provider_platform_account_id AND scope.charge_account_id IS NOT DISTINCT FROM NEW.charge_account_id) THEN
  RAISE EXCEPTION 'Observed subscription money must retain its original agreement charge namespace' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER subscription_original_charge_receipt BEFORE INSERT OR UPDATE OR DELETE ON subscription_provider_charge_receipts FOR EACH ROW EXECUTE FUNCTION freeholder_subscription_charge_receipts();

--> statement-breakpoint
DROP INDEX subscription_card_setups_checkout_idx;
--> statement-breakpoint
CREATE UNIQUE INDEX subscription_card_setups_checkout_idx ON subscription_card_setups(provider,coalesce(provider_platform_account_id,''),provider_account_id,provider_checkout_ref);

--> statement-breakpoint
CREATE FUNCTION freeholder_subscription_scope_merge_fence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='subscription_merchant_scopes' THEN
  UPDATE contact_merge_operations m SET undoable=false,
   undo_blockers=array_append(m.undo_blockers,'Original subscription scope was introduced after this historical merge; restore the pre-upgrade snapshot to separate it safely.')
  WHERE m.undone_at IS NULL AND m.undoable
   AND EXISTS(SELECT 1 FROM subscriptions s WHERE s.id=NEW.subscription_id AND s.contact_id=m.surviving_contact_id)
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(m.reference_state) e WHERE e->>'table'='subscriptions' AND jsonb_typeof(e->'before')='array');
  RETURN NEW;
 END IF;
 IF TG_OP='INSERT' THEN
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.reference_state) e WHERE e->>'table'='subscriptions' AND jsonb_typeof(e->'before')='array')
   AND EXISTS(SELECT 1 FROM subscription_merchant_scopes scope JOIN subscriptions s ON s.id=scope.subscription_id WHERE s.contact_id IN(NEW.surviving_contact_id,NEW.duplicate_contact_id)) THEN
   NEW.undoable=false;
   NEW.undo_blockers=array_append(NEW.undo_blockers,'Original subscription evidence was not captured by this merge; ownership cannot be split safely.');
  END IF;
  RETURN NEW;
 END IF;
 IF NEW.undone_at IS NOT NULL AND OLD.undone_at IS NULL
  AND EXISTS(SELECT 1 FROM jsonb_array_elements(OLD.reference_state) e WHERE e->>'table'='subscriptions' AND jsonb_typeof(e->'before')='array')
  AND EXISTS(SELECT 1 FROM subscription_merchant_scopes scope JOIN subscriptions s ON s.id=scope.subscription_id WHERE s.contact_id IN(OLD.surviving_contact_id,OLD.duplicate_contact_id)) THEN
  RAISE EXCEPTION 'Historical merge omitted original subscription evidence; ownership cannot be split safely' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER subscription_scope_legacy_merge_capture AFTER INSERT ON subscription_merchant_scopes FOR EACH ROW EXECUTE FUNCTION freeholder_subscription_scope_merge_fence();
--> statement-breakpoint
CREATE TRIGGER subscription_scope_legacy_merge_undo BEFORE UPDATE OF undone_at ON contact_merge_operations FOR EACH ROW EXECUTE FUNCTION freeholder_subscription_scope_merge_fence();

--> statement-breakpoint
CREATE TRIGGER subscription_scope_legacy_merge_admission BEFORE INSERT ON contact_merge_operations FOR EACH ROW EXECUTE FUNCTION freeholder_subscription_scope_merge_fence();
