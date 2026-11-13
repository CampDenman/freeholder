-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C12.38/C1.08/C5.19: SOURCE ONLY, UNASSEMBLED tail AFTER unchanged ab894.
-- freeholder:schema-breaking Cumulative partial target generations and explicit actual-resource review extend the original cash debt ABI. The previous image must fail closed; rollback requires the pre-upgrade database.
-- The ordinary migration transaction holds these locks across the caller
-- preflight and ABI replacement; a racing old admission must not pass between.
LOCK TABLE original_cash_recoveries, original_cash_recovery_operations, original_cash_recovery_facts, original_cash_recovery_closures IN ACCESS EXCLUSIVE MODE;
--> statement-breakpoint
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM original_cash_recovery_operations o WHERE NOT EXISTS(SELECT 1 FROM original_cash_recovery_facts f WHERE f.operation_id=o.id AND (f.kind='finish' AND f.evidence->>'callerInstanceId'=o.caller->>'id' OR f.kind='stop' AND f.evidence->>'operationDigest'=o.digest))) THEN
  RAISE EXCEPTION 'Finish or review actual original cash callers before this ABI upgrade; never discard or backfill their physical history' USING ERRCODE='55000';
 END IF;
END $$;
--> statement-breakpoint
ALTER TABLE original_cash_recovery_facts DROP CONSTRAINT original_cash_recovery_facts_kind;
--> statement-breakpoint
ALTER TABLE original_cash_recovery_facts ADD CONSTRAINT original_cash_recovery_facts_kind CHECK(kind IN('primary','refund','state','parent','ack','resource','finish','stop','legacy_fee_stop','customer_request','partial_target','partial_closure','unassigned_refund_review'));
--> statement-breakpoint
DROP INDEX original_cash_recovery_operations_creation;
--> statement-breakpoint
CREATE UNIQUE INDEX original_cash_recovery_operations_creation ON original_cash_recovery_operations(recovery_id,kind,coalesce(request->>'targetFactId','original_full_v1')) WHERE kind<>'inspection';
--> statement-breakpoint
CREATE UNIQUE INDEX original_cash_recovery_facts_target ON original_cash_recovery_facts(recovery_id,(evidence->>'targetKey')) WHERE kind='partial_target';
--> statement-breakpoint
CREATE FUNCTION freeholder_original_cash_partial_abi() RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT 2 $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION freeholder_guard_original_cash_recovery() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original original_cash_recoveries; operation original_cash_recovery_operations; owner_id uuid; body jsonb;
BEGIN
 IF TG_OP<>'INSERT' OR current_setting('freeholder.original_cash_recovery_v1',true) IS DISTINCT FROM '1' OR current_setting('freeholder.original_cash_recovery_v2',true) IS DISTINCT FROM '1' THEN
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
  IF NEW.request ? 'targetFactId' AND NOT EXISTS(SELECT 1 FROM original_cash_recovery_facts f WHERE f.id=(NEW.request->>'targetFactId')::uuid AND f.recovery_id=owner_id AND f.kind='partial_target') THEN RAISE EXCEPTION 'A partial auxiliary creation requires its exact original immutable target' USING ERRCODE='23514'; END IF;
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
  ELSIF NEW.kind NOT IN('legacy_fee_stop','customer_request','partial_target','partial_closure','unassigned_refund_review') THEN
   RAISE EXCEPTION 'A raw financial callback requires its actual admitted physical caller' USING ERRCODE='23514';
  END IF;
  IF NEW.kind='partial_target' AND ((original.owner->'cash'->>'applied')::boolean IS DISTINCT FROM true OR NEW.evidence->>'protocol' IS DISTINCT FROM 'freeholder.original-cash-partial-target.v1' OR NEW.evidence->>'targetKey' !~ '^[a-f0-9]{64}$' OR jsonb_typeof(NEW.evidence->'originalCreditIds') IS DISTINCT FROM 'array') THEN
   RAISE EXCEPTION 'A partial target requires its exact original applied principal and issued-credit witnesses' USING ERRCODE='23514';
  END IF;
  IF NEW.kind='partial_closure' AND NOT EXISTS(SELECT 1 FROM original_cash_recovery_facts f WHERE f.id=(NEW.evidence->>'targetFactId')::uuid AND f.recovery_id=owner_id AND f.kind='partial_target' AND f.evidence->>'targetKey'=NEW.evidence->>'targetKey' AND f.evidence->>'sourceDigest'=NEW.evidence->>'sourceDigest') THEN
   RAISE EXCEPTION 'A partial closure must retain its exact original target, never a full-cash debt waiver' USING ERRCODE='23514';
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
CREATE OR REPLACE FUNCTION freeholder_guard_legacy_bank_feedback() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original_payment uuid; original_cash text;
BEGIN
 IF TG_OP<>'INSERT' OR current_setting('freeholder.legacy_bank_feedback_v1',true) IS DISTINCT FROM '1' THEN
  RAISE EXCEPTION 'Raw original bank feedback is immutable and requires the verified shared intake' USING ERRCODE='55000';
 END IF;
 FOR original_payment IN SELECT DISTINCT p.id FROM payments p WHERE p.provider='stripe'
  AND(p.provider_ref=NEW.evidence->>'observedPaymentRef' OR EXISTS(SELECT 1 FROM refunds r WHERE r.payment_id=p.id AND r.provider_ref=NEW.evidence->>'observedRefundRef')) ORDER BY p.id LOOP
  PERFORM pg_advisory_xact_lock(hashtext('payment:'||original_payment::text));
 END LOOP;
 FOR original_cash IN
  WITH scopes AS (
   SELECT m.provider_platform_account_id platform,m.charge_account_id account,m.provider_ref intent FROM merchant_payment_observations m WHERE m.status='succeeded' AND m.amount_minor>0
   UNION SELECT r.provider_platform_account_id,r.charge_account_id,r.provider_payment_intent_ref FROM subscription_provider_charge_receipts r
  ), owned AS (
   SELECT s.* FROM scopes s WHERE s.account IS NOT DISTINCT FROM NEW.evidence->>'observedChargeAccountId'
    AND(NEW.evidence->>'observedPlatformAccountId' IS NULL OR NEW.evidence->>'observedPlatformAccountId'=s.platform)
    AND(s.intent=NEW.evidence->>'observedPaymentRef' OR EXISTS(SELECT 1 FROM merchant_refund_resource_bindings b JOIN merchant_refund_requests q ON q.id=b.request_id
      WHERE b.provider_ref=NEW.evidence->>'observedRefundRef' AND q.provider_platform_account_id=s.platform AND q.charge_account_id IS NOT DISTINCT FROM s.account AND q.original_payment_ref=s.intent)
     OR EXISTS(SELECT 1 FROM original_cash_recovery_facts f JOIN original_cash_recoveries c ON c.id=f.recovery_id WHERE f.kind='refund' AND f.evidence->>'providerRef'=NEW.evidence->>'observedRefundRef'
      AND f.evidence->>'paymentProviderRef'=s.intent AND c.owner->'cash'->>'providerPlatformAccountId'=s.platform AND c.owner->'cash'->>'chargeAccountId' IS NOT DISTINCT FROM s.account AND c.owner->'cash'->>'providerRef'=s.intent))
  ) SELECT DISTINCT 'subscription-cash:'||platform||':'||coalesce(account,'')||':'||intent FROM owned ORDER BY 1 LOOP
  PERFORM pg_advisory_xact_lock(hashtext(original_cash));
 END LOOP;
 RETURN NEW;
END $$;
