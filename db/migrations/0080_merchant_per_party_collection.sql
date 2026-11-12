-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- freeholder:schema-breaking Per-party collection requires original merchant receipts and guarded payment writers. Stop and drain old payment writers before upgrade; rollback restores the exact pre-upgrade database and provider reconciliation state.
-- C12.26/C12.38: no existing invoice, subscription, account or provider money
-- is reinterpreted or backfilled. Reserved80 remains outside the journal.
ALTER TABLE invoice_market_policies ADD COLUMN collection_version integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE payment_provider_customers ADD COLUMN provider_platform_account_id text;
--> statement-breakpoint
ALTER TABLE payment_methods ADD COLUMN provider_platform_account_id text;
--> statement-breakpoint
ALTER TABLE payment_provider_customers ADD CONSTRAINT payment_provider_customers_platform_valid CHECK(provider_platform_account_id IS NULL OR provider_platform_account_id ~ '^acct_[A-Za-z0-9]+$');
--> statement-breakpoint
ALTER TABLE payment_methods ADD CONSTRAINT payment_methods_platform_valid CHECK(provider_platform_account_id IS NULL OR provider_platform_account_id ~ '^acct_[A-Za-z0-9]+$');
--> statement-breakpoint
DROP INDEX payment_provider_customers_ref_idx;
--> statement-breakpoint
CREATE UNIQUE INDEX payment_provider_customers_ref_idx ON payment_provider_customers(provider,coalesce(provider_platform_account_id,''),provider_account_id,provider_customer_ref);
--> statement-breakpoint
DROP INDEX payment_methods_provider_ref_idx;
--> statement-breakpoint
CREATE UNIQUE INDEX payment_methods_provider_ref_idx ON payment_methods(provider,coalesce(provider_platform_account_id,''),provider_account_id,provider_method_ref);
--> statement-breakpoint
DROP INDEX payment_methods_customer_ref_idx;
--> statement-breakpoint
CREATE INDEX payment_methods_customer_ref_idx ON payment_methods(provider,provider_platform_account_id,provider_account_id,provider_customer_ref);
--> statement-breakpoint
ALTER TABLE invoice_market_policies ADD CONSTRAINT invoice_market_policies_collection_version CHECK(collection_version IN(0,1));
--> statement-breakpoint
ALTER TABLE invoice_market_policies DROP CONSTRAINT invoice_market_policies_merchant_check;
--> statement-breakpoint
ALTER TABLE invoice_market_policies ADD CONSTRAINT invoice_market_policies_merchant_check CHECK(model<>'seller_merchant' OR (adapter='stripe_connect' AND (
 (collection_version=0 AND seller_user_id IS NOT NULL AND merchant_name IS NOT NULL AND provider_account_id IS NOT NULL)
 OR (collection_version=1 AND seller_user_id IS NULL AND merchant_name IS NULL AND merchant_support IS NULL AND merchant_contact_id IS NULL AND provider_account_id IS NULL)
)));
--> statement-breakpoint
CREATE TABLE merchant_collection_configuration (
 id integer PRIMARY KEY DEFAULT 1,
 collection_kind text NOT NULL, provider_platform_account_id text NOT NULL,
 verified_at timestamptz NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT merchant_collection_configuration_singleton CHECK(id=1),
 CONSTRAINT merchant_collection_configuration_kind CHECK(collection_kind IN('direct','destination')),
 CONSTRAINT merchant_collection_configuration_platform CHECK(provider_platform_account_id ~ '^acct_[A-Za-z0-9]+$')
);
--> statement-breakpoint
CREATE TABLE invoice_merchant_collections (
 allocation_id uuid PRIMARY KEY REFERENCES invoice_merchant_allocations(id) ON DELETE RESTRICT,
 invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
 collection_kind text NOT NULL, provider_platform_account_id text NOT NULL,
 charge_account_id text, recipient_account_id text, settlement_merchant_account_id text,
 merchant_name text NOT NULL, merchant_support jsonb, tax_policy jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT invoice_merchant_collections_kind CHECK(collection_kind IN('platform','direct','destination')),
 CONSTRAINT invoice_merchant_collections_platform CHECK(provider_platform_account_id ~ '^acct_[A-Za-z0-9]+$'),
 CONSTRAINT invoice_merchant_collections_accounts CHECK(
  (collection_kind='platform' AND charge_account_id IS NULL AND recipient_account_id IS NULL AND settlement_merchant_account_id IS NULL)
  OR (collection_kind='direct' AND charge_account_id IS NOT NULL AND recipient_account_id IS NOT NULL AND settlement_merchant_account_id IS NOT NULL
   AND charge_account_id ~ '^acct_[A-Za-z0-9]+$' AND charge_account_id<>provider_platform_account_id
   AND recipient_account_id=charge_account_id AND settlement_merchant_account_id=charge_account_id)
  OR (collection_kind='destination' AND charge_account_id IS NULL AND recipient_account_id IS NOT NULL AND settlement_merchant_account_id IS NOT NULL
   AND recipient_account_id ~ '^acct_[A-Za-z0-9]+$' AND recipient_account_id<>provider_platform_account_id AND settlement_merchant_account_id=recipient_account_id)
 ),
 CONSTRAINT invoice_merchant_collections_identity CHECK(char_length(merchant_name) BETWEEN 1 AND 200 AND (merchant_support IS NULL OR jsonb_typeof(merchant_support)='object')),
 CONSTRAINT invoice_merchant_collections_tax_policy CHECK((jsonb_typeof(tax_policy)='object' AND tax_policy ?& ARRAY['liability','profileId','profileVersion','evidenceDigest']
  AND tax_policy->>'liability' IN('platform','seller') AND tax_policy->>'profileId' IS NOT NULL AND (tax_policy->>'profileVersion')::integer>0 AND tax_policy->>'evidenceDigest' ~ '^[0-9a-f]{64}$') IS TRUE)
);
--> statement-breakpoint
CREATE INDEX invoice_merchant_collections_invoice_idx ON invoice_merchant_collections(invoice_id);
--> statement-breakpoint
CREATE TABLE merchant_payment_routes (
 payment_id uuid PRIMARY KEY REFERENCES payments(id) ON DELETE RESTRICT,
 allocation_id uuid NOT NULL REFERENCES invoice_merchant_collections(allocation_id) ON DELETE RESTRICT,
 application_fee_minor bigint NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT merchant_payment_routes_fee CHECK(application_fee_minor>=0)
);
--> statement-breakpoint
CREATE INDEX merchant_payment_routes_allocation_idx ON merchant_payment_routes(allocation_id);
--> statement-breakpoint
CREATE TABLE merchant_agreement_payment_routes (
 payment_id uuid PRIMARY KEY REFERENCES payments(id) ON DELETE RESTRICT,
 subscription_id uuid NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
 agreement_routing_version integer NOT NULL DEFAULT 1, collection_kind text NOT NULL,
 provider_platform_account_id text NOT NULL, charge_account_id text, recipient_account_id text NOT NULL, settlement_merchant_account_id text NOT NULL,
 application_fee_minor bigint NOT NULL, origin_kind text NOT NULL,
 provider_subscription_ref text, provider_invoice_ref text, provider_payment_intent_ref text, provider_charge_ref text, original_charge_receipt_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT merchant_agreement_payment_routes_version CHECK(agreement_routing_version=1),
 CONSTRAINT merchant_agreement_payment_routes_fee CHECK(application_fee_minor>=0),
 CONSTRAINT merchant_agreement_payment_routes_scope CHECK(provider_platform_account_id ~ '^acct_[A-Za-z0-9]+$' AND recipient_account_id ~ '^acct_[A-Za-z0-9]+$'
  AND recipient_account_id<>provider_platform_account_id AND settlement_merchant_account_id=recipient_account_id
  AND((collection_kind='direct' AND charge_account_id IS NOT NULL AND charge_account_id=recipient_account_id)OR(collection_kind='destination' AND charge_account_id IS NULL))),
 CONSTRAINT merchant_agreement_payment_routes_origin CHECK((origin_kind='attempt' AND provider_subscription_ref IS NULL AND provider_invoice_ref IS NULL AND provider_payment_intent_ref IS NULL AND provider_charge_ref IS NULL AND original_charge_receipt_id IS NULL)
  OR(origin_kind='provider_schedule' AND provider_subscription_ref IS NOT NULL AND provider_invoice_ref IS NOT NULL AND provider_payment_intent_ref IS NOT NULL AND provider_charge_ref IS NOT NULL AND original_charge_receipt_id IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX merchant_agreement_payment_routes_subscription_idx ON merchant_agreement_payment_routes(subscription_id);
--> statement-breakpoint
CREATE TABLE merchant_payment_observations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
 provider_event_ref text NOT NULL, provider_ref text NOT NULL, status text NOT NULL, amount_minor bigint NOT NULL,
 currency text NOT NULL, provider_platform_account_id text NOT NULL, charge_account_id text, recipient_account_id text, settlement_merchant_account_id text,
 application_fee_minor bigint, provider_charge_ref text, application_fee_ref text, transfer_ref text, route_verified boolean NOT NULL DEFAULT false, customer_charge_verified boolean NOT NULL DEFAULT false, application_fee_currency text, observed_application_fee_minor bigint, settlement_verified boolean NOT NULL DEFAULT false,
 observed_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT merchant_payment_observations_status CHECK(status IN('pending','succeeded','failed')),
 CONSTRAINT merchant_payment_observations_amount CHECK(amount_minor>=0 AND (application_fee_minor IS NULL OR application_fee_minor>=0)),
 CONSTRAINT merchant_payment_observations_currency CHECK(currency ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX merchant_payment_observations_event_idx ON merchant_payment_observations(payment_id,provider_event_ref);
--> statement-breakpoint
CREATE INDEX merchant_payment_observations_payment_idx ON merchant_payment_observations(payment_id,observed_at);
--> statement-breakpoint
CREATE TABLE merchant_payment_event_receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), provider_platform_account_id text NOT NULL,
 charge_account_id text, provider_event_ref text NOT NULL, claimed_payment_id uuid,
 evidence jsonb NOT NULL, received_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT merchant_payment_event_receipts_scope CHECK(provider_platform_account_id ~ '^acct_[A-Za-z0-9]+$' AND (charge_account_id IS NULL OR charge_account_id ~ '^acct_[A-Za-z0-9]+$')),
 CONSTRAINT merchant_payment_event_receipts_evidence CHECK(jsonb_typeof(evidence)='object')
);
--> statement-breakpoint
CREATE UNIQUE INDEX merchant_payment_event_receipts_event_idx ON merchant_payment_event_receipts(provider_platform_account_id,coalesce(charge_account_id,''),provider_event_ref);
--> statement-breakpoint
CREATE FUNCTION guard_merchant_payment_event_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Original authenticated merchant money evidence is immutable'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER merchant_payment_event_receipt_guard BEFORE UPDATE OR DELETE ON merchant_payment_event_receipts FOR EACH ROW EXECUTE FUNCTION guard_merchant_payment_event_receipt();
--> statement-breakpoint
CREATE TABLE merchant_fee_refunds (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), refund_id uuid NOT NULL REFERENCES refunds(id) ON DELETE RESTRICT,
 payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
 application_fee_ref text NOT NULL, provider_charge_ref text NOT NULL, amount_minor bigint NOT NULL,
 currency text NOT NULL, idempotency_key text NOT NULL, attempt_number integer NOT NULL DEFAULT 1, status text NOT NULL DEFAULT 'reserved', provider_ref text,
 dispatched_at timestamptz, accepted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT merchant_fee_refunds_amount CHECK(amount_minor>0),
 CONSTRAINT merchant_fee_refunds_attempt CHECK(attempt_number>0),
 CONSTRAINT merchant_fee_refunds_currency CHECK(currency ~ '^[A-Z]{3}$'),
 CONSTRAINT merchant_fee_refunds_status CHECK(status IN('reserved','dispatching','accepted','unknown','refused')),
 CONSTRAINT merchant_fee_refunds_accepted CHECK(status<>'accepted' OR(provider_ref IS NOT NULL AND accepted_at IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX merchant_fee_refunds_original_refund_idx ON merchant_fee_refunds(refund_id,attempt_number);
--> statement-breakpoint
CREATE UNIQUE INDEX merchant_fee_refunds_unresolved_idx ON merchant_fee_refunds(refund_id) WHERE status<>'refused';
--> statement-breakpoint
CREATE UNIQUE INDEX merchant_fee_refunds_key_idx ON merchant_fee_refunds(idempotency_key);
--> statement-breakpoint
CREATE UNIQUE INDEX merchant_fee_refunds_provider_ref_idx ON merchant_fee_refunds(provider_ref);
--> statement-breakpoint
CREATE FUNCTION guard_invoice_merchant_collection() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original invoice_merchant_allocations%ROWTYPE; parent invoices%ROWTYPE; policy invoice_market_policies%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Original merchant collection receipts are retained financial evidence.' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
  IF(to_jsonb(NEW)-ARRAY['merchant_name','merchant_support']) IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['merchant_name','merchant_support']) THEN
   RAISE EXCEPTION 'Original merchant collection accounts and tax receipts are immutable.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO original FROM invoice_merchant_allocations WHERE id=NEW.allocation_id;
 SELECT * INTO parent FROM invoices WHERE id=NEW.invoice_id FOR UPDATE;
 SELECT * INTO policy FROM invoice_market_policies WHERE invoice_id=NEW.invoice_id;
 IF original.id IS NULL OR original.invoice_id<>NEW.invoice_id OR parent.id IS NULL OR parent.status<>'draft'
  OR parent.source_type<>'order' OR policy.collection_version IS DISTINCT FROM 1 OR policy.model<>'seller_merchant'
  OR(NEW.collection_kind='platform') IS DISTINCT FROM(original.seller_user_id IS NULL)
  OR NEW.tax_policy->>'liability' IS DISTINCT FROM(CASE WHEN original.seller_user_id IS NULL THEN 'platform' ELSE 'seller' END)
  OR(original.seller_user_id IS NOT NULL AND original.merchant_contact_id IS NULL) OR NEW.merchant_support IS NULL
  OR NEW.merchant_name='[privacy-erased-merchant]' OR EXISTS(SELECT 1 FROM payments WHERE invoice_id=parent.id) THEN
  RAISE EXCEPTION 'Freeze each proven original merchant and tax receipt on its own draft invoice portion.' USING ERRCODE='23514';
 END IF;
 UPDATE contact_merge_operations m SET undoable=false,
  undo_blockers=array_append(m.undo_blockers,'Original merchant collection evidence was recorded after this merge; restore the pre-upgrade snapshot to separate it safely.')
 WHERE m.undone_at IS NULL AND m.undoable AND original.merchant_contact_id IN(m.duplicate_contact_id,m.surviving_contact_id)
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(m.reference_state) e WHERE e->>'table'='invoice_merchant_collections');
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER invoice_merchant_collection_guard BEFORE INSERT OR UPDATE OR DELETE ON invoice_merchant_collections
 FOR EACH ROW EXECUTE FUNCTION guard_invoice_merchant_collection();
--> statement-breakpoint
CREATE FUNCTION guard_invoice_merchant_collection_issue() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE policy invoice_market_policies%ROWTYPE;
BEGIN
 SELECT * INTO policy FROM invoice_market_policies WHERE invoice_id=NEW.id;
 IF NEW.status='draft' OR NEW.source_type<>'order' OR policy.invoice_id IS NULL THEN RETURN NEW; END IF;
 IF OLD.status='draft' AND policy.model='seller_merchant' AND policy.collection_version<>1 THEN
  RAISE EXCEPTION 'New seller order invoices require per-party merchant collection receipts.' USING ERRCODE='23514';
 END IF;
 IF policy.collection_version=1 AND(policy.model<>'seller_merchant' OR policy.allocation_version<>1
  OR NOT EXISTS(SELECT 1 FROM invoice_merchant_allocations WHERE invoice_id=NEW.id)
  OR EXISTS(SELECT 1 FROM invoice_merchant_allocations a WHERE a.invoice_id=NEW.id AND NOT EXISTS(SELECT 1 FROM invoice_merchant_collections c WHERE c.allocation_id=a.id AND c.invoice_id=NEW.id))) THEN
  RAISE EXCEPTION 'Complete every original merchant collection receipt before issuing this invoice.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER invoice_merchant_collection_issue BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION guard_invoice_merchant_collection_issue();
--> statement-breakpoint
CREATE FUNCTION guard_merchant_payment_route() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE payment payments%ROWTYPE; original invoice_merchant_collections%ROWTYPE; part invoice_merchant_allocations%ROWTYPE; paid bigint; prior_fee bigint;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Original per-party payment routing is immutable.' USING ERRCODE='23514'; END IF;
 SELECT * INTO original FROM invoice_merchant_collections WHERE allocation_id=NEW.allocation_id;
 SELECT * INTO part FROM invoice_merchant_allocations WHERE id=NEW.allocation_id;
 PERFORM 1 FROM invoices WHERE id=original.invoice_id FOR UPDATE;
 SELECT * INTO payment FROM payments WHERE id=NEW.payment_id;
 IF payment.id IS NULL OR original.allocation_id IS NULL OR payment.invoice_id<>original.invoice_id OR payment.provider<>'stripe'
  OR payment.status<>'created' OR payment.method NOT IN('hosted_checkout','saved_method')
  OR EXISTS(SELECT 1 FROM merchant_payment_observations o JOIN payments p ON p.id=o.payment_id WHERE p.invoice_id=payment.invoice_id AND o.status='succeeded' AND p.status<>'succeeded')
  OR NEW.application_fee_minor>payment.amount_minor OR EXISTS(SELECT 1 FROM payment_merchant_routes WHERE payment_id=NEW.payment_id)
  OR EXISTS(SELECT 1 FROM payments p WHERE p.invoice_id=payment.invoice_id AND p.id<>NEW.payment_id AND p.status IN('created','processing')) THEN
  RAISE EXCEPTION 'Reserve one original merchant payment before provider dispatch.' USING ERRCODE='23514';
 END IF;
 SELECT COALESCE(sum(p.amount_minor),0),COALESCE(sum(r.application_fee_minor),0) INTO paid,prior_fee
 FROM payments p JOIN merchant_payment_routes r ON r.payment_id=p.id WHERE r.allocation_id=NEW.allocation_id AND p.status='succeeded';
 IF part.total_minor=0 OR paid+payment.amount_minor>part.total_minor OR prior_fee<>floor(part.fee_minor::numeric*paid/part.total_minor)::bigint
  OR NEW.application_fee_minor<>floor(part.fee_minor::numeric*(paid+payment.amount_minor)/part.total_minor)::bigint-prior_fee THEN
  RAISE EXCEPTION 'The original merchant portion and cumulative application fee must conserve every cent.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER merchant_payment_route_guard BEFORE INSERT OR UPDATE OR DELETE ON merchant_payment_routes FOR EACH ROW EXECUTE FUNCTION guard_merchant_payment_route();
--> statement-breakpoint
CREATE FUNCTION guard_merchant_agreement_payment_route() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE payment payments%ROWTYPE; parent invoices%ROWTYPE; policy invoice_market_policies%ROWTYPE; original record; paid numeric; prior_fee numeric;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Original agreement payment routing is immutable.' USING ERRCODE='23514'; END IF;
 SELECT * INTO payment FROM payments WHERE id=NEW.payment_id;
 SELECT * INTO parent FROM invoices WHERE id=payment.invoice_id FOR UPDATE;
 SELECT * INTO policy FROM invoice_market_policies WHERE invoice_id=payment.invoice_id;
 SELECT scope.* INTO original FROM subscription_merchant_scopes scope JOIN subscriptions s ON s.id=scope.subscription_id
  WHERE scope.subscription_id=NEW.subscription_id AND s.merchant_scope_version=1;
 IF payment.id IS NULL OR parent.id IS NULL OR original.subscription_id IS NULL OR parent.source_type IS DISTINCT FROM 'subscription'
  OR split_part(parent.source_id,':',1) IS DISTINCT FROM NEW.subscription_id::text OR policy.invoice_id IS NULL OR policy.model IS DISTINCT FROM 'seller_merchant'
  OR payment.currency IS DISTINCT FROM parent.currency
  OR payment.provider<>'stripe' OR payment.status<>'created' OR payment.method NOT IN('hosted_checkout','saved_method','provider_schedule')
  OR NEW.collection_kind IS DISTINCT FROM original.collection_kind OR NEW.provider_platform_account_id IS DISTINCT FROM original.provider_platform_account_id
  OR NEW.charge_account_id IS DISTINCT FROM original.charge_account_id OR NEW.recipient_account_id IS DISTINCT FROM original.recipient_account_id
  OR NEW.settlement_merchant_account_id IS DISTINCT FROM original.settlement_merchant_account_id
  OR(NEW.origin_kind='provider_schedule') IS DISTINCT FROM(payment.method='provider_schedule')
  OR EXISTS(SELECT 1 FROM merchant_payment_observations o JOIN payments p ON p.id=o.payment_id WHERE p.invoice_id=payment.invoice_id AND o.status='succeeded' AND p.status<>'succeeded')
  OR NEW.application_fee_minor>payment.amount_minor
  OR EXISTS(SELECT 1 FROM payment_merchant_routes WHERE payment_id=NEW.payment_id)
  OR EXISTS(SELECT 1 FROM merchant_payment_routes WHERE payment_id=NEW.payment_id)
  OR EXISTS(SELECT 1 FROM payments p WHERE p.invoice_id=payment.invoice_id AND p.id<>payment.id AND p.status IN('created','processing')) THEN
  RAISE EXCEPTION 'Bind each new agreement payment to its immutable original merchant namespace.' USING ERRCODE='23514';
 END IF;
 SELECT COALESCE(sum(p.amount_minor),0),COALESCE(sum(r.application_fee_minor),0) INTO paid,prior_fee
 FROM payments p JOIN merchant_agreement_payment_routes r ON r.payment_id=p.id WHERE p.invoice_id=payment.invoice_id AND p.status='succeeded';
 IF parent.total_minor=0 OR paid<>parent.paid_minor OR paid+payment.amount_minor>parent.total_minor
  OR prior_fee<>floor(policy.fee_minor::numeric*paid/parent.total_minor)
  OR NEW.application_fee_minor<>floor(policy.fee_minor::numeric*(paid+payment.amount_minor)/parent.total_minor)-prior_fee THEN
  RAISE EXCEPTION 'The original agreement payment and application fee must conserve every invoice cent.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER merchant_agreement_payment_route_guard BEFORE INSERT OR UPDATE OR DELETE ON merchant_agreement_payment_routes FOR EACH ROW EXECUTE FUNCTION guard_merchant_agreement_payment_route();
--> statement-breakpoint
CREATE FUNCTION guard_merchant_payment_observation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Original physical payment observations are append-only.' USING ERRCODE='23514'; END IF;
 PERFORM 1 FROM invoices i JOIN payments p ON p.invoice_id=i.id WHERE p.id=NEW.payment_id FOR UPDATE OF i;
 IF NOT EXISTS(SELECT 1 FROM merchant_payment_routes WHERE payment_id=NEW.payment_id)
  AND NOT EXISTS(SELECT 1 FROM merchant_agreement_payment_routes WHERE payment_id=NEW.payment_id) THEN
  RAISE EXCEPTION 'Bind this original provider observation to its frozen merchant payment route.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER merchant_payment_observation_guard BEFORE INSERT OR UPDATE OR DELETE ON merchant_payment_observations FOR EACH ROW EXECUTE FUNCTION guard_merchant_payment_observation();
--> statement-breakpoint
CREATE FUNCTION guard_merchant_payment_binding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_payment payments%ROWTYPE; policy invoice_market_policies%ROWTYPE; new_agreement boolean;
BEGIN
 SELECT * INTO current_payment FROM payments WHERE id=NEW.id;
 SELECT * INTO policy FROM invoice_market_policies WHERE invoice_id=current_payment.invoice_id;
 SELECT EXISTS(SELECT 1 FROM invoices i JOIN subscriptions s ON s.id::text=split_part(i.source_id,':',1)
  WHERE i.id=current_payment.invoice_id AND i.source_type='subscription' AND s.merchant_scope_version=1 AND policy.model='seller_merchant') INTO new_agreement;
 IF policy.collection_version IS DISTINCT FROM 1 AND NOT new_agreement THEN RETURN NEW; END IF;
 IF(policy.collection_version=1 AND(NOT EXISTS(SELECT 1 FROM merchant_payment_routes WHERE payment_id=current_payment.id) OR EXISTS(SELECT 1 FROM merchant_agreement_payment_routes WHERE payment_id=current_payment.id)))
  OR(new_agreement AND(NOT EXISTS(SELECT 1 FROM merchant_agreement_payment_routes WHERE payment_id=current_payment.id) OR EXISTS(SELECT 1 FROM merchant_payment_routes WHERE payment_id=current_payment.id)))
  OR EXISTS(SELECT 1 FROM payment_merchant_routes WHERE payment_id=current_payment.id) THEN
  RAISE EXCEPTION 'This payment requires its original per-party route before commit.' USING ERRCODE='23514';
 END IF;
 IF current_payment.status='succeeded' AND NOT EXISTS(SELECT 1 FROM merchant_payment_observations o WHERE o.payment_id=current_payment.id
  AND o.status='succeeded' AND o.customer_charge_verified AND o.provider_ref=current_payment.provider_ref AND o.amount_minor=current_payment.amount_minor AND o.currency=current_payment.currency) THEN
  RAISE EXCEPTION 'Retain the positive original provider observation before applying paid money.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER merchant_payment_binding_guard AFTER INSERT OR UPDATE ON payments DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION guard_merchant_payment_binding();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_merchant_document_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='invoice_market_policies' AND to_jsonb(NEW)->>'collection_version'='1' THEN RETURN NEW; END IF;
 IF NEW.model='seller_merchant' AND NEW.merchant_contact_id IS NULL AND NEW.merchant_name IS DISTINCT FROM '[privacy-erased-merchant]' THEN
  RAISE EXCEPTION 'A new merchant document requires its original contact owner.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION guard_merchant_collection_merge() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM invoice_merchant_collections c JOIN invoice_merchant_allocations a ON a.id=c.allocation_id
  WHERE a.merchant_contact_id IN(NEW.duplicate_contact_id,NEW.surviving_contact_id))
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.reference_state) e WHERE e->>'table'='invoice_merchant_collections') THEN
  RAISE EXCEPTION 'This contact merge requires its original merchant collection witness.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER merchant_collection_merge_guard BEFORE INSERT ON contact_merge_operations FOR EACH ROW EXECUTE FUNCTION guard_merchant_collection_merge();
