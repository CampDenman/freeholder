-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C5.19/C12.38: UNASSEMBLED. Append only after complete e783+later owned80
-- fragments in a NEW candidate/database. Never apply to a preserved prototype.
CREATE TABLE legacy_bank_reads (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), refund_id uuid NOT NULL REFERENCES refunds(id) ON DELETE RESTRICT,
 original jsonb NOT NULL, original_digest text NOT NULL, caller jsonb NOT NULL, completion_nonce_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT legacy_bank_reads_digest CHECK(original_digest ~ '^[a-f0-9]{64}$' AND completion_nonce_hash ~ '^[a-f0-9]{64}$'),
 CONSTRAINT legacy_bank_reads_original CHECK((jsonb_typeof(original)='object' AND (original->>'refundId')::uuid=refund_id
  AND original->'originalCreatePlatformAccountId'='null'::jsonb AND original->'originalCreateProtocolVersion'='null'::jsonb) IS TRUE),
 CONSTRAINT legacy_bank_reads_caller CHECK(jsonb_typeof(caller)='object' AND (caller->>'id')::uuid IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX legacy_bank_reads_refund_idx ON legacy_bank_reads(refund_id);
--> statement-breakpoint
CREATE TABLE legacy_bank_read_facts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), read_id uuid NOT NULL REFERENCES legacy_bank_reads(id) ON DELETE RESTRICT,
 sequence integer NOT NULL, kind text NOT NULL, evidence jsonb NOT NULL, evidence_digest text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT legacy_bank_read_facts_evidence CHECK(sequence BETWEEN 1 AND 5005 AND evidence_digest ~ '^[a-f0-9]{64}$' AND jsonb_typeof(evidence)='object'),
 CONSTRAINT legacy_bank_read_facts_kind CHECK(kind IN('exact_refund','primary_cash','inventory_refund','cash_inventory'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX legacy_bank_read_facts_sequence_idx ON legacy_bank_read_facts(read_id,sequence);
--> statement-breakpoint
CREATE TABLE legacy_bank_read_finishes (
 read_id uuid PRIMARY KEY REFERENCES legacy_bank_reads(id) ON DELETE RESTRICT,
 caller_instance_id uuid NOT NULL, outcome text NOT NULL, fact_count integer NOT NULL, facts_digest text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT legacy_bank_read_finishes_inventory CHECK(fact_count BETWEEN 0 AND 5005 AND facts_digest ~ '^[a-f0-9]{64}$'),
 CONSTRAINT legacy_bank_read_finishes_outcome CHECK(outcome IN('returned','threw'))
);
--> statement-breakpoint
CREATE FUNCTION freeholder_guard_legacy_bank_read() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent legacy_bank_reads; actual_count integer; actual_digest text;
BEGIN
 IF TG_OP<>'INSERT' OR current_setting('freeholder.legacy_bank_read_v1',true) IS DISTINCT FROM '1' THEN
  RAISE EXCEPTION 'Original legacy bank read evidence requires its shared service and is immutable' USING ERRCODE='55000';
 END IF;
 IF TG_TABLE_NAME='legacy_bank_read_facts' THEN
  SELECT * INTO parent FROM legacy_bank_reads WHERE id=NEW.read_id FOR UPDATE;
  IF parent.id IS NULL OR EXISTS(SELECT 1 FROM legacy_bank_read_finishes WHERE read_id=NEW.read_id)
   OR NEW.sequence<>(SELECT count(*)+1 FROM legacy_bank_read_facts WHERE read_id=NEW.read_id)
   OR octet_length(NEW.evidence::text)>4194304 THEN
   RAISE EXCEPTION 'Restore the exact unfinished original read and contiguous bounded facts' USING ERRCODE='55000';
  END IF;
 ELSIF TG_TABLE_NAME='legacy_bank_read_finishes' THEN
  SELECT * INTO parent FROM legacy_bank_reads WHERE id=NEW.read_id FOR UPDATE;
  SELECT count(*)::integer,encode(sha256(convert_to(coalesce(string_agg(evidence_digest,',' ORDER BY sequence),''),'UTF8')),'hex')
   INTO actual_count,actual_digest FROM legacy_bank_read_facts WHERE read_id=NEW.read_id;
  IF parent.id IS NULL OR NEW.caller_instance_id IS DISTINCT FROM (parent.caller->>'id')::uuid
   OR NEW.fact_count IS DISTINCT FROM actual_count OR NEW.facts_digest IS DISTINCT FROM actual_digest THEN
   RAISE EXCEPTION 'Restore the actual original read caller and complete callback inventory before its finish' USING ERRCODE='55000';
  END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER legacy_bank_reads_guard BEFORE INSERT OR UPDATE OR DELETE ON legacy_bank_reads FOR EACH ROW EXECUTE FUNCTION freeholder_guard_legacy_bank_read();
--> statement-breakpoint
CREATE TRIGGER legacy_bank_read_facts_guard BEFORE INSERT OR UPDATE OR DELETE ON legacy_bank_read_facts FOR EACH ROW EXECUTE FUNCTION freeholder_guard_legacy_bank_read();
--> statement-breakpoint
CREATE TRIGGER legacy_bank_read_finishes_guard BEFORE INSERT OR UPDATE OR DELETE ON legacy_bank_read_finishes FOR EACH ROW EXECUTE FUNCTION freeholder_guard_legacy_bank_read();
