-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C5.19/C12.38/C1.08: UNASSEMBLED suffix AFTER unchanged d4ae.
-- freeholder:schema-breaking Raw authenticated legacy feedback starts original-bank debt before a first GET; the previous image must fail closed on those writes. Restore the pre-upgrade database for rollback.
CREATE TABLE legacy_bank_feedback (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), capture_key text NOT NULL, evidence_digest text NOT NULL, authentication text NOT NULL,
 evidence jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT legacy_bank_feedback_digests CHECK(capture_key ~ '^[a-f0-9]{64}$' AND evidence_digest ~ '^[a-f0-9]{64}$' AND authentication ~ '^[a-f0-9]{64}$'),
 CONSTRAINT legacy_bank_feedback_evidence CHECK((jsonb_typeof(evidence)='object' AND evidence->>'protocol'='freeholder.legacy-bank-feedback.v1'
  AND evidence->'originalCreatePlatformAccountId'='null'::jsonb AND evidence->'originalCreateProtocolVersion'='null'::jsonb) IS TRUE)
);
--> statement-breakpoint
CREATE UNIQUE INDEX legacy_bank_feedback_capture_idx ON legacy_bank_feedback(capture_key);
--> statement-breakpoint
CREATE INDEX legacy_bank_feedback_payment_idx ON legacy_bank_feedback((evidence->>'observedPaymentRef'),(evidence->>'observedChargeAccountId'));
--> statement-breakpoint
CREATE INDEX legacy_bank_feedback_refund_idx ON legacy_bank_feedback((evidence->>'observedRefundRef'),(evidence->>'observedChargeAccountId'));
--> statement-breakpoint
CREATE FUNCTION freeholder_guard_legacy_bank_feedback() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original_payment uuid;
BEGIN
 IF TG_OP<>'INSERT' OR current_setting('freeholder.legacy_bank_feedback_v1',true) IS DISTINCT FROM '1' THEN
  RAISE EXCEPTION 'Raw original bank feedback is immutable and requires the verified shared intake' USING ERRCODE='55000';
 END IF;
 FOR original_payment IN SELECT DISTINCT p.id FROM payments p WHERE p.provider='stripe'
  AND(p.provider_ref=NEW.evidence->>'observedPaymentRef' OR EXISTS(SELECT 1 FROM refunds r WHERE r.payment_id=p.id AND r.provider_ref=NEW.evidence->>'observedRefundRef')) ORDER BY p.id LOOP
  PERFORM pg_advisory_xact_lock(hashtext('payment:'||original_payment::text));
 END LOOP;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER legacy_bank_feedback_guard BEFORE INSERT OR UPDATE OR DELETE ON legacy_bank_feedback FOR EACH ROW EXECUTE FUNCTION freeholder_guard_legacy_bank_feedback();
--> statement-breakpoint
-- This is a review predicate, never a creator-finish or ownership-by-amount
-- assertion. Application proofs authenticate the actual old admission too.
CREATE FUNCTION freeholder_legacy_bank_feedback_matches(target_refund uuid, observed jsonb) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM refunds r JOIN payments p ON p.id=r.payment_id JOIN money_state_events m ON m.subject_type='refund' AND m.subject_id=r.id
  WHERE r.id=target_refund AND r.provider='stripe' AND p.provider='stripe'
   AND m.metadata->>'protocol'='freeholder.refund-physical.v1' AND m.metadata->>'physicalState'='admitted'
   AND m.metadata->>'authentication' ~ '^[a-f0-9]{64}$' AND m.metadata->'original'->>'refundId'=r.id::text
   AND m.metadata->'original'->>'paymentId'=p.id::text AND m.metadata->'original'->>'invoiceId'=r.invoice_id::text
   AND m.metadata->'original'->>'providerPaymentRef'=p.provider_ref AND m.metadata->'original' ? 'providerAccountId'
   AND (m.metadata->'original'->>'providerAccountId') IS NOT DISTINCT FROM (observed->>'observedChargeAccountId')
   AND(observed->>'observedPaymentRef'=m.metadata->'original'->>'providerPaymentRef' OR (r.provider_ref IS NOT NULL AND observed->>'observedRefundRef'=r.provider_ref)))
