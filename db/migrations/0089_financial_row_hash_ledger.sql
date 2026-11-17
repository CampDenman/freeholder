-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
-- C12.38/C11.05: maintain exact current financial row fingerprints beside their source rows.
CREATE TABLE financial_row_hashes (
 table_name text NOT NULL,
 row_id uuid NOT NULL,
 row_sha256 text NOT NULL,
 row_bytes bigint NOT NULL,
 CONSTRAINT financial_row_hashes_pk PRIMARY KEY(table_name,row_id),
 CONSTRAINT financial_row_hashes_value CHECK(row_sha256 ~ '^[a-f0-9]{64}$' AND row_bytes>=0)
);
--> statement-breakpoint
CREATE FUNCTION freeholder_financial_row_identity(source_table text,source_row jsonb) RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT (source_row->>CASE source_table
  WHEN 'subscriptions' THEN 'id'
  WHEN 'subscription_commercial_terms' THEN 'id'
  WHEN 'subscription_merchant_scopes' THEN 'subscription_id'
  WHEN 'subscription_market_policies' THEN 'subscription_id'
  WHEN 'subscription_provider_schedule_resources' THEN 'subscription_id'
  WHEN 'subscription_provider_schedule_operations' THEN 'id'
  WHEN 'subscription_commercial_amendments' THEN 'terms_id'
  WHEN 'subscription_commercial_resumptions' THEN 'terms_id'
  WHEN 'subscription_provider_generations' THEN 'id'
  WHEN 'subscription_provider_charge_observations' THEN 'id'
  WHEN 'merchant_payment_observations' THEN 'id'
  WHEN 'payment_disputes' THEN 'id'
  WHEN 'refunds' THEN 'id'
  WHEN 'invoices' THEN 'id'
  WHEN 'payments' THEN 'id'
  WHEN 'credit_notes' THEN 'id'
  WHEN 'subscription_provider_charge_receipts' THEN 'id'
  WHEN 'merchant_agreement_payment_routes' THEN 'payment_id'
  WHEN 'payment_methods' THEN 'id'
  WHEN 'merchant_tax_profiles' THEN 'id'
  WHEN 'merchant_fee_refunds' THEN 'id'
  WHEN 'merchant_fee_observations' THEN 'id'
  WHEN 'merchant_payment_requests' THEN 'payment_id'
  WHEN 'merchant_payment_dispatches' THEN 'id'
  WHEN 'merchant_payment_resource_bindings' THEN 'id'
  WHEN 'merchant_payment_retirement_acks' THEN 'id'
  WHEN 'merchant_payment_terminal_receipts' THEN 'payment_id'
  WHEN 'merchant_payment_creation_refusals' THEN 'dispatch_id'
  WHEN 'merchant_payment_dispatch_finishes' THEN 'dispatch_id'
  WHEN 'merchant_payment_dispatch_stops' THEN 'dispatch_id'
  WHEN 'subscription_provider_read_tickets' THEN 'read_id'
  WHEN 'subscription_provider_read_finishes' THEN 'read_id'
  WHEN 'subscription_provider_read_stops' THEN 'read_id'
  WHEN 'subscription_provider_invoice_observations' THEN 'id'
  WHEN 'subscription_provider_invoice_lines' THEN 'id'
  WHEN 'invoice_lines' THEN 'id'
  WHEN 'invoice_market_policies' THEN 'invoice_id'
  WHEN 'invoice_merchant_tax_quotes' THEN 'id'
  WHEN 'invoice_merchant_tax_quote_lines' THEN 'invoice_line_id'
  WHEN 'invoice_credit_applications' THEN 'reservation_id'
  WHEN 'invoice_credit_reservations' THEN 'id'
  WHEN 'invoice_credit_funding' THEN 'id'
  ELSE NULL END)::uuid
