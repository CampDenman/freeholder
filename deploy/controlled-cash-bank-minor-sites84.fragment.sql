-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
-- C12.38/C9.33: one-pass amount site replacement; each repeated page amount validates once.
CREATE OR REPLACE FUNCTION freeholder_controlled_cash_bank_invoice(target_collection_uuid uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
DECLARE actual_collection subscription_controlled_collections%ROWTYPE; actual_quote subscription_controlled_quotes%ROWTYPE; actual_resource subscription_controlled_resources%ROWTYPE;
 actual_binding subscription_controlled_invoice_bindings%ROWTYPE; actual_proof subscription_controlled_invoice_proofs%ROWTYPE; actual_operation subscription_controlled_operations%ROWTYPE; actual_verification subscription_controlled_verifications%ROWTYPE;
 actual_inventory jsonb; actual_manifest jsonb; actual_invoice jsonb; intent_atom jsonb; intent_ref text; seen_intents text[]=ARRAY[]::text[]; received_minor bigint; total_received numeric=0;
 payment_atom jsonb; payment_ref text; seen_payments text[]=ARRAY[]::text[]; payment_minor bigint; payment_sum numeric; cash_atom jsonb; cash_count integer=0; seen_cash text[]=ARRAY[]::text[];
 actual_receipt subscription_provider_charge_receipts%ROWTYPE; positive_receipts uuid[]=ARRAY[]::uuid[]; total_minor bigint; paid_minor bigint; remaining_minor bigint;
BEGIN
 SELECT * INTO actual_collection FROM subscription_controlled_collections WHERE id=target_collection_uuid;
 SELECT * INTO actual_quote FROM subscription_controlled_quotes WHERE id=actual_collection.quote_id;
 SELECT * INTO actual_resource FROM subscription_controlled_resources WHERE id=actual_quote.resource_id;
 SELECT * INTO actual_binding FROM subscription_controlled_invoice_bindings WHERE collection_id=actual_collection.id;
 SELECT proof_row.* INTO actual_proof FROM subscription_controlled_invoice_proofs proof_row JOIN subscription_controlled_operations operation_row ON operation_row.id=proof_row.operation_id
  WHERE proof_row.collection_id=actual_collection.id ORDER BY operation_row.ordinal DESC LIMIT 1;
 SELECT * INTO actual_operation FROM subscription_controlled_operations WHERE id=actual_proof.operation_id;
 SELECT * INTO actual_verification FROM subscription_controlled_verifications WHERE operation_id=actual_proof.operation_id AND call_id=actual_proof.call_id;
 IF actual_collection.id IS NULL OR actual_quote.id IS NULL OR actual_resource.id IS NULL OR actual_binding.collection_id IS NULL OR actual_proof.id IS NULL
  OR actual_operation.id IS NULL OR actual_verification.operation_id IS NULL OR actual_operation.kind IS DISTINCT FROM 'read_manifest' OR actual_operation.resource_id IS DISTINCT FROM actual_resource.id
  OR actual_binding.resource_id IS DISTINCT FROM actual_resource.id OR actual_proof.canonical_target_digest IS DISTINCT FROM actual_collection.canonical_target_digest
  OR actual_verification.actual_result_digest IS DISTINCT FROM actual_proof.result_digest
  OR actual_verification.actual_result->>'providerInvoiceRef' IS DISTINCT FROM actual_binding.provider_invoice_ref
  OR actual_verification.actual_result->'exactManifest' IS DISTINCT FROM 'true'::jsonb OR actual_verification.actual_result->'suppliesPaidAuthority' IS DISTINCT FROM 'false'::jsonb
  OR actual_verification.actual_result->>'customerFinancialDigest' IS DISTINCT FROM actual_proof.customer_financial_digest
  OR NOT EXISTS(SELECT 1 FROM subscription_controlled_calls actual_call JOIN subscription_controlled_finishes actual_finish ON actual_finish.call_id=actual_call.id
   WHERE actual_call.id=actual_proof.call_id AND actual_call.operation_id=actual_operation.id AND actual_finish.actual_result->>'outcome'='returned'
    AND NOT EXISTS(SELECT 1 FROM subscription_controlled_stops actual_stop WHERE actual_stop.call_id=actual_call.id)) THEN
  RAISE EXCEPTION 'Restore the actual latest complete returned manifest/customer inventory; a planned or stopped caller is not bank evidence' USING ERRCODE='23514';END IF;
 actual_manifest=actual_operation.original_request->'payload'->'manifest';actual_inventory=actual_verification.actual_result->'inventory';actual_invoice=actual_inventory->'actualInvoice';
 IF jsonb_typeof(actual_manifest) IS DISTINCT FROM 'object' OR jsonb_typeof(actual_inventory) IS DISTINCT FROM 'object'
  OR actual_manifest->>'collectionId' IS DISTINCT FROM actual_collection.id::text OR actual_manifest->>'quoteId' IS DISTINCT FROM actual_quote.id::text
  OR actual_manifest->>'canonicalInvoiceId' IS DISTINCT FROM actual_collection.invoice_id::text OR actual_manifest->>'termsId' IS DISTINCT FROM actual_collection.terms_id::text
  OR actual_manifest->>'acceptedQuoteDigest' IS DISTINCT FROM actual_collection.accepted_quote_digest OR actual_manifest->>'canonicalTargetDigest' IS DISTINCT FROM actual_collection.canonical_target_digest
  OR actual_inventory->>'providerInvoiceRef' IS DISTINCT FROM actual_binding.provider_invoice_ref OR actual_inventory->>'providerCustomerRef' IS DISTINCT FROM actual_resource.original_scope->>'providerCustomerRef'
  OR actual_inventory->>'providerSubscriptionRef' IS DISTINCT FROM actual_operation.original_request->'payload'->>'providerSubscriptionRef'
  OR actual_inventory->>'currency' IS DISTINCT FROM actual_resource.original_scope->>'currency'
  OR actual_inventory->'completePayments' IS DISTINCT FROM 'true'::jsonb OR actual_inventory->'completeLines' IS DISTINCT FROM 'true'::jsonb
  OR actual_inventory->'suppliesPaidAuthority' IS DISTINCT FROM 'false'::jsonb OR actual_inventory->'financiallyQuiesced' IS DISTINCT FROM 'false'::jsonb
  OR actual_inventory->>'status' IS NULL OR actual_inventory->>'status' NOT IN('open','paid') OR actual_inventory->'autoAdvance' IS DISTINCT FROM 'false'::jsonb
  OR jsonb_typeof(actual_invoice) IS DISTINCT FROM 'object' OR actual_invoice->'auto_advance' IS DISTINCT FROM 'false'::jsonb
  OR actual_invoice->>'id' IS DISTINCT FROM actual_binding.provider_invoice_ref OR freeholder_controlled_cash_ref(actual_invoice->'customer') IS DISTINCT FROM actual_resource.original_scope->>'providerCustomerRef'
  OR coalesce(freeholder_controlled_cash_ref(actual_invoice->'subscription'),freeholder_controlled_cash_ref(actual_invoice->'parent'->'subscription_details'->'subscription')) IS DISTINCT FROM actual_inventory->>'providerSubscriptionRef'
  OR actual_invoice->'starting_balance' IS DISTINCT FROM '0'::jsonb OR actual_invoice->'ending_balance' IS DISTINCT FROM '0'::jsonb
  OR actual_invoice->'pre_payment_credit_notes_amount' IS DISTINCT FROM '0'::jsonb OR actual_invoice->'post_payment_credit_notes_amount' IS DISTINCT FROM '0'::jsonb
  OR jsonb_typeof(actual_inventory->'actualIntents') IS DISTINCT FROM 'array' OR jsonb_typeof(actual_inventory->'actualPayments') IS DISTINCT FROM 'array' OR jsonb_typeof(actual_inventory->'actualCash') IS DISTINCT FROM 'array'
  OR jsonb_array_length(actual_inventory->'actualIntents')+jsonb_array_length(actual_inventory->'actualPayments')+jsonb_array_length(actual_inventory->'actualCash')>5000
  OR EXISTS(SELECT 1 FROM subscription_controlled_operations later_operation JOIN subscription_controlled_calls later_call ON later_call.operation_id=later_operation.id
   WHERE later_operation.resource_id=actual_resource.id AND later_operation.ordinal>actual_operation.ordinal
    AND later_operation.kind NOT IN('read_product','discover_bootstrap','read_bootstrap','read_calendar','preview_proration','preview_update','read_manifest','read_invoice','read_customer_financials','list_invoices')) THEN
  RAISE EXCEPTION 'Keep actual partial/contradictory/unknown bank data for review; no invented complete inventory or canonical target is admitted' USING ERRCODE='23514';END IF;
 total_minor=(CASE WHEN freeholder_controlled_bank_minor(actual_inventory->'totalMinor',false) THEN (actual_inventory->'totalMinor' #>> '{}')::bigint ELSE NULL END);paid_minor=(CASE WHEN freeholder_controlled_bank_minor(actual_inventory->'paidMinor',false) THEN (actual_inventory->'paidMinor' #>> '{}')::bigint ELSE NULL END);remaining_minor=(CASE WHEN freeholder_controlled_bank_minor(actual_inventory->'remainingMinor',false) THEN (actual_inventory->'remainingMinor' #>> '{}')::bigint ELSE NULL END);
 IF total_minor IS NULL OR paid_minor IS NULL OR remaining_minor IS NULL OR total_minor IS DISTINCT FROM (CASE WHEN freeholder_controlled_bank_minor(actual_manifest->'cashDueMinor',false) THEN (actual_manifest->'cashDueMinor' #>> '{}')::bigint ELSE NULL END)
  OR paid_minor::numeric+remaining_minor::numeric IS DISTINCT FROM total_minor::numeric OR actual_inventory->>'status'='paid' AND remaining_minor<>0 OR actual_inventory->>'status'='open' AND remaining_minor=0
  OR actual_invoice->'amount_paid' IS DISTINCT FROM to_jsonb(paid_minor) OR actual_invoice->'amount_remaining' IS DISTINCT FROM to_jsonb(remaining_minor) THEN
  RAISE EXCEPTION 'Actual paid and remaining consideration must conserve the frozen gross-minus-locked-credit bank total without clipping' USING ERRCODE='23514';END IF;
 FOR intent_atom IN SELECT value FROM jsonb_array_elements(actual_inventory->'actualIntents') LOOP
  intent_ref=freeholder_controlled_cash_ref(intent_atom->'id');received_minor=(CASE WHEN freeholder_controlled_bank_minor(intent_atom->'amount_received',false) THEN (intent_atom->'amount_received' #>> '{}')::bigint ELSE NULL END);
  IF intent_ref IS NULL OR intent_ref !~ '^pi_[A-Za-z0-9_]+$' OR intent_ref=ANY(seen_intents) OR received_minor IS NULL THEN RAISE EXCEPTION 'Complete actual PI identity and precise received cash are required for each bank atom' USING ERRCODE='23514';END IF;
  seen_intents=array_append(seen_intents,intent_ref);
  IF received_minor=0 THEN
   IF intent_atom->>'status' IS DISTINCT FROM 'canceled' AND NOT(intent_atom->>'status'='succeeded' AND intent_atom->'amount'='0'::jsonb) THEN RAISE EXCEPTION 'An unsettled zero-received intent remains a genuine caller/collection liability' USING ERRCODE='23514';END IF;
   CONTINUE;
  END IF;
  IF intent_atom->>'status' IS DISTINCT FROM 'succeeded' THEN RAISE EXCEPTION 'Positive received cash remains retained review unless actual intent completion is proved' USING ERRCODE='23514';END IF;
  SELECT receipt_row.* INTO actual_receipt FROM subscription_provider_charge_receipts receipt_row
   JOIN subscription_controlled_charge_origins original_origin ON original_origin.receipt_id=receipt_row.id AND original_origin.resource_id=actual_resource.id
   WHERE receipt_row.subscription_id=actual_resource.subscription_id AND receipt_row.provider_platform_account_id=actual_resource.original_scope->>'providerPlatformAccountId'
    AND receipt_row.charge_account_id IS NOT DISTINCT FROM actual_resource.original_scope->>'providerAccountId'
    AND receipt_row.provider_invoice_ref=actual_binding.provider_invoice_ref AND receipt_row.provider_payment_intent_ref=intent_ref;
  IF actual_receipt.id IS NULL OR actual_receipt.provider_api_version IS DISTINCT FROM actual_resource.original_scope->>'providerApiVersion'
   OR actual_receipt.amount_minor IS DISTINCT FROM received_minor OR actual_receipt.currency IS DISTINCT FROM upper(intent_atom->>'currency')
   OR actual_receipt.currency IS DISTINCT FROM actual_inventory->>'currency' OR freeholder_controlled_cash_ref(intent_atom->'customer') IS DISTINCT FROM actual_resource.original_scope->>'providerCustomerRef'
   OR actual_receipt.provider_charge_ref IS NOT NULL AND freeholder_controlled_cash_ref(intent_atom->'latest_charge') IS DISTINCT FROM actual_receipt.provider_charge_ref THEN
   RAISE EXCEPTION 'Retain every actual unmatched/foreign/contradictory captured PI; value equality cannot supply its canonical receipt' USING ERRCODE='23514';END IF;
  payment_sum=0;
  FOR payment_atom IN SELECT value FROM jsonb_array_elements(actual_inventory->'actualPayments') WHERE freeholder_controlled_cash_ref(value->'payment'->'payment_intent')=intent_ref LOOP
   IF freeholder_controlled_cash_ref(payment_atom->'invoice') IS DISTINCT FROM actual_binding.provider_invoice_ref OR payment_atom->'payment'->>'type' IS DISTINCT FROM 'payment_intent'
    OR upper(payment_atom->>'currency') IS DISTINCT FROM actual_receipt.currency OR payment_atom->>'status' IS DISTINCT FROM 'paid' THEN
    RAISE EXCEPTION 'Actual invoice-payment identities and status must bind the same exact bank PI and invoice' USING ERRCODE='23514';END IF;
   payment_minor=(CASE WHEN freeholder_controlled_bank_minor(payment_atom->'amount_paid',false) THEN (payment_atom->'amount_paid' #>> '{}')::bigint ELSE NULL END);IF payment_minor IS NULL THEN RAISE EXCEPTION 'Retain imprecise invoice-payment amounts as review' USING ERRCODE='23514';END IF;
   payment_sum=payment_sum+payment_minor;
  END LOOP;
  IF payment_sum IS DISTINCT FROM received_minor::numeric THEN RAISE EXCEPTION 'Complete actual invoice-payment atoms must account for the exact original captured PI, never aggregate amount adoption' USING ERRCODE='23514';END IF;
  positive_receipts=array_append(positive_receipts,actual_receipt.id);total_received=total_received+received_minor;
 END LOOP;
 FOR payment_atom IN SELECT value FROM jsonb_array_elements(actual_inventory->'actualPayments') LOOP
  payment_ref=freeholder_controlled_cash_ref(payment_atom->'id');payment_minor=(CASE WHEN freeholder_controlled_bank_minor(payment_atom->'amount_paid',false) THEN (payment_atom->'amount_paid' #>> '{}')::bigint ELSE NULL END);intent_ref=freeholder_controlled_cash_ref(payment_atom->'payment'->'payment_intent');
  IF payment_ref IS NULL OR payment_ref=ANY(seen_payments) OR payment_minor IS NULL OR intent_ref IS NULL OR NOT(intent_ref=ANY(seen_intents))
   OR freeholder_controlled_cash_ref(payment_atom->'invoice') IS DISTINCT FROM actual_binding.provider_invoice_ref OR payment_atom->'payment'->>'type' IS DISTINCT FROM 'payment_intent'
   OR upper(payment_atom->>'currency') IS DISTINCT FROM actual_inventory->>'currency'
   OR payment_minor>0 AND NOT EXISTS(SELECT 1 FROM subscription_provider_charge_receipts original_receipt WHERE original_receipt.id=ANY(positive_receipts) AND original_receipt.provider_payment_intent_ref=intent_ref) THEN
   RAISE EXCEPTION 'Every complete invoice-payment atom must retain a unique real identity and exact original PI owner' USING ERRCODE='23514';END IF;
  seen_payments=array_append(seen_payments,payment_ref);
 END LOOP;
 FOR cash_atom IN SELECT value FROM jsonb_array_elements(actual_inventory->'actualCash') LOOP
  intent_ref=cash_atom->>'providerPaymentIntentRef';SELECT * INTO actual_receipt FROM subscription_provider_charge_receipts original_receipt WHERE original_receipt.id=ANY(positive_receipts) AND original_receipt.provider_payment_intent_ref=intent_ref;
  IF actual_receipt.id IS NULL OR intent_ref=ANY(seen_cash) OR cash_atom->>'subscriptionId' IS DISTINCT FROM actual_receipt.subscription_id::text
   OR cash_atom->>'providerInvoiceRef' IS DISTINCT FROM actual_receipt.provider_invoice_ref OR cash_atom->>'providerSubscriptionRef' IS DISTINCT FROM actual_receipt.provider_subscription_ref
   OR cash_atom->>'providerCustomerRef' IS DISTINCT FROM actual_resource.original_scope->>'providerCustomerRef' OR cash_atom->>'providerPlatformAccountId' IS DISTINCT FROM actual_receipt.provider_platform_account_id
   OR cash_atom->>'providerAccountId' IS DISTINCT FROM actual_receipt.charge_account_id OR cash_atom->>'providerChargeRef' IS DISTINCT FROM actual_receipt.provider_charge_ref
   OR cash_atom->'amountMinor' IS DISTINCT FROM to_jsonb(actual_receipt.amount_minor) OR cash_atom->>'currency' IS DISTINCT FROM actual_receipt.currency
   OR cash_atom->'customerChargeVerified' IS DISTINCT FROM 'true'::jsonb OR cash_atom->'merchantRouteVerified' IS DISTINCT FROM 'true'::jsonb THEN
   RAISE EXCEPTION 'Every actual retained bank-cash atom must bind its exact original receipt/customer/route and verified current charge' USING ERRCODE='23514';END IF;
  seen_cash=array_append(seen_cash,intent_ref);cash_count=cash_count+1;
 END LOOP;
 IF total_received IS DISTINCT FROM paid_minor::numeric OR cash_count<>cardinality(positive_receipts) OR cardinality(positive_receipts)>5000 OR EXISTS(SELECT 1 FROM subscription_provider_charge_receipts receipt_row
  JOIN subscription_controlled_charge_origins original_origin ON original_origin.receipt_id=receipt_row.id AND original_origin.resource_id=actual_resource.id
  WHERE receipt_row.subscription_id=actual_resource.subscription_id AND receipt_row.provider_platform_account_id=actual_resource.original_scope->>'providerPlatformAccountId'
   AND receipt_row.charge_account_id IS NOT DISTINCT FROM actual_resource.original_scope->>'providerAccountId' AND receipt_row.provider_invoice_ref=actual_binding.provider_invoice_ref AND NOT(receipt_row.id=ANY(positive_receipts))) THEN
  RAISE EXCEPTION 'The actual complete bank inventory must account for every real positive receipt occurrence, including late cash; no sum-only adoption' USING ERRCODE='23514';END IF;
 SELECT coalesce(array_agg(value ORDER BY value),ARRAY[]::uuid[]) INTO positive_receipts FROM unnest(positive_receipts) value;
 RETURN jsonb_build_object('providerInvoiceRef',actual_binding.provider_invoice_ref,'providerSubscriptionRef',actual_inventory->>'providerSubscriptionRef','providerCustomerRef',actual_inventory->>'providerCustomerRef','currency',actual_inventory->>'currency','status',actual_inventory->>'status',
  'totalMinor',total_minor,'paidMinor',paid_minor,'remainingMinor',remaining_minor,'positiveReceiptIds',to_jsonb(positive_receipts),'manifestOperationId',actual_operation.id,'manifestCallId',actual_proof.call_id,
  'manifestResultDigest',actual_proof.result_digest,'manifestDigest',actual_verification.actual_result->>'manifestDigest',
  'zeroWalletProofDigest',encode(sha256(convert_to(format('{"customerFinancialDigest":"%s","endingBalance":0,"postPaymentCreditNotes":0,"prePaymentCreditNotes":0,"startingBalance":0}',actual_proof.customer_financial_digest),'UTF8')),'hex'));
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION freeholder_controlled_subscription_route_ready() RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT coalesce(
  EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('freeholder_controlled_subscription_route_valid(jsonb)') AND p.provolatile='v' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='c43cf639e0f7ff4840a87aa219cd597b4463b4eb4e4be2d33b399e8022647d1a')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('guard_merchant_agreement_payment_route()') AND p.provolatile='v' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='1499929d2e393ff2eadd4c43f1a601044be62ea60ac72a41713e9dcff420829a')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('guard_subscription_controlled_agreement_route()') AND p.provolatile='v' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='5315979c10ffba43177521dccf94ab401442f724f9bb372eb24802327d391c6f')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('freeholder_controlled_cash_guard_batch()') AND p.provolatile='v' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='d4eec6cffbc37e319f492d16e1c1914bc1fae9cc2ead53d66f184805d73cd524')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('freeholder_controlled_cash_guard_receipt()') AND p.provolatile='v' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='69cc878883175b6353bfa7a7caafedb3198627b3d7061ec626e49badf466d959')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('freeholder_controlled_cash_receipts_complete(uuid)') AND p.provolatile='v' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='a92e7fdbbff4386fd0944ebcae90a7f25dff9d27f47fcf6ec4ae777eb0eb5af0')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('freeholder_controlled_cash_before_settlement(uuid)') AND p.provolatile='v' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='49bcc680eb768f599b569ca8238e7223403bada4bb90881028f034d166966b9f')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('freeholder_controlled_cash_stage(uuid,uuid,uuid)') AND p.provolatile='v' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='a40dd083ee120f238c2c58b19890e4f2f20110c6cc3af12eaa90f203413af7d6')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('freeholder_controlled_cash_application_shape(uuid)') AND p.provolatile='v' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='3f878d26d2ead57e5d1ae5b159404eee172c947aee20bb78d4e27fbf7e7a32fa')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('freeholder_controlled_cash_atomic_fee_valid(uuid,bigint,numeric,numeric)') AND p.provolatile='v' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='8b6c12df24f5758a11af8b3dce53a045b86f488c13409e49f88c41084548dce0')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('freeholder_guard_agreement_fee()') AND p.provolatile='v' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='d91fd819a23c05940a0392b407d8bae1a107afb980264fbb67cbc2ce47628d57')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('freeholder_controlled_cash_bank_invoice(uuid)') AND p.provolatile='v' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='ea997a78b7a85655575edcc669ecbb41c4a6caee608f357696d164657e9dc48f')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('freeholder_controlled_bank_minor(jsonb,boolean)') AND p.provolatile='i' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='05d891ce5a52f018a9c5b6f21d9c3ae43f68d7abd7e831fb2cf512cff476a68e')
  AND EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid='merchant_agreement_payment_routes'::regclass AND t.tgname='merchant_agreement_payment_route_guard' AND t.tgfoid=to_regprocedure('guard_merchant_agreement_payment_route()') AND t.tgenabled IN('O','A') AND t.tgtype=31 AND NOT t.tgisinternal)
  AND EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid='merchant_agreement_payment_routes'::regclass AND t.tgname='subscription_controlled_agreement_route_guard' AND t.tgfoid=to_regprocedure('guard_subscription_controlled_agreement_route()') AND t.tgenabled IN('O','A') AND t.tgtype=23 AND NOT t.tgisinternal),false);
$$;
