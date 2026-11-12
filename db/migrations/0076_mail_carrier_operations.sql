-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- freeholder:schema-breaking Carrier HTTP intents require the guarded image. Restore the matching database/private receipt keys for rollback. Legacy account bindings are deliberately not backfilled.
-- C3.31: the outer adapter invocation is not proof of each provider request.
-- The previous withdrawal worker reads email before HTTP. Renaming that
-- physical column makes its read fail before it can call today's account.
ALTER TABLE mail_provider_grants RENAME COLUMN email TO original_email;
--> statement-breakpoint
ALTER TABLE mail_dispatches ADD COLUMN carrier_operations jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
ALTER TABLE mail_provider_grants ADD COLUMN resource_digest text;
--> statement-breakpoint
ALTER TABLE mail_provider_grants ADD COLUMN email_digest text;
--> statement-breakpoint
ALTER TABLE mail_provider_grants ADD COLUMN redacted_at timestamptz;
--> statement-breakpoint
ALTER TABLE mail_provider_grants ADD COLUMN revision integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE mail_provider_grants ADD COLUMN review_digest text;
--> statement-breakpoint
ALTER TABLE mail_provider_grants ADD COLUMN reviewed_at timestamptz;
--> statement-breakpoint
ALTER TABLE mail_provider_grants ADD COLUMN reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE mail_provider_grants ADD COLUMN resource_base_url text;
--> statement-breakpoint
ALTER TABLE mail_provider_grants ADD COLUMN carrier_operations jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
ALTER TABLE mail_provider_grants ADD CONSTRAINT mail_provider_grants_resource_consistent CHECK ((resource_digest IS NULL AND resource_base_url IS NULL) OR (resource_digest IS NOT NULL AND resource_digest ~ '^[a-f0-9]{64}$' AND resource_base_url IS NOT NULL));
--> statement-breakpoint
DROP INDEX mail_provider_grants_unique_idx;
--> statement-breakpoint
CREATE UNIQUE INDEX mail_provider_grants_unique_idx ON mail_provider_grants(provider,original_email,consent_record_id,resource_digest);
--> statement-breakpoint
CREATE FUNCTION freeholder_mail_carrier_operations() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous jsonb; current_op jsonb; old_op jsonb;
BEGIN
 IF TG_OP='DELETE' THEN
  RAISE EXCEPTION 'Original carrier operation receipts cannot be deleted; minimize confirmed unheld addresses' USING ERRCODE='23514';
 END IF;
 IF TG_OP='UPDATE' AND TG_TABLE_NAME='mail_provider_grants' THEN
  NEW.revision:=OLD.revision+1;
  IF ROW(NEW.id,NEW.provider,NEW.resource_digest,NEW.resource_base_url,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.provider,OLD.resource_digest,OLD.resource_base_url,OLD.created_at) THEN
   RAISE EXCEPTION 'The original carrier resource and address are immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.original_email IS DISTINCT FROM OLD.original_email OR NEW.email_digest IS DISTINCT FROM OLD.email_digest OR NEW.redacted_at IS DISTINCT FROM OLD.redacted_at THEN
   IF current_setting('freeholder.mail_carrier_v1',true) IS DISTINCT FROM '1' OR OLD.redacted_at IS NOT NULL OR NEW.original_email<>'' OR NEW.email_digest IS NULL OR NEW.email_digest !~ '^[a-f0-9]{64}$' OR NEW.redacted_at IS NULL OR NEW.withdrawn_at IS NULL THEN
    RAISE EXCEPTION 'The original carrier address permits only guarded positive-withdrawal minimization' USING ERRCODE='23514';
   END IF;
  END IF;
  IF OLD.review_digest IS NOT NULL AND ROW(NEW.review_digest,NEW.reviewed_at) IS DISTINCT FROM ROW(OLD.review_digest,OLD.reviewed_at) THEN RAISE EXCEPTION 'Original human carrier evidence is immutable' USING ERRCODE='23514'; END IF;
  IF NEW.withdrawn_at IS DISTINCT FROM OLD.withdrawn_at OR NEW.withdrawal_error IS DISTINCT FROM OLD.withdrawal_error OR NEW.review_digest IS DISTINCT FROM OLD.review_digest OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at THEN
   IF current_setting('freeholder.mail_carrier_v1',true) IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'Carrier outcomes require the current guarded writer' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 IF TG_OP='INSERT' AND TG_TABLE_NAME='mail_dispatches' THEN
  IF EXISTS(SELECT 1 FROM mail_deliveries WHERE id=NEW.delivery_id AND provider='paradise') AND current_setting('freeholder.mail_carrier_v1',true) IS DISTINCT FROM '1' THEN
   RAISE EXCEPTION 'Carrier HTTP claims require the current guarded image' USING ERRCODE='23514';
  END IF;
 END IF;
 IF TG_OP='INSERT' AND TG_TABLE_NAME='mail_provider_grants' THEN
  IF NEW.resource_digest IS NOT NULL AND current_setting('freeholder.mail_carrier_v1',true) IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'Original carrier bindings require the current guarded writer' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='INSERT' THEN previous:='[]'::jsonb; ELSE previous:=OLD.carrier_operations; END IF;
 IF NEW.carrier_operations IS NOT DISTINCT FROM previous THEN RETURN NEW; END IF;
 IF current_setting('freeholder.mail_carrier_v1',true) IS DISTINCT FROM '1' OR jsonb_typeof(NEW.carrier_operations)<>'array' THEN
  RAISE EXCEPTION 'Carrier intents require the current guarded writer' USING ERRCODE='23514';
 END IF;
 IF jsonb_array_length(NEW.carrier_operations)<jsonb_array_length(previous) THEN RAISE EXCEPTION 'Original carrier operations cannot be removed' USING ERRCODE='23514'; END IF;
 FOR old_op IN SELECT value FROM jsonb_array_elements(previous) LOOP
  SELECT value INTO current_op FROM jsonb_array_elements(NEW.carrier_operations) WHERE value->>'id'=old_op->>'id';
  IF current_op IS NULL OR (current_op-'state'-'httpStatus'-'providerCode'-'responseDigest') IS DISTINCT FROM (old_op-'state'-'httpStatus'-'providerCode'-'responseDigest') OR (old_op->>'state'<>'running' AND current_op IS DISTINCT FROM old_op) THEN
   RAISE EXCEPTION 'The original carrier operation and its observed outcome are immutable' USING ERRCODE='23514';
  END IF;
 END LOOP;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER mail_dispatches_carrier_operations BEFORE INSERT OR UPDATE ON mail_dispatches FOR EACH ROW EXECUTE FUNCTION freeholder_mail_carrier_operations();
--> statement-breakpoint
CREATE TRIGGER mail_provider_grants_carrier_operations BEFORE INSERT OR UPDATE OR DELETE ON mail_provider_grants FOR EACH ROW EXECUTE FUNCTION freeholder_mail_carrier_operations();
