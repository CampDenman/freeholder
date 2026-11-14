-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
-- C12.38: UNAPPLIED after exact fd123 current-bank proof; preserve old target/default domains.
CREATE OR REPLACE FUNCTION freeholder_controlled_atomic_refund_bank_state(target_payment uuid)
RETURNS TABLE(known boolean,payment_id uuid,receipt_id uuid,inspection_id uuid,observation_id uuid,refunded_minor float8,namespace_revision text,evidence_fingerprint text,physical_witness jsonb)
LANGUAGE plpgsql STABLE AS $$
DECLARE actual_payment payments%ROWTYPE;actual_route merchant_agreement_payment_routes%ROWTYPE;actual_receipt subscription_provider_charge_receipts%ROWTYPE;
 actual_link controlled_cash_application_links%ROWTYPE;actual_batch controlled_cash_application_batches%ROWTYPE;actual_origin subscription_controlled_charge_origins%ROWTYPE;
 bank_row record;actual_lineage subscription_controlled_cash_inspection_lineages%ROWTYPE;bank jsonb;atom jsonb;prior_lineage record;
 actual_request merchant_refund_requests%ROWTYPE;actual_refund refunds%ROWTYPE;observed merchant_refund_observations%ROWTYPE;captured merchant_refund_observation_captures%ROWTYPE;
 namespace_requests uuid[];namespace_observations uuid[];resource_refs text[]:=ARRAY[]::text[];returned numeric:=0;physical_count bigint;conflicting_physical boolean;
 original_context record;original_packet original_cash_recovery_facts%ROWTYPE;raw_feedback legacy_bank_feedback%ROWTYPE;header jsonb;covered_original text[]:=ARRAY[]::text[];covered_additions text[];finish_count bigint;last_finish_sequence integer;maximal_get record;maximal_state jsonb;progressive_state record;checked_field text;maximal_count integer:=0;
