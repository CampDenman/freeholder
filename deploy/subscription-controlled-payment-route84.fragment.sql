-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
-- C12.38/C9.33/C1.08: OWNED UNAPPLIED additive continuation AFTER exact
-- controlled-cash-application-stages84.fragment.sql + period-source-null84.
-- No edits to frozen SQL0-85. A marker points to genuine current stage only.
CREATE FUNCTION freeholder_controlled_subscription_route_valid(proposed_route jsonb) RETURNS boolean LANGUAGE plpgsql VOLATILE AS $$
DECLARE pointer jsonb; batch_record controlled_cash_application_batches%ROWTYPE; receipt_proof controlled_cash_application_receipts%ROWTYPE;
 link_record controlled_cash_application_links%ROWTYPE; original_receipt subscription_provider_charge_receipts%ROWTYPE;
 origin_record subscription_controlled_charge_origins%ROWTYPE; resource_record subscription_controlled_resources%ROWTYPE; payment_record payments%ROWTYPE; stage_record jsonb;
BEGIN
 pointer=nullif(current_setting('freeholder.controlled_cash_application_batch_v1',true),'')::jsonb;
 IF pointer IS NULL OR jsonb_typeof(pointer) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(pointer))<>4
  OR NOT(pointer ?& ARRAY['batchId','collectionId','receiptId','admissionDigest'])
  OR coalesce(pointer->>'batchId','')!~'^[a-f0-9-]{36}$' OR coalesce(pointer->>'collectionId','')!~'^[a-f0-9-]{36}$'
  OR coalesce(pointer->>'receiptId','')!~'^[a-f0-9-]{36}$' OR coalesce(pointer->>'admissionDigest','')!~'^[a-f0-9]{64}$' THEN RETURN false;END IF;
 SELECT * INTO batch_record FROM controlled_cash_application_batches WHERE id=(pointer->>'batchId')::uuid;
 SELECT * INTO receipt_proof FROM controlled_cash_application_receipts WHERE batch_id=batch_record.id AND receipt_id=(pointer->>'receiptId')::uuid;
 SELECT * INTO link_record FROM controlled_cash_application_links WHERE batch_id=batch_record.id AND receipt_proof_id=receipt_proof.id AND receipt_id=receipt_proof.receipt_id;
 SELECT * INTO original_receipt FROM subscription_provider_charge_receipts WHERE id=receipt_proof.receipt_id;
 SELECT * INTO origin_record FROM subscription_controlled_charge_origins WHERE receipt_id=original_receipt.id;
 SELECT * INTO resource_record FROM subscription_controlled_resources WHERE id=batch_record.resource_id;
 SELECT * INTO payment_record FROM payments WHERE id=link_record.payment_id;
 IF batch_record.id IS NULL OR receipt_proof.id IS NULL OR link_record.payment_id IS NULL OR original_receipt.id IS NULL OR origin_record.receipt_id IS NULL OR resource_record.id IS NULL OR payment_record.id IS NULL
  OR batch_record.protocol IS DISTINCT FROM 'controlled_net_gross.v1' OR batch_record.digest IS DISTINCT FROM pointer->>'admissionDigest'
  OR batch_record.collection_id::text IS DISTINCT FROM pointer->>'collectionId' OR batch_record.admission_transaction_id IS DISTINCT FROM txid_current()::text
  OR origin_record.resource_id IS DISTINCT FROM batch_record.resource_id OR origin_record.operation_id IS DISTINCT FROM receipt_proof.origin_operation_id
  OR origin_record.call_id IS DISTINCT FROM receipt_proof.origin_call_id OR origin_record.fact_id IS DISTINCT FROM receipt_proof.origin_fact_id
  OR original_receipt.subscription_id IS DISTINCT FROM batch_record.subscription_id OR resource_record.subscription_id IS DISTINCT FROM batch_record.subscription_id
  OR original_receipt.amount_minor IS DISTINCT FROM receipt_proof.amount_minor OR original_receipt.currency IS DISTINCT FROM receipt_proof.currency
  OR payment_record.invoice_id IS DISTINCT FROM batch_record.invoice_id OR payment_record.status IS DISTINCT FROM 'created'
  OR payment_record.provider IS DISTINCT FROM 'stripe' OR payment_record.method IS DISTINCT FROM 'provider_schedule'
  OR payment_record.amount_minor IS DISTINCT FROM receipt_proof.amount_minor OR payment_record.currency IS DISTINCT FROM receipt_proof.currency
  OR payment_record.idempotency_key IS DISTINCT FROM receipt_proof.payment_idempotency_key OR payment_record.request_hash IS DISTINCT FROM receipt_proof.payment_request_hash
  OR proposed_route->>'payment_id' IS DISTINCT FROM payment_record.id::text OR proposed_route->>'subscription_id' IS DISTINCT FROM batch_record.subscription_id::text
  OR proposed_route->>'agreement_routing_version' IS DISTINCT FROM '1' OR proposed_route->>'origin_kind' IS DISTINCT FROM 'provider_schedule'
  OR proposed_route->>'original_charge_receipt_id' IS DISTINCT FROM original_receipt.id::text
  OR proposed_route->>'provider_api_version' IS DISTINCT FROM original_receipt.provider_api_version
  OR proposed_route->>'provider_platform_account_id' IS DISTINCT FROM original_receipt.provider_platform_account_id
  OR proposed_route->>'charge_account_id' IS DISTINCT FROM original_receipt.charge_account_id
  OR proposed_route->>'provider_subscription_ref' IS DISTINCT FROM original_receipt.provider_subscription_ref
  OR proposed_route->>'provider_invoice_ref' IS DISTINCT FROM original_receipt.provider_invoice_ref
  OR proposed_route->>'provider_payment_intent_ref' IS DISTINCT FROM original_receipt.provider_payment_intent_ref
  OR proposed_route->>'provider_charge_ref' IS DISTINCT FROM original_receipt.provider_charge_ref OR original_receipt.provider_charge_ref IS NULL
  OR proposed_route->>'recipient_account_id' IS DISTINCT FROM coalesce(resource_record.original_scope->>'destinationAccountId',resource_record.original_scope->>'providerAccountId')
  OR proposed_route->>'settlement_merchant_account_id' IS DISTINCT FROM coalesce(resource_record.original_scope->>'settlementMerchantAccountId',resource_record.original_scope->>'providerAccountId')
  OR proposed_route->>'collection_kind' IS DISTINCT FROM (CASE WHEN resource_record.original_scope->>'destinationAccountId' IS NOT NULL THEN 'destination' ELSE 'direct' END)
  OR proposed_route->>'application_fee_minor' IS DISTINCT FROM receipt_proof.fee_minor::text
  OR (proposed_route->>'created_at')::timestamptz IS DISTINCT FROM now() THEN RETURN false;END IF;
 -- Real post-birth row/link, exact settled prefix, complete current PG graph and
 -- immutable returned bank proof. Never a marker-only or planned-payment grant.
 stage_record=freeholder_controlled_cash_stage(batch_record.id,receipt_proof.receipt_id,payment_record.id);
 RETURN coalesce(stage_record->>'batchId'=batch_record.id::text AND stage_record->>'collectionId'=batch_record.collection_id::text
  AND stage_record->>'receiptId'=receipt_proof.receipt_id::text AND stage_record->>'paymentId'=payment_record.id::text
  AND stage_record->>'normalizedParentRevision'=batch_record.parent_pg_revision AND stage_record->>'complete'='false',false);
