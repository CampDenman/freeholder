-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C9.33/C12.38: OWNED UNAPPLIED continuation AFTER frozen2a943a01/818462a6.
-- Only root assembles/applies a new database. Earlier tails are untouched.
CREATE TABLE subscription_proration_cash_confirmations (
 payment_id uuid PRIMARY KEY REFERENCES payments(id) ON DELETE RESTRICT,proration_id uuid NOT NULL REFERENCES subscription_prorations(id) ON DELETE RESTRICT,
 invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,provider_observation_id uuid REFERENCES merchant_payment_observations(id) ON DELETE RESTRICT,
 external_attestation_id uuid REFERENCES commercial_payment_attestations(payment_id) ON DELETE RESTRICT,retained_at timestamptz NOT NULL DEFAULT clock_timestamp(),original_evidence_digest text NOT NULL,
 CONSTRAINT subscription_proration_cash_confirmations_origin CHECK((provider_observation_id IS NULL)<>(external_attestation_id IS NULL)),
 CONSTRAINT subscription_proration_cash_confirmations_digest CHECK(original_evidence_digest ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE INDEX subscription_proration_cash_confirmations_parent ON subscription_proration_cash_confirmations(proration_id);
--> statement-breakpoint
CREATE TABLE subscription_proration_credit_confirmations (
 application_id uuid PRIMARY KEY REFERENCES invoice_credit_applications(reservation_id) ON DELETE RESTRICT,proration_id uuid NOT NULL REFERENCES subscription_prorations(id) ON DELETE RESTRICT,
 invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,retained_at timestamptz NOT NULL DEFAULT clock_timestamp(),original_evidence_digest text NOT NULL,
 CONSTRAINT subscription_proration_credit_confirmations_digest CHECK(original_evidence_digest ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE INDEX subscription_proration_credit_confirmations_parent ON subscription_proration_credit_confirmations(proration_id);
--> statement-breakpoint
CREATE FUNCTION freeholder_proration_boundary_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE accepted subscription_prorations%ROWTYPE;i invoices%ROWTYPE;p payments%ROWTYPE;o merchant_payment_observations%ROWTYPE;
 a commercial_payment_attestations%ROWTYPE;x invoice_credit_applications%ROWTYPE;r invoice_credit_reservations%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Preserve actual original principal-retention time; no receipt can be rewritten or backdated' USING ERRCODE='23514';END IF;
 SELECT * INTO accepted FROM subscription_prorations WHERE id=NEW.proration_id;
 SELECT * INTO i FROM invoices WHERE id=NEW.invoice_id;
 IF accepted.id IS NULL OR accepted.original_trial_ends_at IS NOT NULL OR accepted.debit_invoice_id IS DISTINCT FROM i.id OR i.source_type<>'subscription'
  OR i.source_id IS DISTINCT FROM accepted.subscription_id::text||':proration:'||accepted.id::text OR i.currency IS DISTINCT FROM accepted.snapshot->>'currency' THEN
  RAISE EXCEPTION 'Retain positive consideration only for its exact original accepted canonical target' USING ERRCODE='23514';END IF;
 IF TG_TABLE_NAME='subscription_proration_cash_confirmations' THEN
  SELECT * INTO p FROM payments WHERE id=NEW.payment_id;
  IF p.id IS NULL OR p.invoice_id<>i.id OR p.currency<>i.currency OR p.amount_minor<=0 OR(NEW.provider_observation_id IS NULL)=(NEW.external_attestation_id IS NULL) THEN
   RAISE EXCEPTION 'A principal confirmation needs one real original payment and exactly one actual source receipt' USING ERRCODE='23514';END IF;
  IF NEW.provider_observation_id IS NOT NULL THEN
   SELECT * INTO o FROM merchant_payment_observations WHERE id=NEW.provider_observation_id;
   IF p.provider<>'stripe' OR o.id IS NULL OR o.payment_id<>p.id OR o.status<>'succeeded' OR NOT o.customer_charge_verified OR NOT o.route_verified OR o.amount_minor<>p.amount_minor OR o.currency<>p.currency
    OR NOT EXISTS(SELECT 1 FROM merchant_agreement_payment_routes g WHERE g.payment_id=p.id AND g.provider_platform_account_id=o.provider_platform_account_id AND g.charge_account_id IS NOT DISTINCT FROM o.charge_account_id
     AND g.recipient_account_id=o.recipient_account_id AND g.settlement_merchant_account_id=o.settlement_merchant_account_id) THEN
    RAISE EXCEPTION 'Retain actual customer and merchant-route proof before claiming on-time provider principal; ancillary fees remain separate' USING ERRCODE='23514';END IF;
   NEW.original_evidence_digest:=encode(sha256(convert_to(to_jsonb(o)::text,'UTF8')),'hex');
  ELSE
   SELECT * INTO a FROM commercial_payment_attestations WHERE payment_id=NEW.external_attestation_id;
   IF p.provider<>'manual' OR a.payment_id IS DISTINCT FROM p.id OR a.invoice_id<>i.id OR a.amount_minor<>p.amount_minor OR a.currency<>p.currency
    OR a.merchant_profile_id<>accepted.profile_id OR a.profile_version<>accepted.profile_version THEN
    RAISE EXCEPTION 'Retain the actual exact external principal attestation; a supplied processedAt is not retention-time evidence' USING ERRCODE='23514';END IF;
   NEW.original_evidence_digest:=encode(sha256(convert_to(to_jsonb(a)::text,'UTF8')),'hex');
  END IF;
 ELSIF TG_TABLE_NAME='subscription_proration_credit_confirmations' THEN
  SELECT * INTO x FROM invoice_credit_applications WHERE reservation_id=NEW.application_id;
  SELECT * INTO r FROM invoice_credit_reservations WHERE id=x.reservation_id;
  IF x.reservation_id IS NULL OR x.invoice_id<>i.id OR r.target_source_id<>i.source_id OR r.amount_minor<=0 THEN
   RAISE EXCEPTION 'Retain the actual original application to its exact accepted target before claiming on-time noncash consideration' USING ERRCODE='23514';END IF;
  NEW.original_evidence_digest:=encode(sha256(convert_to(jsonb_build_object('application',to_jsonb(x),'reservation',to_jsonb(r))::text,'UTF8')),'hex');
 ELSE RAISE EXCEPTION 'Unknown original principal boundary family' USING ERRCODE='23514';END IF;
 -- Force actual execution time. Neither a caller-supplied date nor now()
 -- (transaction start) may supply a false earlier retention instant.
 NEW.retained_at:=clock_timestamp();
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER subscription_proration_cash_confirmations_guard BEFORE INSERT OR UPDATE OR DELETE ON subscription_proration_cash_confirmations FOR EACH ROW EXECUTE FUNCTION freeholder_proration_boundary_receipt();
--> statement-breakpoint
CREATE TRIGGER subscription_proration_credit_confirmations_guard BEFORE INSERT OR UPDATE OR DELETE ON subscription_proration_credit_confirmations FOR EACH ROW EXECUTE FUNCTION freeholder_proration_boundary_receipt();
--> statement-breakpoint
CREATE FUNCTION freeholder_capture_proration_boundary() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_invoice_id uuid;accepted subscription_prorations%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='invoice_credit_applications' THEN target_invoice_id:=NEW.invoice_id;
 ELSIF TG_TABLE_NAME='commercial_payment_attestations' THEN target_invoice_id:=NEW.invoice_id;
 ELSIF TG_TABLE_NAME='merchant_payment_observations' THEN
  IF NEW.status<>'succeeded' OR NOT NEW.customer_charge_verified OR NOT NEW.route_verified THEN RETURN NEW;END IF;
  SELECT p.invoice_id INTO target_invoice_id FROM payments p WHERE p.id=NEW.payment_id;
 ELSE RAISE EXCEPTION 'Unknown real positive principal source' USING ERRCODE='23514';END IF;
 SELECT p.* INTO accepted FROM subscription_prorations p WHERE p.debit_invoice_id=target_invoice_id;
 IF accepted.id IS NULL THEN RETURN NEW;END IF;
 IF TG_TABLE_NAME='invoice_credit_applications' THEN
  INSERT INTO subscription_proration_credit_confirmations(application_id,proration_id,invoice_id,original_evidence_digest) VALUES(NEW.reservation_id,accepted.id,target_invoice_id,'') ON CONFLICT DO NOTHING;
 ELSIF TG_TABLE_NAME='merchant_payment_observations' THEN
  INSERT INTO subscription_proration_cash_confirmations(payment_id,proration_id,invoice_id,provider_observation_id,external_attestation_id,original_evidence_digest)
   VALUES(NEW.payment_id,accepted.id,target_invoice_id,NEW.id,NULL,'') ON CONFLICT DO NOTHING;
 ELSE
  INSERT INTO subscription_proration_cash_confirmations(payment_id,proration_id,invoice_id,provider_observation_id,external_attestation_id,original_evidence_digest)
   VALUES(NEW.payment_id,accepted.id,target_invoice_id,NULL,NEW.payment_id,'') ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER subscription_proration_provider_cash_confirmation AFTER INSERT ON merchant_payment_observations FOR EACH ROW EXECUTE FUNCTION freeholder_capture_proration_boundary();
--> statement-breakpoint
CREATE TRIGGER subscription_proration_external_cash_confirmation AFTER INSERT ON commercial_payment_attestations FOR EACH ROW EXECUTE FUNCTION freeholder_capture_proration_boundary();
--> statement-breakpoint
CREATE TRIGGER subscription_proration_credit_confirmation AFTER INSERT ON invoice_credit_applications FOR EACH ROW EXECUTE FUNCTION freeholder_capture_proration_boundary();
--> statement-breakpoint
CREATE FUNCTION freeholder_proration_boundary_funded(target uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM subscription_prorations a JOIN invoices i ON i.id=a.debit_invoice_id WHERE a.id=target AND a.original_trial_ends_at IS NULL AND i.status='paid'
  AND i.source_type='subscription' AND i.source_id=a.subscription_id::text||':proration:'||a.id::text AND i.currency=a.snapshot->>'currency'
  AND i.total_minor=a.debit_net_minor+a.debit_tax_minor AND i.refunded_minor=0 AND i.paid_minor+i.credited_minor=i.total_minor AND i.paid_at<=a.effective_at
  AND NOT EXISTS(SELECT 1 FROM payments p WHERE p.invoice_id=i.id AND p.status IN('created','processing'))
  AND coalesce((SELECT sum(p.amount_minor) FROM payments p WHERE p.invoice_id=i.id AND p.status='succeeded'),0)=i.paid_minor
  AND NOT EXISTS(SELECT 1 FROM payments p LEFT JOIN subscription_proration_cash_confirmations c ON c.payment_id=p.id
   LEFT JOIN commercial_payment_attestations x ON x.payment_id=c.external_attestation_id LEFT JOIN merchant_payment_observations o ON o.id=c.provider_observation_id
   WHERE p.invoice_id=i.id AND p.status='succeeded' AND(c.payment_id IS NULL OR c.proration_id<>a.id OR c.invoice_id<>i.id OR c.retained_at>a.effective_at
    OR(c.external_attestation_id IS NOT NULL AND c.original_evidence_digest IS DISTINCT FROM encode(sha256(convert_to(to_jsonb(x)::text,'UTF8')),'hex'))
    OR(c.provider_observation_id IS NOT NULL AND c.original_evidence_digest IS DISTINCT FROM encode(sha256(convert_to(to_jsonb(o)::text,'UTF8')),'hex'))))
  AND coalesce((SELECT sum(r.amount_minor) FROM invoice_credit_applications x JOIN invoice_credit_reservations r ON r.id=x.reservation_id WHERE x.invoice_id=i.id),0)=i.credited_minor
  AND NOT EXISTS(SELECT 1 FROM invoice_credit_applications x JOIN invoice_credit_reservations r ON r.id=x.reservation_id LEFT JOIN subscription_proration_credit_confirmations c ON c.application_id=x.reservation_id
   WHERE x.invoice_id=i.id AND(c.application_id IS NULL OR c.proration_id<>a.id OR c.invoice_id<>i.id OR c.retained_at>a.effective_at
    OR c.original_evidence_digest IS DISTINCT FROM encode(sha256(convert_to(jsonb_build_object('application',to_jsonb(x),'reservation',to_jsonb(r))::text,'UTF8')),'hex'))))
$$;
--> statement-breakpoint
CREATE FUNCTION freeholder_proration_acceptance_deadline() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.effective_at<=clock_timestamp() THEN RAISE EXCEPTION 'A local acceptance cannot commit after its reviewed effective instant; roll back its new documents and obtain fresh consent before any provider caller' USING ERRCODE='23514';END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER subscription_proration_acceptance_deadline AFTER INSERT ON subscription_prorations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION freeholder_proration_acceptance_deadline();
--> statement-breakpoint
CREATE FUNCTION freeholder_proration_actual_paid_boundary() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE accepted subscription_prorations%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='agreement_fee_eligibility' THEN SELECT a.* INTO accepted FROM agreement_fee_duties d JOIN subscription_prorations a ON a.id=d.acceptance_id WHERE d.invoice_id=NEW.invoice_id;
 ELSE accepted:=NEW;IF NEW.state<>'applied' OR OLD.state='applied' THEN RETURN NEW;END IF;END IF;
 IF accepted.original_trial_ends_at IS NULL AND NOT freeholder_proration_boundary_funded(accepted.id) THEN
  RAISE EXCEPTION 'Actual complete principal confirmation must be retained before the original boundary; processedAt or provider object creation cannot backdate eligibility/access' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER subscription_proration_actual_paid_boundary BEFORE UPDATE OF state ON subscription_prorations FOR EACH ROW EXECUTE FUNCTION freeholder_proration_actual_paid_boundary();
--> statement-breakpoint
CREATE TRIGGER subscription_proration_fee_paid_boundary BEFORE INSERT ON agreement_fee_eligibility FOR EACH ROW EXECUTE FUNCTION freeholder_proration_actual_paid_boundary();
