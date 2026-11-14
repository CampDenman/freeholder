-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
-- C12.38/C1.08: OWNED UNAPPLIED after the genuine controlled collection/retention tails.
-- SOURCE ONLY / UNQUALIFIED. Root owns assembly, identity pins and NEW DB qualification.
-- Additive guards only: NO existing function/trigger is replaced or disabled.
-- This finite checkpoint REFUSES controlled cash application until its genuine
-- finished bank/refund/dispute + parent/batch proof has an actual frozen SQL
-- producer. A session marker, allowed flag or same amount is NEVER that proof.
CREATE FUNCTION freeholder_controlled_cash_application_shape(target uuid) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE payment_row payments%ROWTYPE;invoice_row invoices%ROWTYPE;route_row merchant_agreement_payment_routes%ROWTYPE;
 receipt_row subscription_provider_charge_receipts%ROWTYPE;origin_row subscription_controlled_charge_origins%ROWTYPE;
 collection_row subscription_controlled_collections%ROWTYPE;quote_row subscription_controlled_quotes%ROWTYPE;
 resource_row subscription_controlled_resources%ROWTYPE;parent_row subscriptions%ROWTYPE;
 operation_row subscription_controlled_operations%ROWTYPE;call_row subscription_controlled_calls%ROWTYPE;fact_row subscription_controlled_facts%ROWTYPE;
 binding_row subscription_controlled_invoice_bindings%ROWTYPE;proof_row subscription_controlled_invoice_proofs%ROWTYPE;verification_row subscription_controlled_verifications%ROWTYPE;
 cash_rows numeric;cash_total numeric;bank jsonb;
