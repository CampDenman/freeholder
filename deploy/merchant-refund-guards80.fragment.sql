-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C12.38: unpublished original refund ABI/provenance and application fences.
-- This ABI is not a security boundary against a DB owner or forged trusted code.
-- Older runtimes and already-admitted provider work still require actual drain.
CREATE FUNCTION freeholder_original_refund_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Original refund evidence is append-only' USING ERRCODE='23514'; END IF;
 IF current_setting('freeholder.merchant_refund_v1',true) IS DISTINCT FROM '1' THEN
  RAISE EXCEPTION 'Use the current shared original refund phase' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['merchant_refund_requests','merchant_refund_reservation_retirements','merchant_refund_dispatches','merchant_refund_observations',
  'merchant_refund_creation_refusals','merchant_refund_terminal_receipts','merchant_refund_dispatch_finishes','merchant_refund_dispatch_stops',
  'merchant_refund_resource_bindings','merchant_cash_return_inspections','merchant_cash_return_inspection_finishes','merchant_cash_return_primary_observations',
  'merchant_cash_return_observations','merchant_unapplied_charge_resolutions','merchant_unapplied_charge_resolution_refunds'] LOOP
  EXECUTE format('CREATE TRIGGER original_refund_append_only BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION freeholder_original_refund_append_only()',t);
 END LOOP;
