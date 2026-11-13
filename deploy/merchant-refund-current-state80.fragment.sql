-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C5.19/C12.38: UNASSEMBLED current-read receipts; never apply to preserved v9.
-- Append after the original refund schema/guards in a NEW unpublished80 build.
-- Unknown webhook protocols remain raw nonbinding facts, never expected GET versions.
ALTER TABLE merchant_refund_observations ALTER COLUMN provider_api_version DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE merchant_refund_observations DROP CONSTRAINT merchant_refund_observations_scope;
--> statement-breakpoint
ALTER TABLE merchant_refund_observations ADD CONSTRAINT merchant_refund_observations_scope CHECK(
 provider_platform_account_id ~ '^acct_[A-Za-z0-9]+$' AND (charge_account_id IS NULL OR charge_account_id ~ '^acct_[A-Za-z0-9]+$')
 AND (provider_api_version IS NULL OR char_length(provider_api_version) BETWEEN 1 AND 100));
--> statement-breakpoint
ALTER TABLE merchant_refund_observations DROP CONSTRAINT merchant_refund_observations_refs;
--> statement-breakpoint
ALTER TABLE merchant_refund_observations ADD CONSTRAINT merchant_refund_observations_refs CHECK(
 provider_ref ~ '^(re|pyr)_[A-Za-z0-9_]+$' AND (payment_provider_ref IS NULL OR payment_provider_ref ~ '^pi_[A-Za-z0-9_]+$')
 AND evidence_digest ~ '^[a-f0-9]{64}$');
