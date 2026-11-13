-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C12.38/C1.08: SOURCE ONLY, UNASSEMBLED suffix after the unchanged RMA fragment.
-- freeholder:schema-breaking Exact original cash-return callers and raw receipt-only sources are new financial debt; the previous image must not dispatch older fee operations over them. Rollback requires the pre-upgrade database.
CREATE TABLE original_cash_recoveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), namespace_key text NOT NULL,
 payment_id uuid REFERENCES payments(id) ON DELETE RESTRICT,
 subscription_charge_receipt_id uuid REFERENCES subscription_provider_charge_receipts(id) ON DELETE RESTRICT,
 owner jsonb NOT NULL, digest text NOT NULL, authentication text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT original_cash_recoveries_source CHECK((payment_id IS NULL)<>(subscription_charge_receipt_id IS NULL)),
 CONSTRAINT original_cash_recoveries_proof CHECK(namespace_key ~ '^[a-f0-9]{64}$' AND digest ~ '^[a-f0-9]{64}$' AND authentication ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX original_cash_recoveries_namespace ON original_cash_recoveries(namespace_key);
--> statement-breakpoint
CREATE INDEX original_cash_recoveries_payment ON original_cash_recoveries(payment_id);
--> statement-breakpoint
CREATE INDEX original_cash_recoveries_receipt ON original_cash_recoveries(subscription_charge_receipt_id);
--> statement-breakpoint
CREATE TABLE original_cash_recovery_operations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), recovery_id uuid NOT NULL REFERENCES original_cash_recoveries(id) ON DELETE RESTRICT,
 kind text NOT NULL, request jsonb NOT NULL, caller jsonb NOT NULL, nonce_hash text NOT NULL,
 digest text NOT NULL, authentication text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT original_cash_recovery_operations_kind CHECK(kind IN('inspection','fee','recipient')),
 CONSTRAINT original_cash_recovery_operations_proof CHECK(nonce_hash ~ '^[a-f0-9]{64}$' AND digest ~ '^[a-f0-9]{64}$' AND authentication ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE INDEX original_cash_recovery_operations_owner ON original_cash_recovery_operations(recovery_id);
--> statement-breakpoint
CREATE UNIQUE INDEX original_cash_recovery_operations_creation ON original_cash_recovery_operations(recovery_id,kind) WHERE kind<>'inspection';
--> statement-breakpoint
CREATE TABLE original_cash_recovery_facts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), recovery_id uuid NOT NULL REFERENCES original_cash_recoveries(id) ON DELETE RESTRICT,
 operation_id uuid REFERENCES original_cash_recovery_operations(id) ON DELETE RESTRICT, sequence integer NOT NULL, kind text NOT NULL, evidence jsonb NOT NULL,
 digest text NOT NULL, authentication text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT original_cash_recovery_facts_kind CHECK(kind IN('primary','refund','state','parent','ack','resource','finish','stop','legacy_fee_stop','customer_request')),
 CONSTRAINT original_cash_recovery_facts_sequence_positive CHECK(sequence>0),
 CONSTRAINT original_cash_recovery_facts_proof CHECK(digest ~ '^[a-f0-9]{64}$' AND authentication ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE INDEX original_cash_recovery_facts_owner ON original_cash_recovery_facts(recovery_id);
--> statement-breakpoint
CREATE INDEX original_cash_recovery_facts_operation ON original_cash_recovery_facts(operation_id);
--> statement-breakpoint
CREATE UNIQUE INDEX original_cash_recovery_facts_sequence ON original_cash_recovery_facts(recovery_id,sequence);
--> statement-breakpoint
CREATE UNIQUE INDEX original_cash_recovery_facts_terminal ON original_cash_recovery_facts(operation_id,kind) WHERE kind IN('finish','stop');
--> statement-breakpoint
CREATE TABLE original_cash_recovery_closures (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), recovery_id uuid NOT NULL REFERENCES original_cash_recoveries(id) ON DELETE RESTRICT,
 operation_id uuid NOT NULL REFERENCES original_cash_recovery_operations(id) ON DELETE RESTRICT,
 revision text NOT NULL, unapplied_return_receipt_id uuid, digest text NOT NULL, authentication text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT original_cash_recovery_closures_proof CHECK(revision ~ '^[a-f0-9]{64}$' AND digest ~ '^[a-f0-9]{64}$' AND authentication ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE INDEX original_cash_recovery_closures_owner ON original_cash_recovery_closures(recovery_id);
--> statement-breakpoint
CREATE UNIQUE INDEX original_cash_recovery_closures_read ON original_cash_recovery_closures(operation_id);
--> statement-breakpoint
CREATE FUNCTION freeholder_guard_original_cash_recovery() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original original_cash_recoveries; operation original_cash_recovery_operations; owner_id uuid; body jsonb;
BEGIN
 IF TG_OP<>'INSERT' OR current_setting('freeholder.original_cash_recovery_v1',true) IS DISTINCT FROM '1' THEN
  RAISE EXCEPTION 'Original cash-return evidence is immutable and requires the shared authenticated phases' USING ERRCODE='55000';
 END IF;
 body:=to_jsonb(NEW);
 IF TG_TABLE_NAME='original_cash_recoveries' THEN
  original:=NEW; owner_id:=NEW.id;
  IF (NEW.owner->'cash'->>'paymentId') IS DISTINCT FROM NEW.payment_id::text
   OR (NEW.owner->'cash'->>'subscriptionChargeReceiptId') IS DISTINCT FROM NEW.subscription_charge_receipt_id::text
   OR (NEW.owner->>'authorizedBy') !~ '^user:[0-9a-f-]{36}$'
   OR (NEW.owner->'cash'->>'providerPlatformAccountId') !~ '^acct_[A-Za-z0-9]+$'
   OR (NEW.owner->'cash'->>'providerRef') !~ '^pi_[A-Za-z0-9_]+$'
   OR (NEW.owner->'cash'->>'amountMinor')::numeric NOT BETWEEN 1 AND 9007199254740991 THEN
   RAISE EXCEPTION 'Original cash-return ownership must retain its actual financial source' USING ERRCODE='23514';
  END IF;
 ELSE
  owner_id:=NEW.recovery_id; SELECT * INTO original FROM original_cash_recoveries WHERE id=owner_id;
  IF original.id IS NULL THEN RAISE EXCEPTION 'Restore the original cash-return owner' USING ERRCODE='23514'; END IF;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtext('subscription-cash:'||(original.owner->'cash'->>'providerPlatformAccountId')||':'||coalesce(original.owner->'cash'->>'chargeAccountId','')||':'||(original.owner->'cash'->>'providerRef')));
 IF TG_TABLE_NAME='original_cash_recovery_operations' THEN
  IF jsonb_typeof(NEW.caller)<>'object' OR NEW.caller->>'id' IS NULL OR NEW.request IS NULL THEN
   RAISE EXCEPTION 'A physical cash-return caller needs its actual retained identity and request' USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM original_cash_recovery_operations o WHERE o.recovery_id=owner_id
   AND NOT EXISTS(SELECT 1 FROM original_cash_recovery_facts f WHERE f.operation_id=o.id AND
    (f.kind='finish' AND f.evidence->>'callerInstanceId'=o.caller->>'id' OR f.kind='stop' AND f.evidence->>'operationDigest'=o.digest))) THEN
   RAISE EXCEPTION 'Finish or review the exact original physical caller before another operation' USING ERRCODE='23514';
  END IF;
 ELSIF TG_TABLE_NAME='original_cash_recovery_facts' THEN
  IF NEW.operation_id IS NOT NULL THEN
   SELECT * INTO operation FROM original_cash_recovery_operations WHERE id=NEW.operation_id;
   IF operation.recovery_id IS DISTINCT FROM owner_id THEN RAISE EXCEPTION 'A cash fact cannot move between original owners' USING ERRCODE='23514'; END IF;
   IF NEW.kind='finish' AND (NEW.evidence->>'callerInstanceId' IS DISTINCT FROM operation.caller->>'id' OR NEW.evidence->>'outcome' NOT IN('returned','threw')) THEN
    RAISE EXCEPTION 'Retain the exact original wrapper finish independently of its bank result' USING ERRCODE='23514';
   END IF;
   IF NEW.kind='stop' AND NEW.evidence->>'operationDigest' IS DISTINCT FROM operation.digest THEN
    RAISE EXCEPTION 'A hosting review must name its exact original operation' USING ERRCODE='23514';
   END IF;
  ELSIF NEW.kind NOT IN('legacy_fee_stop','customer_request') THEN
   RAISE EXCEPTION 'A raw financial callback requires its actual admitted physical caller' USING ERRCODE='23514';
  END IF;
 ELSIF TG_TABLE_NAME='original_cash_recovery_closures' THEN
  SELECT * INTO operation FROM original_cash_recovery_operations WHERE id=NEW.operation_id;
  IF operation.recovery_id IS DISTINCT FROM owner_id OR operation.kind<>'inspection'
   OR NOT EXISTS(SELECT 1 FROM original_cash_recovery_facts f WHERE f.operation_id=operation.id AND f.kind='finish' AND f.evidence->>'outcome'='returned' AND f.evidence->>'callerInstanceId'=operation.caller->>'id') THEN
   RAISE EXCEPTION 'A cash-return closure requires a real returned complete original read' USING ERRCODE='23514';
  END IF;
  IF (original.owner->'cash'->>'applied')::boolean=false AND NOT EXISTS(SELECT 1 FROM merchant_unapplied_charge_resolutions r WHERE r.id=NEW.unapplied_return_receipt_id
   AND r.provider_platform_account_id=original.owner->'cash'->>'providerPlatformAccountId' AND r.charge_account_id IS NOT DISTINCT FROM original.owner->'cash'->>'chargeAccountId'
   AND r.original_payment_ref=original.owner->'cash'->>'providerRef') THEN
   RAISE EXCEPTION 'Unapplied cash requires its real original return disposition without a fabricated payment' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER original_cash_recovery_guard BEFORE INSERT OR UPDATE OR DELETE ON original_cash_recoveries FOR EACH ROW EXECUTE FUNCTION freeholder_guard_original_cash_recovery();