--> statement-breakpoint
CREATE FUNCTION guard_merchant_collection_undo() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.undone_at IS NULL AND NEW.undone_at IS NOT NULL
  AND EXISTS(SELECT 1 FROM invoice_merchant_collections c JOIN invoice_merchant_allocations a ON a.id=c.allocation_id WHERE a.merchant_contact_id IN(OLD.duplicate_contact_id,OLD.surviving_contact_id))
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(OLD.reference_state) e WHERE e->>'table'='invoice_merchant_collections') THEN
  RAISE EXCEPTION 'This historical merge has no original merchant collection witness.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER merchant_collection_undo_guard BEFORE UPDATE OF undone_at ON contact_merge_operations FOR EACH ROW EXECUTE FUNCTION guard_merchant_collection_undo();
--> statement-breakpoint
CREATE FUNCTION guard_merchant_payment_state() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status IN('failed','cancelled') AND EXISTS(SELECT 1 FROM merchant_payment_observations o WHERE o.payment_id=OLD.id AND o.status='succeeded') THEN
  RAISE EXCEPTION 'An observed positive merchant charge must be reconciled rather than marked unpaid.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER merchant_payment_state_guard BEFORE UPDATE OF status ON payments FOR EACH ROW EXECUTE FUNCTION guard_merchant_payment_state();
