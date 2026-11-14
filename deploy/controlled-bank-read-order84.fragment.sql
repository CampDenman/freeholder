-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
-- C12.38/C1.08: OWNED UNAPPLIED follow-on AFTER d598 and signed cde lineage.
-- Frozen earlier fragments/current journals remain byte-for-byte unchanged.
CREATE OR REPLACE FUNCTION freeholder_controlled_receipt_bank_observation(target_collection_uuid uuid,target_receipt_uuid uuid)
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
 -- Real namespace-locked admission sequence and authenticated closed history,
 -- never transaction-start timestamps or UUID tie breaking. Unknown/later
 -- unsequenced or unfinished/negative reads cannot revive an older bank state.
 SELECT * INTO inspection_row FROM merchant_cash_return_inspections inspection
  WHERE inspection.id=freeholder_controlled_cash_read_latest(receipt_row.id)
   AND inspection.provider_platform_account_id=namespace_platform AND inspection.charge_account_id IS NOT DISTINCT FROM namespace_account AND inspection.original_payment_ref=namespace_intent;
 IF NOT EXISTS(SELECT 1 FROM subscription_controlled_cash_inspection_lineages actual_lineage WHERE actual_lineage.inspection_id=inspection_row.id
  AND actual_lineage.resource_id=resource_row.id AND actual_lineage.receipt_id=receipt_row.id
  AND actual_lineage.caller_instance_id::text=inspection_row.caller->>'id'
  AND actual_lineage.admission_fingerprint=encode(sha256(convert_to(to_jsonb(inspection_row)::text,'UTF8')),'hex')) THEN RETURN;END IF;
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
  'actualAdmissionLineage',(SELECT to_jsonb(actual_lineage) FROM subscription_controlled_cash_inspection_lineages actual_lineage WHERE actual_lineage.inspection_id=inspection_row.id),
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
  UNION ALL SELECT 'subscription_controlled_cash_inspection_lineages',actual_lineage.inspection_id::text,encode(sha256(convert_to(to_jsonb(actual_lineage)::text,'UTF8')),'hex') FROM subscription_controlled_cash_inspection_lineages actual_lineage WHERE actual_lineage.inspection_id IN(SELECT id FROM namespace_inspections)
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
