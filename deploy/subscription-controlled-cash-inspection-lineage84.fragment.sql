-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C12.38/C1.08/C9.33. OWNED UNAPPLIED; NOT part of normal journal0--83.
-- Requires the genuine original controlled9 and independent inspection-stop143
-- cohorts. Append only in a NEW qualified migration; no old identities change.
CREATE SEQUENCE controlled_cash_read_admission_seq AS bigint MINVALUE 1 MAXVALUE 9007199254740991 START WITH 1 INCREMENT BY 1 CACHE 1 NO CYCLE;
--> statement-breakpoint
CREATE TABLE subscription_controlled_cash_inspection_lineages (
 inspection_id uuid PRIMARY KEY REFERENCES merchant_cash_return_inspections(id) ON DELETE RESTRICT,
 resource_id uuid NOT NULL REFERENCES subscription_controlled_resources(id) ON DELETE RESTRICT,
 receipt_id uuid NOT NULL REFERENCES subscription_provider_charge_receipts(id) ON DELETE RESTRICT,
 namespace_key text NOT NULL, admission_sequence bigint NOT NULL DEFAULT nextval('controlled_cash_read_admission_seq'::regclass),
 predecessor_inspection_id uuid, predecessor_digest text,
 closed_inspection_ids jsonb NOT NULL, closed_history_digest text NOT NULL,
 caller_instance_id uuid NOT NULL, admission_digest text NOT NULL, admission_fingerprint text NOT NULL,
 digest text NOT NULL, authentication text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT controlled_cash_lineage_predecessor FOREIGN KEY(predecessor_inspection_id) REFERENCES subscription_controlled_cash_inspection_lineages(inspection_id) ON DELETE RESTRICT,
 CONSTRAINT controlled_cash_lineage_sequence_bound CHECK(admission_sequence>0 AND admission_sequence<=9007199254740991),
 CONSTRAINT controlled_cash_lineage_previous CHECK(((predecessor_inspection_id IS NULL AND predecessor_digest IS NULL) OR (predecessor_inspection_id IS NOT NULL AND predecessor_inspection_id<>inspection_id AND predecessor_digest ~ '^[a-f0-9]{64}$')) IS TRUE),
 CONSTRAINT controlled_cash_lineage_closed CHECK(jsonb_typeof(closed_inspection_ids)='array' AND jsonb_array_length(closed_inspection_ids)<=5000),
 CONSTRAINT controlled_cash_lineage_digests CHECK(admission_digest ~ '^[a-f0-9]{64}$' AND admission_fingerprint ~ '^[a-f0-9]{64}$' AND closed_history_digest ~ '^[a-f0-9]{64}$' AND digest ~ '^[a-f0-9]{64}$' AND authentication ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER SEQUENCE controlled_cash_read_admission_seq OWNED BY subscription_controlled_cash_inspection_lineages.admission_sequence;
--> statement-breakpoint
CREATE UNIQUE INDEX controlled_cash_lineage_sequence ON subscription_controlled_cash_inspection_lineages(admission_sequence);
--> statement-breakpoint
CREATE UNIQUE INDEX controlled_cash_lineage_successor ON subscription_controlled_cash_inspection_lineages(namespace_key,predecessor_inspection_id);
--> statement-breakpoint
CREATE UNIQUE INDEX controlled_cash_lineage_root ON subscription_controlled_cash_inspection_lineages(namespace_key) WHERE predecessor_inspection_id IS NULL;
--> statement-breakpoint
CREATE INDEX controlled_cash_lineage_receipt ON subscription_controlled_cash_inspection_lineages(receipt_id);
--> statement-breakpoint
CREATE INDEX controlled_cash_lineage_resource ON subscription_controlled_cash_inspection_lineages(resource_id);
--> statement-breakpoint
-- This is ONLY the immutable admission/closure history. Raw bank callbacks,
-- money and observations remain in separate FULL CURRENT financial witnesses.
CREATE FUNCTION freeholder_controlled_cash_read_history(platform text,account text,intent text,except_inspection uuid)
RETURNS TABLE(inspection_ids uuid[],fingerprint text,row_count integer,closed boolean) LANGUAGE sql STABLE AS $$
 WITH admissions AS MATERIALIZED (
  SELECT a.* FROM merchant_cash_return_inspections a
  WHERE a.provider_platform_account_id=platform AND a.charge_account_id IS NOT DISTINCT FROM account
   AND a.original_payment_ref=intent AND a.id IS DISTINCT FROM except_inspection ORDER BY a.id LIMIT 5001
 ), finishes AS MATERIALIZED (
  SELECT f.* FROM merchant_cash_return_inspection_finishes f JOIN admissions a ON a.id=f.inspection_id ORDER BY f.inspection_id LIMIT 5001
 ), stops AS MATERIALIZED (
  SELECT s.* FROM merchant_cash_return_inspection_stops s JOIN admissions a ON a.id=s.inspection_id ORDER BY s.inspection_id LIMIT 5001
 ), facts AS (
  SELECT 'merchant_cash_return_inspections'::text AS family,a.id::text AS id,to_jsonb(a) AS fact FROM admissions a
  UNION ALL SELECT 'merchant_cash_return_inspection_finishes',f.inspection_id::text,to_jsonb(f) FROM finishes f
  UNION ALL SELECT 'merchant_cash_return_inspection_stops',s.inspection_id::text,to_jsonb(s) FROM stops s
 )
 SELECT ARRAY(SELECT a.id FROM admissions a ORDER BY a.id),
  encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_object('table',family,'id',id,'fact',fact) ORDER BY family,id),'[]'::jsonb)::text,'UTF8')),'hex'),
  count(*)::integer,
  count(*)<=5000 AND NOT EXISTS(SELECT 1 FROM admissions a LEFT JOIN finishes f ON f.inspection_id=a.id LEFT JOIN stops s ON s.inspection_id=a.id
   WHERE (f.inspection_id IS NULL AND s.inspection_id IS NULL) OR (f.inspection_id IS NOT NULL AND s.inspection_id IS NOT NULL)
    OR (f.inspection_id IS NOT NULL AND (f.caller_instance_id IS DISTINCT FROM (a.caller->>'id')::uuid OR f.outcome NOT IN ('returned','threw')))
    OR (s.inspection_id IS NOT NULL AND (s.caller_instance_id IS DISTINCT FROM (a.caller->>'id')::uuid
     OR s.admission_fingerprint IS DISTINCT FROM encode(sha256(convert_to(to_jsonb(a)::text,'UTF8')),'hex'))))
 FROM facts;