--> statement-breakpoint
CREATE FUNCTION guard_merchant_fee_refund() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original refunds%ROWTYPE; original_fee bigint; prior merchant_fee_refunds%ROWTYPE; reserved numeric;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Original commission refund operations are retained financial evidence.' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
  IF(to_jsonb(NEW)-ARRAY['status','provider_ref','dispatched_at','accepted_at','updated_at']) IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['status','provider_ref','dispatched_at','accepted_at','updated_at'])
   OR(OLD.provider_ref IS NOT NULL AND NEW.provider_ref IS DISTINCT FROM OLD.provider_ref)
   OR(OLD.dispatched_at IS NOT NULL AND NEW.dispatched_at IS DISTINCT FROM OLD.dispatched_at)
   OR(OLD.accepted_at IS NOT NULL AND NEW.accepted_at IS DISTINCT FROM OLD.accepted_at)
   OR(OLD.status IN('accepted','refused') AND NEW.status IS DISTINCT FROM OLD.status)
   OR(OLD.status='unknown' AND NEW.status NOT IN('unknown','accepted'))
   OR(OLD.status='dispatching' AND NEW.status='reserved') THEN
   RAISE EXCEPTION 'Original commission money, positive acknowledgements and unknown outcomes are immutable.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO original FROM refunds WHERE id=NEW.refund_id;
 PERFORM 1 FROM payments WHERE id=NEW.payment_id FOR UPDATE;
 SELECT application_fee_minor INTO original_fee FROM(SELECT application_fee_minor FROM merchant_payment_routes WHERE payment_id=NEW.payment_id
  UNION ALL SELECT application_fee_minor FROM merchant_agreement_payment_routes WHERE payment_id=NEW.payment_id) original_route LIMIT 1;
 SELECT * INTO prior FROM merchant_fee_refunds WHERE refund_id=NEW.refund_id ORDER BY attempt_number DESC LIMIT 1;
 SELECT COALESCE(sum(amount_minor),0) INTO reserved FROM merchant_fee_refunds WHERE payment_id=NEW.payment_id AND status<>'refused';
 IF original.id IS NULL OR original.payment_id<>NEW.payment_id OR original.status<>'succeeded' OR original_fee IS NULL
  OR NEW.status<>'reserved' OR NEW.provider_ref IS NOT NULL OR NEW.dispatched_at IS NOT NULL OR NEW.accepted_at IS NOT NULL
  OR NEW.currency<>original.currency OR reserved+NEW.amount_minor>original_fee
  OR NEW.attempt_number<>COALESCE(prior.attempt_number,0)+1
  OR(prior.id IS NOT NULL AND(prior.status<>'refused' OR prior.amount_minor<>NEW.amount_minor OR prior.application_fee_ref<>NEW.application_fee_ref OR prior.provider_charge_ref<>NEW.provider_charge_ref)) THEN
  RAISE EXCEPTION 'Reserve exact original commission only after the independent customer refund succeeds.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER merchant_fee_refund_guard BEFORE INSERT OR UPDATE OR DELETE ON merchant_fee_refunds FOR EACH ROW EXECUTE FUNCTION guard_merchant_fee_refund();
--> statement-breakpoint
CREATE FUNCTION guard_original_provider_resource_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.provider IS DISTINCT FROM OLD.provider
  OR NEW.provider_account_id IS DISTINCT FROM OLD.provider_account_id
  OR NEW.provider_platform_account_id IS DISTINCT FROM OLD.provider_platform_account_id
  OR(TG_TABLE_NAME='payment_provider_customers' AND to_jsonb(NEW)->>'provider_customer_ref' IS DISTINCT FROM to_jsonb(OLD)->>'provider_customer_ref')
  OR(TG_TABLE_NAME='payment_methods' AND to_jsonb(NEW)->>'provider_method_ref' IS DISTINCT FROM to_jsonb(OLD)->>'provider_method_ref') THEN
  RAISE EXCEPTION 'The original provider resource and platform namespace are immutable; no historical ownership is inferred.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER payment_provider_customer_scope_guard BEFORE UPDATE ON payment_provider_customers FOR EACH ROW EXECUTE FUNCTION guard_original_provider_resource_scope();
--> statement-breakpoint
CREATE TRIGGER payment_method_scope_guard BEFORE UPDATE ON payment_methods FOR EACH ROW EXECUTE FUNCTION guard_original_provider_resource_scope();