$$;
--> statement-breakpoint
CREATE FUNCTION freeholder_financial_row_hash_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_setting('freeholder.financial_row_hash_internal',true) IS DISTINCT FROM '1' THEN
  RAISE EXCEPTION 'Financial row hashes are written only by their actual source row' USING ERRCODE='23514';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION freeholder_financial_row_hash_capture() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE identity uuid;old_identity uuid;content jsonb;
BEGIN
 IF TG_OP='DELETE' THEN
  identity:=freeholder_financial_row_identity(TG_TABLE_NAME,to_jsonb(OLD));
  IF identity IS NULL THEN RAISE EXCEPTION 'Unknown financial row hash source' USING ERRCODE='23514';END IF;
  PERFORM set_config('freeholder.financial_row_hash_internal','1',true);
  DELETE FROM financial_row_hashes WHERE table_name=TG_TABLE_NAME AND row_id=identity;
  PERFORM set_config('freeholder.financial_row_hash_internal','0',true);
  RETURN OLD;
 END IF;
 identity:=freeholder_financial_row_identity(TG_TABLE_NAME,to_jsonb(NEW));
 IF identity IS NULL THEN RAISE EXCEPTION 'Unknown financial row hash source' USING ERRCODE='23514';END IF;
 PERFORM set_config('freeholder.financial_row_hash_internal','1',true);
 IF TG_OP='UPDATE' THEN
  old_identity:=freeholder_financial_row_identity(TG_TABLE_NAME,to_jsonb(OLD));
  IF old_identity IS DISTINCT FROM identity THEN
   DELETE FROM financial_row_hashes WHERE table_name=TG_TABLE_NAME AND row_id=old_identity;
  END IF;
 END IF;
 content:=to_jsonb(NEW);
 IF TG_TABLE_NAME='subscription_provider_schedule_resources' THEN content:=content-'updated_at';END IF;
 INSERT INTO financial_row_hashes(table_name,row_id,row_sha256,row_bytes)
 VALUES(TG_TABLE_NAME,identity,encode(sha256(convert_to(content::text,'UTF8')),'hex'),octet_length(content::text))
 ON CONFLICT(table_name,row_id) DO UPDATE SET row_sha256=EXCLUDED.row_sha256,row_bytes=EXCLUDED.row_bytes;
 PERFORM set_config('freeholder.financial_row_hash_internal','0',true);
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION freeholder_financial_row_fingerprint(source_table text,source_id uuid) RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE fingerprint text;
BEGIN
 SELECT row_sha256 INTO fingerprint FROM financial_row_hashes WHERE table_name=source_table AND row_id=source_id;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Missing financial row fingerprint for %.%',source_table,source_id USING ERRCODE='23514';
 END IF;
 RETURN fingerprint;
