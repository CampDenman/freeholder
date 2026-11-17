-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
-- C12.38/C11.05: certify the immutable controlled journal from its actual per-resource row ledger.
ALTER TABLE subscription_controlled_row_hashes ADD COLUMN resource_id uuid;
--> statement-breakpoint
CREATE FUNCTION freeholder_controlled_row_resource(source_table text,source_id uuid) RETURNS uuid LANGUAGE plpgsql STABLE AS $$
DECLARE identity uuid;
BEGIN
 SELECT CASE source_table
  WHEN 'subscription_controlled_resources' THEN (SELECT r.id FROM subscription_controlled_resources r WHERE r.id=source_id)
  WHEN 'subscription_controlled_operations' THEN (SELECT o.resource_id FROM subscription_controlled_operations o WHERE o.id=source_id)
  WHEN 'subscription_controlled_calls' THEN (SELECT o.resource_id FROM subscription_controlled_calls c JOIN subscription_controlled_operations o ON o.id=c.operation_id WHERE c.id=source_id)
  WHEN 'subscription_controlled_facts' THEN (SELECT o.resource_id FROM subscription_controlled_facts f JOIN subscription_controlled_calls c ON c.id=f.call_id JOIN subscription_controlled_operations o ON o.id=c.operation_id WHERE f.id=source_id)
  WHEN 'subscription_controlled_finishes' THEN (SELECT o.resource_id FROM subscription_controlled_finishes f JOIN subscription_controlled_calls c ON c.id=f.call_id JOIN subscription_controlled_operations o ON o.id=c.operation_id WHERE f.call_id=source_id)
  WHEN 'subscription_controlled_stops' THEN (SELECT o.resource_id FROM subscription_controlled_stops s JOIN subscription_controlled_calls c ON c.id=s.call_id JOIN subscription_controlled_operations o ON o.id=c.operation_id WHERE s.call_id=source_id)
  WHEN 'subscription_controlled_verifications' THEN (SELECT o.resource_id FROM subscription_controlled_verifications v JOIN subscription_controlled_operations o ON o.id=v.operation_id WHERE v.operation_id=source_id)
  WHEN 'subscription_controlled_charge_origins' THEN (SELECT o.resource_id FROM subscription_controlled_charge_origins o WHERE o.receipt_id=source_id)
  WHEN 'subscription_controlled_closures' THEN (SELECT c.resource_id FROM subscription_controlled_closures c WHERE c.resource_id=source_id)
  ELSE NULL END INTO identity;
 RETURN identity;
