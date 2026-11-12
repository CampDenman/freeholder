-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C5.19/C12.38: UNASSEMBLED current-read receipts; never apply to preserved v9.
-- Append after the original refund schema/guards in a NEW unpublished80 build.
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
 CONSTRAINT merchant_refund_state_read_finishes_outcome CHECK(outcome IN('returned','threw') AND (outcome<>'returned' OR capture_id IS NOT NULL))
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
