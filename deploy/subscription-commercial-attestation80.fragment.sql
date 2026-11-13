-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C12.38/C9.33: OWNED UNAPPLIED attested-money tail AFTER1da78852ed7ba94a2e77596fe8b41bebc3ce3c174d79dacc7a60c933a98b4d46.
-- Must precede the new proration-credit tail. Root owns assembly/hash/new DB.
-- Recorded external money is not independently verified provider settlement.
CREATE TABLE commercial_payment_attestations (
 payment_id uuid PRIMARY KEY REFERENCES payments(id) ON DELETE RESTRICT,
 invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
 merchant_profile_id uuid NOT NULL REFERENCES merchant_tax_profiles(id) ON DELETE RESTRICT,
 profile_version integer NOT NULL,currency text NOT NULL,amount_minor bigint NOT NULL,fee_owed_minor bigint NOT NULL,
 original_owner_digest text NOT NULL,evidence_digest text NOT NULL,reference_digest text NOT NULL,recorded_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT commercial_payment_attestations_amounts CHECK(amount_minor between 1 and 9007199254740991 AND fee_owed_minor between 0 and amount_minor AND currency ~ '^[A-Z]{3}$' AND profile_version>0),
 CONSTRAINT commercial_payment_attestations_evidence CHECK(original_owner_digest ~ '^[a-f0-9]{64}$' AND evidence_digest ~ '^[a-f0-9]{64}$' AND reference_digest ~ '^[a-f0-9]{64}$' AND recorded_by ~ '^(user:|agent:|plugin:|system$)'),
 CONSTRAINT commercial_payment_attestations_version FOREIGN KEY(merchant_profile_id,profile_version) REFERENCES merchant_tax_profile_versions(profile_id,version) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX commercial_payment_attestations_invoice ON commercial_payment_attestations(invoice_id);
--> statement-breakpoint
CREATE INDEX commercial_payment_attestations_merchant ON commercial_payment_attestations(merchant_profile_id);
--> statement-breakpoint
CREATE TABLE commercial_refund_attestations (
 refund_id uuid PRIMARY KEY REFERENCES refunds(id) ON DELETE RESTRICT,payment_id uuid NOT NULL REFERENCES commercial_payment_attestations(payment_id) ON DELETE RESTRICT,
 amount_minor bigint NOT NULL,currency text NOT NULL,evidence_digest text NOT NULL,recorded_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT commercial_refund_attestations_evidence CHECK(amount_minor between 1 and 9007199254740991 AND currency ~ '^[A-Z]{3}$' AND evidence_digest ~ '^[a-f0-9]{64}$' AND recorded_by ~ '^(user:|agent:|plugin:|system$)')
);
--> statement-breakpoint
CREATE INDEX commercial_refund_attestations_payment ON commercial_refund_attestations(payment_id);
--> statement-breakpoint
CREATE TABLE commercial_fee_attestations (
 id uuid PRIMARY KEY,payment_id uuid NOT NULL REFERENCES commercial_payment_attestations(payment_id) ON DELETE RESTRICT,
 amount_minor bigint NOT NULL,direction text NOT NULL,original_remittance_id uuid REFERENCES commercial_fee_attestations(id) ON DELETE RESTRICT,
 idempotency_key text NOT NULL,evidence_digest text NOT NULL,request_digest text NOT NULL,recorded_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT commercial_fee_attestations_evidence CHECK(amount_minor between 1 and 9007199254740991 AND evidence_digest ~ '^[a-f0-9]{64}$' AND request_digest ~ '^[a-f0-9]{64}$' AND recorded_by ~ '^(user:|agent:|plugin:|system$)'),
 CONSTRAINT commercial_fee_attestations_direction CHECK((direction='remitted' AND original_remittance_id IS NULL) OR(direction='returned' AND original_remittance_id IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX commercial_fee_attestations_payment ON commercial_fee_attestations(payment_id);
--> statement-breakpoint
CREATE INDEX commercial_fee_attestations_original ON commercial_fee_attestations(original_remittance_id);
--> statement-breakpoint
CREATE UNIQUE INDEX commercial_fee_attestations_key ON commercial_fee_attestations(idempotency_key);
--> statement-breakpoint
CREATE FUNCTION guard_commercial_attestation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p payments%ROWTYPE;i invoices%ROWTYPE;policy invoice_market_policies%ROWTYPE;r refunds%ROWTYPE;party invoice_merchant_tax_quotes%ROWTYPE;original commercial_payment_attestations%ROWTYPE;
 previous_cash numeric;previous_fee numeric;actual_fee numeric;scopes integer;
BEGIN
 IF TG_OP<>'INSERT' OR current_setting('freeholder.commercial_attestation_v1',true) IS DISTINCT FROM '1' THEN
  RAISE EXCEPTION 'Preserve the first recorded commercial money evidence and use its authorized shared action' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('payment:'||NEW.payment_id::text));
 SELECT * INTO p FROM payments WHERE id=NEW.payment_id FOR UPDATE;
 PERFORM pg_advisory_xact_lock(hashtext('invoice:'||p.invoice_id::text));
 SELECT * INTO i FROM invoices WHERE id=p.invoice_id;
 SELECT * INTO policy FROM invoice_market_policies WHERE invoice_id=i.id;
 IF p.id IS NULL OR p.provider<>'manual' OR policy.model IS DISTINCT FROM 'seller_merchant' OR policy.collection_version<>0 OR i.source_type<>'subscription' OR i.issued_at IS NULL THEN
  RAISE EXCEPTION 'An external commercial attestation must name its real original manual subscription payment and merchant invoice' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='commercial_payment_attestations' THEN
  SELECT count(*) INTO scopes FROM invoice_merchant_tax_quotes WHERE invoice_id=i.id;
  SELECT * INTO party FROM invoice_merchant_tax_quotes WHERE invoice_id=i.id;
  IF scopes<>1 OR party.seller_user_id IS DISTINCT FROM policy.seller_user_id OR party.profile_id<>NEW.merchant_profile_id OR party.profile_version<>NEW.profile_version
   OR NEW.invoice_id<>i.id OR NEW.currency<>i.currency OR NEW.currency<>p.currency OR NEW.amount_minor<>p.amount_minor OR p.status<>'created' OR p.provider_ref IS NOT NULL
   OR p.method NOT IN('cash','bank_transfer','cheque','external_card','other')
   OR EXISTS(SELECT 1 FROM merchant_agreement_payment_routes WHERE payment_id=p.id) OR EXISTS(SELECT 1 FROM merchant_payment_routes WHERE payment_id=p.id)
   OR EXISTS(SELECT 1 FROM merchant_invoice_payment_routes WHERE payment_id=p.id) OR EXISTS(SELECT 1 FROM payment_merchant_routes WHERE payment_id=p.id)
   OR EXISTS(SELECT 1 FROM payments other WHERE other.invoice_id=i.id AND other.id<>p.id AND other.status IN('created','processing'))
   OR EXISTS(SELECT 1 FROM merchant_payment_observations o JOIN payments old ON old.id=o.payment_id WHERE old.invoice_id=i.id AND o.status='succeeded'
    AND(old.status<>'succeeded' OR o.amount_minor<>old.amount_minor OR o.currency<>old.currency OR(o.provider_ref IS DISTINCT FROM old.provider_ref AND o.provider_ref IS DISTINCT FROM old.provider_checkout_ref)))
   OR EXISTS(SELECT 1 FROM merchant_payment_dispatches d JOIN payments old ON old.id=d.payment_id
      WHERE old.invoice_id=i.id AND NOT EXISTS(SELECT 1 FROM merchant_payment_dispatch_finishes f WHERE f.dispatch_id=d.id) AND NOT EXISTS(SELECT 1 FROM merchant_payment_dispatch_stops s WHERE s.dispatch_id=d.id)) THEN
   RAISE EXCEPTION 'Retain exactly one real external origin with its original declared merchant, amount, evidence and quiesced competing callers' USING ERRCODE='23514'; END IF;
  SELECT coalesce(sum(old.amount_minor),0),coalesce(sum(coalesce(a.fee_owed_minor,g.application_fee_minor,l.application_fee_minor)),0)
   INTO previous_cash,previous_fee FROM payments old
   LEFT JOIN commercial_payment_attestations a ON a.payment_id=old.id LEFT JOIN merchant_agreement_payment_routes g ON g.payment_id=old.id LEFT JOIN payment_merchant_routes l ON l.payment_id=old.id
   WHERE old.invoice_id=i.id AND old.id<>p.id AND old.status='succeeded';
  IF i.total_minor<=0 OR previous_cash<>i.paid_minor OR EXISTS(SELECT 1 FROM payments old
   LEFT JOIN commercial_payment_attestations a ON a.payment_id=old.id LEFT JOIN merchant_agreement_payment_routes g ON g.payment_id=old.id LEFT JOIN payment_merchant_routes l ON l.payment_id=old.id
   WHERE old.invoice_id=i.id AND old.id<>p.id AND old.status='succeeded' AND ((a.payment_id IS NOT NULL)::integer+(g.payment_id IS NOT NULL)::integer+(l.payment_id IS NOT NULL)::integer<>1 OR old.refunded_minor<>0)) THEN
   RAISE EXCEPTION 'Restore the complete original cash and exactly one fee owner before a new external record' USING ERRCODE='23514'; END IF;
  actual_fee:=floor(policy.fee_minor::numeric*(previous_cash+p.amount_minor)/i.total_minor)-previous_fee;
  IF NEW.fee_owed_minor<>actual_fee THEN RAISE EXCEPTION 'The recorded fee owed must use the frozen shared invoice policy, never a fabricated collected fee' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT * INTO original FROM commercial_payment_attestations WHERE payment_id=p.id;
  IF original.payment_id IS NULL OR p.status<>'succeeded' OR original.amount_minor<>p.amount_minor OR original.currency<>p.currency THEN
   RAISE EXCEPTION 'Restore the exact original successful recorded external principal' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME='commercial_refund_attestations' THEN
   SELECT * INTO r FROM refunds WHERE id=NEW.refund_id;
   IF r.id IS NULL OR r.payment_id<>p.id OR r.provider<>'manual' OR r.status<>'created' OR r.provider_ref IS NOT NULL OR NEW.amount_minor<>r.amount_minor OR NEW.currency<>r.currency THEN
    RAISE EXCEPTION 'Record only this actual original manual refund attempt before its balance settles' USING ERRCODE='23514'; END IF;
  ELSIF TG_TABLE_NAME='commercial_fee_attestations' THEN
   IF NEW.direction='remitted' AND coalesce((SELECT sum(CASE WHEN direction='returned' THEN -amount_minor ELSE amount_minor END) FROM commercial_fee_attestations WHERE payment_id=p.id),0)+NEW.amount_minor>floor(original.fee_owed_minor::numeric*(p.amount_minor-p.refunded_minor)/p.amount_minor) THEN
    RAISE EXCEPTION 'Recorded external remittances cannot exceed the original bounded current fee obligation' USING ERRCODE='23514'; END IF;
   IF NEW.direction='returned' AND NOT EXISTS(SELECT 1 FROM commercial_fee_attestations first WHERE first.id=NEW.original_remittance_id AND first.direction='remitted' AND first.payment_id=p.id
    AND coalesce((SELECT sum(a.amount_minor) FROM commercial_fee_attestations a WHERE a.original_remittance_id=first.id),0)+NEW.amount_minor<=first.amount_minor) THEN
    RAISE EXCEPTION 'An external fee return must retain its exact original remittance and remaining actual amount' USING ERRCODE='23514'; END IF;
  ELSE RAISE EXCEPTION 'Unknown recorded commercial money family' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER commercial_payment_attestations_guard BEFORE INSERT OR UPDATE OR DELETE ON commercial_payment_attestations FOR EACH ROW EXECUTE FUNCTION guard_commercial_attestation();
--> statement-breakpoint
CREATE TRIGGER commercial_refund_attestations_guard BEFORE INSERT OR UPDATE OR DELETE ON commercial_refund_attestations FOR EACH ROW EXECUTE FUNCTION guard_commercial_attestation();
--> statement-breakpoint
CREATE TRIGGER commercial_fee_attestations_guard BEFORE INSERT OR UPDATE OR DELETE ON commercial_fee_attestations FOR EACH ROW EXECUTE FUNCTION guard_commercial_attestation();
--> statement-breakpoint
-- Add the new explicit origin to the existing binding authority. Every old
-- provider branch is retained; manual money never acquires a Stripe route.
CREATE OR REPLACE FUNCTION guard_merchant_payment_binding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_payment payments%ROWTYPE;policy invoice_market_policies%ROWTYPE;new_agreement boolean;new_single boolean;route_count integer;
BEGIN
 SELECT * INTO current_payment FROM payments WHERE id=NEW.id;
 SELECT * INTO policy FROM invoice_market_policies WHERE invoice_id=current_payment.invoice_id;
 IF current_payment.provider='manual' AND policy.model='seller_merchant' THEN
  IF NOT EXISTS(SELECT 1 FROM commercial_payment_attestations a WHERE a.payment_id=current_payment.id AND a.invoice_id=current_payment.invoice_id AND a.amount_minor=current_payment.amount_minor AND a.currency=current_payment.currency)
   OR EXISTS(SELECT 1 FROM merchant_payment_routes WHERE payment_id=current_payment.id) OR EXISTS(SELECT 1 FROM merchant_agreement_payment_routes WHERE payment_id=current_payment.id)
   OR EXISTS(SELECT 1 FROM merchant_invoice_payment_routes WHERE payment_id=current_payment.id) OR EXISTS(SELECT 1 FROM payment_merchant_routes WHERE payment_id=current_payment.id) THEN
   RAISE EXCEPTION 'A recorded external payment needs its exact original attestation and cannot invent provider routing' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 SELECT EXISTS(SELECT 1 FROM invoices i JOIN subscriptions s ON s.id::text=split_part(i.source_id,':',1)
  WHERE i.id=current_payment.invoice_id AND i.source_type='subscription' AND s.merchant_scope_version=1 AND policy.model='seller_merchant') INTO new_agreement;
 SELECT EXISTS(SELECT 1 FROM invoice_merchant_scopes WHERE invoice_id=current_payment.invoice_id) INTO new_single;
 IF policy.collection_version IS DISTINCT FROM 1 AND NOT new_agreement AND NOT new_single THEN RETURN NEW; END IF;
 SELECT(EXISTS(SELECT 1 FROM merchant_payment_routes WHERE payment_id=current_payment.id))::integer
  +(EXISTS(SELECT 1 FROM merchant_agreement_payment_routes WHERE payment_id=current_payment.id))::integer
  +(EXISTS(SELECT 1 FROM merchant_invoice_payment_routes WHERE payment_id=current_payment.id))::integer INTO route_count;
 IF route_count<>1 OR(policy.collection_version=1 AND NOT EXISTS(SELECT 1 FROM merchant_payment_routes WHERE payment_id=current_payment.id))
  OR(new_agreement AND NOT EXISTS(SELECT 1 FROM merchant_agreement_payment_routes WHERE payment_id=current_payment.id))
  OR(new_single AND NOT EXISTS(SELECT 1 FROM merchant_invoice_payment_routes WHERE payment_id=current_payment.id))
  OR EXISTS(SELECT 1 FROM payment_merchant_routes WHERE payment_id=current_payment.id) THEN
  RAISE EXCEPTION 'This payment requires its original per-party route before commit.' USING ERRCODE='23514'; END IF;
 IF current_payment.status='succeeded' AND NOT EXISTS(SELECT 1 FROM merchant_payment_observations o WHERE o.payment_id=current_payment.id
  AND o.status='succeeded' AND o.customer_charge_verified AND o.provider_ref=current_payment.provider_ref AND o.amount_minor=current_payment.amount_minor AND o.currency=current_payment.currency) THEN
  RAISE EXCEPTION 'Retain the positive original provider observation before applying paid money.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION guard_commercial_refund_projection() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status='succeeded' AND EXISTS(SELECT 1 FROM commercial_payment_attestations WHERE payment_id=NEW.payment_id)
  AND NOT EXISTS(SELECT 1 FROM commercial_refund_attestations a WHERE a.refund_id=NEW.id AND a.payment_id=NEW.payment_id AND a.amount_minor=NEW.amount_minor AND a.currency=NEW.currency) THEN
  RAISE EXCEPTION 'Retain the actual original external refund attestation before applying returned principal' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER commercial_refund_projection_guard AFTER INSERT OR UPDATE ON refunds DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_commercial_refund_projection();