BEGIN
 SELECT * INTO payment_row FROM payments WHERE id=target;
 SELECT * INTO invoice_row FROM invoices WHERE id=payment_row.invoice_id;
 SELECT * INTO collection_row FROM subscription_controlled_collections WHERE invoice_id=invoice_row.id;
 SELECT * INTO quote_row FROM subscription_controlled_quotes WHERE id=collection_row.quote_id;
 SELECT * INTO resource_row FROM subscription_controlled_resources WHERE id=quote_row.resource_id;
 SELECT * INTO parent_row FROM subscriptions WHERE id=resource_row.subscription_id;
 SELECT * INTO route_row FROM merchant_agreement_payment_routes WHERE payment_id=payment_row.id;
 SELECT * INTO receipt_row FROM subscription_provider_charge_receipts WHERE id=route_row.original_charge_receipt_id;
 SELECT * INTO origin_row FROM subscription_controlled_charge_origins WHERE receipt_id=receipt_row.id;
 SELECT * INTO operation_row FROM subscription_controlled_operations WHERE id=origin_row.operation_id;
 SELECT * INTO call_row FROM subscription_controlled_calls WHERE id=origin_row.call_id;
 SELECT * INTO fact_row FROM subscription_controlled_facts WHERE id=origin_row.fact_id;
 SELECT * INTO binding_row FROM subscription_controlled_invoice_bindings WHERE collection_id=collection_row.id;
 IF payment_row.id IS NULL OR invoice_row.id IS NULL OR collection_row.id IS NULL OR quote_row.id IS NULL OR resource_row.id IS NULL OR parent_row.id IS NULL
  OR NOT coalesce(freeholder_controlled_collection_valid(collection_row.id),false) OR collection_row.invoice_id IS DISTINCT FROM invoice_row.id
  OR invoice_row.source_type IS DISTINCT FROM 'subscription' OR invoice_row.source_id IS DISTINCT FROM quote_row.canonical_source_id
  OR invoice_row.contact_id IS DISTINCT FROM parent_row.contact_id OR invoice_row.currency IS DISTINCT FROM parent_row.currency
  OR quote_row.redacted_at IS NOT NULL OR collection_row.accepted_quote_digest IS DISTINCT FROM quote_row.quote_digest
  OR collection_row.original_consent_digest IS DISTINCT FROM quote_row.quote_digest OR quote_row.resource_id IS DISTINCT FROM resource_row.id
  OR payment_row.provider IS DISTINCT FROM 'stripe' OR payment_row.method IS DISTINCT FROM 'provider_schedule'
  OR payment_row.amount_minor<=0 OR payment_row.currency IS DISTINCT FROM invoice_row.currency OR payment_row.status IS DISTINCT FROM 'succeeded'
  OR route_row.payment_id IS NULL OR route_row.subscription_id IS DISTINCT FROM parent_row.id OR route_row.origin_kind IS DISTINCT FROM 'provider_schedule'
  OR route_row.provider_api_version IS DISTINCT FROM '2026-10-28.endive' OR route_row.original_charge_receipt_id IS NULL
  OR receipt_row.id IS NULL OR receipt_row.subscription_id IS DISTINCT FROM parent_row.id OR receipt_row.provider_api_version IS DISTINCT FROM route_row.provider_api_version
  OR receipt_row.provider_platform_account_id IS DISTINCT FROM route_row.provider_platform_account_id OR receipt_row.charge_account_id IS DISTINCT FROM route_row.charge_account_id
  OR receipt_row.provider_invoice_ref IS DISTINCT FROM route_row.provider_invoice_ref OR receipt_row.provider_subscription_ref IS DISTINCT FROM route_row.provider_subscription_ref
  OR receipt_row.provider_payment_intent_ref IS DISTINCT FROM route_row.provider_payment_intent_ref OR receipt_row.provider_charge_ref IS DISTINCT FROM route_row.provider_charge_ref
  OR receipt_row.provider_charge_ref IS NULL OR receipt_row.amount_minor IS DISTINCT FROM payment_row.amount_minor OR receipt_row.currency IS DISTINCT FROM payment_row.currency
  OR payment_row.provider_ref IS DISTINCT FROM receipt_row.provider_payment_intent_ref OR NOT receipt_row.customer_charge_verified OR NOT receipt_row.merchant_route_verified
  OR receipt_row.provider_platform_account_id IS DISTINCT FROM resource_row.original_scope->>'providerPlatformAccountId'
  OR receipt_row.charge_account_id IS DISTINCT FROM resource_row.original_scope->>'providerAccountId'
  OR origin_row.receipt_id IS NULL OR origin_row.resource_id IS DISTINCT FROM resource_row.id OR operation_row.resource_id IS DISTINCT FROM resource_row.id
  OR call_row.operation_id IS DISTINCT FROM operation_row.id OR fact_row.call_id IS DISTINCT FROM call_row.id OR fact_row.actual->>'kind' IS DISTINCT FROM 'cash_observed'
  OR fact_row.actual->'raw'->'cash'->>'providerPaymentIntentRef' IS DISTINCT FROM receipt_row.provider_payment_intent_ref
  OR fact_row.actual->'raw'->'cash'->>'providerInvoiceRef' IS DISTINCT FROM receipt_row.provider_invoice_ref
  OR fact_row.actual->'raw'->'cash'->>'providerChargeRef' IS DISTINCT FROM receipt_row.provider_charge_ref
  OR fact_row.actual->'raw'->'cash'->>'amountMinor' IS DISTINCT FROM receipt_row.amount_minor::text
  OR fact_row.actual->'raw'->'cash'->>'currency' IS DISTINCT FROM receipt_row.currency
  OR binding_row.collection_id IS NULL OR binding_row.resource_id IS DISTINCT FROM resource_row.id OR binding_row.provider_invoice_ref IS DISTINCT FROM receipt_row.provider_invoice_ref
  OR NOT coalesce(freeholder_controlled_callers_closed(resource_row.id),false)
  OR EXISTS(SELECT 1 FROM subscription_controlled_closures WHERE resource_id=resource_row.id)
  OR EXISTS(SELECT 1 FROM merchant_agreement_payment_routes sibling_route WHERE sibling_route.original_charge_receipt_id=receipt_row.id AND sibling_route.payment_id<>payment_row.id)
  OR EXISTS(SELECT 1 FROM merchant_agreement_payment_routes sibling_route WHERE sibling_route.provider_platform_account_id=receipt_row.provider_platform_account_id
   AND sibling_route.charge_account_id IS NOT DISTINCT FROM receipt_row.charge_account_id AND sibling_route.provider_payment_intent_ref=receipt_row.provider_payment_intent_ref AND sibling_route.payment_id<>payment_row.id)
  OR EXISTS(SELECT 1 FROM merchant_payment_routes WHERE payment_id=payment_row.id)
  OR EXISTS(SELECT 1 FROM merchant_invoice_payment_routes WHERE payment_id=payment_row.id)
  OR EXISTS(SELECT 1 FROM payment_merchant_routes WHERE payment_id=payment_row.id)
  OR EXISTS(SELECT 1 FROM commercial_payment_attestations WHERE payment_id=payment_row.id) THEN RETURN false;END IF;
 SELECT count(*),coalesce(sum(prior_payment.amount_minor),0) INTO cash_rows,cash_total FROM payments prior_payment
  WHERE prior_payment.invoice_id=invoice_row.id AND prior_payment.status='succeeded';
 IF cash_rows>5000 OR cash_total IS DISTINCT FROM invoice_row.paid_minor::numeric OR cash_total+invoice_row.credited_minor>invoice_row.total_minor
  OR invoice_row.paid_minor<0 OR invoice_row.credited_minor<0 OR invoice_row.refunded_minor<>0 OR payment_row.refunded_minor<>0
  OR(invoice_row.status='paid') IS DISTINCT FROM(cash_total+invoice_row.credited_minor=invoice_row.total_minor)
  OR EXISTS(SELECT 1 FROM payments sibling_payment WHERE sibling_payment.invoice_id=invoice_row.id AND sibling_payment.id<>payment_row.id AND sibling_payment.status IN('created','processing')) THEN RETURN false;END IF;
 SELECT proof.* INTO proof_row FROM subscription_controlled_invoice_proofs proof JOIN subscription_controlled_operations original_read ON original_read.id=proof.operation_id
  WHERE proof.collection_id=collection_row.id ORDER BY original_read.ordinal DESC LIMIT 1;
 SELECT * INTO verification_row FROM subscription_controlled_verifications WHERE operation_id=proof_row.operation_id AND call_id=proof_row.call_id;
 bank=verification_row.actual_result->'inventory';
 IF proof_row.id IS NULL OR proof_row.canonical_target_digest IS DISTINCT FROM collection_row.canonical_target_digest
  OR proof_row.result_digest IS DISTINCT FROM verification_row.actual_result_digest OR verification_row.actual_result->>'exactManifest' IS DISTINCT FROM 'true'
  OR verification_row.actual_result->>'providerInvoiceRef' IS DISTINCT FROM binding_row.provider_invoice_ref
  OR bank->>'completePayments' IS DISTINCT FROM 'true' OR bank->>'completeLines' IS DISTINCT FROM 'true' OR bank->>'autoAdvance' IS DISTINCT FROM 'false'
  OR bank->>'providerInvoiceRef' IS DISTINCT FROM receipt_row.provider_invoice_ref OR bank->>'providerSubscriptionRef' IS DISTINCT FROM receipt_row.provider_subscription_ref
  OR bank->>'providerCustomerRef' IS DISTINCT FROM resource_row.original_scope->>'providerCustomerRef' OR bank->>'currency' IS DISTINCT FROM receipt_row.currency
  OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(bank->'actualCash')='array' THEN bank->'actualCash' ELSE '[]'::jsonb END) observed_cash
   WHERE observed_cash->>'providerPaymentIntentRef'=receipt_row.provider_payment_intent_ref AND observed_cash->>'providerInvoiceRef'=receipt_row.provider_invoice_ref
    AND observed_cash->>'providerChargeRef'=receipt_row.provider_charge_ref AND observed_cash->>'amountMinor'=receipt_row.amount_minor::text AND observed_cash->>'currency'=receipt_row.currency) THEN RETURN false;END IF;
 -- REQUIRED dependency, deliberately NOT a free allowed/session-marker branch:
 -- genuine latest finished original charge/refund/dispute inspection + exact
 -- pre-application parent/privacy/credit/fee and bounded actual batch revision,
 -- including callback races and same-TX canonical deltas, has NO frozen SQL
 -- producer yet. Structural membership/read_manifest alone cannot supply it.
 RETURN false;
