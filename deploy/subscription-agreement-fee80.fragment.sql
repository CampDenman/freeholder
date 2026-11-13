-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C12.38/C9.33: OWNED UNAPPLIED tail AFTER frozen34837db8 gross31e3acdc.
-- Root owns assembly/new database. No previous fragment is changed.
CREATE TABLE agreement_fee_duties (
 invoice_id uuid PRIMARY KEY REFERENCES invoices(id) ON DELETE RESTRICT,acceptance_id uuid NOT NULL UNIQUE REFERENCES subscription_prorations(id) ON DELETE RESTRICT,
 merchant_profile_id uuid NOT NULL REFERENCES merchant_tax_profiles(id) ON DELETE RESTRICT,profile_version integer NOT NULL,
 currency text NOT NULL,total_minor bigint NOT NULL,target_fee_minor bigint NOT NULL,credited_minor bigint NOT NULL,carried_fee_minor bigint NOT NULL,
 cash_principal_minor bigint NOT NULL,cash_fee_target_minor bigint NOT NULL,expected_receivable_minor bigint NOT NULL,
 accepted_quote_digest text NOT NULL,original_owner_digest text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT agreement_fee_duties_profile_version FOREIGN KEY(merchant_profile_id,profile_version) REFERENCES merchant_tax_profile_versions(profile_id,version) ON DELETE RESTRICT,
 CONSTRAINT agreement_fee_duties_amounts CHECK(total_minor between 1 and 9007199254740991 AND target_fee_minor between 0 and total_minor AND credited_minor between 0 and total_minor AND carried_fee_minor between 0 and credited_minor
  AND cash_principal_minor=total_minor-credited_minor AND cash_fee_target_minor=least(cash_principal_minor,greatest(0,target_fee_minor-carried_fee_minor)) AND expected_receivable_minor=greatest(0,target_fee_minor-carried_fee_minor-cash_fee_target_minor)),
 CONSTRAINT agreement_fee_duties_owner CHECK(currency ~ '^[A-Z]{3}$' AND profile_version>0 AND accepted_quote_digest ~ '^[a-f0-9]{64}$' AND original_owner_digest ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE INDEX agreement_fee_duties_merchant ON agreement_fee_duties(merchant_profile_id);
--> statement-breakpoint
CREATE TABLE agreement_fee_credit_assignments (
 application_id uuid PRIMARY KEY REFERENCES invoice_credit_applications(reservation_id) ON DELETE RESTRICT,invoice_id uuid NOT NULL REFERENCES agreement_fee_duties(invoice_id) ON DELETE RESTRICT,
 amount_minor bigint NOT NULL,fee_obligation_minor bigint NOT NULL,proven_collected_minor bigint NOT NULL,original_evidence_digest text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT agreement_fee_credit_assignments_amounts CHECK(amount_minor between 1 and 9007199254740991 AND fee_obligation_minor between 0 and amount_minor AND proven_collected_minor between 0 and fee_obligation_minor AND original_evidence_digest ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE INDEX agreement_fee_credit_assignments_invoice ON agreement_fee_credit_assignments(invoice_id);
--> statement-breakpoint
CREATE TABLE agreement_fee_cash_assignments (
 payment_id uuid PRIMARY KEY REFERENCES payments(id) ON DELETE RESTRICT,invoice_id uuid NOT NULL REFERENCES agreement_fee_duties(invoice_id) ON DELETE RESTRICT,
 amount_minor bigint NOT NULL,fee_obligation_minor bigint NOT NULL,origin text NOT NULL,original_evidence_digest text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT agreement_fee_cash_assignments_amounts CHECK(amount_minor between 1 and 9007199254740991 AND fee_obligation_minor between 0 and amount_minor AND origin IN('recorded_external','provider') AND original_evidence_digest ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE INDEX agreement_fee_cash_assignments_invoice ON agreement_fee_cash_assignments(invoice_id);
--> statement-breakpoint
CREATE TABLE agreement_fee_eligibility (
 invoice_id uuid PRIMARY KEY REFERENCES agreement_fee_duties(invoice_id) ON DELETE RESTRICT,paid_at timestamptz NOT NULL,principal_evidence_digest text NOT NULL,
 cash_payment_ids jsonb NOT NULL,credit_application_ids jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT agreement_fee_eligibility_evidence CHECK(principal_evidence_digest ~ '^[a-f0-9]{64}$' AND jsonb_typeof(cash_payment_ids)='array' AND jsonb_array_length(cash_payment_ids)<=1000 AND jsonb_typeof(credit_application_ids)='array' AND jsonb_array_length(credit_application_ids)<=1000)
);
--> statement-breakpoint
CREATE TABLE agreement_fee_remittances (
 id uuid PRIMARY KEY,invoice_id uuid NOT NULL REFERENCES agreement_fee_duties(invoice_id) ON DELETE RESTRICT,direction text NOT NULL,
 original_remittance_id uuid REFERENCES agreement_fee_remittances(id) ON DELETE RESTRICT,amount_minor bigint NOT NULL,currency text NOT NULL,
 recorded_by text NOT NULL,evidence_digest text NOT NULL,request_digest text NOT NULL,idempotency_key text NOT NULL UNIQUE,created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT agreement_fee_remittances_amounts CHECK(amount_minor between 1 and 9007199254740991 AND currency ~ '^[A-Z]{3}$'),
 CONSTRAINT agreement_fee_remittances_original CHECK((direction='remitted' AND original_remittance_id IS NULL)OR(direction='returned' AND original_remittance_id IS NOT NULL)),
 CONSTRAINT agreement_fee_remittances_evidence CHECK(recorded_by ~ '^(user:|agent:|plugin:|system$)' AND evidence_digest ~ '^[a-f0-9]{64}$' AND request_digest ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE INDEX agreement_fee_remittances_invoice ON agreement_fee_remittances(invoice_id);
--> statement-breakpoint
-- Nonallocation target cash keeps its own frozen fee epoch. Unknown actual
-- principal/refund/caller evidence is NULL, never a reduced consideration.
CREATE FUNCTION freeholder_agreement_fee_principal_safe(target uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM payments p WHERE p.id=target AND p.status='succeeded' AND p.amount_minor>0 AND p.refunded_minor between 0 and p.amount_minor
  AND freeholder_merchant_creators_quiesced(p.id)
  AND coalesce((SELECT sum(r.amount_minor) FROM refunds r WHERE r.payment_id=p.id AND r.status='succeeded'),0)=p.refunded_minor
  AND NOT EXISTS(SELECT 1 FROM refunds r WHERE r.payment_id=p.id AND(r.status IN('created','processing')OR(r.status='failed' AND r.failure_code='provider_already_refunded')))
  AND NOT EXISTS(SELECT 1 FROM payment_disputes d WHERE d.payment_id=p.id AND d.status IN('open','lost'))
  AND((p.provider='manual' AND EXISTS(SELECT 1 FROM commercial_payment_attestations a WHERE a.payment_id=p.id AND a.amount_minor=p.amount_minor AND a.currency=p.currency)
    AND NOT EXISTS(SELECT 1 FROM refunds r WHERE r.payment_id=p.id AND r.status='succeeded' AND NOT EXISTS(SELECT 1 FROM commercial_refund_attestations a WHERE a.refund_id=r.id AND a.payment_id=p.id AND a.amount_minor=r.amount_minor AND a.currency=r.currency)))
   OR(p.provider='stripe' AND EXISTS(SELECT 1 FROM merchant_agreement_payment_routes g JOIN LATERAL(SELECT * FROM merchant_payment_observations o WHERE o.payment_id=p.id AND o.provider_ref=p.provider_ref AND o.status='succeeded' ORDER BY o.observed_at DESC,o.id DESC LIMIT 1)o ON true
     WHERE g.payment_id=p.id AND o.customer_charge_verified AND o.route_verified AND o.amount_minor=p.amount_minor AND o.currency=p.currency AND o.provider_platform_account_id=g.provider_platform_account_id
      AND o.charge_account_id IS NOT DISTINCT FROM g.charge_account_id AND o.recipient_account_id=g.recipient_account_id AND o.settlement_merchant_account_id=g.settlement_merchant_account_id)
    AND NOT EXISTS(SELECT 1 FROM refunds r WHERE r.payment_id=p.id AND r.status='succeeded' AND NOT EXISTS(SELECT 1 FROM merchant_refund_requests q WHERE q.refund_id=r.id AND q.payment_id=p.id AND freeholder_original_refund_resolved(q.id,'succeeded',r.provider_ref)))))
 )
$$;
--> statement-breakpoint
CREATE FUNCTION freeholder_agreement_fee_current(target uuid) RETURNS TABLE(known boolean,eligible boolean,owed bigint,recorded bigint,excess bigint) LANGUAGE plpgsql STABLE AS $$
DECLARE duty agreement_fee_duties%ROWTYPE;i invoices%ROWTYPE;cash_gross numeric;cash_returned numeric;cash_remaining numeric;cash_duty numeric;credit_remaining numeric;credit_duty numeric;target_duty numeric;
BEGIN
 SELECT * INTO duty FROM agreement_fee_duties WHERE invoice_id=target;
 SELECT * INTO i FROM invoices WHERE id=target;
 IF duty.invoice_id IS NULL OR i.id IS NULL OR i.total_minor<>duty.total_minor OR i.credited_minor<>duty.credited_minor OR i.currency<>duty.currency
  OR(SELECT count(*) FROM invoice_lines WHERE invoice_id=i.id)<>1 OR NOT EXISTS(SELECT 1 FROM invoice_lines l WHERE l.invoice_id=i.id AND l.snapshot->>'subscriptionProrationId'=duty.acceptance_id::text)
  OR NOT EXISTS(SELECT 1 FROM invoice_market_policies m WHERE m.invoice_id=i.id AND m.model='seller_merchant' AND m.fee_minor=duty.target_fee_minor)
  OR(SELECT count(*) FROM payments WHERE invoice_id=i.id)+(SELECT count(*) FROM agreement_fee_credit_assignments WHERE invoice_id=i.id)+(SELECT count(*) FROM agreement_fee_remittances WHERE invoice_id=i.id)>1000
  OR EXISTS(SELECT 1 FROM payments p WHERE p.invoice_id=i.id AND NOT freeholder_merchant_creators_quiesced(p.id))
  OR EXISTS(SELECT 1 FROM merchant_payment_observations o JOIN payments p ON p.id=o.payment_id WHERE p.invoice_id=i.id AND o.status='succeeded' AND(p.status<>'succeeded' OR o.amount_minor<>p.amount_minor OR o.currency<>p.currency OR(o.provider_ref IS DISTINCT FROM p.provider_ref AND o.provider_ref IS DISTINCT FROM p.provider_checkout_ref)))
  OR EXISTS(SELECT 1 FROM payments p WHERE p.invoice_id=i.id AND p.status IN('failed','cancelled') AND(
   EXISTS(SELECT 1 FROM commercial_payment_attestations a WHERE a.payment_id=p.id)
   OR NOT EXISTS(SELECT 1 FROM merchant_payment_requests q WHERE q.payment_id=p.id)
   OR NOT(EXISTS(SELECT 1 FROM merchant_payment_terminal_receipts q WHERE q.payment_id=p.id)
    OR(p.provider_ref IS NULL AND p.provider_checkout_ref IS NULL AND NOT EXISTS(SELECT 1 FROM merchant_payment_dispatches d LEFT JOIN merchant_payment_creation_refusals r ON r.dispatch_id=d.id WHERE d.payment_id=p.id AND r.dispatch_id IS NULL)))))
  OR EXISTS(SELECT 1 FROM payments p LEFT JOIN agreement_fee_cash_assignments a ON a.payment_id=p.id WHERE p.invoice_id=i.id AND(p.status IN('created','processing')OR(p.status='succeeded' AND(a.payment_id IS NULL OR a.invoice_id<>i.id OR a.amount_minor<>p.amount_minor OR NOT freeholder_agreement_fee_principal_safe(p.id) OR freeholder_original_payment_fee(p.id) IS DISTINCT FROM a.fee_obligation_minor)))) THEN
  RETURN QUERY SELECT false,false,NULL::bigint,NULL::bigint,NULL::bigint;RETURN;END IF;
 SELECT coalesce(sum(p.amount_minor),0),coalesce(sum(p.refunded_minor),0),coalesce(sum(p.amount_minor-p.refunded_minor),0),coalesce(sum(floor(a.fee_obligation_minor::numeric*(p.amount_minor-p.refunded_minor)/p.amount_minor)),0)
  INTO cash_gross,cash_returned,cash_remaining,cash_duty FROM payments p JOIN agreement_fee_cash_assignments a ON a.payment_id=p.id WHERE p.invoice_id=i.id AND p.status='succeeded';
 IF cash_gross<>i.paid_minor OR cash_returned<>i.refunded_minor OR EXISTS(SELECT 1 FROM agreement_fee_credit_assignments a
  LEFT JOIN invoice_credit_applications x ON x.reservation_id=a.application_id LEFT JOIN invoice_credit_reservations r ON r.id=x.reservation_id LEFT JOIN invoice_credit_funding f ON f.id=r.funding_id LEFT JOIN payments p ON p.id=f.source_payment_id
  WHERE a.invoice_id=i.id AND(x.invoice_id IS DISTINCT FROM i.id OR r.target_source_id IS DISTINCT FROM i.source_id OR a.amount_minor IS DISTINCT FROM r.amount_minor OR a.fee_obligation_minor IS DISTINCT FROM x.fee_obligation_minor
   OR a.proven_collected_minor IS DISTINCT FROM x.fee_proven_collected_minor OR p.id IS NULL OR p.refunded_minor<>0 OR NOT freeholder_agreement_fee_principal_safe(p.id))) THEN
  RETURN QUERY SELECT false,false,NULL::bigint,NULL::bigint,NULL::bigint;RETURN;END IF;
 SELECT coalesce(sum(amount_minor),0),coalesce(sum(fee_obligation_minor),0) INTO credit_remaining,credit_duty FROM agreement_fee_credit_assignments WHERE invoice_id=i.id;
 IF credit_remaining<>duty.credited_minor OR cash_remaining+credit_remaining>duty.total_minor THEN RETURN QUERY SELECT false,false,NULL::bigint,NULL::bigint,NULL::bigint;RETURN;END IF;
 SELECT coalesce(sum(CASE WHEN direction='returned' THEN -amount_minor ELSE amount_minor END),0) INTO recorded FROM agreement_fee_remittances WHERE invoice_id=i.id;
 eligible:=EXISTS(SELECT 1 FROM agreement_fee_eligibility WHERE invoice_id=i.id);
 target_duty:=CASE WHEN eligible THEN floor(duty.target_fee_minor::numeric*(cash_remaining+credit_remaining)/duty.total_minor) ELSE 0 END;
 known:=true;owed:=CASE WHEN eligible THEN greatest(0,target_duty-credit_duty-cash_duty) ELSE 0 END;excess:=CASE WHEN eligible THEN greatest(0,credit_duty+cash_duty-target_duty) ELSE 0 END;
 RETURN NEXT;
END $$;
--> statement-breakpoint
CREATE FUNCTION freeholder_guard_agreement_fee() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE duty agreement_fee_duties%ROWTYPE;i invoices%ROWTYPE;a subscription_prorations%ROWTYPE;p payments%ROWTYPE;x invoice_credit_applications%ROWTYPE;r invoice_credit_reservations%ROWTYPE;
 prior_cash numeric;prior_fee numeric;current_state record;
BEGIN
 IF TG_OP<>'INSERT' OR current_setting('freeholder.agreement_fee_v1',true) IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'Original commission duty, assignments, eligibility and actual remittances are immutable guarded receipts' USING ERRCODE='23514';END IF;
 SELECT * INTO i FROM invoices WHERE id=NEW.invoice_id;
 IF TG_TABLE_NAME='agreement_fee_duties' THEN
  SELECT * INTO a FROM subscription_prorations WHERE id=NEW.acceptance_id;
  IF a.id IS NULL OR a.state<>'accepted' OR a.original_trial_ends_at IS NOT NULL OR a.debit_invoice_id IS DISTINCT FROM i.id OR i.source_type<>'subscription' OR i.source_id<>a.subscription_id::text||':proration:'||a.id::text
   OR i.currency<>NEW.currency OR i.total_minor<>NEW.total_minor OR i.credited_minor<>NEW.credited_minor OR i.paid_minor<>0 OR i.status IN('draft','void')
   OR NEW.merchant_profile_id<>a.profile_id OR NEW.profile_version<>a.profile_version OR NEW.accepted_quote_digest<>a.accepted_quote_digest OR NEW.target_fee_minor<>a.debit_fee_obligation_minor OR NEW.carried_fee_minor<>a.applied_fee_obligation_minor
   OR NOT EXISTS(SELECT 1 FROM invoice_market_policies m WHERE m.invoice_id=i.id AND m.model='seller_merchant' AND m.fee_minor=NEW.target_fee_minor)
   OR(SELECT count(*) FROM invoice_lines WHERE invoice_id=i.id)<>1 THEN RAISE EXCEPTION 'Freeze one exact accepted target commission epoch before collection, without rewriting an old or order-v1 policy' USING ERRCODE='23514';END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO duty FROM agreement_fee_duties WHERE invoice_id=NEW.invoice_id;
 IF duty.invoice_id IS NULL OR i.id IS NULL THEN RAISE EXCEPTION 'Restore the exact original accepted commission duty before its children' USING ERRCODE='23514';END IF;
 IF TG_TABLE_NAME='agreement_fee_credit_assignments' THEN
  SELECT * INTO x FROM invoice_credit_applications WHERE reservation_id=NEW.application_id;SELECT * INTO r FROM invoice_credit_reservations WHERE id=x.reservation_id;
  IF x.reservation_id IS NULL OR x.invoice_id<>i.id OR r.target_source_id<>i.source_id OR NEW.amount_minor<>r.amount_minor OR NEW.fee_obligation_minor<>x.fee_obligation_minor OR NEW.proven_collected_minor<>x.fee_proven_collected_minor OR x.fee_evidence_digest IS NULL THEN
   RAISE EXCEPTION 'Each carried commission assignment retains its exact actual application and original fee proof' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='agreement_fee_cash_assignments' THEN
  SELECT * INTO p FROM payments WHERE id=NEW.payment_id;
  IF p.id IS NULL OR p.invoice_id<>i.id OR p.status<>'created' OR p.currency<>duty.currency OR NEW.amount_minor<>p.amount_minor OR freeholder_original_payment_fee(p.id) IS DISTINCT FROM NEW.fee_obligation_minor
   OR(NEW.origin='recorded_external' AND(p.provider<>'manual' OR NOT EXISTS(SELECT 1 FROM commercial_payment_attestations WHERE payment_id=p.id)))
   OR(NEW.origin='provider' AND(p.provider<>'stripe' OR NOT EXISTS(SELECT 1 FROM merchant_agreement_payment_routes WHERE payment_id=p.id))) THEN
   RAISE EXCEPTION 'A physical fee assignment needs its exact real principal attempt and one original provider route or external attestation' USING ERRCODE='23514';END IF;
  SELECT coalesce(sum(q.amount_minor),0),coalesce(sum(c.fee_obligation_minor),0) INTO prior_cash,prior_fee FROM payments q LEFT JOIN agreement_fee_cash_assignments c ON c.payment_id=q.id WHERE q.invoice_id=i.id AND q.id<>p.id AND q.status='succeeded';
  IF duty.cash_principal_minor<=0 OR prior_cash<>i.paid_minor OR prior_cash+p.amount_minor>duty.cash_principal_minor
   OR prior_fee<>floor(duty.cash_fee_target_minor::numeric*prior_cash/duty.cash_principal_minor)
   OR NEW.fee_obligation_minor<>floor(duty.cash_fee_target_minor::numeric*(prior_cash+p.amount_minor)/duty.cash_principal_minor)-prior_fee
   OR EXISTS(SELECT 1 FROM payments q LEFT JOIN agreement_fee_cash_assignments c ON c.payment_id=q.id WHERE q.invoice_id=i.id AND q.id<>p.id AND(q.status IN('created','processing')OR(q.status='succeeded' AND(c.payment_id IS NULL OR q.refunded_minor<>0)))) THEN
   RAISE EXCEPTION 'Preserve complete original cash assignments and cumulative physical-fee residuals within the actual cash cap' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='agreement_fee_eligibility' THEN
  SELECT * INTO a FROM subscription_prorations WHERE id=duty.acceptance_id;
  SELECT * INTO current_state FROM freeholder_agreement_fee_current(i.id);
  IF NOT current_state.known OR i.status<>'paid' OR i.paid_at IS NULL OR NEW.paid_at<>i.paid_at OR i.paid_at>a.effective_at OR i.refunded_minor<>0 OR i.paid_minor+i.credited_minor<>i.total_minor
   OR NEW.cash_payment_ids IS DISTINCT FROM coalesce((SELECT jsonb_agg(p.id::text ORDER BY p.id) FROM payments p WHERE p.invoice_id=i.id AND p.status='succeeded'),'[]'::jsonb)
   OR NEW.credit_application_ids IS DISTINCT FROM coalesce((SELECT jsonb_agg(c.application_id::text ORDER BY c.application_id) FROM agreement_fee_credit_assignments c WHERE c.invoice_id=i.id),'[]'::jsonb) THEN
   RAISE EXCEPTION 'Only authentic full canonical consideration in the accepted window establishes eligibility; it never proves commission remittance' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='agreement_fee_remittances' THEN
  SELECT * INTO current_state FROM freeholder_agreement_fee_current(i.id);
  IF NOT current_state.known OR NOT current_state.eligible OR NEW.currency<>duty.currency THEN RAISE EXCEPTION 'Resolve complete actual cash and noncash disposition before attesting commission money' USING ERRCODE='23514';END IF;
  IF NEW.direction='remitted' AND current_state.recorded+NEW.amount_minor>current_state.owed THEN RAISE EXCEPTION 'An actual remittance cannot exceed the current original whole-consideration receivable' USING ERRCODE='23514';END IF;
  IF NEW.direction='returned' AND NOT EXISTS(SELECT 1 FROM agreement_fee_remittances f WHERE f.id=NEW.original_remittance_id AND f.invoice_id=i.id AND f.direction='remitted'
   AND coalesce((SELECT sum(q.amount_minor) FROM agreement_fee_remittances q WHERE q.original_remittance_id=f.id),0)+NEW.amount_minor<=f.amount_minor) THEN
   RAISE EXCEPTION 'An actual commission return names its exact original bounded remittance receipt' USING ERRCODE='23514';END IF;
 ELSE RAISE EXCEPTION 'Unknown original commission receipt family' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER agreement_fee_duties_guard BEFORE INSERT OR UPDATE OR DELETE ON agreement_fee_duties FOR EACH ROW EXECUTE FUNCTION freeholder_guard_agreement_fee();
--> statement-breakpoint
CREATE TRIGGER agreement_fee_credit_assignments_guard BEFORE INSERT OR UPDATE OR DELETE ON agreement_fee_credit_assignments FOR EACH ROW EXECUTE FUNCTION freeholder_guard_agreement_fee();
--> statement-breakpoint
CREATE TRIGGER agreement_fee_cash_assignments_guard BEFORE INSERT OR UPDATE OR DELETE ON agreement_fee_cash_assignments FOR EACH ROW EXECUTE FUNCTION freeholder_guard_agreement_fee();
--> statement-breakpoint
CREATE TRIGGER agreement_fee_eligibility_guard BEFORE INSERT OR UPDATE OR DELETE ON agreement_fee_eligibility FOR EACH ROW EXECUTE FUNCTION freeholder_guard_agreement_fee();
--> statement-breakpoint
CREATE TRIGGER agreement_fee_remittances_guard BEFORE INSERT OR UPDATE OR DELETE ON agreement_fee_remittances FOR EACH ROW EXECUTE FUNCTION freeholder_guard_agreement_fee();
--> statement-breakpoint
CREATE FUNCTION freeholder_agreement_fee_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE duty agreement_fee_duties%ROWTYPE;i invoices%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='payments' THEN
  SELECT * INTO i FROM invoices WHERE id=NEW.invoice_id;
  IF i.source_type<>'subscription' OR split_part(i.source_id,':',2)<>'proration' OR i.total_minor=0 OR NEW.status NOT IN('created','processing','succeeded') THEN RETURN NULL;END IF;
  SELECT * INTO duty FROM agreement_fee_duties WHERE invoice_id=i.id;
  IF duty.invoice_id IS NULL OR(NOT(NEW.provider='manual' AND NEW.status='created') AND NOT EXISTS(SELECT 1 FROM agreement_fee_cash_assignments WHERE payment_id=NEW.id AND invoice_id=i.id)) THEN
   RAISE EXCEPTION 'Retain the original accepted duty and exact real cash assignment before a caller or settlement can commit' USING ERRCODE='23514';END IF;
 ELSE
  SELECT * INTO duty FROM agreement_fee_duties WHERE invoice_id=NEW.invoice_id;
  IF coalesce((SELECT sum(amount_minor) FROM agreement_fee_credit_assignments WHERE invoice_id=duty.invoice_id),0)<>duty.credited_minor
   OR coalesce((SELECT sum(fee_obligation_minor) FROM agreement_fee_credit_assignments WHERE invoice_id=duty.invoice_id),0)<>duty.carried_fee_minor THEN
   RAISE EXCEPTION 'Freeze every actual original credit consideration and its whole carried duty with the accepted fee plan' USING ERRCODE='23514';END IF;
 END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER agreement_fee_duties_complete AFTER INSERT ON agreement_fee_duties DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION freeholder_agreement_fee_complete();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER agreement_fee_payment_assignment_complete AFTER INSERT OR UPDATE ON payments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION freeholder_agreement_fee_complete();

--> statement-breakpoint
-- Preserve the entire previous external writer; cap only an exact new gross
-- target whose separate original duty is already frozen in this transaction.
CREATE OR REPLACE FUNCTION guard_commercial_attestation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p payments%ROWTYPE;i invoices%ROWTYPE;policy invoice_market_policies%ROWTYPE;r refunds%ROWTYPE;party invoice_merchant_tax_quotes%ROWTYPE;original commercial_payment_attestations%ROWTYPE;
 previous_cash numeric;previous_fee numeric;actual_fee numeric;scopes integer;carried_fee numeric;cash_fee numeric;cash_principal numeric;
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
  SELECT coalesce(sum(a.fee_obligation_minor),0) INTO carried_fee FROM invoice_credit_applications a WHERE a.invoice_id=i.id;
  IF EXISTS(SELECT 1 FROM invoice_credit_applications a WHERE a.invoice_id=i.id AND a.fee_evidence_digest IS NULL)
   OR coalesce((SELECT sum(r.amount_minor)FROM invoice_credit_applications a JOIN invoice_credit_reservations r ON r.id=a.reservation_id WHERE a.invoice_id=i.id),0)<>i.credited_minor THEN
   RAISE EXCEPTION 'Restore exact noncash consideration and original fee ownership before recording another commission' USING ERRCODE='23514';END IF;
  cash_principal:=i.total_minor-i.credited_minor;cash_fee:=greatest(0,policy.fee_minor-carried_fee);
  IF split_part(i.source_id,':',2)='proration' THEN
   IF NOT EXISTS(SELECT 1 FROM agreement_fee_duties d WHERE d.invoice_id=i.id AND d.total_minor=i.total_minor AND d.target_fee_minor=policy.fee_minor AND d.credited_minor=i.credited_minor AND d.carried_fee_minor=carried_fee AND d.cash_principal_minor=cash_principal
    AND d.cash_fee_target_minor=least(cash_principal,cash_fee) AND d.expected_receivable_minor=greatest(0,cash_fee-cash_principal)) THEN
    RAISE EXCEPTION 'Preserve the exact original separate commission receivable before recording its physically bounded cash fee' USING ERRCODE='23514';END IF;
   cash_fee:=least(cash_principal,cash_fee);
  END IF;
  IF cash_principal<=0 OR cash_fee>cash_principal THEN RAISE EXCEPTION 'The original fee duty requires its bounded receivable; never invent collection or enlarge an unrelated charge' USING ERRCODE='23514';END IF;
  actual_fee:=floor(cash_fee*(previous_cash+p.amount_minor)/cash_principal)-previous_fee;
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
CREATE FUNCTION freeholder_agreement_fee_acceptance_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current subscription_prorations%ROWTYPE;
BEGIN
 SELECT * INTO current FROM subscription_prorations WHERE id=NEW.id;
 IF current.original_trial_ends_at IS NULL AND current.debit_net_minor+current.debit_tax_minor>0 AND NOT EXISTS(SELECT 1 FROM agreement_fee_duties d WHERE d.acceptance_id=current.id AND d.invoice_id=current.debit_invoice_id
  AND d.target_fee_minor=current.debit_fee_obligation_minor AND d.carried_fee_minor=current.applied_fee_obligation_minor AND d.accepted_quote_digest=current.accepted_quote_digest) THEN
  RAISE EXCEPTION 'The whole original commission duty and exact source assignments must commit with their accepted gross target' USING ERRCODE='23514';END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER agreement_fee_acceptance_complete AFTER INSERT OR UPDATE ON subscription_prorations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION freeholder_agreement_fee_acceptance_complete();

--> statement-breakpoint
-- Keep every existing provider/recipient/origin/caller guard and the complete
-- historical ordinary branch; only exact new gross duties use their cash cap.
CREATE OR REPLACE FUNCTION guard_merchant_agreement_payment_route() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE payment payments%ROWTYPE; parent invoices%ROWTYPE; policy invoice_market_policies%ROWTYPE; original record; paid numeric; prior_fee numeric; duty agreement_fee_duties%ROWTYPE;
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
  OR(NEW.origin_kind='provider_schedule' AND NEW.provider_api_version IS DISTINCT FROM original.provider_schedule_api_version)
  OR(NEW.origin_kind='provider_schedule' AND NOT EXISTS(SELECT 1 FROM subscription_provider_charge_receipts receipt WHERE receipt.id=NEW.original_charge_receipt_id
   AND receipt.subscription_id=NEW.subscription_id AND receipt.provider_platform_account_id=NEW.provider_platform_account_id AND receipt.charge_account_id IS NOT DISTINCT FROM NEW.charge_account_id
   AND receipt.provider_api_version=NEW.provider_api_version AND receipt.provider_subscription_ref=NEW.provider_subscription_ref AND receipt.provider_invoice_ref=NEW.provider_invoice_ref
   AND receipt.provider_payment_intent_ref=NEW.provider_payment_intent_ref AND receipt.provider_charge_ref=NEW.provider_charge_ref AND receipt.amount_minor=payment.amount_minor AND receipt.currency=payment.currency))
  OR EXISTS(SELECT 1 FROM merchant_payment_observations o JOIN payments p ON p.id=o.payment_id WHERE p.invoice_id=payment.invoice_id AND o.status='succeeded' AND(p.status<>'succeeded' OR o.amount_minor<>p.amount_minor OR o.currency<>p.currency OR(o.provider_ref IS DISTINCT FROM p.provider_ref AND o.provider_ref IS DISTINCT FROM p.provider_checkout_ref)))
  OR NEW.application_fee_minor>payment.amount_minor
  OR EXISTS(SELECT 1 FROM payment_merchant_routes WHERE payment_id=NEW.payment_id)
  OR EXISTS(SELECT 1 FROM merchant_payment_routes WHERE payment_id=NEW.payment_id)
  OR EXISTS(SELECT 1 FROM payments p WHERE p.invoice_id=payment.invoice_id AND p.id<>payment.id AND p.status IN('created','processing')) THEN
  RAISE EXCEPTION 'Bind each new agreement payment to its immutable original merchant namespace.' USING ERRCODE='23514';
 END IF;
 IF split_part(parent.source_id,':',2)='proration' THEN
  SELECT * INTO duty FROM agreement_fee_duties WHERE invoice_id=parent.id;
  SELECT coalesce(sum(p.amount_minor),0),coalesce(sum(coalesce(a.fee_owed_minor,g.application_fee_minor)),0) INTO paid,prior_fee FROM payments p
   LEFT JOIN commercial_payment_attestations a ON a.payment_id=p.id LEFT JOIN merchant_agreement_payment_routes g ON g.payment_id=p.id
   WHERE p.invoice_id=parent.id AND p.status='succeeded';
  IF duty.invoice_id IS NULL OR NEW.origin_kind<>'attempt' OR duty.total_minor<>parent.total_minor OR duty.credited_minor<>parent.credited_minor OR duty.target_fee_minor<>policy.fee_minor
   OR duty.cash_principal_minor<=0 OR paid<>parent.paid_minor OR paid+payment.amount_minor>duty.cash_principal_minor
   OR prior_fee<>floor(duty.cash_fee_target_minor::numeric*paid/duty.cash_principal_minor)
   OR NEW.application_fee_minor<>floor(duty.cash_fee_target_minor::numeric*(paid+payment.amount_minor)/duty.cash_principal_minor)-prior_fee
   OR EXISTS(SELECT 1 FROM payments p LEFT JOIN commercial_payment_attestations a ON a.payment_id=p.id LEFT JOIN merchant_agreement_payment_routes g ON g.payment_id=p.id WHERE p.invoice_id=parent.id AND p.status='succeeded'
    AND((a.payment_id IS NOT NULL)::integer+(g.payment_id IS NOT NULL)::integer<>1 OR p.refunded_minor<>0)) THEN
   RAISE EXCEPTION 'Bind only the physically bounded original gross-target fee while preserving its separately frozen merchant receivable and actual source assignments' USING ERRCODE='23514';END IF;
  RETURN NEW;
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