$$;
--> statement-breakpoint
CREATE FUNCTION freeholder_controlled_cash_lineage_writer() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE admitted merchant_cash_return_inspections%ROWTYPE; origin subscription_controlled_charge_origins%ROWTYPE;
 original_receipt subscription_provider_charge_receipts%ROWTYPE; previous subscription_controlled_cash_inspection_lineages%ROWTYPE;
 history record; birth_xid bigint; expected_namespace text;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Actual inspection admission lineages are immutable' USING ERRCODE='23514'; END IF;
 SELECT a.* INTO admitted FROM merchant_cash_return_inspections a WHERE a.id=NEW.inspection_id;
 -- xmin is used solely for SAME TRANSACTION birth equality, NEVER read order.
 SELECT a.xmin::text::bigint INTO birth_xid FROM merchant_cash_return_inspections a WHERE a.id=NEW.inspection_id;
 IF admitted.id IS NULL OR birth_xid IS DISTINCT FROM (pg_current_xact_id()::text::numeric % 4294967296)::bigint THEN
  RAISE EXCEPTION 'No retrospective lineage or fabricated legacy order; retain a genuinely new admission' USING ERRCODE='23514';
 END IF;
 expected_namespace:=admitted.provider_platform_account_id||':'||coalesce(admitted.charge_account_id,'')||':'||admitted.original_payment_ref;
 PERFORM pg_advisory_xact_lock(hashtext('subscription-cash:'||expected_namespace));
 PERFORM pg_advisory_xact_lock(hashtext('merchant-return-read:'||NEW.inspection_id::text));
 SELECT o.* INTO origin FROM subscription_controlled_charge_origins o
 LEFT JOIN merchant_agreement_payment_routes r ON r.original_charge_receipt_id=o.receipt_id
 WHERE (admitted.subscription_charge_receipt_id IS NOT NULL AND o.receipt_id=admitted.subscription_charge_receipt_id)
  OR (admitted.payment_id IS NOT NULL AND r.payment_id=admitted.payment_id);
 SELECT * INTO original_receipt FROM subscription_provider_charge_receipts WHERE id=origin.receipt_id;
 SELECT * INTO previous FROM subscription_controlled_cash_inspection_lineages WHERE namespace_key=expected_namespace ORDER BY admission_sequence DESC LIMIT 1;
 SELECT * INTO history FROM freeholder_controlled_cash_read_history(admitted.provider_platform_account_id,admitted.charge_account_id,admitted.original_payment_ref,admitted.id);
 IF origin.receipt_id IS NULL OR NEW.receipt_id IS DISTINCT FROM origin.receipt_id OR NEW.resource_id IS DISTINCT FROM origin.resource_id
  OR original_receipt.provider_platform_account_id IS DISTINCT FROM admitted.provider_platform_account_id
  OR original_receipt.charge_account_id IS DISTINCT FROM admitted.charge_account_id
  OR original_receipt.provider_payment_intent_ref IS DISTINCT FROM admitted.original_payment_ref
  OR NEW.namespace_key IS DISTINCT FROM expected_namespace OR NEW.caller_instance_id IS DISTINCT FROM (admitted.caller->>'id')::uuid
  OR NEW.admission_fingerprint IS DISTINCT FROM encode(sha256(convert_to(to_jsonb(admitted)::text,'UTF8')),'hex')
  OR NEW.admission_sequence IS DISTINCT FROM currval('controlled_cash_read_admission_seq'::regclass)
  OR NEW.predecessor_inspection_id IS DISTINCT FROM previous.inspection_id OR NEW.predecessor_digest IS DISTINCT FROM previous.digest
  OR (previous.inspection_id IS NOT NULL AND NEW.admission_sequence<=previous.admission_sequence)
  OR NOT history.closed OR NEW.closed_inspection_ids IS DISTINCT FROM to_jsonb(history.inspection_ids)
  OR NEW.closed_history_digest IS DISTINCT FROM history.fingerprint
  OR EXISTS(SELECT 1 FROM merchant_cash_return_inspection_finishes WHERE inspection_id=admitted.id)
  OR EXISTS(SELECT 1 FROM merchant_cash_return_inspection_stops WHERE inspection_id=admitted.id)
  OR EXISTS(SELECT 1 FROM merchant_cash_return_primary_observations WHERE inspection_id=admitted.id)
  OR EXISTS(SELECT 1 FROM merchant_cash_return_observations WHERE inspection_id=admitted.id)
  OR EXISTS(SELECT 1 FROM merchant_refund_observations WHERE inspection_id=admitted.id) THEN
  RAISE EXCEPTION 'Bind the genuine original controlled admission, namespace predecessor and complete closed history before any SDK callback' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER controlled_cash_lineage_writer BEFORE INSERT OR UPDATE OR DELETE ON subscription_controlled_cash_inspection_lineages FOR EACH ROW EXECUTE FUNCTION freeholder_controlled_cash_lineage_writer();
