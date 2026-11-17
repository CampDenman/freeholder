-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
-- C12.38/C11.05: hash immutable controlled rows once, never alter their evidence bytes.
CREATE TABLE subscription_controlled_row_hashes (
 table_name text NOT NULL,
 row_id uuid NOT NULL,
 row_sha256 text NOT NULL,
 row_bytes bigint NOT NULL,
 CONSTRAINT subscription_controlled_row_hashes_pk PRIMARY KEY(table_name,row_id),
 CONSTRAINT subscription_controlled_row_hashes_value CHECK(row_sha256 ~ '^[a-f0-9]{64}$' AND row_bytes>=0)
);
--> statement-breakpoint
CREATE FUNCTION freeholder_controlled_row_hash_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_setting('freeholder.controlled_row_hash_internal',true) IS DISTINCT FROM '1' THEN
  RAISE EXCEPTION 'Controlled row hashes are written only by their actual immutable source row' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION freeholder_controlled_row_hash_capture() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE identity uuid;identity_key text;
BEGIN
 identity_key:=CASE TG_TABLE_NAME
  WHEN 'subscription_controlled_resources' THEN 'id'
  WHEN 'subscription_controlled_operations' THEN 'id'
  WHEN 'subscription_controlled_calls' THEN 'id'
  WHEN 'subscription_controlled_facts' THEN 'id'
  WHEN 'subscription_controlled_finishes' THEN 'call_id'
  WHEN 'subscription_controlled_stops' THEN 'call_id'
  WHEN 'subscription_controlled_verifications' THEN 'operation_id'
  WHEN 'subscription_controlled_charge_origins' THEN 'receipt_id'
  WHEN 'subscription_controlled_closures' THEN 'resource_id'
  ELSE NULL END;
 identity:=(to_jsonb(NEW)->>identity_key)::uuid;
 IF identity IS NULL THEN RAISE EXCEPTION 'Unknown controlled row hash source' USING ERRCODE='23514';END IF;
 PERFORM set_config('freeholder.controlled_row_hash_internal','1',true);
 INSERT INTO subscription_controlled_row_hashes(table_name,row_id,row_sha256,row_bytes)
 VALUES(TG_TABLE_NAME,identity,encode(sha256(convert_to(to_jsonb(NEW)::text,'UTF8')),'hex'),octet_length(to_jsonb(NEW)::text));
 PERFORM set_config('freeholder.controlled_row_hash_internal','0',true);
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER controlled_row_hash_capture AFTER INSERT ON subscription_controlled_resources FOR EACH ROW EXECUTE FUNCTION freeholder_controlled_row_hash_capture();
--> statement-breakpoint
CREATE TRIGGER controlled_row_hash_capture AFTER INSERT ON subscription_controlled_operations FOR EACH ROW EXECUTE FUNCTION freeholder_controlled_row_hash_capture();
--> statement-breakpoint
CREATE TRIGGER controlled_row_hash_capture AFTER INSERT ON subscription_controlled_calls FOR EACH ROW EXECUTE FUNCTION freeholder_controlled_row_hash_capture();
--> statement-breakpoint
CREATE TRIGGER controlled_row_hash_capture AFTER INSERT ON subscription_controlled_facts FOR EACH ROW EXECUTE FUNCTION freeholder_controlled_row_hash_capture();
--> statement-breakpoint
CREATE TRIGGER controlled_row_hash_capture AFTER INSERT ON subscription_controlled_finishes FOR EACH ROW EXECUTE FUNCTION freeholder_controlled_row_hash_capture();
--> statement-breakpoint
CREATE TRIGGER controlled_row_hash_capture AFTER INSERT ON subscription_controlled_stops FOR EACH ROW EXECUTE FUNCTION freeholder_controlled_row_hash_capture();
--> statement-breakpoint
CREATE TRIGGER controlled_row_hash_capture AFTER INSERT ON subscription_controlled_verifications FOR EACH ROW EXECUTE FUNCTION freeholder_controlled_row_hash_capture();
--> statement-breakpoint
CREATE TRIGGER controlled_row_hash_capture AFTER INSERT ON subscription_controlled_charge_origins FOR EACH ROW EXECUTE FUNCTION freeholder_controlled_row_hash_capture();
--> statement-breakpoint
CREATE TRIGGER controlled_row_hash_capture AFTER INSERT ON subscription_controlled_closures FOR EACH ROW EXECUTE FUNCTION freeholder_controlled_row_hash_capture();
--> statement-breakpoint
CREATE TRIGGER controlled_row_hash_guard BEFORE INSERT OR UPDATE OR DELETE ON subscription_controlled_row_hashes FOR EACH ROW EXECUTE FUNCTION freeholder_controlled_row_hash_guard();
--> statement-breakpoint
SELECT set_config('freeholder.controlled_row_hash_internal','1',true);
--> statement-breakpoint
INSERT INTO subscription_controlled_row_hashes(table_name,row_id,row_sha256,row_bytes)
 SELECT 'subscription_controlled_resources',id,encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex'),octet_length(to_jsonb(r)::text) FROM subscription_controlled_resources r
 UNION ALL SELECT 'subscription_controlled_operations',id,encode(sha256(convert_to(to_jsonb(o)::text,'UTF8')),'hex'),octet_length(to_jsonb(o)::text) FROM subscription_controlled_operations o
 UNION ALL SELECT 'subscription_controlled_calls',id,encode(sha256(convert_to(to_jsonb(c)::text,'UTF8')),'hex'),octet_length(to_jsonb(c)::text) FROM subscription_controlled_calls c
 UNION ALL SELECT 'subscription_controlled_facts',id,encode(sha256(convert_to(to_jsonb(f)::text,'UTF8')),'hex'),octet_length(to_jsonb(f)::text) FROM subscription_controlled_facts f
 UNION ALL SELECT 'subscription_controlled_finishes',call_id,encode(sha256(convert_to(to_jsonb(f)::text,'UTF8')),'hex'),octet_length(to_jsonb(f)::text) FROM subscription_controlled_finishes f
 UNION ALL SELECT 'subscription_controlled_stops',call_id,encode(sha256(convert_to(to_jsonb(s)::text,'UTF8')),'hex'),octet_length(to_jsonb(s)::text) FROM subscription_controlled_stops s
 UNION ALL SELECT 'subscription_controlled_verifications',operation_id,encode(sha256(convert_to(to_jsonb(v)::text,'UTF8')),'hex'),octet_length(to_jsonb(v)::text) FROM subscription_controlled_verifications v
 UNION ALL SELECT 'subscription_controlled_charge_origins',receipt_id,encode(sha256(convert_to(to_jsonb(o)::text,'UTF8')),'hex'),octet_length(to_jsonb(o)::text) FROM subscription_controlled_charge_origins o
 UNION ALL SELECT 'subscription_controlled_closures',resource_id,encode(sha256(convert_to(to_jsonb(c)::text,'UTF8')),'hex'),octet_length(to_jsonb(c)::text) FROM subscription_controlled_closures c;
--> statement-breakpoint
SELECT set_config('freeholder.controlled_row_hash_internal','0',true);