END $$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_merchant_agreement_payment_route() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE payment payments%ROWTYPE; parent invoices%ROWTYPE; policy invoice_market_policies%ROWTYPE; original record; paid numeric; prior_fee numeric; duty agreement_fee_duties%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Original agreement payment routing is immutable.' USING ERRCODE='23514'; END IF;
 SELECT * INTO payment FROM payments WHERE id=NEW.payment_id;
 SELECT * INTO parent FROM invoices WHERE id=payment.invoice_id FOR UPDATE;
 SELECT * INTO policy FROM invoice_market_policies WHERE invoice_id=payment.invoice_id;
 SELECT scope.* INTO original FROM subscription_merchant_scopes scope JOIN subscriptions s ON s.id=scope.subscription_id
  WHERE scope.subscription_id=NEW.subscription_id AND s.merchant_scope_version=1;
 IF payment.id IS NULL OR parent.id IS NULL OR original.subscription_id IS NULL OR parent.source_type IS DISTINCT FROM 'subscription'
  OR split_part(parent.source_id,':',1) IS DISTINCT FROM NEW.subscription_id::text OR policy.invoice_id IS NULL OR policy.model IS DISTINCT FROM 'seller_merchant'
  OR payment.currency IS DISTINCT FROM parent.currency
  OR payment.provider<>'stripe' OR payment.status<>'created' OR payment.method NOT IN('hosted_checkout','saved_method','provider_schedule')
  OR NEW.collection_kind IS DISTINCT FROM original.collection_kind OR NEW.provider_platform_account_id IS DISTINCT FROM original.provider_platform_account_id
  OR NEW.charge_account_id IS DISTINCT FROM original.charge_account_id OR NEW.recipient_account_id IS DISTINCT FROM original.recipient_account_id
  OR NEW.settlement_merchant_account_id IS DISTINCT FROM original.settlement_merchant_account_id
  OR(NEW.origin_kind='provider_schedule') IS DISTINCT FROM(payment.method='provider_schedule')
  OR(NEW.origin_kind='provider_schedule' AND NEW.provider_api_version IS DISTINCT FROM original.provider_schedule_api_version)
  OR(NEW.origin_kind='provider_schedule' AND NOT EXISTS(SELECT 1 FROM subscription_provider_charge_receipts receipt WHERE receipt.id=NEW.original_charge_receipt_id
   AND receipt.subscription_id=NEW.subscription_id AND receipt.provider_platform_account_id=NEW.provider_platform_account_id AND receipt.charge_account_id IS NOT DISTINCT FROM NEW.charge_account_id
   AND receipt.provider_api_version=NEW.provider_api_version AND receipt.provider_subscription_ref=NEW.provider_subscription_ref AND receipt.provider_invoice_ref=NEW.provider_invoice_ref
   AND receipt.provider_payment_intent_ref=NEW.provider_payment_intent_ref AND receipt.provider_charge_ref=NEW.provider_charge_ref AND receipt.amount_minor=payment.amount_minor AND receipt.currency=payment.currency))
  OR EXISTS(SELECT 1 FROM merchant_payment_observations o JOIN payments p ON p.id=o.payment_id WHERE p.invoice_id=payment.invoice_id AND o.status='succeeded' AND(p.status<>'succeeded' OR o.amount_minor<>p.amount_minor OR o.currency<>p.currency OR(o.provider_ref IS DISTINCT FROM p.provider_ref AND o.provider_ref IS DISTINCT FROM p.provider_checkout_ref)))
  OR NEW.application_fee_minor>payment.amount_minor
  OR EXISTS(SELECT 1 FROM payment_merchant_routes WHERE payment_id=NEW.payment_id)
  OR EXISTS(SELECT 1 FROM merchant_payment_routes WHERE payment_id=NEW.payment_id)
  OR EXISTS(SELECT 1 FROM payments p WHERE p.invoice_id=payment.invoice_id AND p.id<>payment.id AND p.status IN('created','processing')) THEN
  RAISE EXCEPTION 'Bind each new agreement payment to its immutable original merchant namespace.' USING ERRCODE='23514';
 END IF;
 IF split_part(parent.source_id,':',2)='proration' THEN
  SELECT * INTO duty FROM agreement_fee_duties WHERE invoice_id=parent.id;
  SELECT coalesce(sum(p.amount_minor),0),coalesce(sum(coalesce(a.fee_owed_minor,g.application_fee_minor)),0) INTO paid,prior_fee FROM payments p
   LEFT JOIN commercial_payment_attestations a ON a.payment_id=p.id LEFT JOIN merchant_agreement_payment_routes g ON g.payment_id=p.id
   WHERE p.invoice_id=parent.id AND p.status='succeeded';
  IF duty.invoice_id IS NULL OR (NEW.origin_kind<>'attempt' AND NOT freeholder_controlled_subscription_route_valid(to_jsonb(NEW))) OR duty.total_minor<>parent.total_minor OR duty.credited_minor<>parent.credited_minor OR duty.target_fee_minor<>policy.fee_minor
   OR duty.cash_principal_minor<=0 OR paid<>parent.paid_minor OR paid+payment.amount_minor>duty.cash_principal_minor
   OR prior_fee<>floor(duty.cash_fee_target_minor::numeric*paid/duty.cash_principal_minor)
   OR NEW.application_fee_minor<>floor(duty.cash_fee_target_minor::numeric*(paid+payment.amount_minor)/duty.cash_principal_minor)-prior_fee
   OR EXISTS(SELECT 1 FROM payments p LEFT JOIN commercial_payment_attestations a ON a.payment_id=p.id LEFT JOIN merchant_agreement_payment_routes g ON g.payment_id=p.id WHERE p.invoice_id=parent.id AND p.status='succeeded'
    AND((a.payment_id IS NOT NULL)::integer+(g.payment_id IS NOT NULL)::integer<>1 OR p.refunded_minor<>0)) THEN
   RAISE EXCEPTION 'Bind only the physically bounded original gross-target fee while preserving its separately frozen merchant receivable and actual source assignments' USING ERRCODE='23514';END IF;
  RETURN NEW;
 END IF;
 SELECT COALESCE(sum(p.amount_minor),0),COALESCE(sum(r.application_fee_minor),0) INTO paid,prior_fee
 FROM payments p JOIN merchant_agreement_payment_routes r ON r.payment_id=p.id WHERE p.invoice_id=payment.invoice_id AND p.status='succeeded';
 IF parent.total_minor=0 OR paid<>parent.paid_minor OR paid+payment.amount_minor>parent.total_minor
  OR prior_fee<>floor(policy.fee_minor::numeric*paid/parent.total_minor)
  OR NEW.application_fee_minor<>floor(policy.fee_minor::numeric*(paid+payment.amount_minor)/parent.total_minor)-prior_fee THEN
  RAISE EXCEPTION 'The original agreement payment and application fee must conserve every invoice cent.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;