--> statement-breakpoint
ALTER TABLE merchant_refund_resource_bindings DROP CONSTRAINT merchant_refund_resource_bindings_ref;
--> statement-breakpoint
ALTER TABLE merchant_refund_resource_bindings ADD CONSTRAINT merchant_refund_resource_bindings_ref CHECK(provider_ref ~ '^(re|pyr)_[A-Za-z0-9_]+$');
--> statement-breakpoint
CREATE TABLE merchant_refund_observation_captures (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 observation_id uuid NOT NULL REFERENCES merchant_refund_observations(id) ON DELETE RESTRICT,
 capture_key text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT merchant_refund_observation_captures_key CHECK(capture_key ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE INDEX merchant_refund_observation_captures_fact_idx ON merchant_refund_observation_captures(observation_id);
--> statement-breakpoint
CREATE UNIQUE INDEX merchant_refund_observation_captures_key_idx ON merchant_refund_observation_captures(capture_key);
--> statement-breakpoint
CREATE TABLE merchant_refund_state_reads (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 request_id uuid NOT NULL REFERENCES merchant_refund_requests(id) ON DELETE RESTRICT,
 request_digest text NOT NULL,
 resource_binding_id uuid NOT NULL REFERENCES merchant_refund_resource_bindings(id) ON DELETE RESTRICT,
 source_revision text NOT NULL,
 source_observation_ids jsonb NOT NULL,
 caller jsonb NOT NULL,
 completion_nonce_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT merchant_refund_state_reads_digest CHECK(request_digest ~ '^[a-f0-9]{64}$' AND source_revision ~ '^[a-f0-9]{64}$' AND completion_nonce_hash ~ '^[a-f0-9]{64}$'),
 CONSTRAINT merchant_refund_state_reads_inventory CHECK(jsonb_typeof(source_observation_ids)='array' AND jsonb_array_length(source_observation_ids)<=5000)
);
--> statement-breakpoint
CREATE INDEX merchant_refund_state_reads_request_idx ON merchant_refund_state_reads(request_id);
--> statement-breakpoint
CREATE TABLE merchant_refund_state_read_finishes (
 read_id uuid PRIMARY KEY REFERENCES merchant_refund_state_reads(id) ON DELETE RESTRICT,
 caller_instance_id uuid NOT NULL,
 outcome text NOT NULL,
 capture_id uuid REFERENCES merchant_refund_observation_captures(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT merchant_refund_state_read_finishes_outcome CHECK(outcome IN('returned','threw'))
);
--> statement-breakpoint
CREATE TABLE merchant_refund_current_receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 read_id uuid NOT NULL REFERENCES merchant_refund_state_reads(id) ON DELETE RESTRICT,
 request_id uuid NOT NULL REFERENCES merchant_refund_requests(id) ON DELETE RESTRICT,
 capture_id uuid NOT NULL REFERENCES merchant_refund_observation_captures(id) ON DELETE RESTRICT,
 resolved_revision text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT merchant_refund_current_receipts_revision CHECK(resolved_revision ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX merchant_refund_current_receipts_read_idx ON merchant_refund_current_receipts(read_id);
--> statement-breakpoint
CREATE INDEX merchant_refund_current_receipts_request_idx ON merchant_refund_current_receipts(request_id);
--> statement-breakpoint
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['merchant_refund_observation_captures','merchant_refund_state_reads',
  'merchant_refund_state_read_finishes','merchant_refund_current_receipts'] LOOP
  EXECUTE format('CREATE TRIGGER original_refund_append_only BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION freeholder_original_refund_append_only()',t);
 END LOOP;
END $$;
--> statement-breakpoint
-- The same bounded revision is used by trusted services and integrity guards.
-- Captures are distinct even when a semantic status row is deduplicated.
-- Exclusions are only the one current read's actual newly captured fact;
-- receipt INSERT guards independently verify those IDs and the original caller.
CREATE FUNCTION freeholder_refund_current_revision(target_request uuid, exclude_observation uuid DEFAULT NULL, exclude_capture uuid DEFAULT NULL)
RETURNS TABLE(revision text,incomplete boolean,observation_ids jsonb) LANGUAGE sql STABLE AS $$
 WITH original AS (
  SELECT * FROM merchant_refund_requests WHERE id=target_request
 ), requests AS (
  SELECT r.* FROM merchant_refund_requests r,original p
  WHERE r.provider_platform_account_id=p.provider_platform_account_id AND r.charge_account_id IS NOT DISTINCT FROM p.charge_account_id
   AND r.original_payment_ref=p.original_payment_ref LIMIT 5001
 ), source_receipts AS (
  SELECT r.* FROM subscription_provider_charge_receipts r,original p
  WHERE r.provider_platform_account_id=p.provider_platform_account_id AND r.charge_account_id IS NOT DISTINCT FROM p.charge_account_id
   AND r.provider_payment_intent_ref=p.original_payment_ref LIMIT 5001
 ), aliases AS (
  SELECT a.* FROM merchant_agreement_payment_routes a WHERE a.original_charge_receipt_id IN(SELECT id FROM source_receipts) LIMIT 5001
 ), payment_cash AS (
  SELECT c.* FROM merchant_payment_observations c,original p
  WHERE c.provider_platform_account_id=p.provider_platform_account_id AND c.charge_account_id IS NOT DISTINCT FROM p.charge_account_id
   AND c.provider_ref=p.original_payment_ref LIMIT 5001
 ), payment_ids AS (
  SELECT payment_id AS id FROM payment_cash UNION SELECT payment_id FROM aliases UNION SELECT payment_id FROM original WHERE payment_id IS NOT NULL
 ), observations AS (
  SELECT o.* FROM merchant_refund_observations o,original p
  WHERE (o.provider_platform_account_id=p.provider_platform_account_id AND o.charge_account_id IS NOT DISTINCT FROM p.charge_account_id AND o.payment_provider_ref=p.original_payment_ref)
   OR o.request_id IN(SELECT id FROM requests)
   OR o.payment_provider_ref IS NULL AND (o.payment_id IN(SELECT id FROM payment_ids) OR o.subscription_charge_receipt_id IN(SELECT id FROM source_receipts)) LIMIT 5001
 ), captures AS (
  SELECT c.* FROM merchant_refund_observation_captures c WHERE c.observation_id IN(SELECT id FROM observations) LIMIT 5001
 ), dispatches AS (
  SELECT d.* FROM merchant_refund_dispatches d WHERE d.request_id IN(SELECT id FROM requests) LIMIT 5001
 ), fees AS (
  SELECT f.* FROM merchant_fee_refunds f WHERE f.payment_id IN(SELECT id FROM payment_ids) OR f.original_charge_receipt_id IN(SELECT id FROM source_receipts) LIMIT 5001
 ), inspections AS (
  SELECT i.* FROM merchant_cash_return_inspections i,original p
  WHERE i.provider_platform_account_id=p.provider_platform_account_id AND i.charge_account_id IS NOT DISTINCT FROM p.charge_account_id
   AND i.original_payment_ref=p.original_payment_ref LIMIT 5001
 ), resolutions AS (
  SELECT r.* FROM merchant_unapplied_charge_resolutions r,original p
  WHERE r.provider_platform_account_id=p.provider_platform_account_id AND r.charge_account_id IS NOT DISTINCT FROM p.charge_account_id
   AND r.original_payment_ref=p.original_payment_ref LIMIT 5001
 ), facts AS (
  SELECT 'request' AS domain,r.id::text AS identity,to_jsonb(r) AS body FROM requests r
  UNION ALL SELECT 'observation',o.id::text,to_jsonb(o) FROM observations o WHERE o.id IS DISTINCT FROM exclude_observation
  UNION ALL SELECT 'capture',c.id::text,to_jsonb(c) FROM captures c WHERE c.id IS DISTINCT FROM exclude_capture
  UNION ALL SELECT 'dispatch',d.id::text,to_jsonb(d) FROM dispatches d
  UNION ALL SELECT 'finish',f.dispatch_id::text,to_jsonb(f) FROM merchant_refund_dispatch_finishes f WHERE f.dispatch_id IN(SELECT id FROM dispatches)
  UNION ALL SELECT 'stop',s.dispatch_id::text,to_jsonb(s) FROM merchant_refund_dispatch_stops s WHERE s.dispatch_id IN(SELECT id FROM dispatches)
  UNION ALL SELECT 'refusal',r.dispatch_id::text,to_jsonb(r) FROM merchant_refund_creation_refusals r WHERE r.dispatch_id IN(SELECT id FROM dispatches)
  UNION ALL SELECT 'retirement',r.request_id::text,to_jsonb(r) FROM merchant_refund_reservation_retirements r WHERE r.request_id IN(SELECT id FROM requests)
  UNION ALL SELECT 'terminal',t.request_id::text,to_jsonb(t) FROM merchant_refund_terminal_receipts t WHERE t.request_id IN(SELECT id FROM requests)
  UNION ALL SELECT 'binding',b.id::text,to_jsonb(b) FROM merchant_refund_resource_bindings b WHERE b.request_id IN(SELECT id FROM requests)
  UNION ALL SELECT 'payment_cash',c.id::text,to_jsonb(c) FROM payment_cash c
  UNION ALL SELECT 'receipt',r.id::text,to_jsonb(r) FROM source_receipts r
  UNION ALL SELECT 'subscription_cash',c.id::text,to_jsonb(c) FROM subscription_provider_charge_observations c,original p
   WHERE c.provider_platform_account_id=p.provider_platform_account_id AND c.charge_account_id IS NOT DISTINCT FROM p.charge_account_id AND c.provider_payment_intent_ref=p.original_payment_ref
  UNION ALL SELECT 'alias',a.payment_id::text,to_jsonb(a) FROM aliases a
  UNION ALL SELECT 'fee',f.id::text,to_jsonb(f) FROM fees f
  UNION ALL SELECT 'fee_observation',o.id::text,to_jsonb(o) FROM merchant_fee_observations o WHERE o.operation_id IN(SELECT id FROM fees)
  UNION ALL SELECT 'inspection',i.id::text,to_jsonb(i) FROM inspections i
  UNION ALL SELECT 'inspection_finish',f.inspection_id::text,to_jsonb(f) FROM merchant_cash_return_inspection_finishes f WHERE f.inspection_id IN(SELECT id FROM inspections)
  UNION ALL SELECT 'primary',o.id::text,to_jsonb(o) FROM merchant_cash_return_primary_observations o WHERE o.inspection_id IN(SELECT id FROM inspections)
  UNION ALL SELECT 'cash_state',o.id::text,to_jsonb(o) FROM merchant_cash_return_observations o WHERE o.inspection_id IN(SELECT id FROM inspections)
  UNION ALL SELECT 'resolution',r.id::text,to_jsonb(r) FROM resolutions r
  UNION ALL SELECT 'resolution_refund',r.resolution_id::text||':'||r.observation_id::text,to_jsonb(r) FROM merchant_unapplied_charge_resolution_refunds r WHERE r.resolution_id IN(SELECT id FROM resolutions)
 ), bounded AS (SELECT * FROM facts LIMIT 5001)
 SELECT encode(sha256(convert_to(coalesce(string_agg(domain||':'||identity||':'||body::text,E'\n' ORDER BY domain,identity),''),'UTF8')),'hex'),
  count(*)>5000 OR NOT EXISTS(SELECT 1 FROM original),
  coalesce((SELECT jsonb_agg(id::text ORDER BY id) FROM observations),'[]'::jsonb)
 FROM bounded
$$;
--> statement-breakpoint
CREATE FUNCTION freeholder_refund_current_creators_quiesced(target_request uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 WITH original AS (SELECT * FROM merchant_refund_requests WHERE id=target_request),
 requests AS (SELECT r.* FROM merchant_refund_requests r,original p WHERE r.provider_platform_account_id=p.provider_platform_account_id
  AND r.charge_account_id IS NOT DISTINCT FROM p.charge_account_id AND r.original_payment_ref=p.original_payment_ref),
 payment_ids AS (
  SELECT payment_id AS id FROM requests WHERE payment_id IS NOT NULL
  UNION SELECT a.payment_id FROM merchant_agreement_payment_routes a JOIN subscription_provider_charge_receipts r ON r.id=a.original_charge_receipt_id,original p
   WHERE r.provider_platform_account_id=p.provider_platform_account_id AND r.charge_account_id IS NOT DISTINCT FROM p.charge_account_id AND r.provider_payment_intent_ref=p.original_payment_ref
 )
 SELECT EXISTS(SELECT 1 FROM original)
 AND NOT EXISTS(SELECT 1 FROM merchant_refund_dispatches d WHERE d.request_id IN(SELECT id FROM requests)
  AND NOT EXISTS(SELECT 1 FROM merchant_refund_dispatch_finishes f WHERE f.dispatch_id=d.id AND f.caller_instance_id=(d.caller->>'id')::uuid)
  AND NOT EXISTS(SELECT 1 FROM merchant_refund_dispatch_stops s WHERE s.dispatch_id=d.id AND s.caller_instance_id=(d.caller->>'id')::uuid AND s.request_digest=d.request_digest))
 AND NOT EXISTS(SELECT 1 FROM merchant_payment_dispatches d WHERE d.payment_id IN(SELECT id FROM payment_ids)
  AND NOT EXISTS(SELECT 1 FROM merchant_payment_dispatch_finishes f WHERE f.dispatch_id=d.id AND f.caller_instance_id=(d.caller->>'id')::uuid)
  AND NOT EXISTS(SELECT 1 FROM merchant_payment_dispatch_stops s WHERE s.dispatch_id=d.id AND s.caller_instance_id=(d.caller->>'id')::uuid AND s.request_digest=d.request_digest))
$$;
--> statement-breakpoint
CREATE FUNCTION freeholder_refund_capture_lock() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE fact merchant_refund_observations%ROWTYPE; lock_key text;
BEGIN
 SELECT * INTO fact FROM merchant_refund_observations WHERE id=NEW.observation_id;
 IF fact.id IS NULL THEN RAISE EXCEPTION 'Restore the actual primary refund observation before its capture' USING ERRCODE='23514'; END IF;
 -- Lock original owning cash even for a nullable/foreign claimed PI. Such raw
 -- facts remain nonbinding, but cannot race a current-state closure unnoticed.
 FOR lock_key IN SELECT DISTINCT k FROM (
  SELECT 'subscription-cash:'||r.provider_platform_account_id||':'||coalesce(r.charge_account_id,'')||':'||r.original_payment_ref AS k
   FROM merchant_refund_requests r WHERE r.id=fact.request_id OR r.payment_id=fact.payment_id OR r.subscription_charge_receipt_id=fact.subscription_charge_receipt_id
  UNION ALL SELECT 'subscription-cash:'||fact.provider_platform_account_id||':'||coalesce(fact.charge_account_id,'')||':'||fact.payment_provider_ref WHERE fact.payment_provider_ref IS NOT NULL
 ) keys ORDER BY k LOOP PERFORM pg_advisory_xact_lock(hashtext(lock_key)); END LOOP;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER original_refund_capture_lock BEFORE INSERT ON merchant_refund_observation_captures FOR EACH ROW EXECUTE FUNCTION freeholder_refund_capture_lock();
--> statement-breakpoint
CREATE FUNCTION freeholder_refund_current_read_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original merchant_refund_requests%ROWTYPE; source_read merchant_refund_state_reads%ROWTYPE;
 binding merchant_refund_resource_bindings%ROWTYPE; finished merchant_refund_state_read_finishes%ROWTYPE;
 captured merchant_refund_observation_captures%ROWTYPE; fact merchant_refund_observations%ROWTYPE;
 current_revision record; prior_revision record; ignored_observation uuid;
BEGIN
 IF TG_TABLE_NAME='merchant_refund_state_reads' THEN
  SELECT * INTO original FROM merchant_refund_requests WHERE id=NEW.request_id;
 ELSE
  SELECT * INTO source_read FROM merchant_refund_state_reads WHERE id=NEW.read_id;
  SELECT * INTO original FROM merchant_refund_requests WHERE id=source_read.request_id;
 END IF;
 IF original.id IS NULL THEN RAISE EXCEPTION 'Restore the exact original current-read request' USING ERRCODE='23514'; END IF;
 IF original.refund_id IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtext('refund:'||original.refund_id::text)); END IF;
 PERFORM pg_advisory_xact_lock(hashtext('subscription-cash:'||original.provider_platform_account_id||':'||coalesce(original.charge_account_id,'')||':'||original.original_payment_ref));
 IF TG_TABLE_NAME='merchant_refund_state_reads' THEN
  SELECT * INTO binding FROM merchant_refund_resource_bindings WHERE id=NEW.resource_binding_id;
  SELECT * INTO current_revision FROM freeholder_refund_current_revision(original.id);
  IF NEW.request_digest IS DISTINCT FROM original.request_digest OR binding.id IS NULL OR binding.request_id<>original.id
   OR EXISTS(SELECT 1 FROM merchant_refund_resource_bindings b WHERE b.request_id=original.id AND b.provider_ref<>binding.provider_ref)
   OR current_revision.incomplete OR NEW.source_revision IS DISTINCT FROM current_revision.revision
   OR NEW.source_observation_ids IS DISTINCT FROM current_revision.observation_ids
   OR NOT freeholder_refund_current_creators_quiesced(original.id)
   OR jsonb_typeof(NEW.caller)<>'object' OR NOT(NEW.caller ?& ARRAY['id','pid','host','startedAt','bootId','pidNamespace','startTicks']) THEN
   RAISE EXCEPTION 'A current read needs complete unchanged original cash, one bound resource and finished creators' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;
 IF source_read.id IS NULL OR source_read.request_digest IS DISTINCT FROM original.request_digest THEN
  RAISE EXCEPTION 'Restore the immutable original current-read admission' USING ERRCODE='23514';
 END IF;
 IF TG_TABLE_NAME='merchant_refund_state_read_finishes' THEN
  IF NEW.caller_instance_id IS DISTINCT FROM (source_read.caller->>'id')::uuid THEN
   RAISE EXCEPTION 'Only the actual original read caller can finish it' USING ERRCODE='23514';
  END IF;
  IF NEW.capture_id IS NOT NULL THEN
   SELECT * INTO captured FROM merchant_refund_observation_captures WHERE id=NEW.capture_id;
   IF captured.id IS NULL OR captured.capture_key IS DISTINCT FROM encode(sha256(convert_to('refund-state-read:'||source_read.id::text,'UTF8')),'hex') THEN
    RAISE EXCEPTION 'The actual current read must retain its own capture before completion' USING ERRCODE='23514';
   END IF;
  END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO finished FROM merchant_refund_state_read_finishes WHERE read_id=source_read.id;
 SELECT * INTO captured FROM merchant_refund_observation_captures WHERE id=NEW.capture_id;
 SELECT * INTO fact FROM merchant_refund_observations WHERE id=captured.observation_id;
 SELECT * INTO binding FROM merchant_refund_resource_bindings WHERE id=source_read.resource_binding_id;
 IF finished.read_id IS NULL OR finished.outcome<>'returned' OR finished.caller_instance_id IS DISTINCT FROM (source_read.caller->>'id')::uuid
  OR finished.capture_id IS DISTINCT FROM NEW.capture_id OR captured.id IS NULL OR fact.id IS NULL OR binding.id IS NULL
  OR captured.capture_key IS DISTINCT FROM encode(sha256(convert_to('refund-state-read:'||source_read.id::text,'UTF8')),'hex')
  OR NEW.request_id IS DISTINCT FROM original.id OR binding.request_id<>original.id OR fact.request_id IS DISTINCT FROM original.id
  OR fact.binding_verified IS DISTINCT FROM true OR fact.provider_ref IS DISTINCT FROM binding.provider_ref
  OR fact.provider_platform_account_id IS DISTINCT FROM original.provider_platform_account_id OR fact.charge_account_id IS DISTINCT FROM original.charge_account_id
  OR fact.provider_api_version IS DISTINCT FROM original.provider_api_version OR fact.payment_provider_ref IS DISTINCT FROM original.original_payment_ref
  OR fact.amount_minor IS DISTINCT FROM original.amount_minor OR fact.currency IS DISTINCT FROM original.currency
  OR NOT freeholder_refund_current_creators_quiesced(original.id) THEN
  RAISE EXCEPTION 'Current state needs the actual finished exact-original resource read, not historic success' USING ERRCODE='23514';
 END IF;
 ignored_observation:=CASE WHEN source_read.source_observation_ids ? fact.id::text THEN NULL ELSE fact.id END;
 SELECT * INTO prior_revision FROM freeholder_refund_current_revision(original.id,ignored_observation,captured.id);
 SELECT * INTO current_revision FROM freeholder_refund_current_revision(original.id);
 IF prior_revision.incomplete OR current_revision.incomplete OR prior_revision.revision IS DISTINCT FROM source_read.source_revision
  OR current_revision.revision IS DISTINCT FROM NEW.resolved_revision THEN
  RAISE EXCEPTION 'Concurrent retained refund evidence invalidates this current read; read the original resource again' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER original_refund_current_read BEFORE INSERT ON merchant_refund_state_reads FOR EACH ROW EXECUTE FUNCTION freeholder_refund_current_read_guard();
--> statement-breakpoint
CREATE TRIGGER original_refund_current_finish BEFORE INSERT ON merchant_refund_state_read_finishes FOR EACH ROW EXECUTE FUNCTION freeholder_refund_current_read_guard();
--> statement-breakpoint
CREATE TRIGGER original_refund_current_receipt BEFORE INSERT ON merchant_refund_current_receipts FOR EACH ROW EXECUTE FUNCTION freeholder_refund_current_read_guard();
--> statement-breakpoint
-- A stale receipt never selects an old success. Multiple contradictory valid
-- receipts are recovery, not a timestamp-based choice of one provider state.
CREATE FUNCTION freeholder_refund_current_state(target_request uuid)
RETURNS TABLE(receipt_id uuid,status text,observation_id uuid,has_receipts boolean) LANGUAGE plpgsql STABLE AS $$
DECLARE original merchant_refund_requests%ROWTYPE; current_revision record; candidate record; candidates integer:=0;
BEGIN
 receipt_id:=NULL; status:=NULL; observation_id:=NULL;
 has_receipts:=EXISTS(SELECT 1 FROM merchant_refund_current_receipts c WHERE c.request_id=target_request);
 SELECT * INTO original FROM merchant_refund_requests WHERE id=target_request;
 IF original.id IS NULL OR NOT has_receipts OR NOT freeholder_refund_current_creators_quiesced(target_request) THEN RETURN NEXT; RETURN; END IF;
 SELECT * INTO current_revision FROM freeholder_refund_current_revision(target_request);
 IF current_revision.incomplete THEN RETURN NEXT; RETURN; END IF;
 FOR candidate IN
  SELECT c.id AS receipt,o.id AS observation,o.status AS current_status
  FROM merchant_refund_current_receipts c
  JOIN merchant_refund_state_reads r ON r.id=c.read_id AND r.request_id=c.request_id AND r.request_digest=original.request_digest
  JOIN merchant_refund_state_read_finishes f ON f.read_id=r.id AND f.outcome='returned' AND f.caller_instance_id=(r.caller->>'id')::uuid AND f.capture_id=c.capture_id
  JOIN merchant_refund_observation_captures captured ON captured.id=c.capture_id
   AND captured.capture_key=encode(sha256(convert_to('refund-state-read:'||r.id::text,'UTF8')),'hex')
  JOIN merchant_refund_observations o ON o.id=captured.observation_id
  JOIN merchant_refund_resource_bindings b ON b.id=r.resource_binding_id AND b.request_id=original.id
  CROSS JOIN LATERAL freeholder_refund_current_revision(target_request,CASE WHEN r.source_observation_ids ? o.id::text THEN NULL ELSE o.id END,captured.id) prior
  WHERE c.request_id=target_request AND c.resolved_revision=current_revision.revision
   AND NOT prior.incomplete AND prior.revision=r.source_revision
   AND o.request_id=original.id AND o.binding_verified AND o.provider_ref=b.provider_ref
   AND o.provider_platform_account_id=original.provider_platform_account_id AND o.charge_account_id IS NOT DISTINCT FROM original.charge_account_id
   AND o.provider_api_version=original.provider_api_version AND o.payment_provider_ref=original.original_payment_ref
   AND o.amount_minor=original.amount_minor AND o.currency=original.currency
   AND NOT EXISTS(SELECT 1 FROM merchant_refund_resource_bindings other WHERE other.request_id=original.id AND other.provider_ref<>b.provider_ref)
  LIMIT 2
 LOOP
  candidates:=candidates+1; receipt_id:=candidate.receipt; observation_id:=candidate.observation; status:=candidate.current_status;
 END LOOP;
 IF candidates<>1 THEN receipt_id:=NULL; observation_id:=NULL; status:=NULL; END IF;
 RETURN NEXT;
END $$;
--> statement-breakpoint
-- Preserve every old caller/resource/retirement rule. A complete original
-- current read is the only way to supersede old bank-status contradictions.
CREATE OR REPLACE FUNCTION freeholder_original_refund_resolved(p_request_id uuid, outcome text, resource_ref text DEFAULT NULL) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE original merchant_refund_requests%ROWTYPE; resource text; resource_count integer; current_state record;
BEGIN
 SELECT * INTO original FROM merchant_refund_requests WHERE id=p_request_id;
 IF original.id IS NULL THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM merchant_refund_dispatches d WHERE d.request_id=original.id
  AND NOT EXISTS(SELECT 1 FROM merchant_refund_dispatch_finishes f WHERE f.dispatch_id=d.id AND f.caller_instance_id=(d.caller->>'id')::uuid)
  AND NOT EXISTS(SELECT 1 FROM merchant_refund_dispatch_stops s WHERE s.dispatch_id=d.id AND s.caller_instance_id=(d.caller->>'id')::uuid AND s.request_digest=d.request_digest)) THEN RETURN false; END IF;
 IF outcome='failed' AND EXISTS(SELECT 1 FROM merchant_refund_reservation_retirements r WHERE r.request_id=original.id AND r.request_digest=original.request_digest)
  AND NOT EXISTS(SELECT 1 FROM merchant_refund_dispatches WHERE request_id=original.id) THEN RETURN true; END IF;
 SELECT count(DISTINCT b.provider_ref),min(b.provider_ref) INTO resource_count,resource FROM merchant_refund_resource_bindings b WHERE b.request_id=original.id
  AND (b.origin='physical_ack' OR NOT EXISTS(SELECT 1 FROM merchant_refund_resource_bindings a WHERE a.request_id=original.id AND a.origin='physical_ack'));
 IF resource_count<>1 OR resource_ref IS NOT NULL AND resource_ref<>resource THEN RETURN false; END IF;
 SELECT * INTO current_state FROM freeholder_refund_current_state(original.id);
 IF current_state.has_receipts THEN
  RETURN coalesce(current_state.receipt_id IS NOT NULL AND ((outcome='succeeded' AND current_state.status='succeeded')
   OR(outcome='failed' AND current_state.status IN('failed','canceled'))),false);
 END IF;
 IF EXISTS(SELECT 1 FROM merchant_refund_observations o WHERE o.request_id=original.id AND o.provider_ref=resource AND o.binding_verified AND o.status='succeeded')
  AND EXISTS(SELECT 1 FROM merchant_refund_observations o WHERE o.request_id=original.id AND o.provider_ref=resource AND o.binding_verified AND(o.status IN('failed','canceled','requires_action','pending') OR o.status IS NULL)) THEN RETURN false; END IF;
 RETURN EXISTS(SELECT 1 FROM merchant_refund_observations o WHERE o.request_id=original.id AND o.provider_ref=resource AND o.binding_verified
  AND o.provider_platform_account_id=original.provider_platform_account_id AND o.charge_account_id IS NOT DISTINCT FROM original.charge_account_id
  AND o.provider_api_version=original.provider_api_version AND o.payment_provider_ref=original.original_payment_ref
  AND o.amount_minor=original.amount_minor AND o.currency=original.currency
  AND ((outcome='succeeded' AND o.status='succeeded') OR(outcome='failed' AND o.status IN('failed','canceled'))));
END $$;
--> statement-breakpoint
CREATE FUNCTION freeholder_refund_current_projection_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original merchant_refund_requests%ROWTYPE; current_state record; projected text;
BEGIN
 SELECT * INTO original FROM merchant_refund_requests WHERE refund_id=OLD.id;
 IF original.id IS NULL OR OLD.status=NEW.status OR OLD.status NOT IN('succeeded','failed','cancelled') THEN RETURN NEW; END IF;
 SELECT * INTO current_state FROM freeholder_refund_current_state(original.id);
 IF current_state.receipt_id IS NULL OR current_state.status IS NULL THEN
  RAISE EXCEPTION 'A bank reclassification needs an actual current original-resource receipt' USING ERRCODE='23514';
 END IF;
 projected:=CASE WHEN current_state.status='succeeded' THEN 'succeeded' WHEN current_state.status IN('failed','canceled') THEN 'failed' ELSE 'processing' END;
 IF NEW.status IS DISTINCT FROM projected THEN
  RAISE EXCEPTION 'The refund projection must follow its actual current bank state' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER original_refund_current_projection BEFORE UPDATE ON refunds FOR EACH ROW EXECUTE FUNCTION freeholder_refund_current_projection_guard();
--> statement-breakpoint
CREATE FUNCTION freeholder_refund_current_balance_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original merchant_refund_requests%ROWTYPE; payment payments%ROWTYPE; invoice invoices%ROWTYPE; returned numeric; invoice_returned numeric;
BEGIN
 SELECT * INTO original FROM merchant_refund_requests WHERE refund_id=NEW.id;
 IF original.id IS NULL OR NOT EXISTS(SELECT 1 FROM merchant_refund_current_receipts WHERE request_id=original.id) THEN RETURN NULL; END IF;
 SELECT * INTO payment FROM payments WHERE id=NEW.payment_id;
 SELECT * INTO invoice FROM invoices WHERE id=NEW.invoice_id;
 SELECT coalesce(sum(amount_minor) FILTER(WHERE status='succeeded'),0) INTO returned FROM refunds WHERE payment_id=NEW.payment_id;
 SELECT coalesce(sum(refunded_minor),0) INTO invoice_returned FROM payments WHERE invoice_id=NEW.invoice_id;
 IF payment.id IS NULL OR invoice.id IS NULL OR returned IS DISTINCT FROM payment.refunded_minor OR invoice_returned IS DISTINCT FROM invoice.refunded_minor
  OR EXISTS(SELECT 1 FROM refunds r WHERE r.payment_id=payment.id AND r.currency<>payment.currency)
  OR EXISTS(SELECT 1 FROM payments p WHERE p.invoice_id=invoice.id AND p.currency<>invoice.currency) THEN
  RAISE EXCEPTION 'Current bank projections and original payment/invoice cash totals must commit together' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER original_refund_current_balances AFTER UPDATE ON refunds DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
 WHEN(OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION freeholder_refund_current_balance_guard();
--> statement-breakpoint