END $$;
--> statement-breakpoint
CREATE FUNCTION freeholder_original_refund_request() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE observed merchant_payment_observations%ROWTYPE; scheduled subscription_provider_charge_observations%ROWTYPE;
 receipt subscription_provider_charge_receipts%ROWTYPE; logical refunds%ROWTYPE; body text; owner_field text; owner_id uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('subscription-cash:'||NEW.provider_platform_account_id||':'||coalesce(NEW.charge_account_id,'')||':'||NEW.original_payment_ref));
 IF NEW.payment_id IS NOT NULL THEN
  SELECT * INTO observed FROM merchant_payment_observations WHERE id=NEW.original_observation_id;
  IF observed.id IS NULL OR observed.payment_id<>NEW.payment_id OR observed.status<>'succeeded'
   OR observed.provider_platform_account_id<>NEW.provider_platform_account_id OR observed.charge_account_id IS DISTINCT FROM NEW.charge_account_id
   OR coalesce(observed.provider_api_version,'2026-02-25.clover')<>NEW.provider_api_version OR observed.provider_ref<>NEW.original_payment_ref
   OR observed.amount_minor<>NEW.original_cash_amount_minor OR observed.currency<>NEW.currency THEN
   RAISE EXCEPTION 'Restore the actual original payment cash before refund admission' USING ERRCODE='23514';
  END IF;
  owner_field:='freeholder_payment_id'; owner_id:=NEW.payment_id;
  IF NEW.purpose='invoice_refund' THEN
   SELECT * INTO logical FROM refunds WHERE id=NEW.refund_id;
   IF logical.id IS NULL OR logical.payment_id<>NEW.payment_id OR logical.amount_minor<>NEW.amount_minor OR logical.currency<>NEW.currency
    OR logical.idempotency_key<>NEW.idempotency_key OR NOT observed.customer_charge_verified
    OR NOT EXISTS(SELECT 1 FROM payments p WHERE p.id=NEW.payment_id AND p.status='succeeded' AND p.provider='stripe'
     AND p.provider_ref=NEW.original_payment_ref AND p.amount_minor=NEW.original_cash_amount_minor AND p.currency=NEW.currency) THEN
    RAISE EXCEPTION 'An invoice refund requires its actual original successful payment and reservation' USING ERRCODE='23514';
   END IF;
  ELSIF EXISTS(SELECT 1 FROM payments p WHERE p.id=NEW.payment_id AND p.status='succeeded' AND p.provider_ref=NEW.original_payment_ref
   AND p.amount_minor=NEW.original_cash_amount_minor AND p.currency=NEW.currency) THEN
   RAISE EXCEPTION 'Applied cash must use its original invoice refund path' USING ERRCODE='23514';
  END IF;
 ELSE
  SELECT * INTO receipt FROM subscription_provider_charge_receipts WHERE id=NEW.subscription_charge_receipt_id;
  SELECT * INTO scheduled FROM subscription_provider_charge_observations WHERE id=NEW.subscription_charge_observation_id;
  IF receipt.id IS NULL OR scheduled.id IS NULL OR scheduled.subscription_id<>receipt.subscription_id
   OR receipt.provider_platform_account_id<>NEW.provider_platform_account_id OR receipt.charge_account_id IS DISTINCT FROM NEW.charge_account_id
   OR receipt.provider_api_version<>NEW.provider_api_version OR receipt.provider_payment_intent_ref<>NEW.original_payment_ref
   OR receipt.amount_minor<>NEW.original_cash_amount_minor OR receipt.currency<>NEW.currency
   OR scheduled.provider_platform_account_id<>receipt.provider_platform_account_id OR scheduled.charge_account_id IS DISTINCT FROM receipt.charge_account_id
   OR scheduled.provider_api_version<>receipt.provider_api_version OR scheduled.provider_invoice_ref<>receipt.provider_invoice_ref
   OR scheduled.provider_subscription_ref<>receipt.provider_subscription_ref OR scheduled.provider_payment_intent_ref<>receipt.provider_payment_intent_ref
   OR scheduled.amount_minor<>receipt.amount_minor OR scheduled.currency<>receipt.currency
   OR EXISTS(SELECT 1 FROM merchant_agreement_payment_routes r WHERE r.original_charge_receipt_id=receipt.id) THEN
   RAISE EXCEPTION 'Restore unassigned original subscription cash; do not invent a payment' USING ERRCODE='23514';
  END IF;
  owner_field:='freeholder_subscription_charge_receipt_id'; owner_id:=receipt.id;
 END IF;
 body:='payment_intent='||NEW.original_payment_ref||'&amount='||NEW.amount_minor::text||'&metadata%5Bfreeholder_refund_id%5D='||NEW.id::text
  ||'&metadata%5Bfreeholder_platform_account_id%5D='||NEW.provider_platform_account_id||'&metadata%5B'||owner_field||'%5D='||owner_id::text;
 IF (NEW.original_request->>'refundAttemptId') IS DISTINCT FROM NEW.id::text
  OR (NEW.original_request->>'providerPlatformAccountId') IS DISTINCT FROM NEW.provider_platform_account_id
  OR coalesce(NEW.original_request->>'providerAccountId','')<>coalesce(NEW.charge_account_id,'')
  OR (NEW.original_request->>'providerApiVersion') IS DISTINCT FROM NEW.provider_api_version
  OR (NEW.original_request->>'providerRef') IS DISTINCT FROM NEW.original_payment_ref
  OR (NEW.original_request->>'amountMinor') IS DISTINCT FROM NEW.amount_minor::text OR (NEW.original_request->>'currency') IS DISTINCT FROM NEW.currency
  OR (NEW.original_request->>'idempotencyKey') IS DISTINCT FROM 'freeholder-merchant-refund:'||NEW.id::text
  OR (NEW.original_request->>'frozenBody') IS DISTINCT FROM body OR NEW.original_request->>'reverseTransfer' IS DISTINCT FROM 'false'
  OR NEW.original_request->>'refundApplicationFee' IS DISTINCT FROM 'false'
  OR (NEW.payment_id IS NOT NULL AND (NEW.original_request->>'paymentId') IS DISTINCT FROM NEW.payment_id::text)
  OR (NEW.subscription_charge_receipt_id IS NOT NULL AND (NEW.original_request->>'subscriptionChargeReceiptId') IS DISTINCT FROM NEW.subscription_charge_receipt_id::text) THEN
  RAISE EXCEPTION 'The exact original refund transport does not match its cash owner' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER original_refund_request BEFORE INSERT ON merchant_refund_requests FOR EACH ROW EXECUTE FUNCTION freeholder_original_refund_request();