END $$;
--> statement-breakpoint
CREATE TRIGGER financial_row_hash_capture AFTER INSERT OR UPDATE OR DELETE ON subscriptions FOR EACH ROW EXECUTE FUNCTION freeholder_financial_row_hash_capture();
--> statement-breakpoint
CREATE TRIGGER financial_row_hash_capture AFTER INSERT OR UPDATE OR DELETE ON subscription_commercial_terms FOR EACH ROW EXECUTE FUNCTION freeholder_financial_row_hash_capture();
--> statement-breakpoint
CREATE TRIGGER financial_row_hash_capture AFTER INSERT OR UPDATE OR DELETE ON subscription_merchant_scopes FOR EACH ROW EXECUTE FUNCTION freeholder_financial_row_hash_capture();
--> statement-breakpoint
CREATE TRIGGER financial_row_hash_capture AFTER INSERT OR UPDATE OR DELETE ON subscription_market_policies FOR EACH ROW EXECUTE FUNCTION freeholder_financial_row_hash_capture();
--> statement-breakpoint
CREATE TRIGGER financial_row_hash_capture AFTER INSERT OR UPDATE OR DELETE ON subscription_provider_schedule_resources FOR EACH ROW EXECUTE FUNCTION freeholder_financial_row_hash_capture();
--> statement-breakpoint
CREATE TRIGGER financial_row_hash_capture AFTER INSERT OR UPDATE OR DELETE ON subscription_provider_schedule_operations FOR EACH ROW EXECUTE FUNCTION freeholder_financial_row_hash_capture();
--> statement-breakpoint
CREATE TRIGGER financial_row_hash_capture AFTER INSERT OR UPDATE OR DELETE ON subscription_commercial_amendments FOR EACH ROW EXECUTE FUNCTION freeholder_financial_row_hash_capture();
--> statement-breakpoint
CREATE TRIGGER financial_row_hash_capture AFTER INSERT OR UPDATE OR DELETE ON subscription_commercial_resumptions FOR EACH ROW EXECUTE FUNCTION freeholder_financial_row_hash_capture();
--> statement-breakpoint
CREATE TRIGGER financial_row_hash_capture AFTER INSERT OR UPDATE OR DELETE ON subscription_provider_generations FOR EACH ROW EXECUTE FUNCTION freeholder_financial_row_hash_capture();
--> statement-breakpoint
CREATE TRIGGER financial_row_hash_capture AFTER INSERT OR UPDATE OR DELETE ON subscription_provider_charge_observations FOR EACH ROW EXECUTE FUNCTION freeholder_financial_row_hash_capture();
--> statement-breakpoint
CREATE TRIGGER financial_row_hash_capture AFTER INSERT OR UPDATE OR DELETE ON merchant_payment_observations FOR EACH ROW EXECUTE FUNCTION freeholder_financial_row_hash_capture();
--> statement-breakpoint
CREATE TRIGGER financial_row_hash_capture AFTER INSERT OR UPDATE OR DELETE ON payment_disputes FOR EACH ROW EXECUTE FUNCTION freeholder_financial_row_hash_capture();
--> statement-breakpoint
CREATE TRIGGER financial_row_hash_capture AFTER INSERT OR UPDATE OR DELETE ON refunds FOR EACH ROW EXECUTE FUNCTION freeholder_financial_row_hash_capture();
--> statement-breakpoint
CREATE TRIGGER financial_row_hash_capture AFTER INSERT OR UPDATE OR DELETE ON invoices FOR EACH ROW EXECUTE FUNCTION freeholder_financial_row_hash_capture();
--> statement-breakpoint
CREATE TRIGGER financial_row_hash_capture AFTER INSERT OR UPDATE OR DELETE ON payments FOR EACH ROW EXECUTE FUNCTION freeholder_financial_row_hash_capture();
--> statement-breakpoint
CREATE TRIGGER financial_row_hash_capture AFTER INSERT OR UPDATE OR DELETE ON credit_notes FOR EACH ROW EXECUTE FUNCTION freeholder_financial_row_hash_capture();
--> statement-breakpoint
CREATE TRIGGER financial_row_hash_capture AFTER INSERT OR UPDATE OR DELETE ON subscription_provider_charge_receipts FOR EACH ROW EXECUTE FUNCTION freeholder_financial_row_hash_capture();
--> statement-breakpoint
CREATE TRIGGER financial_row_hash_capture AFTER INSERT OR UPDATE OR DELETE ON merchant_agreement_payment_routes FOR EACH ROW EXECUTE FUNCTION freeholder_financial_row_hash_capture();
--> statement-breakpoint
CREATE TRIGGER financial_row_hash_capture AFTER INSERT OR UPDATE OR DELETE ON payment_methods FOR EACH ROW EXECUTE FUNCTION freeholder_financial_row_hash_capture();
--> statement-breakpoint
CREATE TRIGGER financial_row_hash_capture AFTER INSERT OR UPDATE OR DELETE ON merchant_tax_profiles FOR EACH ROW EXECUTE FUNCTION freeholder_financial_row_hash_capture();
--> statement-breakpoint
CREATE TRIGGER financial_row_hash_capture AFTER INSERT OR UPDATE OR DELETE ON merchant_fee_refunds FOR EACH ROW EXECUTE FUNCTION freeholder_financial_row_hash_capture();
--> statement-breakpoint
CREATE TRIGGER financial_row_hash_capture AFTER INSERT OR UPDATE OR DELETE ON merchant_fee_observations FOR EACH ROW EXECUTE FUNCTION freeholder_financial_row_hash_capture();
--> statement-breakpoint
CREATE TRIGGER financial_row_hash_capture AFTER INSERT OR UPDATE OR DELETE ON merchant_payment_requests FOR EACH ROW EXECUTE FUNCTION freeholder_financial_row_hash_capture();
--> statement-breakpoint
CREATE TRIGGER financial_row_hash_capture AFTER INSERT OR UPDATE OR DELETE ON merchant_payment_dispatches FOR EACH ROW EXECUTE FUNCTION freeholder_financial_row_hash_capture();
--> statement-breakpoint
CREATE TRIGGER financial_row_hash_capture AFTER INSERT OR UPDATE OR DELETE ON merchant_payment_resource_bindings FOR EACH ROW EXECUTE FUNCTION freeholder_financial_row_hash_capture();
--> statement-breakpoint
CREATE TRIGGER financial_row_hash_capture AFTER INSERT OR UPDATE OR DELETE ON merchant_payment_retirement_acks FOR EACH ROW EXECUTE FUNCTION freeholder_financial_row_hash_capture();
--> statement-breakpoint
CREATE TRIGGER financial_row_hash_capture AFTER INSERT OR UPDATE OR DELETE ON merchant_payment_terminal_receipts FOR EACH ROW EXECUTE FUNCTION freeholder_financial_row_hash_capture();
--> statement-breakpoint
CREATE TRIGGER financial_row_hash_capture AFTER INSERT OR UPDATE OR DELETE ON merchant_payment_creation_refusals FOR EACH ROW EXECUTE FUNCTION freeholder_financial_row_hash_capture();
--> statement-breakpoint
CREATE TRIGGER financial_row_hash_capture AFTER INSERT OR UPDATE OR DELETE ON merchant_payment_dispatch_finishes FOR EACH ROW EXECUTE FUNCTION freeholder_financial_row_hash_capture();
--> statement-breakpoint
CREATE TRIGGER financial_row_hash_capture AFTER INSERT OR UPDATE OR DELETE ON merchant_payment_dispatch_stops FOR EACH ROW EXECUTE FUNCTION freeholder_financial_row_hash_capture();
--> statement-breakpoint
CREATE TRIGGER financial_row_hash_capture AFTER INSERT OR UPDATE OR DELETE ON subscription_provider_read_tickets FOR EACH ROW EXECUTE FUNCTION freeholder_financial_row_hash_capture();
--> statement-breakpoint
CREATE TRIGGER financial_row_hash_capture AFTER INSERT OR UPDATE OR DELETE ON subscription_provider_read_finishes FOR EACH ROW EXECUTE FUNCTION freeholder_financial_row_hash_capture();
--> statement-breakpoint
CREATE TRIGGER financial_row_hash_capture AFTER INSERT OR UPDATE OR DELETE ON subscription_provider_read_stops FOR EACH ROW EXECUTE FUNCTION freeholder_financial_row_hash_capture();
--> statement-breakpoint
CREATE TRIGGER financial_row_hash_capture AFTER INSERT OR UPDATE OR DELETE ON subscription_provider_invoice_observations FOR EACH ROW EXECUTE FUNCTION freeholder_financial_row_hash_capture();
--> statement-breakpoint
CREATE TRIGGER financial_row_hash_capture AFTER INSERT OR UPDATE OR DELETE ON subscription_provider_invoice_lines FOR EACH ROW EXECUTE FUNCTION freeholder_financial_row_hash_capture();
--> statement-breakpoint
CREATE TRIGGER financial_row_hash_capture AFTER INSERT OR UPDATE OR DELETE ON invoice_lines FOR EACH ROW EXECUTE FUNCTION freeholder_financial_row_hash_capture();
--> statement-breakpoint
CREATE TRIGGER financial_row_hash_capture AFTER INSERT OR UPDATE OR DELETE ON invoice_market_policies FOR EACH ROW EXECUTE FUNCTION freeholder_financial_row_hash_capture();
--> statement-breakpoint
CREATE TRIGGER financial_row_hash_capture AFTER INSERT OR UPDATE OR DELETE ON invoice_merchant_tax_quotes FOR EACH ROW EXECUTE FUNCTION freeholder_financial_row_hash_capture();
--> statement-breakpoint
CREATE TRIGGER financial_row_hash_capture AFTER INSERT OR UPDATE OR DELETE ON invoice_merchant_tax_quote_lines FOR EACH ROW EXECUTE FUNCTION freeholder_financial_row_hash_capture();
--> statement-breakpoint
CREATE TRIGGER financial_row_hash_capture AFTER INSERT OR UPDATE OR DELETE ON invoice_credit_applications FOR EACH ROW EXECUTE FUNCTION freeholder_financial_row_hash_capture();
--> statement-breakpoint
CREATE TRIGGER financial_row_hash_capture AFTER INSERT OR UPDATE OR DELETE ON invoice_credit_reservations FOR EACH ROW EXECUTE FUNCTION freeholder_financial_row_hash_capture();
--> statement-breakpoint
CREATE TRIGGER financial_row_hash_capture AFTER INSERT OR UPDATE OR DELETE ON invoice_credit_funding FOR EACH ROW EXECUTE FUNCTION freeholder_financial_row_hash_capture();
--> statement-breakpoint
CREATE TRIGGER financial_row_hash_guard BEFORE INSERT OR UPDATE OR DELETE ON financial_row_hashes FOR EACH ROW EXECUTE FUNCTION freeholder_financial_row_hash_guard();
--> statement-breakpoint
SELECT set_config('freeholder.financial_row_hash_internal','1',true);
--> statement-breakpoint
INSERT INTO financial_row_hashes(table_name,row_id,row_sha256,row_bytes)
 SELECT source.table_name,freeholder_financial_row_identity(source.table_name,source.content),encode(sha256(convert_to(source.content::text,'UTF8')),'hex'),octet_length(source.content::text)
 FROM (
  SELECT 'subscriptions' AS table_name,to_jsonb(s) AS content FROM subscriptions s
  UNION ALL SELECT 'subscription_commercial_terms',to_jsonb(t) FROM subscription_commercial_terms t
  UNION ALL SELECT 'subscription_merchant_scopes',to_jsonb(s) FROM subscription_merchant_scopes s
  UNION ALL SELECT 'subscription_market_policies',to_jsonb(s) FROM subscription_market_policies s
  UNION ALL SELECT 'subscription_provider_schedule_resources',to_jsonb(s)-'updated_at' FROM subscription_provider_schedule_resources s
  UNION ALL SELECT 'subscription_provider_schedule_operations',to_jsonb(s) FROM subscription_provider_schedule_operations s
  UNION ALL SELECT 'subscription_commercial_amendments',to_jsonb(s) FROM subscription_commercial_amendments s
  UNION ALL SELECT 'subscription_commercial_resumptions',to_jsonb(s) FROM subscription_commercial_resumptions s
  UNION ALL SELECT 'subscription_provider_generations',to_jsonb(s) FROM subscription_provider_generations s
  UNION ALL SELECT 'subscription_provider_charge_observations',to_jsonb(s) FROM subscription_provider_charge_observations s
  UNION ALL SELECT 'merchant_payment_observations',to_jsonb(s) FROM merchant_payment_observations s
  UNION ALL SELECT 'payment_disputes',to_jsonb(s) FROM payment_disputes s
  UNION ALL SELECT 'refunds',to_jsonb(s) FROM refunds s
  UNION ALL SELECT 'invoices',to_jsonb(s) FROM invoices s
  UNION ALL SELECT 'payments',to_jsonb(s) FROM payments s
  UNION ALL SELECT 'credit_notes',to_jsonb(s) FROM credit_notes s
  UNION ALL SELECT 'subscription_provider_charge_receipts',to_jsonb(s) FROM subscription_provider_charge_receipts s
  UNION ALL SELECT 'merchant_agreement_payment_routes',to_jsonb(s) FROM merchant_agreement_payment_routes s
  UNION ALL SELECT 'payment_methods',to_jsonb(m) FROM payment_methods m
  UNION ALL SELECT 'merchant_tax_profiles',to_jsonb(p) FROM merchant_tax_profiles p
  UNION ALL SELECT 'merchant_fee_refunds',to_jsonb(s) FROM merchant_fee_refunds s
  UNION ALL SELECT 'merchant_fee_observations',to_jsonb(s) FROM merchant_fee_observations s
  UNION ALL SELECT 'merchant_payment_requests',to_jsonb(s) FROM merchant_payment_requests s
  UNION ALL SELECT 'merchant_payment_dispatches',to_jsonb(s) FROM merchant_payment_dispatches s
  UNION ALL SELECT 'merchant_payment_resource_bindings',to_jsonb(s) FROM merchant_payment_resource_bindings s
  UNION ALL SELECT 'merchant_payment_retirement_acks',to_jsonb(s) FROM merchant_payment_retirement_acks s
  UNION ALL SELECT 'merchant_payment_terminal_receipts',to_jsonb(s) FROM merchant_payment_terminal_receipts s
  UNION ALL SELECT 'merchant_payment_creation_refusals',to_jsonb(s) FROM merchant_payment_creation_refusals s
  UNION ALL SELECT 'merchant_payment_dispatch_finishes',to_jsonb(s) FROM merchant_payment_dispatch_finishes s
  UNION ALL SELECT 'merchant_payment_dispatch_stops',to_jsonb(s) FROM merchant_payment_dispatch_stops s
  UNION ALL SELECT 'subscription_provider_read_tickets',to_jsonb(s) FROM subscription_provider_read_tickets s
  UNION ALL SELECT 'subscription_provider_read_finishes',to_jsonb(s) FROM subscription_provider_read_finishes s
  UNION ALL SELECT 'subscription_provider_read_stops',to_jsonb(s) FROM subscription_provider_read_stops s
  UNION ALL SELECT 'subscription_provider_invoice_observations',to_jsonb(s) FROM subscription_provider_invoice_observations s
  UNION ALL SELECT 'subscription_provider_invoice_lines',to_jsonb(s) FROM subscription_provider_invoice_lines s
  UNION ALL SELECT 'invoice_lines',to_jsonb(s) FROM invoice_lines s
  UNION ALL SELECT 'invoice_market_policies',to_jsonb(s) FROM invoice_market_policies s
  UNION ALL SELECT 'invoice_merchant_tax_quotes',to_jsonb(s) FROM invoice_merchant_tax_quotes s
  UNION ALL SELECT 'invoice_merchant_tax_quote_lines',to_jsonb(s) FROM invoice_merchant_tax_quote_lines s
  UNION ALL SELECT 'invoice_credit_applications',to_jsonb(s) FROM invoice_credit_applications s
  UNION ALL SELECT 'invoice_credit_reservations',to_jsonb(s) FROM invoice_credit_reservations s
  UNION ALL SELECT 'invoice_credit_funding',to_jsonb(s) FROM invoice_credit_funding s
 ) source;
--> statement-breakpoint
SELECT set_config('freeholder.financial_row_hash_internal','0',true);