$$;
--> statement-breakpoint
CREATE FUNCTION freeholder_legacy_bank_feedback_review(target_refund uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM legacy_bank_feedback f WHERE freeholder_legacy_bank_feedback_matches(target_refund,f.evidence))
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION freeholder_legacy_bank_refund_capacity(target_payment uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT NOT EXISTS(SELECT 1 FROM refunds r WHERE r.payment_id=target_payment
  AND (EXISTS(SELECT 1 FROM legacy_bank_reads b WHERE b.refund_id=r.id) OR freeholder_legacy_bank_feedback_review(r.id))
  AND NOT EXISTS(SELECT 1 FROM freeholder_legacy_bank_current(r.id) s WHERE s.status='succeeded' AND NOT s.requires_review))
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION freeholder_guard_legacy_bank_projection() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_state record; projected text; original_ack boolean;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM legacy_bank_reads WHERE refund_id=OLD.id) AND NOT freeholder_legacy_bank_feedback_review(OLD.id) THEN
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Retain original legacy bank resource history' USING ERRCODE='23514'; END IF;
 original_ack:=OLD.provider_ref IS NULL AND NEW.provider_ref IS NOT NULL AND OLD.status='processing' AND NEW.status=OLD.status
  AND current_setting('freeholder.legacy_bank_original_ack',true)=OLD.id::text
  AND EXISTS(SELECT 1 FROM money_state_events e WHERE e.subject_type='refund' AND e.subject_id=OLD.id
   AND e.metadata->>'protocol'='freeholder.refund-physical.v1' AND e.metadata->>'physicalState'='finished'
   AND e.metadata->>'authentication' ~ '^[a-f0-9]{64}$' AND e.metadata->>'requestHash'=OLD.request_hash
   AND e.metadata->'result'->>'providerRef'=NEW.provider_ref AND e.metadata->'recoveryRequired'='false'::jsonb);
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.payment_id IS DISTINCT FROM OLD.payment_id OR NEW.invoice_id IS DISTINCT FROM OLD.invoice_id
  OR NEW.provider IS DISTINCT FROM OLD.provider OR (NEW.provider_ref IS DISTINCT FROM OLD.provider_ref AND NOT coalesce(original_ack,false))
  OR NEW.amount_minor IS DISTINCT FROM OLD.amount_minor OR NEW.currency IS DISTINCT FROM OLD.currency
  OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key OR NEW.request_hash IS DISTINCT FROM OLD.request_hash THEN
  RAISE EXCEPTION 'Original legacy bank resource identity and money are immutable' USING ERRCODE='23514';
 END IF;
 IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
 SELECT * INTO current_state FROM freeholder_legacy_bank_current(OLD.id);
 IF current_state.receipt_id IS NULL OR current_state.status IS NULL THEN
  RAISE EXCEPTION 'A legacy bank transition requires its fresh exact finished current receipt' USING ERRCODE='23514';
 END IF;
 projected:=CASE WHEN current_state.status='succeeded' THEN 'succeeded' WHEN current_state.status IN('failed','canceled') THEN 'failed' ELSE 'processing' END;
 IF NEW.status IS DISTINCT FROM projected THEN
  RAISE EXCEPTION 'An old result or later event cannot bypass current legacy bank proof' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION freeholder_guard_legacy_bank_balances() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE payment payments; invoice invoices; returned numeric; invoice_returned numeric;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM legacy_bank_reads WHERE refund_id=NEW.id) AND NOT freeholder_legacy_bank_feedback_review(NEW.id) THEN RETURN NULL; END IF;
 SELECT * INTO payment FROM payments WHERE id=NEW.payment_id;
 SELECT * INTO invoice FROM invoices WHERE id=NEW.invoice_id;
 SELECT coalesce(sum(amount_minor) FILTER(WHERE status='succeeded'),0) INTO returned FROM refunds WHERE payment_id=NEW.payment_id;
 SELECT coalesce(sum(refunded_minor),0) INTO invoice_returned FROM payments WHERE invoice_id=NEW.invoice_id;
 IF payment.id IS NULL OR invoice.id IS NULL OR returned IS DISTINCT FROM payment.refunded_minor OR invoice_returned IS DISTINCT FROM invoice.refunded_minor
  OR returned<0 OR returned>payment.amount_minor OR invoice_returned<0 OR invoice_returned>invoice.paid_minor
  OR EXISTS(SELECT 1 FROM refunds r WHERE r.payment_id=payment.id AND r.currency<>payment.currency)
  OR EXISTS(SELECT 1 FROM payments p WHERE p.invoice_id=invoice.id AND p.currency<>invoice.currency) THEN
  RAISE EXCEPTION 'Original legacy bank projection and existing invoice/payment cash must commit together' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION freeholder_legacy_bank_revision(target_refund uuid, exclude_read uuid DEFAULT NULL)