--> statement-breakpoint
CREATE FUNCTION freeholder_original_refund_admission() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original merchant_refund_requests%ROWTYPE;
BEGIN
 SELECT * INTO original FROM merchant_refund_requests WHERE id=NEW.request_id;
 IF original.id IS NULL THEN RAISE EXCEPTION 'Restore the original refund request' USING ERRCODE='23514'; END IF;
 IF original.refund_id IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtext('refund:'||original.refund_id::text)); END IF;
 PERFORM pg_advisory_xact_lock(hashtext('subscription-cash:'||original.provider_platform_account_id||':'||coalesce(original.charge_account_id,'')||':'||original.original_payment_ref));
 IF TG_TABLE_NAME='merchant_refund_dispatches' THEN
  IF original.payment_id IS NOT NULL AND EXISTS(SELECT 1 FROM merchant_payment_dispatches d WHERE d.payment_id=original.payment_id
   AND NOT EXISTS(SELECT 1 FROM merchant_payment_dispatch_finishes f WHERE f.dispatch_id=d.id AND f.caller_instance_id=(d.caller->>'id')::uuid)
   AND NOT EXISTS(SELECT 1 FROM merchant_payment_dispatch_stops s WHERE s.dispatch_id=d.id AND s.caller_instance_id=(d.caller->>'id')::uuid AND s.request_digest=d.request_digest)) THEN
   RAISE EXCEPTION 'Finish or verify the original payment caller before admitting a customer refund' USING ERRCODE='23514';
  END IF;
  IF NEW.ordinal<>1 OR NEW.request_digest<>original.request_digest OR NEW.completion_nonce_hash !~ '^[a-f0-9]{64}$'
   OR jsonb_typeof(NEW.caller)<>'object' OR NOT (NEW.caller ?& ARRAY['id','pid','host','startedAt','bootId','pidNamespace','startTicks'])
   OR EXISTS(SELECT 1 FROM merchant_refund_reservation_retirements WHERE request_id=original.id)
   OR EXISTS(SELECT 1 FROM merchant_refund_dispatches WHERE request_id=original.id) THEN
   RAISE EXCEPTION 'One original refund permits one physical creation; reconcile instead of replaying it' USING ERRCODE='23514';
  END IF;
 ELSE
  IF NEW.request_digest<>original.request_digest OR EXISTS(SELECT 1 FROM merchant_refund_dispatches WHERE request_id=original.id) THEN
   RAISE EXCEPTION 'A physically admitted refund cannot be retired by a local cancellation' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER original_refund_dispatch BEFORE INSERT ON merchant_refund_dispatches FOR EACH ROW EXECUTE FUNCTION freeholder_original_refund_admission();
--> statement-breakpoint
CREATE TRIGGER original_refund_retire BEFORE INSERT ON merchant_refund_reservation_retirements FOR EACH ROW EXECUTE FUNCTION freeholder_original_refund_admission();
--> statement-breakpoint
CREATE FUNCTION freeholder_original_refund_resolved(p_request_id uuid, outcome text, resource_ref text DEFAULT NULL) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE original merchant_refund_requests%ROWTYPE; resource text; resource_count integer;
BEGIN
 SELECT * INTO original FROM merchant_refund_requests WHERE id=p_request_id;
 IF original.id IS NULL THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM merchant_refund_dispatches d WHERE d.request_id=original.id
  AND NOT EXISTS(SELECT 1 FROM merchant_refund_dispatch_finishes f WHERE f.dispatch_id=d.id AND f.caller_instance_id=(d.caller->>'id')::uuid)
  AND NOT EXISTS(SELECT 1 FROM merchant_refund_dispatch_stops s WHERE s.dispatch_id=d.id AND s.caller_instance_id=(d.caller->>'id')::uuid AND s.request_digest=d.request_digest)) THEN RETURN false; END IF;
 IF outcome='failed' AND EXISTS(SELECT 1 FROM merchant_refund_reservation_retirements r WHERE r.request_id=original.id AND r.request_digest=original.request_digest)
  AND NOT EXISTS(SELECT 1 FROM merchant_refund_dispatches WHERE request_id=original.id) THEN RETURN true; END IF;
 SELECT count(DISTINCT b.provider_ref),min(b.provider_ref) INTO resource_count,resource FROM merchant_refund_resource_bindings b WHERE b.request_id=original.id
  AND (b.origin='physical_ack' OR NOT EXISTS(SELECT 1 FROM merchant_refund_resource_bindings a WHERE a.request_id=original.id AND a.origin='physical_ack'));
 IF resource_count<>1 OR resource_ref IS NOT NULL AND resource_ref<>resource THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM merchant_refund_observations o WHERE o.request_id=original.id AND o.provider_ref=resource AND o.binding_verified AND o.status='succeeded')
  AND EXISTS(SELECT 1 FROM merchant_refund_observations o WHERE o.request_id=original.id AND o.provider_ref=resource AND o.binding_verified AND(o.status IN('failed','canceled','requires_action') OR o.status IS NULL)) THEN RETURN false; END IF;
 RETURN EXISTS(SELECT 1 FROM merchant_refund_observations o WHERE o.request_id=original.id AND o.provider_ref=resource AND o.binding_verified
  AND o.provider_platform_account_id=original.provider_platform_account_id AND o.charge_account_id IS NOT DISTINCT FROM original.charge_account_id
  AND o.provider_api_version=original.provider_api_version AND o.payment_provider_ref=original.original_payment_ref
  AND o.amount_minor=original.amount_minor AND o.currency=original.currency
  AND ((outcome='succeeded' AND o.status='succeeded') OR(outcome='failed' AND o.status IN('failed','canceled'))));