--> statement-breakpoint
CREATE FUNCTION guard_subscription_controlled_agreement_route() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM controlled_cash_application_links actual_link WHERE actual_link.payment_id=NEW.payment_id)
  OR EXISTS(SELECT 1 FROM subscription_controlled_charge_origins actual_origin WHERE actual_origin.receipt_id=NEW.original_charge_receipt_id) THEN
  IF TG_OP IS DISTINCT FROM 'INSERT' OR freeholder_controlled_subscription_route_valid(to_jsonb(NEW)) IS DISTINCT FROM true THEN
   RAISE EXCEPTION 'Only the actual uniquely admitted controlled receipt/payment may create its exact original immutable merchant route' USING ERRCODE='23514';END IF;
 END IF;
 RETURN NEW;
END $$;

--> statement-breakpoint
CREATE TRIGGER subscription_controlled_agreement_route_guard BEFORE INSERT OR UPDATE ON merchant_agreement_payment_routes FOR EACH ROW EXECUTE FUNCTION guard_subscription_controlled_agreement_route();

--> statement-breakpoint
CREATE FUNCTION freeholder_controlled_subscription_route_ready() RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT coalesce(
  EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('freeholder_controlled_subscription_route_valid(jsonb)') AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='85c86262d3f819470ff6bb6e534e91357cbfb3e62bf4ae3b4a4eece2eabf5426')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('guard_merchant_agreement_payment_route()') AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='6afbc75ffcecfa9210c70a2646e6cb1751b5016367d845e498116c1362289d65')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('guard_subscription_controlled_agreement_route()') AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='5315979c10ffba43177521dccf94ab401442f724f9bb372eb24802327d391c6f')
  AND EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid='merchant_agreement_payment_routes'::regclass AND t.tgname='merchant_agreement_payment_route_guard' AND t.tgfoid=to_regprocedure('guard_merchant_agreement_payment_route()') AND t.tgenabled IN('O','A') AND t.tgtype=31 AND NOT t.tgisinternal)
  AND EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid='merchant_agreement_payment_routes'::regclass AND t.tgname='subscription_controlled_agreement_route_guard' AND t.tgfoid=to_regprocedure('guard_subscription_controlled_agreement_route()') AND t.tgenabled IN('O','A') AND t.tgtype=23 AND NOT t.tgisinternal),false);
$$;
