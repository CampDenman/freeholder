-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C5.19/C12.38/C1.08: UNASSEMBLED suffix AFTER unchanged 9b7 current proof.
CREATE TABLE legacy_bank_read_stops (
 read_id uuid PRIMARY KEY REFERENCES legacy_bank_reads(id) ON DELETE RESTRICT,
 caller_instance_id uuid NOT NULL, original_digest text NOT NULL, source_revision text NOT NULL,
 mechanical_check text NOT NULL, hosting_evidence_digest text NOT NULL, reviewed_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT legacy_bank_read_stops_digests CHECK(original_digest ~ '^[a-f0-9]{64}$' AND source_revision ~ '^[a-f0-9]{64}$' AND hosting_evidence_digest ~ '^[a-f0-9]{64}$'),
 CONSTRAINT legacy_bank_read_stops_kind CHECK(mechanical_check IN('original_process_absent','unobservable_host_review')),
 CONSTRAINT legacy_bank_read_stops_reviewer CHECK(reviewed_by ~ '^user:[0-9a-f-]{36}$')
);
--> statement-breakpoint
CREATE FUNCTION freeholder_guard_legacy_bank_reader_stop() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original_read legacy_bank_reads;
BEGIN
 IF TG_OP<>'INSERT' OR current_setting('freeholder.legacy_bank_reader_stop_v1',true) IS DISTINCT FROM '1' THEN
  RAISE EXCEPTION 'Original legacy reader stop review is immutable and requires its human-authorized shared service' USING ERRCODE='55000';
 END IF;
 SELECT * INTO original_read FROM legacy_bank_reads WHERE id=NEW.read_id FOR UPDATE;
 IF original_read.id IS NULL OR NEW.caller_instance_id IS DISTINCT FROM (original_read.caller->>'id')::uuid
  OR NEW.original_digest IS DISTINCT FROM original_read.original_digest OR NEW.source_revision IS DISTINCT FROM original_read.source_revision
  OR EXISTS(SELECT 1 FROM legacy_bank_read_finishes WHERE read_id=NEW.read_id) THEN
  RAISE EXCEPTION 'Review the exact unresolved original caller without inventing its returned or thrown finish' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER legacy_bank_read_stops_guard BEFORE INSERT OR UPDATE OR DELETE ON legacy_bank_read_stops FOR EACH ROW EXECUTE FUNCTION freeholder_guard_legacy_bank_reader_stop();
--> statement-breakpoint
CREATE FUNCTION freeholder_guard_legacy_bank_recovered_read() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM 1 FROM legacy_bank_reads WHERE id=NEW.read_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM legacy_bank_read_stops WHERE read_id=NEW.read_id) THEN
  RAISE EXCEPTION 'A reviewed stopped legacy read cannot append late callbacks or fabricate a real wrapper finish' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER legacy_bank_recovered_read_guard BEFORE INSERT ON legacy_bank_read_facts FOR EACH ROW EXECUTE FUNCTION freeholder_guard_legacy_bank_recovered_read();
--> statement-breakpoint
CREATE TRIGGER legacy_bank_recovered_read_guard BEFORE INSERT ON legacy_bank_read_finishes FOR EACH ROW EXECUTE FUNCTION freeholder_guard_legacy_bank_recovered_read();
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
  UNION ALL SELECT 'read',r.id::text,to_jsonb(r) FROM reads r
  UNION ALL SELECT 'read_fact',f.id::text,to_jsonb(f) FROM legacy_bank_read_facts f WHERE f.read_id IN(SELECT id FROM reads)
  UNION ALL SELECT 'read_finish',f.read_id::text,to_jsonb(f) FROM legacy_bank_read_finishes f WHERE f.read_id IN(SELECT id FROM reads)
  UNION ALL SELECT 'read_stop',f.read_id::text,to_jsonb(f) FROM legacy_bank_read_stops f WHERE f.read_id IN(SELECT id FROM reads)
 ), bounded AS(SELECT * FROM facts LIMIT 5001)
 SELECT encode(sha256(convert_to(coalesce(string_agg(domain||':'||identity||':'||body::text,E'\n' ORDER BY domain,identity),''),'UTF8')),'hex'),
  count(*)>5000 OR NOT EXISTS(SELECT 1 FROM original) FROM bounded
$$;
--> statement-breakpoint
ALTER TABLE legacy_bank_current_receipts ADD COLUMN replacement_eligible boolean NOT NULL DEFAULT false;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION freeholder_guard_legacy_bank_refund_capacity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT freeholder_legacy_bank_refund_capacity(NEW.payment_id)
  AND current_setting('freeholder.legacy_bank_capacity_payment',true) IS DISTINCT FROM NEW.payment_id::text THEN
  RAISE EXCEPTION 'Original legacy bank debt requires exact authenticated causal reconciliation before a new refund intent' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
-- Signed feedback is retained in a short transaction before processing it.
-- Serialize its original payment inventory against current-proof admission.
CREATE FUNCTION freeholder_lock_legacy_bank_signed_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE payment_id uuid;
BEGIN
 FOR payment_id IN SELECT DISTINCT p.id FROM payments p WHERE p.provider=NEW.provider
  AND (p.provider_ref=NEW.provider_object_ref OR EXISTS(SELECT 1 FROM refunds r WHERE r.payment_id=p.id AND r.provider_ref=NEW.provider_object_ref)) ORDER BY p.id LOOP
  PERFORM pg_advisory_xact_lock(hashtext('payment:'||payment_id::text));
 END LOOP;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER legacy_bank_signed_event_lock BEFORE INSERT ON payment_provider_events FOR EACH ROW EXECUTE FUNCTION freeholder_lock_legacy_bank_signed_event();
--> statement-breakpoint
CREATE FUNCTION freeholder_lock_legacy_bank_physical_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE payment_id uuid;
BEGIN
 IF NEW.subject_type='refund' AND NEW.metadata->>'protocol'='freeholder.refund-physical.v1' THEN
  SELECT r.payment_id INTO payment_id FROM refunds r WHERE r.id=NEW.subject_id;
  IF payment_id IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtext('payment:'||payment_id::text)); END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER legacy_bank_physical_event_lock BEFORE INSERT ON money_state_events FOR EACH ROW EXECUTE FUNCTION freeholder_lock_legacy_bank_physical_event();