END $$;
--> statement-breakpoint
CREATE FUNCTION freeholder_controlled_row_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 NEW.resource_id:=freeholder_controlled_row_resource(NEW.table_name,NEW.row_id);
 IF NEW.resource_id IS NULL THEN RAISE EXCEPTION 'Controlled row hashes require their actual journal resource' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TABLE subscription_controlled_journal_heads (
 resource_id uuid PRIMARY KEY REFERENCES subscription_controlled_resources(id) ON DELETE RESTRICT,
 fingerprint text NOT NULL,
 counts jsonb NOT NULL,
 physical_count integer NOT NULL,
 physical_bytes bigint NOT NULL,
 CONSTRAINT subscription_controlled_journal_heads_value CHECK(fingerprint ~ '^[a-f0-9]{64}$' AND jsonb_typeof(counts)='object' AND physical_count>=1 AND physical_bytes>=0)
);
--> statement-breakpoint
CREATE FUNCTION freeholder_controlled_journal_head_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_setting('freeholder.controlled_journal_head_internal',true) IS DISTINCT FROM '1' THEN
  RAISE EXCEPTION 'Controlled journal heads are written only by their actual row ledger' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION freeholder_controlled_journal_head_refresh(target uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 PERFORM set_config('freeholder.controlled_journal_head_internal','1',true);
 INSERT INTO subscription_controlled_journal_heads(resource_id,fingerprint,counts,physical_count,physical_bytes)
 SELECT r.resource_id,
  encode(sha256(convert_to(jsonb_agg(jsonb_build_array(r.table_name,r.row_id,r.row_sha256) ORDER BY r.table_name,r.row_id)::text,'UTF8')),'hex'),
  jsonb_build_object('resources',count(*) FILTER(WHERE r.table_name='subscription_controlled_resources'),
   'operations',count(*) FILTER(WHERE r.table_name='subscription_controlled_operations'),
   'calls',count(*) FILTER(WHERE r.table_name='subscription_controlled_calls'),
   'facts',count(*) FILTER(WHERE r.table_name='subscription_controlled_facts'),
   'finishes',count(*) FILTER(WHERE r.table_name='subscription_controlled_finishes'),
   'stops',count(*) FILTER(WHERE r.table_name='subscription_controlled_stops'),
   'verifications',count(*) FILTER(WHERE r.table_name='subscription_controlled_verifications'),
   'chargeOrigins',count(*) FILTER(WHERE r.table_name='subscription_controlled_charge_origins'),
   'closures',count(*) FILTER(WHERE r.table_name='subscription_controlled_closures')),
  count(*)::integer,sum(r.row_bytes)::bigint
 FROM subscription_controlled_row_hashes r WHERE r.resource_id=target GROUP BY r.resource_id
 ON CONFLICT(resource_id) DO UPDATE SET fingerprint=EXCLUDED.fingerprint,counts=EXCLUDED.counts,physical_count=EXCLUDED.physical_count,physical_bytes=EXCLUDED.physical_bytes;
 PERFORM set_config('freeholder.controlled_journal_head_internal','0',true);
END $$;
--> statement-breakpoint
CREATE FUNCTION freeholder_controlled_journal_head_capture() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM freeholder_controlled_journal_head_refresh(NEW.resource_id);
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER controlled_row_scope BEFORE INSERT ON subscription_controlled_row_hashes FOR EACH ROW EXECUTE FUNCTION freeholder_controlled_row_scope();
--> statement-breakpoint
CREATE TRIGGER controlled_journal_head_capture AFTER INSERT ON subscription_controlled_row_hashes FOR EACH ROW EXECUTE FUNCTION freeholder_controlled_journal_head_capture();
--> statement-breakpoint
CREATE TRIGGER controlled_journal_head_guard BEFORE INSERT OR UPDATE OR DELETE ON subscription_controlled_journal_heads FOR EACH ROW EXECUTE FUNCTION freeholder_controlled_journal_head_guard();
--> statement-breakpoint
SELECT set_config('freeholder.controlled_row_hash_internal','1',true);
--> statement-breakpoint
UPDATE subscription_controlled_row_hashes h SET resource_id=freeholder_controlled_row_resource(h.table_name,h.row_id);
--> statement-breakpoint
SELECT set_config('freeholder.controlled_row_hash_internal','0',true);
--> statement-breakpoint
ALTER TABLE subscription_controlled_row_hashes ADD CONSTRAINT subscription_controlled_row_hashes_resource_fk FOREIGN KEY(resource_id) REFERENCES subscription_controlled_resources(id) ON DELETE RESTRICT;
--> statement-breakpoint
CREATE INDEX subscription_controlled_row_hashes_resource ON subscription_controlled_row_hashes(resource_id);
--> statement-breakpoint
SELECT freeholder_controlled_journal_head_refresh(r.resource_id) FROM (SELECT DISTINCT resource_id FROM subscription_controlled_row_hashes) r;
--> statement-breakpoint
ALTER TABLE subscription_controlled_journal_heads ADD CONSTRAINT subscription_controlled_journal_heads_counts CHECK(
 counts->>'resources'~'^[0-9]+$' AND counts->>'operations'~'^[0-9]+$' AND counts->>'calls'~'^[0-9]+$'
 AND counts->>'facts'~'^[0-9]+$' AND counts->>'finishes'~'^[0-9]+$' AND counts->>'stops'~'^[0-9]+$'
 AND counts->>'verifications'~'^[0-9]+$' AND counts->>'chargeOrigins'~'^[0-9]+$' AND counts->>'closures'~'^[0-9]+$'
);
