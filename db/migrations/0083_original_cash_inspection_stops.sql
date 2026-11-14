-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C12.38/C1.08/C11.10. OWNED UNAPPLIED current-family143 tail.
-- Append after root's exact current83 assembly; never edit migrations0--82.
-- The protocol marker is a trusted writer ABI, not a DB-owner security ACL.
CREATE TABLE merchant_cash_return_inspection_stops (
 inspection_id uuid PRIMARY KEY REFERENCES merchant_cash_return_inspections(id) ON DELETE RESTRICT,
 caller_instance_id uuid NOT NULL, admission_digest text NOT NULL, admission_fingerprint text NOT NULL,
 source_revision text NOT NULL, mechanical_check text NOT NULL, hosting_evidence_digest text NOT NULL,
 reviewed_by text NOT NULL, digest text NOT NULL, authentication text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT merchant_cash_inspection_stop_digests CHECK(admission_digest ~ '^[a-f0-9]{64}$' AND admission_fingerprint ~ '^[a-f0-9]{64}$' AND source_revision ~ '^[a-f0-9]{64}$' AND hosting_evidence_digest ~ '^[a-f0-9]{64}$' AND digest ~ '^[a-f0-9]{64}$' AND authentication ~ '^[a-f0-9]{64}$'),
 CONSTRAINT merchant_cash_inspection_stop_kind CHECK(mechanical_check IN ('original_process_absent')),
 CONSTRAINT merchant_cash_inspection_stop_reviewer CHECK(reviewed_by ~ '^user:[0-9a-f-]{36}$')
);
--> statement-breakpoint
CREATE FUNCTION freeholder_cash_inspection_stop_writer() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE admitted merchant_cash_return_inspections%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Original cash inspection stop receipts are immutable' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('merchant-return-read:'||NEW.inspection_id::text));
 SELECT * INTO admitted FROM merchant_cash_return_inspections WHERE id=NEW.inspection_id;
 IF current_setting('freeholder.cash_inspection_stop_v1',true) IS DISTINCT FROM NEW.inspection_id::text
  OR admitted.id IS NULL OR NEW.caller_instance_id IS DISTINCT FROM (admitted.caller->>'id')::uuid
  OR NEW.admission_fingerprint IS DISTINCT FROM encode(sha256(convert_to(to_jsonb(admitted)::text,'UTF8')),'hex')
  OR coalesce(admitted.caller->>'bootId','')='' OR coalesce(admitted.caller->>'pidNamespace','')=''
  OR coalesce(admitted.caller->>'host','')='' OR coalesce(admitted.caller->>'startTicks','')!~'^\d+$'
  OR coalesce(admitted.caller->>'pid','')!~'^[1-9][0-9]*$' OR coalesce(admitted.caller->>'startedAt','')=''
  OR EXISTS(SELECT 1 FROM merchant_cash_return_inspection_finishes f WHERE f.inspection_id=admitted.id) THEN
  RAISE EXCEPTION 'Use fresh human review of the exact original admitted process and current namespace; never invent a bank finish' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER merchant_cash_inspection_stop_writer BEFORE INSERT OR UPDATE OR DELETE ON merchant_cash_return_inspection_stops FOR EACH ROW EXECUTE FUNCTION freeholder_cash_inspection_stop_writer();
--> statement-breakpoint
CREATE FUNCTION freeholder_cash_inspection_after_stop() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.inspection_id IS NOT NULL THEN
  PERFORM pg_advisory_xact_lock(hashtext('merchant-return-read:'||NEW.inspection_id::text));
  IF EXISTS(SELECT 1 FROM merchant_cash_return_inspection_stops s WHERE s.inspection_id=NEW.inspection_id) THEN
   RAISE EXCEPTION 'A stopped original inspection cannot append callbacks or fabricate its wrapper finish; retain later raw ingress independently' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER cash_inspection_finish_after_stop BEFORE INSERT ON merchant_cash_return_inspection_finishes FOR EACH ROW EXECUTE FUNCTION freeholder_cash_inspection_after_stop();
--> statement-breakpoint
CREATE TRIGGER cash_inspection_primary_after_stop BEFORE INSERT ON merchant_cash_return_primary_observations FOR EACH ROW EXECUTE FUNCTION freeholder_cash_inspection_after_stop();
--> statement-breakpoint
CREATE TRIGGER cash_inspection_state_after_stop BEFORE INSERT ON merchant_cash_return_observations FOR EACH ROW EXECUTE FUNCTION freeholder_cash_inspection_after_stop();
--> statement-breakpoint
CREATE TRIGGER cash_inspection_refund_after_stop BEFORE INSERT ON merchant_refund_observations FOR EACH ROW EXECUTE FUNCTION freeholder_cash_inspection_after_stop();