END $$;
--> statement-breakpoint
CREATE FUNCTION freeholder_original_refund_transition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original merchant_refund_requests%ROWTYPE; source_payment uuid;
BEGIN
 source_payment:=CASE WHEN TG_OP='DELETE' THEN OLD.payment_id ELSE NEW.payment_id END;
 IF NOT EXISTS(SELECT 1 FROM merchant_payment_routes WHERE payment_id=source_payment)
  AND NOT EXISTS(SELECT 1 FROM merchant_invoice_payment_routes WHERE payment_id=source_payment)
  AND NOT EXISTS(SELECT 1 FROM merchant_agreement_payment_routes WHERE payment_id=source_payment) THEN
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Original merchant refund history cannot be deleted' USING ERRCODE='23514'; END IF;
 -- Existing privacy minimization may remove free text while preserving money.
 IF to_jsonb(NEW)-ARRAY['reason','failure_message','updated_at'] = to_jsonb(OLD)-ARRAY['reason','failure_message','updated_at'] AND NEW.reason IS NULL AND NEW.failure_message IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO original FROM merchant_refund_requests WHERE refund_id=OLD.id;
 IF original.id IS NULL OR current_setting('freeholder.merchant_refund_v1',true) IS DISTINCT FROM '1' THEN
  RAISE EXCEPTION 'Restore the original merchant refund source before state changes' USING ERRCODE='55000';
 END IF;
 IF NEW.id<>OLD.id OR NEW.payment_id<>OLD.payment_id OR NEW.invoice_id<>OLD.invoice_id OR NEW.provider<>OLD.provider
  OR NEW.amount_minor<>OLD.amount_minor OR NEW.currency<>OLD.currency OR NEW.idempotency_key<>OLD.idempotency_key OR NEW.request_hash<>OLD.request_hash
  OR OLD.provider_ref IS NOT NULL AND NEW.provider_ref IS DISTINCT FROM OLD.provider_ref THEN
  RAISE EXCEPTION 'Original merchant refund identity and money are immutable' USING ERRCODE='23514';
 END IF;
 IF NEW.status='processing' THEN
  IF NOT EXISTS(SELECT 1 FROM merchant_refund_dispatches WHERE request_id=original.id)
   OR NEW.provider_ref IS NOT NULL AND NOT EXISTS(SELECT 1 FROM merchant_refund_resource_bindings WHERE request_id=original.id AND provider_ref=NEW.provider_ref) THEN
   RAISE EXCEPTION 'Processing requires actual original physical admission and resource proof' USING ERRCODE='23514';
  END IF;
 ELSIF NEW.status='succeeded' THEN
  IF NOT freeholder_original_refund_resolved(original.id,'succeeded',NEW.provider_ref) THEN RAISE EXCEPTION 'Retain the actual original successful refund and caller proof first' USING ERRCODE='23514'; END IF;
 ELSIF NEW.status='failed' THEN
  IF NOT freeholder_original_refund_resolved(original.id,'failed') THEN RAISE EXCEPTION 'Unknown refund money cannot be released as failed' USING ERRCODE='23514'; END IF;
 ELSIF NEW.status='cancelled' THEN
  IF NOT EXISTS(SELECT 1 FROM merchant_refund_reservation_retirements WHERE request_id=original.id AND request_digest=original.request_digest)
   OR EXISTS(SELECT 1 FROM merchant_refund_dispatches WHERE request_id=original.id) THEN
   RAISE EXCEPTION 'Only a provably unadmitted original refund can be cancelled locally' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER original_merchant_refund_transition BEFORE UPDATE OR DELETE ON refunds FOR EACH ROW EXECUTE FUNCTION freeholder_original_refund_transition();