END $$;
--> statement-breakpoint
CREATE FUNCTION freeholder_controlled_cash_application_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_payment_uuid uuid;target_invoice_uuid uuid;before_row jsonb;after_row jsonb;candidate record;
BEGIN
 after_row=to_jsonb(NEW);IF TG_OP='UPDATE' THEN before_row=to_jsonb(OLD);END IF;
 IF TG_TABLE_NAME='payments' THEN
  -- Existing refund counters/statuses do not create a new cash application.
  IF TG_OP='UPDATE' AND(before_row-ARRAY['refunded_minor','failure_code','failure_message'])=(after_row-ARRAY['refunded_minor','failure_code','failure_message']) THEN RETURN NEW;END IF;
  target_payment_uuid=(after_row->>'id')::uuid;target_invoice_uuid=(after_row->>'invoice_id')::uuid;
  IF TG_OP='UPDATE' AND before_row->>'invoice_id' IS DISTINCT FROM after_row->>'invoice_id'
   AND EXISTS(SELECT 1 FROM subscription_controlled_collections accepted_before WHERE accepted_before.invoice_id=(before_row->>'invoice_id')::uuid) THEN
   RAISE EXCEPTION 'An original controlled canonical payment cannot leave its accepted target' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='merchant_agreement_payment_routes' THEN
  target_payment_uuid=(after_row->>'payment_id')::uuid;SELECT p.invoice_id INTO target_invoice_uuid FROM payments p WHERE p.id=target_payment_uuid;
 ELSIF TG_TABLE_NAME='invoices' THEN
  target_invoice_uuid=(after_row->>'id')::uuid;
  IF TG_OP='UPDATE' AND before_row->>'paid_minor' IS NOT DISTINCT FROM after_row->>'paid_minor'
   AND before_row->>'paid_at' IS NOT DISTINCT FROM after_row->>'paid_at'
   AND(before_row->>'status' IS NOT DISTINCT FROM after_row->>'status' OR after_row->>'status'<>'paid') THEN RETURN NEW;END IF;
  -- Zero cash/credit-only invoice completion retains its separate existing
  -- canonical issued-credit guards; it cannot invent a receipt/payment here.
  IF (after_row->>'paid_minor')::bigint=0 THEN RETURN NEW;END IF;
 ELSE RAISE EXCEPTION 'Unknown controlled cash application boundary' USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM subscription_controlled_collections accepted_target WHERE accepted_target.invoice_id=target_invoice_uuid) THEN RETURN NEW;END IF;
 IF target_payment_uuid IS NOT NULL THEN
  IF freeholder_controlled_cash_application_shape(target_payment_uuid) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Controlled cash needs its genuine same-receipt current bank and parent application proof; marker, amount or manifest alone is insufficient' USING ERRCODE='23514';END IF;
 ELSE
  FOR candidate IN SELECT p.id FROM payments p WHERE p.invoice_id=target_invoice_uuid AND p.status='succeeded' LOOP
   IF freeholder_controlled_cash_application_shape(candidate.id) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Every actually paid controlled receipt needs its independent complete original application proof' USING ERRCODE='23514';END IF;
  END LOOP;
  IF NOT EXISTS(SELECT 1 FROM payments p WHERE p.invoice_id=target_invoice_uuid AND p.status='succeeded') THEN RAISE EXCEPTION 'A paid controlled cash balance cannot be invented without its real receipt-owned payment' USING ERRCODE='23514';END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER subscription_controlled_cash_payment_complete AFTER INSERT OR UPDATE ON payments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION freeholder_controlled_cash_application_guard();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER subscription_controlled_cash_route_complete AFTER INSERT OR UPDATE ON merchant_agreement_payment_routes DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION freeholder_controlled_cash_application_guard();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER subscription_controlled_cash_invoice_complete AFTER INSERT OR UPDATE ON invoices DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION freeholder_controlled_cash_application_guard();