--> statement-breakpoint
CREATE TRIGGER original_cash_recovery_guard BEFORE INSERT OR UPDATE OR DELETE ON original_cash_recovery_operations FOR EACH ROW EXECUTE FUNCTION freeholder_guard_original_cash_recovery();
--> statement-breakpoint
CREATE TRIGGER original_cash_recovery_guard BEFORE INSERT OR UPDATE OR DELETE ON original_cash_recovery_facts FOR EACH ROW EXECUTE FUNCTION freeholder_guard_original_cash_recovery();
--> statement-breakpoint
CREATE TRIGGER original_cash_recovery_guard BEFORE INSERT OR UPDATE OR DELETE ON original_cash_recovery_closures FOR EACH ROW EXECUTE FUNCTION freeholder_guard_original_cash_recovery();
--> statement-breakpoint
CREATE FUNCTION freeholder_guard_original_cash_old_fee_dispatch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (TG_OP='INSERT' OR NEW.status='dispatching' AND OLD.status IS DISTINCT FROM 'dispatching') AND EXISTS(
  SELECT 1 FROM original_cash_recoveries c LEFT JOIN payments p ON p.id=NEW.payment_id WHERE
   c.subscription_charge_receipt_id=NEW.original_charge_receipt_id OR c.payment_id=NEW.payment_id AND c.owner->'cash'->>'providerRef'=p.provider_ref) THEN
  RAISE EXCEPTION 'Use the exact original cash-return fee caller; the older payment-only fee writer cannot add another operation' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER original_cash_old_fee_dispatch BEFORE INSERT OR UPDATE ON merchant_fee_refunds FOR EACH ROW EXECUTE FUNCTION freeholder_guard_original_cash_old_fee_dispatch();