--> statement-breakpoint
CREATE FUNCTION freeholder_original_refund_capture() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (EXISTS(SELECT 1 FROM merchant_payment_routes WHERE payment_id=NEW.payment_id) OR EXISTS(SELECT 1 FROM merchant_invoice_payment_routes WHERE payment_id=NEW.payment_id)
  OR EXISTS(SELECT 1 FROM merchant_agreement_payment_routes WHERE payment_id=NEW.payment_id))
  AND NOT EXISTS(SELECT 1 FROM merchant_refund_requests r WHERE r.refund_id=NEW.id AND r.payment_id=NEW.payment_id AND r.amount_minor=NEW.amount_minor AND r.currency=NEW.currency AND r.idempotency_key=NEW.idempotency_key) THEN
  RAISE EXCEPTION 'Current merchant refunds must capture original request provenance in the shared reservation transaction' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER original_merchant_refund_capture AFTER INSERT ON refunds DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION freeholder_original_refund_capture();
--> statement-breakpoint
CREATE FUNCTION freeholder_original_cash_applicable(platform_id text, charge_account text, payment_ref text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('subscription-cash:'||platform_id||':'||coalesce(charge_account,'')||':'||payment_ref));
 RETURN NOT EXISTS(SELECT 1 FROM merchant_refund_requests WHERE provider_platform_account_id=platform_id AND charge_account_id IS NOT DISTINCT FROM charge_account
  AND original_payment_ref=payment_ref AND purpose='unapplied_return')
  AND NOT EXISTS(SELECT 1 FROM merchant_unapplied_charge_resolutions WHERE provider_platform_account_id=platform_id AND charge_account_id IS NOT DISTINCT FROM charge_account AND original_payment_ref=payment_ref);
END $$;
--> statement-breakpoint
CREATE FUNCTION freeholder_original_cash_payment_application() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner record;
BEGIN
 IF NEW.status<>'succeeded' OR NEW.provider_ref IS NULL THEN RETURN NEW; END IF;
 FOR owner IN
  SELECT c.provider_platform_account_id platform_id,c.charge_account_id charge_account FROM merchant_payment_routes r JOIN invoice_merchant_collections c ON c.allocation_id=r.allocation_id WHERE r.payment_id=NEW.id
  UNION ALL SELECT c.provider_platform_account_id,c.charge_account_id FROM merchant_invoice_payment_routes r JOIN invoice_merchant_scopes c ON c.invoice_id=r.invoice_id WHERE r.payment_id=NEW.id
  UNION ALL SELECT r.provider_platform_account_id,r.charge_account_id FROM merchant_agreement_payment_routes r WHERE r.payment_id=NEW.id
 LOOP
  IF NOT freeholder_original_cash_applicable(owner.platform_id,owner.charge_account,NEW.provider_ref) THEN
   RAISE EXCEPTION 'Original cash reserved for return cannot be credited to an invoice' USING ERRCODE='23514';
  END IF;
 END LOOP;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER original_cash_payment_application AFTER INSERT OR UPDATE ON payments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION freeholder_original_cash_payment_application();
--> statement-breakpoint
CREATE FUNCTION freeholder_original_subscription_cash_application() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE receipt subscription_provider_charge_receipts%ROWTYPE;
BEGIN
 IF NEW.original_charge_receipt_id IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO receipt FROM subscription_provider_charge_receipts WHERE id=NEW.original_charge_receipt_id;
 IF receipt.id IS NULL OR NOT freeholder_original_cash_applicable(receipt.provider_platform_account_id,receipt.charge_account_id,receipt.provider_payment_intent_ref) THEN
  RAISE EXCEPTION 'The original subscription cash is missing, returning, or already returned' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER original_subscription_cash_application AFTER INSERT OR UPDATE ON merchant_agreement_payment_routes DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION freeholder_original_subscription_cash_application();
