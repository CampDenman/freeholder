-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
-- C12.38: OWNED UNAPPLIED after complete core3/783 corrected definitions.
-- Replace the deliberately closed old424 shape ONLY with genuine immutable
-- receipt/payment/bank/parent/current-TX complete proof. Old boundary triggers
-- and every applicable structural predicate remain; no marker supplies grant.
CREATE OR REPLACE FUNCTION freeholder_controlled_cash_application_shape(target uuid) RETURNS boolean LANGUAGE plpgsql VOLATILE AS $$
DECLARE payment_row payments%ROWTYPE;invoice_row invoices%ROWTYPE;route_row merchant_agreement_payment_routes%ROWTYPE;
 receipt_row subscription_provider_charge_receipts%ROWTYPE;origin_row subscription_controlled_charge_origins%ROWTYPE;
 collection_row subscription_controlled_collections%ROWTYPE;quote_row subscription_controlled_quotes%ROWTYPE;
 resource_row subscription_controlled_resources%ROWTYPE;parent_row subscriptions%ROWTYPE;
 operation_row subscription_controlled_operations%ROWTYPE;call_row subscription_controlled_calls%ROWTYPE;fact_row subscription_controlled_facts%ROWTYPE;
 binding_row subscription_controlled_invoice_bindings%ROWTYPE;proof_row subscription_controlled_invoice_proofs%ROWTYPE;verification_row subscription_controlled_verifications%ROWTYPE;
 cash_rows numeric;cash_total numeric;bank jsonb;
 link_row controlled_cash_application_links%ROWTYPE;receipt_proof controlled_cash_application_receipts%ROWTYPE;batch_row controlled_cash_application_batches%ROWTYPE;current_batch controlled_cash_application_batches%ROWTYPE;terms_row subscription_commercial_terms%ROWTYPE;stage jsonb;current_batch_count integer;
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
 SELECT * INTO terms_row FROM subscription_commercial_terms WHERE id=collection_row.terms_id;
 IF payment_row.id IS NULL OR invoice_row.id IS NULL OR collection_row.id IS NULL OR quote_row.id IS NULL OR resource_row.id IS NULL OR parent_row.id IS NULL
  OR NOT coalesce(freeholder_controlled_collection_valid(collection_row.id),false) OR collection_row.invoice_id IS DISTINCT FROM invoice_row.id
  OR invoice_row.source_type IS DISTINCT FROM 'subscription' OR invoice_row.source_id IS DISTINCT FROM quote_row.canonical_source_id
  OR invoice_row.contact_id IS DISTINCT FROM parent_row.contact_id OR invoice_row.currency IS DISTINCT FROM parent_row.currency
  OR quote_row.redacted_at IS NOT NULL OR collection_row.accepted_quote_digest IS DISTINCT FROM quote_row.quote_digest
  OR terms_row.id IS NULL OR terms_row.subscription_id IS DISTINCT FROM parent_row.id
  OR(collection_row.kind='proration' AND collection_row.original_consent_digest IS DISTINCT FROM quote_row.quote_digest
   OR collection_row.kind='period' AND collection_row.original_consent_digest IS DISTINCT FROM terms_row.accepted_quote_digest) OR quote_row.resource_id IS DISTINCT FROM resource_row.id
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
 -- Structural/manifest membership remains necessary, but cannot authorize
 -- application. Bind the ACTUAL generated payment to its immutable real receipt
 -- proof, then prove the ENTIRE current transaction's normalized original graph.
 SELECT * INTO link_row FROM controlled_cash_application_links WHERE payment_id=payment_row.id;
 SELECT * INTO receipt_proof FROM controlled_cash_application_receipts WHERE id=link_row.receipt_proof_id;
 SELECT * INTO batch_row FROM controlled_cash_application_batches WHERE id=link_row.batch_id;
 IF link_row.receipt_id IS NULL OR receipt_proof.id IS NULL OR batch_row.id IS NULL
  OR link_row.receipt_id IS DISTINCT FROM receipt_row.id OR receipt_proof.receipt_id IS DISTINCT FROM receipt_row.id OR receipt_proof.batch_id IS DISTINCT FROM batch_row.id
  OR batch_row.collection_id IS DISTINCT FROM collection_row.id OR batch_row.quote_id IS DISTINCT FROM quote_row.id OR batch_row.resource_id IS DISTINCT FROM resource_row.id
  OR batch_row.invoice_id IS DISTINCT FROM invoice_row.id OR batch_row.subscription_id IS DISTINCT FROM parent_row.id OR batch_row.terms_id IS DISTINCT FROM collection_row.terms_id
  OR payment_row.idempotency_key IS DISTINCT FROM receipt_proof.payment_idempotency_key OR payment_row.request_hash IS DISTINCT FROM receipt_proof.payment_request_hash
  OR payment_row.processed_at IS DISTINCT FROM receipt_proof.processed_at OR payment_row.amount_minor IS DISTINCT FROM receipt_proof.amount_minor
  OR route_row.application_fee_minor IS DISTINCT FROM receipt_proof.fee_minor THEN RETURN false;END IF;
 -- An earlier committed partial receipt may remain in this invoice. It never
 -- reuses its old transaction grant: the NEW current batch must authenticate
 -- its full unchanged before-row and all real bank/parent debt independently.
 SELECT count(*) INTO current_batch_count FROM controlled_cash_application_batches admitted WHERE admitted.invoice_id=invoice_row.id AND admitted.admission_transaction_id=txid_current()::text;
 IF current_batch_count<>1 THEN RETURN false;END IF;
 SELECT * INTO current_batch FROM controlled_cash_application_batches admitted WHERE admitted.invoice_id=invoice_row.id AND admitted.admission_transaction_id=txid_current()::text;
 IF current_batch.collection_id IS DISTINCT FROM collection_row.id THEN RETURN false;END IF;
 IF batch_row.id<>current_batch.id AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(current_batch.before_entries) original_entry
  WHERE original_entry->>'table'='payments' AND original_entry->>'id'=payment_row.id::text
   AND original_entry->>'fingerprint'=encode(sha256(convert_to(to_jsonb(payment_row)::text,'UTF8')),'hex')) THEN RETURN false;END IF;
 stage=freeholder_controlled_cash_stage(current_batch.id,null,null);
 RETURN stage->>'complete'='true' AND stage->>'batchId'=current_batch.id::text
  AND stage->>'normalizedParentRevision'=current_batch.parent_pg_revision;
END $$;