RETURNS TABLE(revision text,incomplete boolean) LANGUAGE sql STABLE SET TimeZone='UTC' AS $$
 WITH original AS (SELECT r.* FROM refunds r WHERE r.id=target_refund),
 reads AS (SELECT r.* FROM legacy_bank_reads r WHERE r.refund_id=target_refund AND r.id IS DISTINCT FROM exclude_read LIMIT 5001),
 facts AS (
  -- The original identity and HMAC physical journal are stable across logical
  -- cash projection and free-text privacy minimization. No current account or
  -- same-amount resource is adopted into the old create protocol.
  SELECT 'original' domain,r.id::text identity,jsonb_build_object('id',r.id,'payment_id',r.payment_id,'invoice_id',r.invoice_id,
   'provider',r.provider,'provider_ref',r.provider_ref,'amount_minor',r.amount_minor,'currency',r.currency,
   'idempotency_key',r.idempotency_key,'request_hash',r.request_hash) body FROM original r
  UNION ALL SELECT 'payment',p.id::text,jsonb_build_object('id',p.id,'invoice_id',p.invoice_id,'provider',p.provider,
   'provider_ref',p.provider_ref,'amount_minor',p.amount_minor,'currency',p.currency,'request_hash',p.request_hash)
   FROM payments p,original r WHERE p.id=r.payment_id
  UNION ALL SELECT 'route',p.payment_id::text,to_jsonb(p) FROM payment_merchant_routes p,original r WHERE p.payment_id=r.payment_id
  UNION ALL SELECT 'physical',e.id::text,to_jsonb(e) FROM money_state_events e WHERE e.subject_type='refund' AND e.subject_id IN(SELECT rr.id FROM refunds rr,original r WHERE rr.payment_id=r.payment_id)
   AND e.metadata->>'protocol'='freeholder.refund-physical.v1'
   AND (e.subject_id=target_refund OR e.metadata->>'physicalState' IS DISTINCT FROM 'unsubmitted')
  UNION ALL SELECT 'signed_event',e.id::text,to_jsonb(e) FROM payment_provider_events e,original r JOIN payments p ON p.id=r.payment_id
   WHERE e.provider=r.provider AND (e.provider_object_ref=p.provider_ref OR e.provider_object_ref IN(SELECT rr.provider_ref FROM refunds rr WHERE rr.payment_id=r.payment_id))
  UNION ALL SELECT 'raw_feedback',f.id::text,to_jsonb(f) FROM legacy_bank_feedback f WHERE freeholder_legacy_bank_feedback_matches(target_refund,f.evidence)
  UNION ALL SELECT 'read',r.id::text,to_jsonb(r) FROM reads r
  UNION ALL SELECT 'read_fact',f.id::text,to_jsonb(f) FROM legacy_bank_read_facts f WHERE f.read_id IN(SELECT id FROM reads)
  UNION ALL SELECT 'read_finish',f.read_id::text,to_jsonb(f) FROM legacy_bank_read_finishes f WHERE f.read_id IN(SELECT id FROM reads)
  UNION ALL SELECT 'read_stop',f.read_id::text,to_jsonb(f) FROM legacy_bank_read_stops f WHERE f.read_id IN(SELECT id FROM reads)
 ), bounded AS(SELECT * FROM facts LIMIT 5001)
 SELECT encode(sha256(convert_to(coalesce(string_agg(domain||':'||identity||':'||body::text,E'\n' ORDER BY domain,identity),''),'UTF8')),'hex'),
  count(*)>5000 OR NOT EXISTS(SELECT 1 FROM original) FROM bounded
$$;