BEGIN
 SELECT p.* INTO actual_payment FROM payments p WHERE p.id=target_payment;
 SELECT r.* INTO actual_route FROM merchant_agreement_payment_routes r WHERE r.payment_id=target_payment;
 SELECT l.* INTO actual_link FROM controlled_cash_application_links l WHERE l.payment_id=target_payment;
 SELECT b.* INTO actual_batch FROM controlled_cash_application_batches b WHERE b.id=actual_link.batch_id;
 SELECT r.* INTO actual_receipt FROM subscription_provider_charge_receipts r WHERE r.id=actual_link.receipt_id;
 SELECT o.* INTO actual_origin FROM subscription_controlled_charge_origins o WHERE o.receipt_id=actual_receipt.id;
 IF actual_payment.id IS NULL OR actual_payment.status IS DISTINCT FROM 'succeeded' OR actual_payment.provider IS DISTINCT FROM 'stripe' OR actual_payment.method IS DISTINCT FROM 'provider_schedule'
  OR actual_route.original_charge_receipt_id IS DISTINCT FROM actual_receipt.id OR actual_batch.id IS NULL OR actual_origin.receipt_id IS NULL
  OR actual_batch.protocol NOT IN('controlled_net_gross.v1','controlled_cash_atomic.v1') OR actual_batch.admission_transaction_id=txid_current()::text
  OR actual_batch.invoice_id IS DISTINCT FROM actual_payment.invoice_id OR actual_batch.resource_id IS DISTINCT FROM actual_origin.resource_id
  OR actual_batch.subscription_id IS DISTINCT FROM actual_receipt.subscription_id OR actual_route.subscription_id IS DISTINCT FROM actual_receipt.subscription_id
  OR actual_route.provider_platform_account_id IS DISTINCT FROM actual_receipt.provider_platform_account_id OR actual_route.charge_account_id IS DISTINCT FROM actual_receipt.charge_account_id
  OR actual_payment.provider_ref IS DISTINCT FROM actual_receipt.provider_payment_intent_ref OR actual_payment.amount_minor IS DISTINCT FROM actual_receipt.amount_minor OR actual_payment.currency IS DISTINCT FROM actual_receipt.currency
  OR actual_payment.refunded_minor<0 OR actual_payment.refunded_minor>actual_payment.amount_minor THEN RETURN;END IF;
 IF NOT EXISTS(SELECT 1 FROM controlled_cash_application_batches b WHERE b.invoice_id=actual_payment.invoice_id AND b.protocol='controlled_cash_atomic.v1') THEN RETURN;END IF;
 SELECT current_bank.* INTO bank_row FROM freeholder_controlled_receipt_bank_observation(actual_batch.collection_id,actual_receipt.id) current_bank;
 IF bank_row.actual_inspection_id IS NULL OR bank_row.actual_observation_id IS NULL THEN RETURN;END IF;
 SELECT l.* INTO actual_lineage FROM subscription_controlled_cash_inspection_lineages l WHERE l.inspection_id=bank_row.actual_inspection_id;
 IF actual_lineage.receipt_id IS DISTINCT FROM actual_receipt.id OR actual_lineage.resource_id IS DISTINCT FROM actual_origin.resource_id THEN RETURN;END IF;
 bank:=bank_row.current_evidence;
 IF bank->>'paymentProviderRef' IS DISTINCT FROM actual_payment.provider_ref OR bank->>'providerChargeRef' IS DISTINCT FROM actual_receipt.provider_charge_ref
  OR bank->>'providerPlatformAccountId' IS DISTINCT FROM actual_receipt.provider_platform_account_id OR bank->>'chargeAccountId' IS DISTINCT FROM actual_receipt.charge_account_id
  OR bank->>'providerApiVersion' IS DISTINCT FROM actual_receipt.provider_api_version OR bank->>'currency' IS DISTINCT FROM actual_payment.currency
  OR bank->>'amountMinor' IS DISTINCT FROM actual_payment.amount_minor::text OR bank->>'chargePaymentProviderRef' IS DISTINCT FROM actual_payment.provider_ref
  OR bank->>'chargeAmountMinor' IS DISTINCT FROM actual_payment.amount_minor::text OR bank->>'chargeCurrency' IS DISTINCT FROM actual_payment.currency
  OR bank->>'paymentIntentStatus' IS DISTINCT FROM 'succeeded' OR bank->'paid' IS DISTINCT FROM 'true'::jsonb OR bank->'captured' IS DISTINCT FROM 'true'::jsonb
  OR bank->>'amountCapturableMinor' IS DISTINCT FROM '0' OR bank->>'amountRefundedMinor' IS DISTINCT FROM actual_payment.refunded_minor::text
  OR bank->'refunded' IS DISTINCT FROM to_jsonb(actual_payment.refunded_minor=actual_payment.amount_minor)
  OR bank->'refundsComplete' IS DISTINCT FROM 'true'::jsonb OR bank->'disputesComplete' IS DISTINCT FROM 'true'::jsonb
  OR jsonb_typeof(bank->'refunds') IS DISTINCT FROM 'array' OR jsonb_typeof(bank->'disputes') IS DISTINCT FROM 'array'
  OR jsonb_array_length(bank->'refunds')>1000 OR jsonb_array_length(bank->'disputes')>1000
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(bank->'disputes') disputed WHERE disputed->>'chargeRef' IS DISTINCT FROM actual_receipt.provider_charge_ref OR coalesce(disputed->>'status','') NOT IN('won','warning_closed'))
  OR(SELECT count(*) FROM jsonb_array_elements(bank->'disputes'))<>(SELECT count(DISTINCT disputed->>'providerRef') FROM jsonb_array_elements(bank->'disputes') disputed) THEN RETURN;END IF;
 SELECT coalesce(array_agg(r.id ORDER BY r.id),ARRAY[]::uuid[]) INTO namespace_requests FROM merchant_refund_requests r
  WHERE r.payment_id=actual_payment.id OR r.subscription_charge_receipt_id=actual_receipt.id
   OR(r.provider_platform_account_id=actual_receipt.provider_platform_account_id AND r.charge_account_id IS NOT DISTINCT FROM actual_receipt.charge_account_id AND r.original_payment_ref=actual_payment.provider_ref);
 IF cardinality(namespace_requests)>5000 THEN RETURN;END IF;
 IF EXISTS(SELECT 1 FROM subscription_controlled_calls c JOIN subscription_controlled_operations op ON op.id=c.operation_id
  LEFT JOIN subscription_controlled_finishes f ON f.call_id=c.id LEFT JOIN subscription_controlled_stops s ON s.call_id=c.id
  WHERE op.resource_id=actual_origin.resource_id AND((f.call_id IS NULL AND s.call_id IS NULL) OR(f.call_id IS NOT NULL AND s.call_id IS NOT NULL)))
  OR EXISTS(SELECT 1 FROM merchant_refund_state_reads r LEFT JOIN merchant_refund_state_read_finishes f ON f.read_id=r.id
   WHERE r.request_id=ANY(namespace_requests) AND(f.read_id IS NULL OR f.caller_instance_id::text IS DISTINCT FROM r.caller->>'id' OR f.outcome NOT IN('returned','threw')))
  OR EXISTS(SELECT 1 FROM merchant_refund_requests r WHERE r.id=ANY(namespace_requests) AND NOT freeholder_refund_current_creators_quiesced(r.id)) THEN RETURN;END IF;
 FOR atom IN SELECT value FROM jsonb_array_elements(bank->'refunds') LOOP
  IF coalesce(atom->>'providerRef','')!~'^(re|pyr)_[A-Za-z0-9_]+$' OR atom->>'providerRef'=ANY(resource_refs)
   OR atom->>'paymentProviderRef' IS DISTINCT FROM actual_payment.provider_ref OR atom->>'chargeRef' IS DISTINCT FROM actual_receipt.provider_charge_ref
   OR atom->>'currency' IS DISTINCT FROM actual_payment.currency OR NOT freeholder_controlled_bank_minor(atom->'amountMinor',true)
   OR coalesce(atom->>'status','') NOT IN('succeeded','failed','canceled') THEN RETURN;END IF;
  resource_refs:=array_append(resource_refs,atom->>'providerRef');
  SELECT r.* INTO actual_request FROM merchant_refund_requests r JOIN merchant_refund_resource_bindings binding ON binding.request_id=r.id
   WHERE r.id=ANY(namespace_requests) AND binding.provider_ref=atom->>'providerRef';
  IF actual_request.id IS NULL OR(SELECT count(DISTINCT r.id) FROM merchant_refund_requests r JOIN merchant_refund_resource_bindings binding ON binding.request_id=r.id
   WHERE r.id=ANY(namespace_requests) AND binding.provider_ref=atom->>'providerRef')<>1 THEN RETURN;END IF;
  SELECT r.* INTO actual_refund FROM refunds r WHERE r.id=actual_request.refund_id;
  IF actual_request.purpose IS DISTINCT FROM 'invoice_refund' OR actual_request.payment_id IS DISTINCT FROM actual_payment.id OR actual_request.subscription_charge_receipt_id IS NOT NULL
   OR actual_request.original_payment_ref IS DISTINCT FROM actual_payment.provider_ref OR actual_request.provider_platform_account_id IS DISTINCT FROM actual_receipt.provider_platform_account_id
   OR actual_request.charge_account_id IS DISTINCT FROM actual_receipt.charge_account_id OR actual_request.provider_api_version IS DISTINCT FROM actual_receipt.provider_api_version
   OR actual_request.amount_minor::text IS DISTINCT FROM atom->>'amountMinor' OR actual_request.currency IS DISTINCT FROM actual_payment.currency
   OR actual_refund.id IS NULL OR actual_refund.payment_id IS DISTINCT FROM actual_payment.id OR actual_refund.invoice_id IS DISTINCT FROM actual_payment.invoice_id
   OR actual_refund.provider_ref IS DISTINCT FROM atom->>'providerRef' OR actual_refund.amount_minor IS DISTINCT FROM actual_request.amount_minor
   OR actual_refund.currency IS DISTINCT FROM actual_payment.currency OR actual_refund.idempotency_key IS DISTINCT FROM actual_request.idempotency_key
   OR actual_refund.failure_code='provider_already_refunded'
   OR(atom->>'status'='succeeded' AND actual_refund.status IS DISTINCT FROM 'succeeded')
   OR(atom->>'status' IN('failed','canceled') AND actual_refund.status NOT IN('failed','cancelled'))
   OR EXISTS(SELECT 1 FROM merchant_refund_resource_bindings binding WHERE binding.request_id=actual_request.id AND binding.provider_ref<>atom->>'providerRef') THEN RETURN;END IF;
  IF atom->>'status'='succeeded' THEN returned:=returned+actual_refund.amount_minor;END IF;
 END LOOP;
 IF returned<>actual_payment.refunded_minor OR EXISTS(SELECT 1 FROM refunds r WHERE r.payment_id=actual_payment.id AND(r.provider_ref IS NULL OR NOT r.provider_ref=ANY(resource_refs)))
  OR EXISTS(SELECT 1 FROM merchant_refund_requests r WHERE r.id=ANY(namespace_requests) AND NOT EXISTS(
   SELECT 1 FROM merchant_refund_resource_bindings binding WHERE binding.request_id=r.id AND binding.provider_ref=ANY(resource_refs))) THEN RETURN;END IF;
 SELECT coalesce(array_agg(o.id ORDER BY o.id),ARRAY[]::uuid[]) INTO namespace_observations FROM merchant_refund_observations o
  WHERE o.payment_id=actual_payment.id OR o.subscription_charge_receipt_id=actual_receipt.id OR o.request_id=ANY(namespace_requests) OR o.claimed_request_id=ANY(namespace_requests)
   OR(o.provider_platform_account_id=actual_receipt.provider_platform_account_id AND o.charge_account_id IS NOT DISTINCT FROM actual_receipt.charge_account_id
    AND(o.payment_provider_ref=actual_payment.provider_ref OR o.provider_ref=ANY(resource_refs)));
 IF cardinality(namespace_observations)>5000 THEN RETURN;END IF;
 FOR observed IN SELECT o.* FROM merchant_refund_observations o WHERE o.id=ANY(namespace_observations) LOOP
  SELECT value INTO atom FROM jsonb_array_elements(bank->'refunds') WHERE value->>'providerRef'=observed.provider_ref;
  IF atom IS NULL OR observed.provider_platform_account_id IS DISTINCT FROM actual_receipt.provider_platform_account_id OR observed.charge_account_id IS DISTINCT FROM actual_receipt.charge_account_id
   OR observed.provider_api_version IS DISTINCT FROM actual_receipt.provider_api_version OR(observed.payment_provider_ref IS NOT NULL AND observed.payment_provider_ref<>actual_payment.provider_ref)
   OR(observed.provider_charge_ref IS NOT NULL AND observed.provider_charge_ref<>actual_receipt.provider_charge_ref)
   OR observed.amount_minor::text IS DISTINCT FROM atom->>'amountMinor' OR observed.currency IS DISTINCT FROM actual_payment.currency THEN RETURN;END IF;
  SELECT r.* INTO actual_request FROM merchant_refund_requests r JOIN merchant_refund_resource_bindings binding ON binding.request_id=r.id
   WHERE r.id=ANY(namespace_requests) AND binding.provider_ref=observed.provider_ref;
  IF observed.request_id IS NOT NULL AND observed.request_id<>actual_request.id AND NOT(NOT observed.binding_verified AND observed.claimed_request_id=observed.request_id) THEN RETURN;END IF;
  IF NOT EXISTS(SELECT 1 FROM merchant_refund_observation_captures c WHERE c.observation_id=observed.id) THEN RETURN;END IF;
  IF observed.status IS DISTINCT FROM atom->>'status' THEN
   -- ONLY an actually earlier closed lineaged read may supply a historical
   -- transition. A new detached capture against that old semantic ID refuses.
   FOR captured IN SELECT c.* FROM merchant_refund_observation_captures c WHERE c.observation_id=observed.id LOOP
    SELECT l.*,i.caller AS actual_caller,f.outcome,f.caller_instance_id AS actual_finish_caller INTO prior_lineage
     FROM subscription_controlled_cash_inspection_lineages l JOIN merchant_cash_return_inspections i ON i.id=l.inspection_id
     JOIN merchant_cash_return_inspection_finishes f ON f.inspection_id=i.id
     WHERE l.inspection_id=observed.inspection_id AND l.receipt_id=actual_receipt.id AND l.resource_id=actual_origin.resource_id
      AND l.namespace_key=actual_lineage.namespace_key AND l.admission_sequence<actual_lineage.admission_sequence
      AND actual_lineage.closed_inspection_ids ? l.inspection_id::text
      AND l.admission_fingerprint=encode(sha256(convert_to(to_jsonb(i)::text,'UTF8')),'hex')
      AND NOT EXISTS(SELECT 1 FROM merchant_cash_return_inspection_stops s WHERE s.inspection_id=i.id);
    IF prior_lineage.inspection_id IS NULL OR prior_lineage.outcome IS DISTINCT FROM 'returned'
     OR prior_lineage.actual_finish_caller::text IS DISTINCT FROM prior_lineage.actual_caller->>'id'
     OR prior_lineage.caller_instance_id IS DISTINCT FROM prior_lineage.actual_finish_caller THEN RETURN;END IF;
   END LOOP;
  END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM merchant_refund_requests r WHERE r.id=ANY(namespace_requests) AND NOT EXISTS(
  SELECT 1 FROM merchant_refund_observations o WHERE o.id=ANY(namespace_observations) AND o.request_id=r.id AND o.binding_verified
   AND o.provider_ref=ANY(resource_refs))) THEN RETURN;END IF;
 -- A complete signed original-v2 preimage containing the selected immutable
 -- lineage UUID is a causal AFTER edge. This is not PGhash=JSdigest equality.
 FOR original_context IN SELECT o.*,parent_owner.namespace_key AS original_namespace,parent_owner.owner AS original_owner
  FROM original_cash_recovery_operations o JOIN original_cash_recoveries parent_owner ON parent_owner.id=o.recovery_id
  WHERE parent_owner.owner->'cash'->>'providerPlatformAccountId'=actual_receipt.provider_platform_account_id
   AND parent_owner.owner->'cash'->>'chargeAccountId' IS NOT DISTINCT FROM actual_receipt.charge_account_id
   AND parent_owner.owner->'cash'->>'providerRef'=actual_payment.provider_ref AND o.kind='inspection' AND NOT o.request ? 'auxiliaryOperationId' LOOP
  header:=original_context.request->'inventoryComparison';
  IF header IS NULL THEN CONTINUE;END IF;
  IF jsonb_typeof(header) IS DISTINCT FROM 'object' OR header->>'protocol' IS DISTINCT FROM 'freeholder.original-cash-inventory-causal.v2'
   OR header->>'recoveryId' IS DISTINCT FROM original_context.recovery_id::text OR header->>'operationId' IS DISTINCT FROM original_context.id::text
   OR header->>'namespaceKey' IS DISTINCT FROM original_context.original_namespace OR header->>'callerId' IS DISTINCT FROM original_context.caller->>'id'
   OR header->>'nonceHash' IS DISTINCT FROM original_context.nonce_hash OR header->>'sourceRevision' IS DISTINCT FROM original_context.request->>'sourceRevision'
   OR jsonb_typeof(header->'preimageEntries') IS DISTINCT FROM 'array' OR jsonb_array_length(header->'preimageEntries')>5000 THEN RETURN;END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(header->'preimageEntries') preimage WHERE jsonb_typeof(preimage) IS DISTINCT FROM 'object'
   OR coalesce(preimage->>'table','')!~'^[a-z_][a-z0-9_.]*$' OR coalesce(preimage->>'id','')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   OR jsonb_typeof(preimage->'fingerprints') IS DISTINCT FROM 'object') THEN RETURN;END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(header->'preimageEntries') preimage WHERE NOT EXISTS(SELECT 1 FROM jsonb_each_text(preimage->'fingerprints'))
   OR EXISTS(SELECT 1 FROM jsonb_each_text(preimage->'fingerprints') fields WHERE fields.key NOT IN('postgres_row','history_canonical','dependency_canonical') OR coalesce(fields.value,'')!~'^[a-f0-9]{64}$'))
   OR(SELECT count(*) FROM jsonb_array_elements(header->'preimageEntries'))<>(SELECT count(DISTINCT (e->>'table',e->>'id')) FROM jsonb_array_elements(header->'preimageEntries') e) THEN RETURN;END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(header->'preimageEntries') preimage WHERE preimage->>'table'='subscription_controlled_cash_inspection_lineages'
   AND preimage->>'id'=actual_lineage.inspection_id::text) THEN RETURN;END IF;
  SELECT coalesce(array_agg(preimage->>'table'||':'||(preimage->>'id')),ARRAY[]::text[]) INTO covered_additions FROM jsonb_array_elements(header->'preimageEntries') preimage;
  covered_original:=covered_original||covered_additions;
  SELECT count(*) FILTER(WHERE f.kind='finish'),max(f.sequence) FILTER(WHERE f.kind='finish') INTO finish_count,last_finish_sequence
   FROM original_cash_recovery_facts f WHERE f.operation_id=original_context.id;
  IF finish_count<>1 OR EXISTS(SELECT 1 FROM original_cash_recovery_facts f WHERE f.operation_id=original_context.id
   AND(f.kind='stop' OR f.sequence>last_finish_sequence OR(f.kind='finish' AND(f.evidence->>'callerInstanceId' IS DISTINCT FROM original_context.caller->>'id'
    OR coalesce(f.evidence->>'outcome','') NOT IN('returned','threw'))))) THEN RETURN;END IF;
  covered_original:=array_append(covered_original,'original_cash_recovery_operations:'||original_context.id::text);
  SELECT coalesce(array_agg('original_cash_recovery_facts:'||f.id::text),ARRAY[]::text[]) INTO covered_additions FROM original_cash_recovery_facts f WHERE f.operation_id=original_context.id;
  covered_original:=covered_original||covered_additions;
  SELECT ARRAY(SELECT DISTINCT actual_keys.actual_key FROM unnest(covered_original) actual_keys(actual_key) ORDER BY actual_keys.actual_key LIMIT 5001) INTO covered_original;
  IF cardinality(covered_original)>5000 THEN RETURN;END IF;
 END LOOP;
 -- Each causally MAXIMAL original-v2 GET must actually agree with this bank
 -- state. Older packets covered by a later complete signed preimage remain
 -- history; absence of a selected-lineage UUID is not enough to hide a race.
 FOR maximal_get IN SELECT o.* FROM original_cash_recovery_operations o JOIN original_cash_recoveries parent_owner ON parent_owner.id=o.recovery_id
  WHERE parent_owner.owner->'cash'->>'providerPlatformAccountId'=actual_receipt.provider_platform_account_id
   AND parent_owner.owner->'cash'->>'chargeAccountId' IS NOT DISTINCT FROM actual_receipt.charge_account_id AND parent_owner.owner->'cash'->>'providerRef'=actual_payment.provider_ref
   AND o.kind='inspection' AND NOT o.request ? 'auxiliaryOperationId' AND o.request->'inventoryComparison'->>'protocol'='freeholder.original-cash-inventory-causal.v2' LOOP
  IF EXISTS(SELECT 1 FROM original_cash_recovery_operations later_get WHERE later_get.recovery_id=maximal_get.recovery_id AND later_get.id<>maximal_get.id
   AND later_get.kind='inspection' AND NOT later_get.request ? 'auxiliaryOperationId'
   AND later_get.request->'inventoryComparison'->>'protocol'='freeholder.original-cash-inventory-causal.v2'
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(later_get.request->'inventoryComparison'->'preimageEntries') e WHERE e->>'table'='original_cash_recovery_operations' AND e->>'id'=maximal_get.id::text)
   AND NOT EXISTS(SELECT 1 FROM original_cash_recovery_facts predecessor_fact WHERE predecessor_fact.operation_id=maximal_get.id AND NOT EXISTS(
    SELECT 1 FROM jsonb_array_elements(later_get.request->'inventoryComparison'->'preimageEntries') e WHERE e->>'table'='original_cash_recovery_facts' AND e->>'id'=predecessor_fact.id::text))) THEN CONTINUE;END IF;
  maximal_count:=maximal_count+1;
  SELECT f.evidence INTO maximal_state FROM original_cash_recovery_facts f WHERE f.operation_id=maximal_get.id AND f.kind='state' ORDER BY f.sequence DESC LIMIT 1;
  IF maximal_state IS NULL OR maximal_state IS DISTINCT FROM bank OR maximal_state->'refundsComplete' IS DISTINCT FROM 'true'::jsonb OR maximal_state->'disputesComplete' IS DISTINCT FROM 'true'::jsonb
   OR NOT EXISTS(SELECT 1 FROM original_cash_recovery_facts f WHERE f.operation_id=maximal_get.id AND f.kind='finish' AND f.evidence->>'outcome'='returned' AND f.evidence->>'callerInstanceId'=maximal_get.caller->>'id') THEN RETURN;END IF;
  FOR progressive_state IN SELECT f.evidence FROM original_cash_recovery_facts f WHERE f.operation_id=maximal_get.id AND f.kind='state' LOOP
   IF progressive_state.evidence->>'paymentIntentStatus' IS DISTINCT FROM bank->>'paymentIntentStatus'
    OR jsonb_typeof(progressive_state.evidence->'refunds') IS DISTINCT FROM 'array' OR jsonb_typeof(progressive_state.evidence->'disputes') IS DISTINCT FROM 'array' THEN RETURN;END IF;
   FOREACH checked_field IN ARRAY ARRAY['amountCapturableMinor','chargePaymentProviderRef','chargeAmountMinor','chargeCurrency','paid','captured','refunded','amountRefundedMinor'] LOOP
    IF progressive_state.evidence->checked_field IS DISTINCT FROM 'null'::jsonb AND progressive_state.evidence->checked_field IS DISTINCT FROM bank->checked_field THEN RETURN;END IF;
   END LOOP;
   IF(progressive_state.evidence->'fee' IS DISTINCT FROM 'null'::jsonb AND(progressive_state.evidence->'fee' IS DISTINCT FROM bank->'fee' OR bank->'feeFieldObserved' IS DISTINCT FROM 'true'::jsonb))
    OR(progressive_state.evidence->'fee'='null'::jsonb AND progressive_state.evidence->'feeFieldObserved'='true'::jsonb AND(bank->'feeFieldObserved' IS DISTINCT FROM 'true'::jsonb OR bank->'fee' IS DISTINCT FROM 'null'::jsonb))
    OR(progressive_state.evidence->'transfer' IS DISTINCT FROM 'null'::jsonb AND(progressive_state.evidence->'transfer' IS DISTINCT FROM bank->'transfer' OR bank->'transferFieldObserved' IS DISTINCT FROM 'true'::jsonb))
    OR(progressive_state.evidence->'transfer'='null'::jsonb AND progressive_state.evidence->'transferFieldObserved'='true'::jsonb AND(bank->'transferFieldObserved' IS DISTINCT FROM 'true'::jsonb OR bank->'transfer' IS DISTINCT FROM 'null'::jsonb))
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(progressive_state.evidence->'refunds') prior_refund WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(bank->'refunds') actual_refund WHERE actual_refund=prior_refund))
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(progressive_state.evidence->'disputes') prior_dispute WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(bank->'disputes') actual_dispute WHERE actual_dispute=prior_dispute))
    OR(progressive_state.evidence->'refundsComplete'='true'::jsonb AND jsonb_array_length(progressive_state.evidence->'refunds')<>jsonb_array_length(bank->'refunds'))
    OR(progressive_state.evidence->'disputesComplete'='true'::jsonb AND jsonb_array_length(progressive_state.evidence->'disputes')<>jsonb_array_length(bank->'disputes'))
    OR(SELECT count(*) FROM jsonb_array_elements(progressive_state.evidence->'refunds'))<>(SELECT count(DISTINCT e->>'providerRef') FROM jsonb_array_elements(progressive_state.evidence->'refunds') e)
    OR(SELECT count(*) FROM jsonb_array_elements(progressive_state.evidence->'disputes'))<>(SELECT count(DISTINCT e->>'providerRef') FROM jsonb_array_elements(progressive_state.evidence->'disputes') e) THEN RETURN;END IF;
  END LOOP;
 END LOOP;
 IF maximal_count=0 AND EXISTS(SELECT 1 FROM original_cash_recovery_operations o JOIN original_cash_recoveries parent_owner ON parent_owner.id=o.recovery_id
  WHERE parent_owner.owner->'cash'->>'providerPlatformAccountId'=actual_receipt.provider_platform_account_id AND parent_owner.owner->'cash'->>'chargeAccountId' IS NOT DISTINCT FROM actual_receipt.charge_account_id
   AND parent_owner.owner->'cash'->>'providerRef'=actual_payment.provider_ref AND o.kind='inspection' AND NOT o.request ? 'auxiliaryOperationId'
   AND o.request->'inventoryComparison'->>'protocol'='freeholder.original-cash-inventory-causal.v2') THEN RETURN;END IF;
 IF EXISTS(SELECT 1 FROM original_cash_recovery_operations o JOIN original_cash_recoveries parent_owner ON parent_owner.id=o.recovery_id
  WHERE parent_owner.owner->'cash'->>'providerPlatformAccountId'=actual_receipt.provider_platform_account_id
   AND parent_owner.owner->'cash'->>'chargeAccountId' IS NOT DISTINCT FROM actual_receipt.charge_account_id AND parent_owner.owner->'cash'->>'providerRef'=actual_payment.provider_ref
   AND NOT ('original_cash_recovery_operations:'||o.id::text)=ANY(covered_original)) THEN RETURN;END IF;
 FOR original_packet IN SELECT f.* FROM original_cash_recovery_facts f JOIN original_cash_recoveries parent_owner ON parent_owner.id=f.recovery_id
  WHERE parent_owner.owner->'cash'->>'providerPlatformAccountId'=actual_receipt.provider_platform_account_id
   AND parent_owner.owner->'cash'->>'chargeAccountId' IS NOT DISTINCT FROM actual_receipt.charge_account_id AND parent_owner.owner->'cash'->>'providerRef'=actual_payment.provider_ref LOOP
  IF original_packet.operation_id IS NOT NULL AND NOT ('original_cash_recovery_facts:'||original_packet.id::text)=ANY(covered_original) THEN RETURN;END IF;
  IF original_packet.kind IN('primary','state','refund') AND original_packet.operation_id IS NULL THEN RETURN;END IF;
  IF original_packet.kind='primary' AND(original_packet.evidence->>'providerRef' IS DISTINCT FROM actual_payment.provider_ref
   OR original_packet.evidence->>'providerPlatformAccountId' IS DISTINCT FROM actual_receipt.provider_platform_account_id
   OR original_packet.evidence->>'providerAccountId' IS DISTINCT FROM actual_receipt.charge_account_id
   OR original_packet.evidence->>'providerApiVersion' IS DISTINCT FROM actual_receipt.provider_api_version
   OR original_packet.evidence->>'amountMinor' IS DISTINCT FROM actual_payment.amount_minor::text OR original_packet.evidence->>'currency' IS DISTINCT FROM actual_payment.currency) THEN RETURN;END IF;
  IF original_packet.kind='state' AND(original_packet.evidence->>'paymentProviderRef' IS DISTINCT FROM actual_payment.provider_ref
   OR original_packet.evidence->>'providerPlatformAccountId' IS DISTINCT FROM actual_receipt.provider_platform_account_id
   OR original_packet.evidence->>'chargeAccountId' IS DISTINCT FROM actual_receipt.charge_account_id OR original_packet.evidence->>'providerChargeRef' IS DISTINCT FROM actual_receipt.provider_charge_ref
   OR original_packet.evidence->>'providerApiVersion' IS DISTINCT FROM actual_receipt.provider_api_version
   OR original_packet.evidence->>'amountMinor' IS DISTINCT FROM actual_payment.amount_minor::text OR original_packet.evidence->>'currency' IS DISTINCT FROM actual_payment.currency) THEN RETURN;END IF;
  IF original_packet.kind='refund' THEN
   SELECT value INTO atom FROM jsonb_array_elements(bank->'refunds') WHERE value->>'providerRef'=original_packet.evidence->>'providerRef';
   IF atom IS NULL OR original_packet.evidence->>'providerPlatformAccountId' IS DISTINCT FROM actual_receipt.provider_platform_account_id
    OR original_packet.evidence->>'providerAccountId' IS DISTINCT FROM actual_receipt.charge_account_id
    OR(original_packet.evidence->>'paymentProviderRef' IS NOT NULL AND original_packet.evidence->>'paymentProviderRef'<>actual_payment.provider_ref)
    OR(original_packet.evidence->>'providerChargeRef' IS NOT NULL AND original_packet.evidence->>'providerChargeRef'<>actual_receipt.provider_charge_ref)
    OR original_packet.evidence->>'amountMinor' IS DISTINCT FROM atom->>'amountMinor' OR original_packet.evidence->>'currency' IS DISTINCT FROM actual_payment.currency THEN RETURN;END IF;
  END IF;
 END LOOP;
 -- Raw ingress remains a distinct occurrence. Identity plus equal amount
 -- cannot erase a new contradictory/unknown status after a selected bank GET.
 FOR raw_feedback IN SELECT feedback.* FROM legacy_bank_feedback feedback WHERE feedback.id::text IN(
  SELECT witness->>'id' FROM jsonb_array_elements(bank_row.bank_witness) witness WHERE witness->>'table'='legacy_bank_feedback') LOOP
  SELECT value INTO atom FROM jsonb_array_elements(bank->'refunds') WHERE value->>'providerRef'=raw_feedback.evidence->>'observedRefundRef';
  IF atom IS NULL OR raw_feedback.evidence->>'observedChargeAccountId' IS DISTINCT FROM actual_receipt.charge_account_id
   OR(raw_feedback.evidence->>'observedPlatformAccountId' IS NOT NULL AND raw_feedback.evidence->>'observedPlatformAccountId'<>actual_receipt.provider_platform_account_id)
   OR(raw_feedback.evidence->>'observedPaymentRef' IS NOT NULL AND raw_feedback.evidence->>'observedPaymentRef'<>actual_payment.provider_ref)
   OR(raw_feedback.evidence->>'observedChargeRef' IS NOT NULL AND raw_feedback.evidence->>'observedChargeRef'<>actual_receipt.provider_charge_ref)
   OR(raw_feedback.evidence->>'amountMinor' IS NOT NULL AND raw_feedback.evidence->>'amountMinor'<>atom->>'amountMinor')
   OR(raw_feedback.evidence->>'currency' IS NOT NULL AND raw_feedback.evidence->>'currency'<>actual_payment.currency)
   OR raw_feedback.evidence->>'status' IS DISTINCT FROM atom->>'status' THEN RETURN;END IF;
 END LOOP;
 WITH actual_rows AS(
  SELECT e->>'table' family,e->>'id' identity,e->>'fingerprint' fingerprint FROM jsonb_array_elements(bank_row.bank_witness) e
  UNION ALL SELECT 'refunds',r.id::text,encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') FROM refunds r WHERE r.payment_id=actual_payment.id
  UNION ALL SELECT 'merchant_refund_requests',r.id::text,encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') FROM merchant_refund_requests r WHERE r.id=ANY(namespace_requests)
  UNION ALL SELECT 'merchant_refund_resource_bindings',r.id::text,encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') FROM merchant_refund_resource_bindings r WHERE r.request_id=ANY(namespace_requests)
  UNION ALL SELECT 'merchant_refund_observations',r.id::text,encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') FROM merchant_refund_observations r WHERE r.id=ANY(namespace_observations)
  UNION ALL SELECT 'merchant_refund_observation_captures',r.id::text,encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') FROM merchant_refund_observation_captures r WHERE r.observation_id=ANY(namespace_observations)
  UNION ALL SELECT 'merchant_refund_state_reads',r.id::text,encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') FROM merchant_refund_state_reads r WHERE r.request_id=ANY(namespace_requests)
  UNION ALL SELECT 'merchant_refund_state_read_finishes',r.read_id::text,encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') FROM merchant_refund_state_read_finishes r JOIN merchant_refund_state_reads parent_read ON parent_read.id=r.read_id WHERE parent_read.request_id=ANY(namespace_requests)
  UNION ALL SELECT 'merchant_refund_current_receipts',r.id::text,encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') FROM merchant_refund_current_receipts r WHERE r.request_id=ANY(namespace_requests)
  UNION ALL SELECT 'merchant_fee_refund_invocations',r.id::text,encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') FROM merchant_fee_refund_invocations r WHERE r.payment_id=actual_payment.id
 ),physical AS(SELECT family,identity,min(fingerprint) fingerprint FROM actual_rows GROUP BY family,identity),bounded AS(SELECT * FROM physical ORDER BY family,identity LIMIT 5001)
 SELECT count(*),jsonb_agg(jsonb_build_object('table',family,'id',identity,'fingerprint',fingerprint) ORDER BY family,identity),
  encode(sha256(convert_to(string_agg(family||':'||identity||':'||fingerprint,E'\n' ORDER BY family,identity),'UTF8')),'hex'),
  EXISTS(SELECT 1 FROM actual_rows GROUP BY family,identity HAVING count(DISTINCT fingerprint)<>1) INTO physical_count,physical_witness,evidence_fingerprint,conflicting_physical FROM bounded;
 IF physical_count>5000 OR physical_count=0 OR conflicting_physical THEN RETURN;END IF;
 known:=true;payment_id:=actual_payment.id;receipt_id:=actual_receipt.id;inspection_id:=bank_row.actual_inspection_id;observation_id:=bank_row.actual_observation_id;
 refunded_minor:=actual_payment.refunded_minor;namespace_revision:=bank_row.bank_fingerprint;RETURN NEXT;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION freeholder_atomic_auxiliary_fee_ready() RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT coalesce(
  EXISTS(SELECT 1 FROM pg_proc installed WHERE installed.oid=to_regprocedure('freeholder_atomic_fee_return_resources(uuid)') AND encode(sha256(convert_to(installed.prosrc,'UTF8')),'hex')='91fd305274ea123483945235f43f2bfc5cf18207eb7701f590f056c08cebdb4f')
  AND EXISTS(SELECT 1 FROM pg_proc installed WHERE installed.oid=to_regprocedure('freeholder_controlled_atomic_refund_bank_state(uuid)') AND installed.provolatile='s' AND encode(sha256(convert_to(installed.prosrc,'UTF8')),'hex')='c793259d4dd2949f650d6ae9bfaebb562816f27faedc356640f9436fcf2ccc8d')
  AND EXISTS(SELECT 1 FROM pg_proc installed WHERE installed.oid=to_regprocedure('freeholder_atomic_auxiliary_fee_target_valid(jsonb)') AND encode(sha256(convert_to(installed.prosrc,'UTF8')),'hex')='9c00662eaf2303b5eb83c03cf7101fb827caaddeb3966bc0eef2e0776af70828')
  AND EXISTS(SELECT 1 FROM pg_proc installed WHERE installed.oid=to_regprocedure('freeholder_atomic_auxiliary_fee_operation_valid(jsonb)') AND encode(sha256(convert_to(installed.prosrc,'UTF8')),'hex')='4fef21d307faa1396cbca7865ddbb868d80005a9779c208563379493cd3bbf8b')
  AND EXISTS(SELECT 1 FROM pg_proc installed WHERE installed.oid=to_regprocedure('freeholder_atomic_auxiliary_fee_closure_valid(jsonb)') AND encode(sha256(convert_to(installed.prosrc,'UTF8')),'hex')='10ed65903fc91e3d149cd073a70fe362ef1403269f6a4c0744a983cf3b643394')
  AND EXISTS(SELECT 1 FROM pg_proc installed WHERE installed.oid=to_regprocedure('freeholder_guard_original_cash_recovery()') AND encode(sha256(convert_to(installed.prosrc,'UTF8')),'hex')='1971de37dfc39be8ca4178ee86c9684e699c92e875b1de35f5d4d4b3d83758fc')
  AND EXISTS(SELECT 1 FROM pg_proc installed WHERE installed.oid=to_regprocedure('freeholder_controlled_atomic_refund_targets(uuid)') AND encode(sha256(convert_to(installed.prosrc,'UTF8')),'hex')='da88bad09a1b87c8abc12856586fe9e1debfe0b72e192e46971677f4fad92eeb')
  AND EXISTS(SELECT 1 FROM pg_proc installed WHERE installed.oid=to_regprocedure('freeholder_controlled_atomic_refund_fee_state(uuid)') AND encode(sha256(convert_to(installed.prosrc,'UTF8')),'hex')='7564bec682b47fba4517097002e7c1e92da6aca21f4a7c678ddb080da08a4f3d')
  AND EXISTS(SELECT 1 FROM pg_proc installed WHERE installed.oid=to_regprocedure('freeholder_merchant_fee_invocations_ready()') AND encode(sha256(convert_to(installed.prosrc,'UTF8')),'hex')='98a0b6c71aafd07c27bb3b7b198040041ba80e80ab3161e09497041cbc5da047')
  AND freeholder_merchant_fee_invocations_ready()
  AND (SELECT count(*) FROM pg_trigger installed WHERE installed.tgname='original_cash_recovery_guard' AND installed.tgrelid IN('original_cash_recoveries'::regclass,'original_cash_recovery_operations'::regclass,'original_cash_recovery_facts'::regclass,'original_cash_recovery_closures'::regclass) AND installed.tgfoid=to_regprocedure('freeholder_guard_original_cash_recovery()') AND installed.tgtype=31 AND installed.tgenabled IN('O','A') AND NOT installed.tgisinternal)=4
  AND EXISTS(SELECT 1 FROM pg_constraint installed WHERE installed.conrelid='original_cash_recovery_facts'::regclass AND installed.conname='original_cash_recovery_facts_kind' AND installed.contype='c' AND installed.convalidated AND pg_get_expr(installed.conbin,installed.conrelid)='(kind = ANY (ARRAY[''primary''::text, ''refund''::text, ''state''::text, ''parent''::text, ''ack''::text, ''resource''::text, ''finish''::text, ''stop''::text, ''legacy_fee_stop''::text, ''customer_request''::text, ''partial_target''::text, ''partial_closure''::text, ''unassigned_refund_review''::text, ''atomic_fee_target''::text, ''atomic_fee_closure''::text]))')
  AND EXISTS(SELECT 1 FROM pg_index installed JOIN pg_class idx ON idx.oid=installed.indexrelid WHERE installed.indrelid='original_cash_recovery_facts'::regclass AND idx.relname='original_cash_atomic_fee_target' AND installed.indisunique AND installed.indisvalid AND installed.indisready AND installed.indkey::text='2 0' AND pg_get_expr(installed.indexprs,installed.indrelid)='(evidence ->> ''targetKey''::text)' AND pg_get_expr(installed.indpred,installed.indrelid)='(kind = ''atomic_fee_target''::text)')
  AND EXISTS(SELECT 1 FROM pg_index installed JOIN pg_class idx ON idx.oid=installed.indexrelid WHERE installed.indrelid='original_cash_recovery_facts'::regclass AND idx.relname='original_cash_atomic_fee_closure' AND installed.indisunique AND installed.indisvalid AND installed.indisready AND installed.indkey::text='2 0 0' AND pg_get_expr(installed.indexprs,installed.indrelid)='(evidence ->> ''targetFactId''::text), (evidence ->> ''revision''::text)' AND pg_get_expr(installed.indpred,installed.indrelid)='(kind = ''atomic_fee_closure''::text)'),false);
$$;
