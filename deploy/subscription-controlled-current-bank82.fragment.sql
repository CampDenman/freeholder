-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
-- C12.38/C1.08: OWNED UNAPPLIED genuine bank-observation predicates.
-- After actual controlled collection/retention and original inspection-stop tails.
-- No application permission, activation, current assembly or existing function replacement.
CREATE FUNCTION freeholder_controlled_bank_minor(value jsonb,positive boolean DEFAULT false) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE WHEN jsonb_typeof(value)='number' AND value::text ~ '^(0|[1-9][0-9]{0,15})$'
  THEN (value::text)::numeric BETWEEN CASE WHEN positive THEN 1 ELSE 0 END AND 9007199254740991 ELSE false END
$$;
--> statement-breakpoint
-- Pure policy over separately authenticated ORIGINAL capture and ACTUAL
-- finished current bank state. This cannot authenticate either on its own.
CREATE FUNCTION freeholder_controlled_bank_unreturned(expected jsonb,observed jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE refund_item jsonb;dispute_item jsonb;fee jsonb;transfer jsonb;recipient text;refund_ids text[]:=ARRAY[]::text[];dispute_ids text[]:=ARRAY[]::text[];
BEGIN
 IF jsonb_typeof(expected) IS DISTINCT FROM 'object' OR jsonb_typeof(observed) IS DISTINCT FROM 'object'
  OR expected->'customerChargeVerified' IS DISTINCT FROM 'true'::jsonb OR expected->'merchantRouteVerified' IS DISTINCT FROM 'true'::jsonb
  OR expected->>'providerApiVersion' IS DISTINCT FROM '2026-10-28.endive'
  OR NOT freeholder_controlled_bank_minor(expected->'amountMinor',true) OR NOT freeholder_controlled_bank_minor(expected->'feeMinor')
  OR coalesce(expected->>'providerPlatformAccountId','')!~'^acct_[A-Za-z0-9]+$' OR coalesce(expected->>'providerRef','')!~'^pi_[A-Za-z0-9_]+$'
  OR coalesce(expected->>'chargeRef','')!~'^ch_[A-Za-z0-9_]+$' OR coalesce(expected->>'currency','')!~'^[A-Z]{3}$'
  OR observed->>'providerPlatformAccountId' IS DISTINCT FROM expected->>'providerPlatformAccountId'
  OR observed->>'chargeAccountId' IS DISTINCT FROM expected->>'providerAccountId' OR observed->>'providerApiVersion' IS DISTINCT FROM expected->>'providerApiVersion'
  OR observed->>'paymentProviderRef' IS DISTINCT FROM expected->>'providerRef' OR observed->>'providerChargeRef' IS DISTINCT FROM expected->>'chargeRef'
  OR observed->>'chargePaymentProviderRef' IS DISTINCT FROM expected->>'providerRef' OR observed->>'amountMinor' IS DISTINCT FROM expected->>'amountMinor'
  OR observed->>'chargeAmountMinor' IS DISTINCT FROM expected->>'amountMinor' OR observed->>'currency' IS DISTINCT FROM expected->>'currency'
  OR observed->>'chargeCurrency' IS DISTINCT FROM expected->>'currency' OR observed->>'paymentIntentStatus' IS DISTINCT FROM 'succeeded'
  OR NOT freeholder_controlled_bank_minor(observed->'amountMinor',true) OR NOT freeholder_controlled_bank_minor(observed->'chargeAmountMinor',true)
  OR NOT freeholder_controlled_bank_minor(observed->'amountCapturableMinor') OR NOT freeholder_controlled_bank_minor(observed->'amountRefundedMinor')
  OR observed->>'amountCapturableMinor' IS DISTINCT FROM '0' OR observed->'paid' IS DISTINCT FROM 'true'::jsonb OR observed->'captured' IS DISTINCT FROM 'true'::jsonb
  OR observed->'refunded' IS DISTINCT FROM 'false'::jsonb OR observed->>'amountRefundedMinor' IS DISTINCT FROM '0'
  OR observed->'refundsComplete' IS DISTINCT FROM 'true'::jsonb OR observed->'disputesComplete' IS DISTINCT FROM 'true'::jsonb
  OR observed->'feeFieldObserved' IS DISTINCT FROM 'true'::jsonb OR observed->'transferFieldObserved' IS DISTINCT FROM 'true'::jsonb
  OR jsonb_typeof(observed->'refunds') IS DISTINCT FROM 'array' OR jsonb_typeof(observed->'disputes') IS DISTINCT FROM 'array' THEN RETURN false;END IF;
 IF (expected->>'feeMinor')::numeric>(expected->>'amountMinor')::numeric OR jsonb_array_length(observed->'refunds')>1000 OR jsonb_array_length(observed->'disputes')>1000 THEN RETURN false;END IF;
 FOR refund_item IN SELECT value FROM jsonb_array_elements(observed->'refunds') LOOP
  IF jsonb_typeof(refund_item) IS DISTINCT FROM 'object' OR coalesce(refund_item->>'providerRef','')!~'^(re|pyr)_[A-Za-z0-9_]+$'
   OR refund_item->>'providerRef'=ANY(refund_ids) OR refund_item->>'paymentProviderRef' IS DISTINCT FROM expected->>'providerRef'
   OR refund_item->>'chargeRef' IS DISTINCT FROM expected->>'chargeRef' OR NOT freeholder_controlled_bank_minor(refund_item->'amountMinor',true)
   OR refund_item->>'currency' IS DISTINCT FROM expected->>'currency' OR coalesce(refund_item->>'status','') NOT IN('failed','canceled') THEN RETURN false;END IF;
  refund_ids=array_append(refund_ids,refund_item->>'providerRef');
 END LOOP;
 FOR dispute_item IN SELECT value FROM jsonb_array_elements(observed->'disputes') LOOP
  IF jsonb_typeof(dispute_item) IS DISTINCT FROM 'object' OR coalesce(dispute_item->>'providerRef','')!~'^du_[A-Za-z0-9_]+$'
   OR dispute_item->>'providerRef'=ANY(dispute_ids) OR dispute_item->>'chargeRef' IS DISTINCT FROM expected->>'chargeRef'
   OR coalesce(dispute_item->>'status','') NOT IN('won','warning_closed') THEN RETURN false;END IF;
  dispute_ids=array_append(dispute_ids,dispute_item->>'providerRef');
 END LOOP;
 recipient=coalesce(expected->>'destinationAccountId',expected->>'providerAccountId');fee=observed->'fee';transfer=observed->'transfer';
 IF coalesce(recipient,'')!~'^acct_[A-Za-z0-9]+$' THEN RETURN false;END IF;
 IF expected->>'feeMinor'='0' THEN
  IF fee IS DISTINCT FROM 'null'::jsonb OR expected->>'originalFeeRef' IS NOT NULL THEN RETURN false;END IF;
 ELSE
  IF jsonb_typeof(fee) IS DISTINCT FROM 'object' OR coalesce(fee->>'providerRef','')!~'^fee_[A-Za-z0-9_]+$'
   OR(expected->>'originalFeeRef' IS NOT NULL AND fee->>'providerRef' IS DISTINCT FROM expected->>'originalFeeRef')
   OR fee->>'originatingChargeRef' IS DISTINCT FROM expected->>'chargeRef' OR fee->>'accountId' IS DISTINCT FROM recipient
   OR NOT freeholder_controlled_bank_minor(fee->'amountMinor',true) OR NOT freeholder_controlled_bank_minor(fee->'refundedMinor')
   OR fee->>'amountMinor' IS DISTINCT FROM expected->>'feeMinor' OR fee->>'refundedMinor' IS DISTINCT FROM '0' OR fee->>'currency' IS DISTINCT FROM expected->>'currency' THEN RETURN false;END IF;
 END IF;
 IF expected->>'destinationAccountId' IS NOT NULL THEN
  IF expected->>'providerAccountId' IS NOT NULL OR expected->>'settlementMerchantAccountId' IS DISTINCT FROM expected->>'destinationAccountId'
   OR jsonb_typeof(transfer) IS DISTINCT FROM 'object' OR coalesce(transfer->>'providerRef','')!~'^tr_[A-Za-z0-9_]+$'
   OR transfer->>'sourceChargeRef' IS DISTINCT FROM expected->>'chargeRef' OR transfer->>'destinationAccountId' IS DISTINCT FROM expected->>'destinationAccountId'
   OR NOT freeholder_controlled_bank_minor(transfer->'amountMinor',true) OR NOT freeholder_controlled_bank_minor(transfer->'reversedMinor')
   OR transfer->>'amountMinor' IS DISTINCT FROM expected->>'amountMinor' OR transfer->>'reversedMinor' IS DISTINCT FROM '0'
   OR transfer->'reversed' IS DISTINCT FROM 'false'::jsonb OR transfer->>'currency' IS DISTINCT FROM expected->>'currency' THEN RETURN false;END IF;
 ELSE
  IF expected->>'settlementMerchantAccountId' IS NOT NULL OR transfer IS DISTINCT FROM 'null'::jsonb THEN RETURN false;END IF;
 END IF;
 RETURN true;
END $$;
--> statement-breakpoint
-- Internal observation witness only. Full CURRENT physical rows are hashed;
-- no own reader, callback, capture or canonical delta is removed. Historical
-- JS source_history_digest is retained, never compared to an unrelated PG hash.
CREATE FUNCTION freeholder_controlled_receipt_bank_observation(target_collection_uuid uuid,target_receipt_uuid uuid)
RETURNS TABLE(actual_inspection_id uuid,actual_observation_id uuid,current_evidence jsonb,original_expectation jsonb,bank_witness jsonb,bank_fingerprint text,immutable_bank_fingerprint text,admitted_source_history_digest text)
LANGUAGE plpgsql STABLE AS $$
DECLARE receipt_row subscription_provider_charge_receipts%ROWTYPE;origin_row subscription_controlled_charge_origins%ROWTYPE;
 resource_row subscription_controlled_resources%ROWTYPE;origin_operation subscription_controlled_operations%ROWTYPE;origin_call subscription_controlled_calls%ROWTYPE;origin_fact subscription_controlled_facts%ROWTYPE;
 collection_row subscription_controlled_collections%ROWTYPE;quote_row subscription_controlled_quotes%ROWTYPE;binding_row subscription_controlled_invoice_bindings%ROWTYPE;
 inspection_row merchant_cash_return_inspections%ROWTYPE;finish_row merchant_cash_return_inspection_finishes%ROWTYPE;state_row merchant_cash_return_observations%ROWTYPE;
 admitted_observation subscription_provider_charge_observations%ROWTYPE;source_cash jsonb;bank jsonb;state_count bigint;state_max integer;primary_count bigint;witness_count bigint;
 namespace_platform text;namespace_account text;namespace_intent text;
BEGIN
 SELECT * INTO receipt_row FROM subscription_provider_charge_receipts WHERE id=target_receipt_uuid;
 SELECT * INTO origin_row FROM subscription_controlled_charge_origins WHERE receipt_id=target_receipt_uuid;
 SELECT * INTO resource_row FROM subscription_controlled_resources WHERE id=origin_row.resource_id;
 SELECT * INTO collection_row FROM subscription_controlled_collections WHERE id=target_collection_uuid;
 SELECT * INTO quote_row FROM subscription_controlled_quotes WHERE id=collection_row.quote_id;
 SELECT * INTO binding_row FROM subscription_controlled_invoice_bindings WHERE collection_id=collection_row.id;
 SELECT * INTO origin_operation FROM subscription_controlled_operations WHERE id=origin_row.operation_id;
 SELECT * INTO origin_call FROM subscription_controlled_calls WHERE id=origin_row.call_id;
 SELECT * INTO origin_fact FROM subscription_controlled_facts WHERE id=origin_row.fact_id;
 source_cash=origin_fact.actual->'raw'->'cash';
 IF receipt_row.id IS NULL OR origin_row.receipt_id IS NULL OR resource_row.id IS NULL OR collection_row.id IS NULL OR quote_row.id IS NULL
  OR quote_row.resource_id IS DISTINCT FROM resource_row.id OR binding_row.resource_id IS DISTINCT FROM resource_row.id
  OR binding_row.provider_invoice_ref IS DISTINCT FROM receipt_row.provider_invoice_ref OR receipt_row.subscription_id IS DISTINCT FROM resource_row.subscription_id
  OR NOT coalesce(freeholder_controlled_collection_valid(collection_row.id),false) OR quote_row.redacted_at IS NOT NULL
  OR receipt_row.provider_api_version IS DISTINCT FROM '2026-10-28.endive' OR receipt_row.provider_charge_ref IS NULL
  OR receipt_row.provider_platform_account_id IS DISTINCT FROM resource_row.original_scope->>'providerPlatformAccountId'
  OR receipt_row.charge_account_id IS DISTINCT FROM resource_row.original_scope->>'providerAccountId'
  OR receipt_row.actual_destination_account_id IS DISTINCT FROM resource_row.original_scope->>'destinationAccountId'
  OR receipt_row.actual_settlement_merchant_account_id IS DISTINCT FROM resource_row.original_scope->>'settlementMerchantAccountId'
  OR origin_operation.resource_id IS DISTINCT FROM resource_row.id OR origin_call.operation_id IS DISTINCT FROM origin_operation.id
  OR origin_fact.call_id IS DISTINCT FROM origin_call.id OR origin_fact.actual->>'kind' IS DISTINCT FROM 'cash_observed'
  OR source_cash->>'subscriptionId' IS DISTINCT FROM receipt_row.subscription_id::text
  OR source_cash->>'providerPaymentIntentRef' IS DISTINCT FROM receipt_row.provider_payment_intent_ref OR source_cash->>'providerInvoiceRef' IS DISTINCT FROM receipt_row.provider_invoice_ref
  OR source_cash->>'providerSubscriptionRef' IS DISTINCT FROM receipt_row.provider_subscription_ref
  OR(source_cash->>'providerChargeRef' IS NOT NULL AND source_cash->>'providerChargeRef' IS DISTINCT FROM receipt_row.provider_charge_ref)
  OR source_cash->>'destinationAccountId' IS DISTINCT FROM resource_row.original_scope->>'destinationAccountId'
  OR source_cash->>'settlementMerchantAccountId' IS DISTINCT FROM resource_row.original_scope->>'settlementMerchantAccountId'
  OR source_cash->>'providerPlatformAccountId' IS DISTINCT FROM receipt_row.provider_platform_account_id OR source_cash->>'providerAccountId' IS DISTINCT FROM receipt_row.charge_account_id
  OR source_cash->>'providerCustomerRef' IS DISTINCT FROM resource_row.original_scope->>'providerCustomerRef'
  OR origin_fact.actual->'raw'->'invoice'->>'id' IS DISTINCT FROM receipt_row.provider_invoice_ref
  OR origin_fact.actual->'raw'->'intent'->>'id' IS DISTINCT FROM receipt_row.provider_payment_intent_ref
  OR freeholder_controlled_ref(origin_fact.actual->'raw'->'invoice'->'customer') IS DISTINCT FROM resource_row.original_scope->>'providerCustomerRef'
  OR freeholder_controlled_ref(origin_fact.actual->'raw'->'intent'->'customer') IS DISTINCT FROM resource_row.original_scope->>'providerCustomerRef'
  OR coalesce(freeholder_controlled_ref(origin_fact.actual->'raw'->'invoice'->'subscription'),freeholder_controlled_ref(origin_fact.actual->'raw'->'invoice'->'parent'->'subscription_details'->'subscription')) IS DISTINCT FROM receipt_row.provider_subscription_ref
  OR origin_fact.actual->'raw'->'intent'->>'amount_received' IS DISTINCT FROM receipt_row.amount_minor::text
  OR upper(origin_fact.actual->'raw'->'intent'->>'currency') IS DISTINCT FROM receipt_row.currency
  OR(freeholder_controlled_ref(origin_fact.actual->'raw'->'intent'->'latest_charge') IS NOT NULL AND freeholder_controlled_ref(origin_fact.actual->'raw'->'intent'->'latest_charge') IS DISTINCT FROM receipt_row.provider_charge_ref)
  OR source_cash->>'amountMinor' IS DISTINCT FROM receipt_row.amount_minor::text OR source_cash->>'currency' IS DISTINCT FROM receipt_row.currency
  OR source_cash->'customerChargeVerified' IS DISTINCT FROM 'true'::jsonb OR source_cash->'merchantRouteVerified' IS DISTINCT FROM 'true'::jsonb
  OR NOT receipt_row.customer_charge_verified OR NOT receipt_row.merchant_route_verified OR NOT coalesce(freeholder_controlled_callers_closed(resource_row.id),false) THEN RETURN;END IF;
 namespace_platform=receipt_row.provider_platform_account_id;namespace_account=receipt_row.charge_account_id;namespace_intent=receipt_row.provider_payment_intent_ref;
 -- Latest namespace admission, including an unfinished/negative later reader.
 -- A later payment-owned inspection cannot silently revive this older receipt read.
 SELECT * INTO inspection_row FROM merchant_cash_return_inspections inspection
  WHERE inspection.provider_platform_account_id=namespace_platform AND inspection.charge_account_id IS NOT DISTINCT FROM namespace_account AND inspection.original_payment_ref=namespace_intent
  ORDER BY inspection.created_at DESC,inspection.id DESC LIMIT 1;
 IF inspection_row.id IS NULL OR inspection_row.subscription_charge_receipt_id IS DISTINCT FROM receipt_row.id OR inspection_row.payment_id IS NOT NULL
  OR inspection_row.original_observation_id IS NOT NULL OR inspection_row.original_cash_amount_minor IS DISTINCT FROM receipt_row.amount_minor
  OR inspection_row.currency IS DISTINCT FROM receipt_row.currency OR inspection_row.provider_api_version IS DISTINCT FROM receipt_row.provider_api_version THEN RETURN;END IF;
 SELECT * INTO admitted_observation FROM subscription_provider_charge_observations WHERE id=inspection_row.subscription_charge_observation_id;
 IF admitted_observation.id IS NULL OR admitted_observation.subscription_id IS DISTINCT FROM receipt_row.subscription_id
  OR admitted_observation.provider_platform_account_id IS DISTINCT FROM namespace_platform OR admitted_observation.charge_account_id IS DISTINCT FROM namespace_account
  OR admitted_observation.provider_api_version IS DISTINCT FROM receipt_row.provider_api_version OR admitted_observation.provider_invoice_ref IS DISTINCT FROM receipt_row.provider_invoice_ref
  OR admitted_observation.provider_subscription_ref IS DISTINCT FROM receipt_row.provider_subscription_ref OR admitted_observation.provider_payment_intent_ref IS DISTINCT FROM namespace_intent
  OR admitted_observation.provider_charge_ref IS DISTINCT FROM receipt_row.provider_charge_ref OR admitted_observation.amount_minor IS DISTINCT FROM receipt_row.amount_minor OR admitted_observation.currency IS DISTINCT FROM receipt_row.currency THEN RETURN;END IF;
 SELECT * INTO finish_row FROM merchant_cash_return_inspection_finishes WHERE inspection_id=inspection_row.id;
 IF finish_row.inspection_id IS NULL OR finish_row.caller_instance_id::text IS DISTINCT FROM inspection_row.caller->>'id' OR finish_row.outcome IS DISTINCT FROM 'returned'
  OR EXISTS(SELECT 1 FROM merchant_cash_return_inspection_stops WHERE inspection_id=inspection_row.id) THEN RETURN;END IF;
 -- A stop closes ONLY the actual older caller. It cannot supply selected bank evidence.
 IF EXISTS(SELECT 1 FROM merchant_cash_return_inspections admitted
  LEFT JOIN merchant_cash_return_inspection_finishes finished ON finished.inspection_id=admitted.id
  LEFT JOIN merchant_cash_return_inspection_stops stopped ON stopped.inspection_id=admitted.id
  WHERE admitted.provider_platform_account_id=namespace_platform AND admitted.charge_account_id IS NOT DISTINCT FROM namespace_account AND admitted.original_payment_ref=namespace_intent
   AND((finished.inspection_id IS NOT NULL AND stopped.inspection_id IS NOT NULL)
    OR(finished.inspection_id IS NOT NULL AND(finished.caller_instance_id::text IS DISTINCT FROM admitted.caller->>'id' OR finished.outcome NOT IN('returned','threw')))
    OR(stopped.inspection_id IS NOT NULL AND(stopped.caller_instance_id::text IS DISTINCT FROM admitted.caller->>'id'
      OR stopped.admission_fingerprint IS DISTINCT FROM encode(sha256(convert_to(to_jsonb(admitted)::text,'UTF8')),'hex') OR stopped.mechanical_check IS DISTINCT FROM 'original_process_absent'))
    OR(finished.inspection_id IS NULL AND stopped.inspection_id IS NULL))) THEN RETURN;END IF;
 IF EXISTS(SELECT 1 FROM merchant_refund_dispatches dispatched JOIN merchant_refund_requests requested ON requested.id=dispatched.request_id
  LEFT JOIN merchant_refund_dispatch_finishes finished ON finished.dispatch_id=dispatched.id
  LEFT JOIN merchant_refund_dispatch_stops stopped ON stopped.dispatch_id=dispatched.id
  WHERE requested.provider_platform_account_id=namespace_platform AND requested.charge_account_id IS NOT DISTINCT FROM namespace_account AND requested.original_payment_ref=namespace_intent
   AND((finished.dispatch_id IS NOT NULL AND stopped.dispatch_id IS NOT NULL)
    OR(finished.dispatch_id IS NOT NULL AND finished.caller_instance_id::text IS DISTINCT FROM dispatched.caller->>'id')
    OR(stopped.dispatch_id IS NOT NULL AND(stopped.caller_instance_id::text IS DISTINCT FROM dispatched.caller->>'id' OR stopped.request_digest IS DISTINCT FROM dispatched.request_digest))
    OR(finished.dispatch_id IS NULL AND stopped.dispatch_id IS NULL))) THEN RETURN;END IF;
 IF EXISTS(SELECT 1 FROM original_cash_recovery_operations physical_call JOIN original_cash_recoveries physical_owner ON physical_owner.id=physical_call.recovery_id
  WHERE physical_owner.owner->'cash'->>'providerPlatformAccountId'=namespace_platform AND physical_owner.owner->'cash'->>'chargeAccountId' IS NOT DISTINCT FROM namespace_account
   AND physical_owner.owner->'cash'->>'providerRef'=namespace_intent AND NOT EXISTS(SELECT 1 FROM original_cash_recovery_facts actual_finish WHERE actual_finish.operation_id=physical_call.id
    AND(actual_finish.kind='finish' AND actual_finish.evidence->>'callerInstanceId'=physical_call.caller->>'id' AND actual_finish.evidence->>'outcome' IN('returned','threw')
     OR actual_finish.kind='stop' AND actual_finish.evidence->>'operationDigest'=physical_call.digest))) THEN RETURN;END IF;
 SELECT count(*),max(sequence) INTO state_count,state_max FROM merchant_cash_return_observations WHERE inspection_id=inspection_row.id;
 SELECT * INTO state_row FROM merchant_cash_return_observations WHERE inspection_id=inspection_row.id ORDER BY sequence DESC LIMIT 1;
 SELECT count(*) INTO primary_count FROM merchant_cash_return_primary_observations WHERE inspection_id=inspection_row.id;
 IF state_count<1 OR state_count>5000 OR state_max IS DISTINCT FROM state_count OR primary_count<1 OR primary_count>5000
  OR EXISTS(SELECT 1 FROM merchant_cash_return_observations state WHERE state.inspection_id=inspection_row.id AND(state.sequence<1 OR state.sequence>state_count))
  OR EXISTS(SELECT 1 FROM merchant_cash_return_primary_observations primary_row WHERE primary_row.inspection_id=inspection_row.id
   AND(NOT freeholder_controlled_bank_minor(primary_row.evidence->'amountMinor',true) OR primary_row.evidence->>'providerRef' IS DISTINCT FROM namespace_intent
    OR NOT coalesce(primary_row.evidence->>'status'='succeeded' OR(primary_row.evidence->>'status'='failed' AND state_row.evidence->>'paymentIntentStatus'='canceled'),false)
    OR primary_row.evidence->>'providerPlatformAccountId' IS DISTINCT FROM namespace_platform OR primary_row.evidence->>'providerAccountId' IS DISTINCT FROM namespace_account
    OR primary_row.evidence->>'providerApiVersion' IS DISTINCT FROM receipt_row.provider_api_version OR primary_row.evidence->>'amountMinor' IS DISTINCT FROM receipt_row.amount_minor::text
    OR primary_row.evidence->>'currency' IS DISTINCT FROM receipt_row.currency OR primary_row.evidence->>'providerChargeRef' IS DISTINCT FROM receipt_row.provider_charge_ref)) THEN RETURN;END IF;
 bank=state_row.evidence;
 IF jsonb_typeof(bank) IS DISTINCT FROM 'object' OR bank->>'providerPlatformAccountId' IS DISTINCT FROM namespace_platform OR bank->>'chargeAccountId' IS DISTINCT FROM namespace_account
  OR bank->>'providerApiVersion' IS DISTINCT FROM receipt_row.provider_api_version OR bank->>'paymentProviderRef' IS DISTINCT FROM namespace_intent OR bank->>'providerChargeRef' IS DISTINCT FROM receipt_row.provider_charge_ref
  OR bank->>'amountMinor' IS DISTINCT FROM receipt_row.amount_minor::text OR bank->>'currency' IS DISTINCT FROM receipt_row.currency
  OR bank->>'chargePaymentProviderRef' IS DISTINCT FROM namespace_intent OR bank->>'chargeAmountMinor' IS DISTINCT FROM receipt_row.amount_minor::text OR bank->>'chargeCurrency' IS DISTINCT FROM receipt_row.currency
  OR bank->'refundsComplete' IS DISTINCT FROM 'true'::jsonb OR bank->'disputesComplete' IS DISTINCT FROM 'true'::jsonb
  OR jsonb_typeof(bank->'refunds') IS DISTINCT FROM 'array' OR jsonb_typeof(bank->'disputes') IS DISTINCT FROM 'array' THEN RETURN;END IF;
 IF jsonb_array_length(bank->'refunds')>1000 OR jsonb_array_length(bank->'disputes')>1000 THEN RETURN;END IF;
 IF EXISTS(SELECT 1 FROM merchant_refund_observations refund_row WHERE refund_row.inspection_id=inspection_row.id
  AND(refund_row.provider_platform_account_id IS DISTINCT FROM namespace_platform OR refund_row.charge_account_id IS DISTINCT FROM namespace_account
   OR refund_row.payment_provider_ref IS DISTINCT FROM namespace_intent OR refund_row.currency IS DISTINCT FROM receipt_row.currency
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(bank->'refunds') actual_refund WHERE actual_refund->>'providerRef'=refund_row.provider_ref
    AND actual_refund->>'paymentProviderRef'=refund_row.payment_provider_ref AND actual_refund->>'chargeRef'=refund_row.provider_charge_ref
    AND actual_refund->>'amountMinor'=refund_row.amount_minor::text AND actual_refund->>'currency'=refund_row.currency AND actual_refund->>'status'=refund_row.status))) THEN RETURN;END IF;
 immutable_bank_fingerprint=encode(sha256(convert_to(jsonb_build_object('receiptId',receipt_row.id,'origin',to_jsonb(origin_row),'originalOperation',to_jsonb(origin_operation),
  'originalCall',to_jsonb(origin_call),'originalFact',to_jsonb(origin_fact),'inspection',to_jsonb(inspection_row),'finish',to_jsonb(finish_row),'latestState',to_jsonb(state_row),
  'primary',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM merchant_cash_return_primary_observations p WHERE p.inspection_id=inspection_row.id),
  'ownRefunds',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]'::jsonb) FROM merchant_refund_observations r WHERE r.inspection_id=inspection_row.id))::text,'UTF8')),'hex');
 WITH namespace_inspections AS(SELECT i.* FROM merchant_cash_return_inspections i WHERE i.provider_platform_account_id=namespace_platform AND i.charge_account_id IS NOT DISTINCT FROM namespace_account AND i.original_payment_ref=namespace_intent),
 resource_calls AS(SELECT c.* FROM subscription_controlled_calls c JOIN subscription_controlled_operations o ON o.id=c.operation_id WHERE o.resource_id=resource_row.id),
 namespace_requests AS(SELECT r.* FROM merchant_refund_requests r WHERE r.provider_platform_account_id=namespace_platform AND r.charge_account_id IS NOT DISTINCT FROM namespace_account AND r.original_payment_ref=namespace_intent),
 namespace_aliases AS(SELECT r.* FROM merchant_agreement_payment_routes r WHERE r.original_charge_receipt_id=receipt_row.id),
 namespace_payments AS(SELECT p.* FROM payments p WHERE p.id IN(SELECT payment_id FROM namespace_aliases)
  OR p.id IN(SELECT m.payment_id FROM merchant_payment_observations m WHERE m.provider_platform_account_id=namespace_platform AND m.charge_account_id IS NOT DISTINCT FROM namespace_account AND m.provider_ref=namespace_intent)),
 namespace_fees AS(SELECT f.* FROM merchant_fee_refunds f WHERE f.original_charge_receipt_id=receipt_row.id OR f.payment_id IN(SELECT id FROM namespace_payments)),
 namespace_owners AS(SELECT o.* FROM original_cash_recoveries o WHERE o.subscription_charge_receipt_id=receipt_row.id
  OR(o.owner->'cash'->>'providerPlatformAccountId'=namespace_platform AND o.owner->'cash'->>'chargeAccountId' IS NOT DISTINCT FROM namespace_account AND o.owner->'cash'->>'providerRef'=namespace_intent)),
 namespace_resolutions AS(SELECT r.* FROM merchant_unapplied_charge_resolutions r WHERE r.subscription_charge_receipt_id=receipt_row.id
  OR(r.provider_platform_account_id=namespace_platform AND r.charge_account_id IS NOT DISTINCT FROM namespace_account AND r.original_payment_ref=namespace_intent)),
 refund_rows AS(SELECT r.* FROM merchant_refund_observations r WHERE r.inspection_id IN(SELECT id FROM namespace_inspections)
  OR(r.provider_platform_account_id=namespace_platform AND r.charge_account_id IS NOT DISTINCT FROM namespace_account AND r.payment_provider_ref=namespace_intent)),
 physical_rows AS(
  SELECT 'subscription_provider_charge_receipts'::text family,receipt_row.id::text identity,encode(sha256(convert_to(to_jsonb(receipt_row)::text,'UTF8')),'hex') fingerprint
  UNION ALL SELECT 'subscription_controlled_resources',resource_row.id::text,encode(sha256(convert_to(to_jsonb(resource_row)::text,'UTF8')),'hex')
  UNION ALL SELECT 'subscription_controlled_collections',collection_row.id::text,encode(sha256(convert_to(to_jsonb(collection_row)::text,'UTF8')),'hex')
  UNION ALL SELECT 'subscription_controlled_quotes',quote_row.id::text,encode(sha256(convert_to(to_jsonb(quote_row)::text,'UTF8')),'hex')
  UNION ALL SELECT 'subscription_controlled_invoice_bindings',binding_row.collection_id::text,encode(sha256(convert_to(to_jsonb(binding_row)::text,'UTF8')),'hex')
  UNION ALL SELECT 'subscription_controlled_operations',o.id::text,encode(sha256(convert_to(to_jsonb(o)::text,'UTF8')),'hex') FROM subscription_controlled_operations o WHERE o.resource_id=resource_row.id
  UNION ALL SELECT 'subscription_controlled_calls',c.id::text,encode(sha256(convert_to(to_jsonb(c)::text,'UTF8')),'hex') FROM resource_calls c
  UNION ALL SELECT 'subscription_controlled_facts',f.id::text,encode(sha256(convert_to(to_jsonb(f)::text,'UTF8')),'hex') FROM subscription_controlled_facts f WHERE f.call_id IN(SELECT id FROM resource_calls)
  UNION ALL SELECT 'subscription_controlled_finishes',f.call_id::text,encode(sha256(convert_to(to_jsonb(f)::text,'UTF8')),'hex') FROM subscription_controlled_finishes f WHERE f.call_id IN(SELECT id FROM resource_calls)
  UNION ALL SELECT 'subscription_controlled_stops',s.call_id::text,encode(sha256(convert_to(to_jsonb(s)::text,'UTF8')),'hex') FROM subscription_controlled_stops s WHERE s.call_id IN(SELECT id FROM resource_calls)
  UNION ALL SELECT 'subscription_controlled_verifications',v.operation_id::text,encode(sha256(convert_to(to_jsonb(v)::text,'UTF8')),'hex') FROM subscription_controlled_verifications v WHERE v.call_id IN(SELECT id FROM resource_calls)
  UNION ALL SELECT 'subscription_controlled_charge_origins',o.receipt_id::text,encode(sha256(convert_to(to_jsonb(o)::text,'UTF8')),'hex') FROM subscription_controlled_charge_origins o WHERE o.resource_id=resource_row.id
  UNION ALL SELECT 'subscription_controlled_closures',c.resource_id::text,encode(sha256(convert_to(to_jsonb(c)::text,'UTF8')),'hex') FROM subscription_controlled_closures c WHERE c.resource_id=resource_row.id
  UNION ALL SELECT 'subscription_provider_charge_observations',o.id::text,encode(sha256(convert_to(to_jsonb(o)::text,'UTF8')),'hex') FROM subscription_provider_charge_observations o WHERE o.provider_platform_account_id=namespace_platform AND o.charge_account_id IS NOT DISTINCT FROM namespace_account AND o.provider_payment_intent_ref=namespace_intent
  UNION ALL SELECT 'merchant_cash_return_inspections',i.id::text,encode(sha256(convert_to(to_jsonb(i)::text,'UTF8')),'hex') FROM namespace_inspections i
  UNION ALL SELECT 'merchant_cash_return_inspection_finishes',f.inspection_id::text,encode(sha256(convert_to(to_jsonb(f)::text,'UTF8')),'hex') FROM merchant_cash_return_inspection_finishes f WHERE f.inspection_id IN(SELECT id FROM namespace_inspections)
  UNION ALL SELECT 'merchant_cash_return_inspection_stops',s.inspection_id::text,encode(sha256(convert_to(to_jsonb(s)::text,'UTF8')),'hex') FROM merchant_cash_return_inspection_stops s WHERE s.inspection_id IN(SELECT id FROM namespace_inspections)
  UNION ALL SELECT 'merchant_cash_return_primary_observations',p.id::text,encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex') FROM merchant_cash_return_primary_observations p WHERE p.inspection_id IN(SELECT id FROM namespace_inspections)
  UNION ALL SELECT 'merchant_cash_return_observations',s.id::text,encode(sha256(convert_to(to_jsonb(s)::text,'UTF8')),'hex') FROM merchant_cash_return_observations s WHERE s.inspection_id IN(SELECT id FROM namespace_inspections)
  UNION ALL SELECT 'merchant_refund_observations',r.id::text,encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') FROM refund_rows r
  UNION ALL SELECT 'merchant_refund_observation_captures',c.id::text,encode(sha256(convert_to(to_jsonb(c)::text,'UTF8')),'hex') FROM merchant_refund_observation_captures c WHERE c.observation_id IN(SELECT id FROM refund_rows)
  UNION ALL SELECT 'merchant_agreement_payment_routes',a.payment_id::text,encode(sha256(convert_to(to_jsonb(a)::text,'UTF8')),'hex') FROM namespace_aliases a
  UNION ALL SELECT 'payments',p.id::text,encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex') FROM namespace_payments p
  UNION ALL SELECT 'merchant_payment_observations',o.id::text,encode(sha256(convert_to(to_jsonb(o)::text,'UTF8')),'hex') FROM merchant_payment_observations o WHERE o.provider_platform_account_id=namespace_platform AND o.charge_account_id IS NOT DISTINCT FROM namespace_account AND o.provider_ref=namespace_intent
  UNION ALL SELECT 'merchant_fee_refunds',f.id::text,encode(sha256(convert_to(to_jsonb(f)::text,'UTF8')),'hex') FROM namespace_fees f
  UNION ALL SELECT 'merchant_fee_observations',o.id::text,encode(sha256(convert_to(to_jsonb(o)::text,'UTF8')),'hex') FROM merchant_fee_observations o WHERE o.operation_id IN(SELECT id FROM namespace_fees)
  UNION ALL SELECT 'merchant_refund_requests',r.id::text,encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') FROM namespace_requests r
  UNION ALL SELECT 'merchant_refund_reservation_retirements',r.request_id::text,encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') FROM merchant_refund_reservation_retirements r WHERE r.request_id IN(SELECT id FROM namespace_requests)
  UNION ALL SELECT 'merchant_refund_dispatches',d.id::text,encode(sha256(convert_to(to_jsonb(d)::text,'UTF8')),'hex') FROM merchant_refund_dispatches d WHERE d.request_id IN(SELECT id FROM namespace_requests)
  UNION ALL SELECT 'merchant_refund_dispatch_finishes',f.dispatch_id::text,encode(sha256(convert_to(to_jsonb(f)::text,'UTF8')),'hex') FROM merchant_refund_dispatch_finishes f JOIN merchant_refund_dispatches d ON d.id=f.dispatch_id WHERE d.request_id IN(SELECT id FROM namespace_requests)
  UNION ALL SELECT 'merchant_refund_dispatch_stops',s.dispatch_id::text,encode(sha256(convert_to(to_jsonb(s)::text,'UTF8')),'hex') FROM merchant_refund_dispatch_stops s JOIN merchant_refund_dispatches d ON d.id=s.dispatch_id WHERE d.request_id IN(SELECT id FROM namespace_requests)
  UNION ALL SELECT 'merchant_refund_creation_refusals',r.dispatch_id::text,encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') FROM merchant_refund_creation_refusals r JOIN merchant_refund_dispatches d ON d.id=r.dispatch_id WHERE d.request_id IN(SELECT id FROM namespace_requests)
  UNION ALL SELECT 'merchant_refund_terminal_receipts',r.request_id::text,encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') FROM merchant_refund_terminal_receipts r WHERE r.request_id IN(SELECT id FROM namespace_requests)
  UNION ALL SELECT 'merchant_refund_resource_bindings',b.id::text,encode(sha256(convert_to(to_jsonb(b)::text,'UTF8')),'hex') FROM merchant_refund_resource_bindings b WHERE b.request_id IN(SELECT id FROM namespace_requests)
  UNION ALL SELECT 'original_cash_recoveries',o.id::text,encode(sha256(convert_to(to_jsonb(o)::text,'UTF8')),'hex') FROM namespace_owners o
  UNION ALL SELECT 'original_cash_recovery_operations',o.id::text,encode(sha256(convert_to(to_jsonb(o)::text,'UTF8')),'hex') FROM original_cash_recovery_operations o WHERE o.recovery_id IN(SELECT id FROM namespace_owners)
  UNION ALL SELECT 'original_cash_recovery_facts',f.id::text,encode(sha256(convert_to(to_jsonb(f)::text,'UTF8')),'hex') FROM original_cash_recovery_facts f WHERE f.recovery_id IN(SELECT id FROM namespace_owners)
  UNION ALL SELECT 'original_cash_recovery_closures',c.id::text,encode(sha256(convert_to(to_jsonb(c)::text,'UTF8')),'hex') FROM original_cash_recovery_closures c WHERE c.recovery_id IN(SELECT id FROM namespace_owners)
  UNION ALL SELECT 'merchant_unapplied_charge_resolutions',r.id::text,encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') FROM namespace_resolutions r
  UNION ALL SELECT 'merchant_unapplied_charge_resolution_refunds',r.resolution_id::text||':'||r.observation_id::text,encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') FROM merchant_unapplied_charge_resolution_refunds r WHERE r.resolution_id IN(SELECT id FROM namespace_resolutions)
  UNION ALL SELECT 'legacy_bank_feedback',f.id::text,encode(sha256(convert_to(to_jsonb(f)::text,'UTF8')),'hex') FROM legacy_bank_feedback f
   WHERE f.evidence->>'observedChargeAccountId' IS NOT DISTINCT FROM namespace_account
    AND(f.evidence->>'observedPlatformAccountId' IS NULL OR f.evidence->>'observedPlatformAccountId'=namespace_platform)
    AND(f.evidence->>'observedPaymentRef'=namespace_intent OR(f.evidence->>'observedPaymentRef' IS NULL AND f.evidence->>'observedChargeRef'=receipt_row.provider_charge_ref)
     OR f.evidence->>'observedRefundRef' IN(SELECT b.provider_ref FROM merchant_refund_resource_bindings b WHERE b.request_id IN(SELECT id FROM namespace_requests))
     OR f.evidence->>'observedRefundRef' IN(SELECT f2.evidence->>'providerRef' FROM original_cash_recovery_facts f2 WHERE f2.recovery_id IN(SELECT id FROM namespace_owners) AND f2.kind='refund'))
 ),bounded_physical_rows AS(SELECT * FROM physical_rows ORDER BY family,identity LIMIT 5001)
 SELECT count(*),jsonb_agg(jsonb_build_object('table',family,'id',identity,'fingerprint',fingerprint) ORDER BY family,identity),
  encode(sha256(convert_to(string_agg(family||':'||identity||':'||fingerprint,E'\n' ORDER BY family,identity),'UTF8')),'hex') INTO witness_count,bank_witness,bank_fingerprint FROM bounded_physical_rows;
 IF witness_count>5000 THEN RETURN;END IF;
 actual_inspection_id=inspection_row.id;actual_observation_id=state_row.id;current_evidence=bank;admitted_source_history_digest=inspection_row.source_history_digest;
 original_expectation=resource_row.original_scope||jsonb_build_object('providerRef',namespace_intent,'chargeRef',receipt_row.provider_charge_ref,'amountMinor',receipt_row.amount_minor,'currency',receipt_row.currency,
  'originalFeeRef',receipt_row.application_fee_ref,'customerChargeVerified',receipt_row.customer_charge_verified,'merchantRouteVerified',receipt_row.merchant_route_verified);
 RETURN NEXT;
END $$;
--> statement-breakpoint
-- Actual canonical fee ownership supplies the expectation; callers cannot
-- choose it by passing an amount/recipient JSON object to an authority.
-- TRUE means only this original bank observation is eligible unreturned cash,
-- NOT complete parent/application/principal/credit/access authority.
CREATE FUNCTION freeholder_controlled_receipt_bank_unreturned(target_collection_uuid uuid,target_receipt_uuid uuid) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE observed_bank record;collection_row subscription_controlled_collections%ROWTYPE;invoice_row invoices%ROWTYPE;policy_row invoice_market_policies%ROWTYPE;
 receipt_row subscription_provider_charge_receipts%ROWTYPE;route_row merchant_agreement_payment_routes%ROWTYPE;payment_row payments%ROWTYPE;duty_row agreement_fee_duties%ROWTYPE;
 carried_fee numeric;cash_principal numeric;cash_fee numeric;prior_cash numeric;prior_fee numeric;fee_minor numeric;cash_count bigint;application_count bigint;
BEGIN
 SELECT * INTO observed_bank FROM freeholder_controlled_receipt_bank_observation(target_collection_uuid,target_receipt_uuid);
 IF observed_bank.actual_inspection_id IS NULL THEN RETURN false;END IF;
 SELECT * INTO collection_row FROM subscription_controlled_collections WHERE id=target_collection_uuid;
 SELECT * INTO invoice_row FROM invoices WHERE id=collection_row.invoice_id;SELECT * INTO policy_row FROM invoice_market_policies WHERE invoice_id=invoice_row.id;
 SELECT * INTO receipt_row FROM subscription_provider_charge_receipts WHERE id=target_receipt_uuid;
 SELECT * INTO route_row FROM merchant_agreement_payment_routes WHERE original_charge_receipt_id=receipt_row.id;
 SELECT * INTO payment_row FROM payments WHERE id=route_row.payment_id;
 IF invoice_row.id IS NULL OR policy_row.model IS DISTINCT FROM 'seller_merchant' OR invoice_row.currency IS DISTINCT FROM receipt_row.currency THEN RETURN false;END IF;
 IF route_row.payment_id IS NOT NULL THEN
  -- Exact immutable original fee allocation was retained by the original route
  -- writer. Do not reprice it or infer a different per-receipt residual order.
  IF payment_row.invoice_id IS DISTINCT FROM invoice_row.id OR payment_row.provider IS DISTINCT FROM 'stripe' OR payment_row.method IS DISTINCT FROM 'provider_schedule'
   OR payment_row.amount_minor IS DISTINCT FROM receipt_row.amount_minor OR payment_row.currency IS DISTINCT FROM receipt_row.currency
   OR route_row.origin_kind IS DISTINCT FROM 'provider_schedule' OR route_row.provider_api_version IS DISTINCT FROM receipt_row.provider_api_version
   OR route_row.provider_platform_account_id IS DISTINCT FROM receipt_row.provider_platform_account_id OR route_row.charge_account_id IS DISTINCT FROM receipt_row.charge_account_id
   OR route_row.provider_invoice_ref IS DISTINCT FROM receipt_row.provider_invoice_ref OR route_row.provider_subscription_ref IS DISTINCT FROM receipt_row.provider_subscription_ref
   OR route_row.provider_payment_intent_ref IS DISTINCT FROM receipt_row.provider_payment_intent_ref OR route_row.provider_charge_ref IS DISTINCT FROM receipt_row.provider_charge_ref THEN RETURN false;END IF;
  fee_minor=route_row.application_fee_minor;
 ELSE
  SELECT count(*),coalesce(sum(application.fee_obligation_minor),0) INTO application_count,carried_fee FROM invoice_credit_applications application WHERE application.invoice_id=invoice_row.id;
  IF application_count>5000 OR EXISTS(SELECT 1 FROM invoice_credit_applications application WHERE application.invoice_id=invoice_row.id AND application.fee_evidence_digest IS NULL)
   OR coalesce((SELECT sum(reservation.amount_minor) FROM invoice_credit_applications application JOIN invoice_credit_reservations reservation ON reservation.id=application.reservation_id WHERE application.invoice_id=invoice_row.id),0) IS DISTINCT FROM invoice_row.credited_minor::numeric THEN RETURN false;END IF;
  cash_principal=invoice_row.total_minor-invoice_row.credited_minor;cash_fee=greatest(0,policy_row.fee_minor-carried_fee);
  IF split_part(invoice_row.source_id,':',2)='proration' THEN
   SELECT * INTO duty_row FROM agreement_fee_duties WHERE invoice_id=invoice_row.id;
   IF duty_row.invoice_id IS NULL OR duty_row.total_minor IS DISTINCT FROM invoice_row.total_minor OR duty_row.target_fee_minor IS DISTINCT FROM policy_row.fee_minor
    OR duty_row.credited_minor IS DISTINCT FROM invoice_row.credited_minor OR duty_row.carried_fee_minor IS DISTINCT FROM carried_fee
    OR duty_row.cash_principal_minor IS DISTINCT FROM cash_principal OR duty_row.cash_fee_target_minor IS DISTINCT FROM least(cash_principal,cash_fee) THEN RETURN false;END IF;
   cash_fee=duty_row.cash_fee_target_minor;
  END IF;
  IF cash_principal<=0 OR cash_fee>cash_principal THEN RETURN false;END IF;
  SELECT count(*),coalesce(sum(accounted_payment.amount_minor),0),coalesce(sum(coalesce(external_owner.fee_owed_minor,agreement_owner.application_fee_minor)),0)
   INTO cash_count,prior_cash,prior_fee FROM payments accounted_payment
   LEFT JOIN commercial_payment_attestations external_owner ON external_owner.payment_id=accounted_payment.id
   LEFT JOIN merchant_agreement_payment_routes agreement_owner ON agreement_owner.payment_id=accounted_payment.id
   WHERE accounted_payment.invoice_id=invoice_row.id AND accounted_payment.status='succeeded';
  IF cash_count+application_count>5000 OR prior_cash IS DISTINCT FROM invoice_row.paid_minor::numeric OR prior_cash+receipt_row.amount_minor>cash_principal
   OR prior_fee IS DISTINCT FROM floor(cash_fee*prior_cash/cash_principal)
   OR EXISTS(SELECT 1 FROM payments accounted_payment LEFT JOIN commercial_payment_attestations external_owner ON external_owner.payment_id=accounted_payment.id
    LEFT JOIN merchant_agreement_payment_routes agreement_owner ON agreement_owner.payment_id=accounted_payment.id
    WHERE accounted_payment.invoice_id=invoice_row.id AND accounted_payment.status='succeeded'
     AND((external_owner.payment_id IS NOT NULL)::integer+(agreement_owner.payment_id IS NOT NULL)::integer<>1 OR accounted_payment.refunded_minor<>0)) THEN RETURN false;END IF;
  fee_minor=floor(cash_fee*(prior_cash+receipt_row.amount_minor)/cash_principal)-prior_fee;
 END IF;
 RETURN freeholder_controlled_bank_unreturned(observed_bank.original_expectation||jsonb_build_object('feeMinor',fee_minor),observed_bank.current_evidence) IS TRUE;
END $$;
