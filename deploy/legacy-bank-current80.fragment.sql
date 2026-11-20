-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C5.19/C12.38: UNASSEMBLED suffix after complete root3a. NEW DB/hash only.
ALTER TABLE legacy_bank_reads ADD COLUMN source_revision text NOT NULL;
--> statement-breakpoint
ALTER TABLE legacy_bank_reads DROP CONSTRAINT legacy_bank_reads_digest;
--> statement-breakpoint
ALTER TABLE legacy_bank_reads ADD CONSTRAINT legacy_bank_reads_digest CHECK(source_revision ~ '^[a-f0-9]{64}$' AND original_digest ~ '^[a-f0-9]{64}$' AND completion_nonce_hash ~ '^[a-f0-9]{64}$');
--> statement-breakpoint
CREATE TABLE legacy_bank_current_receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), read_id uuid NOT NULL REFERENCES legacy_bank_reads(id) ON DELETE RESTRICT,
 refund_id uuid NOT NULL REFERENCES refunds(id) ON DELETE RESTRICT, resolved_revision text NOT NULL,
 status text, raw_status text, requires_review boolean NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT legacy_bank_current_receipts_revision CHECK(resolved_revision ~ '^[a-f0-9]{64}$' AND (raw_status IS NULL OR length(raw_status)<=100)),
 CONSTRAINT legacy_bank_current_receipts_status CHECK(status IS NULL OR status IN('pending','requires_action','succeeded','failed','canceled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX legacy_bank_current_receipts_read_idx ON legacy_bank_current_receipts(read_id);
--> statement-breakpoint
CREATE INDEX legacy_bank_current_receipts_refund_idx ON legacy_bank_current_receipts(refund_id);
--> statement-breakpoint
CREATE FUNCTION freeholder_legacy_bank_revision(target_refund uuid, exclude_read uuid DEFAULT NULL)
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
  UNION ALL SELECT 'physical',e.id::text,to_jsonb(e) FROM money_state_events e WHERE e.subject_type='refund' AND e.subject_id=target_refund
   AND e.metadata->>'protocol'='freeholder.refund-physical.v1'
  UNION ALL SELECT 'signed_event',e.id::text,to_jsonb(e) FROM payment_provider_events e,original r JOIN payments p ON p.id=r.payment_id
   WHERE e.provider=r.provider AND e.provider_object_ref IN(r.provider_ref,p.provider_ref)
  UNION ALL SELECT 'read',r.id::text,to_jsonb(r) FROM reads r
  UNION ALL SELECT 'read_fact',f.id::text,to_jsonb(f) FROM legacy_bank_read_facts f WHERE f.read_id IN(SELECT id FROM reads)
  UNION ALL SELECT 'read_finish',f.read_id::text,to_jsonb(f) FROM legacy_bank_read_finishes f WHERE f.read_id IN(SELECT id FROM reads)
 ), bounded AS(SELECT * FROM facts LIMIT 5001)
 SELECT encode(sha256(convert_to(coalesce(string_agg(domain||':'||identity||':'||body::text,E'\n' ORDER BY domain,identity),''),'UTF8')),'hex'),
  count(*)>5000 OR NOT EXISTS(SELECT 1 FROM original) FROM bounded
$$;
--> statement-breakpoint
CREATE FUNCTION freeholder_guard_legacy_bank_current() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original_read legacy_bank_reads; actual_finish legacy_bank_read_finishes; before_revision record; after_revision record; actual_raw text; exact_count integer;
BEGIN
 IF TG_OP<>'INSERT' OR current_setting('freeholder.legacy_bank_current_v1',true) IS DISTINCT FROM '1' THEN
  RAISE EXCEPTION 'Original legacy bank current proof is immutable and requires its shared service' USING ERRCODE='55000';
 END IF;
 SELECT * INTO original_read FROM legacy_bank_reads WHERE id=NEW.read_id FOR UPDATE;
 SELECT * INTO actual_finish FROM legacy_bank_read_finishes WHERE read_id=NEW.read_id;
 SELECT * INTO before_revision FROM freeholder_legacy_bank_revision(NEW.refund_id,NEW.read_id);
 SELECT * INTO after_revision FROM freeholder_legacy_bank_revision(NEW.refund_id);
 SELECT count(*)::integer,min(evidence->>'rawProviderStatus') INTO exact_count,actual_raw FROM legacy_bank_read_facts WHERE read_id=NEW.read_id AND kind='exact_refund';
 IF original_read.id IS NULL OR original_read.refund_id IS DISTINCT FROM NEW.refund_id OR actual_finish.outcome IS DISTINCT FROM 'returned'
  OR actual_finish.caller_instance_id IS DISTINCT FROM (original_read.caller->>'id')::uuid OR exact_count<>1
  OR before_revision.incomplete OR after_revision.incomplete OR before_revision.revision IS DISTINCT FROM original_read.source_revision
  OR NEW.resolved_revision IS DISTINCT FROM after_revision.revision OR NEW.raw_status IS DISTINCT FROM actual_raw
  OR NEW.status IS DISTINCT FROM (CASE WHEN actual_raw IN('pending','requires_action','succeeded','failed','canceled') THEN actual_raw ELSE NULL END) THEN
  RAISE EXCEPTION 'Retain the actual returned caller and complete unchanged exact-resource evidence before current bank proof' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER legacy_bank_current_receipts_guard BEFORE INSERT OR UPDATE OR DELETE ON legacy_bank_current_receipts FOR EACH ROW EXECUTE FUNCTION freeholder_guard_legacy_bank_current();
--> statement-breakpoint
CREATE FUNCTION freeholder_legacy_bank_current(target_refund uuid)
RETURNS TABLE(receipt_id uuid,status text,requires_review boolean) LANGUAGE sql STABLE AS $$
 SELECT r.id,r.status,r.requires_review FROM legacy_bank_current_receipts r,freeholder_legacy_bank_revision(target_refund) v
 WHERE r.refund_id=target_refund AND NOT v.incomplete AND r.resolved_revision=v.revision ORDER BY r.created_at DESC,r.id DESC LIMIT 1
$$;
--> statement-breakpoint
CREATE FUNCTION freeholder_legacy_bank_refund_capacity(target_payment uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT NOT EXISTS(SELECT 1 FROM refunds r WHERE r.payment_id=target_payment AND EXISTS(SELECT 1 FROM legacy_bank_reads b WHERE b.refund_id=r.id)
  AND NOT EXISTS(SELECT 1 FROM freeholder_legacy_bank_current(r.id) s WHERE s.status='succeeded' AND NOT s.requires_review))
$$;
--> statement-breakpoint
CREATE FUNCTION freeholder_guard_legacy_bank_refund_capacity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT freeholder_legacy_bank_refund_capacity(NEW.payment_id) THEN
  RAISE EXCEPTION 'Original legacy bank refund debt requires exact reconciliation before a new refund intent' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER legacy_bank_refund_capacity_guard BEFORE INSERT ON refunds FOR EACH ROW EXECUTE FUNCTION freeholder_guard_legacy_bank_refund_capacity();
--> statement-breakpoint
CREATE FUNCTION freeholder_guard_legacy_bank_projection() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_state record; projected text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM legacy_bank_reads WHERE refund_id=OLD.id) THEN
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Retain original legacy bank resource history' USING ERRCODE='23514'; END IF;
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.payment_id IS DISTINCT FROM OLD.payment_id OR NEW.invoice_id IS DISTINCT FROM OLD.invoice_id
  OR NEW.provider IS DISTINCT FROM OLD.provider OR NEW.provider_ref IS DISTINCT FROM OLD.provider_ref
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
CREATE TRIGGER legacy_bank_current_projection BEFORE UPDATE OR DELETE ON refunds FOR EACH ROW EXECUTE FUNCTION freeholder_guard_legacy_bank_projection();
--> statement-breakpoint
CREATE FUNCTION freeholder_guard_legacy_bank_balances() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE payment payments; invoice invoices; returned numeric; invoice_returned numeric;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM legacy_bank_reads WHERE refund_id=NEW.id) THEN RETURN NULL; END IF;
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
CREATE CONSTRAINT TRIGGER legacy_bank_current_balances AFTER UPDATE ON refunds DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
 WHEN(OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION freeholder_guard_legacy_bank_balances();