--> statement-breakpoint
-- An old runtime must not create a NEW unsequenced controlled admission. The
-- deferred check lets the actual trusted writer insert its child in the same TX.
CREATE FUNCTION freeholder_controlled_cash_admission_lineage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM subscription_controlled_charge_origins o JOIN subscription_provider_charge_receipts receipt ON receipt.id=o.receipt_id
  WHERE receipt.provider_platform_account_id=NEW.provider_platform_account_id AND receipt.charge_account_id IS NOT DISTINCT FROM NEW.charge_account_id AND receipt.provider_payment_intent_ref=NEW.original_payment_ref)
  AND NOT EXISTS(SELECT 1 FROM subscription_controlled_cash_inspection_lineages l WHERE l.inspection_id=NEW.id) THEN
  RAISE EXCEPTION 'Every genuinely new controlled inspection requires its atomic actual admission lineage; no legacy backfill' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER controlled_cash_admission_lineage AFTER INSERT ON merchant_cash_return_inspections DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION freeholder_controlled_cash_admission_lineage();
--> statement-breakpoint
-- Mechanical current-order selector ONLY. The ordinary reader must additionally
-- authenticate HMAC ancestry, full bank facts and full CURRENT financial graph.
CREATE FUNCTION freeholder_controlled_cash_read_latest(actual_receipt_id uuid) RETURNS uuid LANGUAGE plpgsql STABLE AS $$
DECLARE original_receipt subscription_provider_charge_receipts%ROWTYPE; latest subscription_controlled_cash_inspection_lineages%ROWTYPE; history record;
BEGIN
 SELECT * INTO original_receipt FROM subscription_provider_charge_receipts WHERE id=actual_receipt_id;
 IF original_receipt.id IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO latest FROM subscription_controlled_cash_inspection_lineages
 WHERE namespace_key=original_receipt.provider_platform_account_id||':'||coalesce(original_receipt.charge_account_id,'')||':'||original_receipt.provider_payment_intent_ref ORDER BY admission_sequence DESC LIMIT 1;
 IF latest.inspection_id IS NULL OR latest.receipt_id IS DISTINCT FROM actual_receipt_id THEN RETURN NULL; END IF;
 SELECT * INTO history FROM freeholder_controlled_cash_read_history(original_receipt.provider_platform_account_id,original_receipt.charge_account_id,original_receipt.provider_payment_intent_ref,latest.inspection_id);
 IF NOT history.closed OR latest.closed_inspection_ids IS DISTINCT FROM to_jsonb(history.inspection_ids) OR latest.closed_history_digest IS DISTINCT FROM history.fingerprint
  OR NOT EXISTS(SELECT 1 FROM merchant_cash_return_inspection_finishes f JOIN merchant_cash_return_inspections a ON a.id=f.inspection_id
   WHERE f.inspection_id=latest.inspection_id AND f.caller_instance_id=(a.caller->>'id')::uuid AND f.outcome='returned')
  OR EXISTS(SELECT 1 FROM merchant_cash_return_inspection_stops s WHERE s.inspection_id=latest.inspection_id)
  OR EXISTS(SELECT 1 FROM (
   SELECT l.*,lag(l.inspection_id) OVER(ORDER BY l.admission_sequence) AS previous_id,lag(l.digest) OVER(ORDER BY l.admission_sequence) AS previous_digest
   FROM subscription_controlled_cash_inspection_lineages l WHERE l.namespace_key=latest.namespace_key
  ) chain WHERE chain.predecessor_inspection_id IS DISTINCT FROM chain.previous_id OR chain.predecessor_digest IS DISTINCT FROM chain.previous_digest)
 THEN RETURN NULL; END IF;
 RETURN latest.inspection_id;
END $$;
