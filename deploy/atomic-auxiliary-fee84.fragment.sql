-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
-- C12.38/C9.33: UNAPPLIED after both exact signed160 tails. No new table.
-- Full/partial customer-return protocols and old payment-only dispatch remain.
ALTER TABLE original_cash_recovery_facts DROP CONSTRAINT original_cash_recovery_facts_kind;
--> statement-breakpoint
ALTER TABLE original_cash_recovery_facts ADD CONSTRAINT original_cash_recovery_facts_kind CHECK(kind IN('primary','refund','state','parent','ack','resource','finish','stop','legacy_fee_stop','customer_request','partial_target','partial_closure','unassigned_refund_review','atomic_fee_target','atomic_fee_closure'));
--> statement-breakpoint
CREATE UNIQUE INDEX original_cash_atomic_fee_target ON original_cash_recovery_facts(recovery_id,(evidence->>'targetKey')) WHERE kind='atomic_fee_target';
--> statement-breakpoint
CREATE UNIQUE INDEX original_cash_atomic_fee_closure ON original_cash_recovery_facts(recovery_id,(evidence->>'targetFactId'),(evidence->>'revision')) WHERE kind='atomic_fee_closure';
--> statement-breakpoint
CREATE FUNCTION freeholder_atomic_fee_return_resources(target_payment uuid)
RETURNS TABLE(known boolean,pending boolean,ledger text,payment_id uuid,receipt_id uuid,operation_id uuid,provider_ref text,application_fee_ref text,amount_minor bigint,currency text,evidence_fingerprint text)
LANGUAGE plpgsql STABLE AS $$
DECLARE parent_row payments%ROWTYPE;route_row merchant_agreement_payment_routes%ROWTYPE;receipt_row subscription_provider_charge_receipts%ROWTYPE;
 original_fee text;fee_record record;auxiliary record;observation record;observer original_cash_recovery_operations%ROWTYPE;
 observer_finish original_cash_recovery_facts%ROWTYPE;actual_rows jsonb:='[]'::jsonb;pending_calls boolean:=false;
 row_count bigint;resource_count bigint;actual_returned numeric;conflicting boolean;entries jsonb;
BEGIN
 SELECT * INTO parent_row FROM payments WHERE id=target_payment;
 SELECT * INTO route_row FROM merchant_agreement_payment_routes WHERE payment_id=target_payment;
 SELECT * INTO receipt_row FROM subscription_provider_charge_receipts WHERE id=route_row.original_charge_receipt_id;
 SELECT coalesce(receipt_row.application_fee_ref,initial_bank.evidence->'fee'->>'providerRef') INTO original_fee
  FROM controlled_cash_application_links actual_link JOIN controlled_cash_application_receipts initial_proof ON initial_proof.id=actual_link.receipt_proof_id
  JOIN merchant_cash_return_observations initial_bank ON initial_bank.id=initial_proof.bank_observation_id
  WHERE actual_link.payment_id=target_payment AND actual_link.receipt_id=receipt_row.id;
 payment_id:=target_payment;receipt_id:=receipt_row.id;application_fee_ref:=original_fee;currency:=parent_row.currency;ledger:='inventory';amount_minor:=0;known:=false;pending:=true;
 IF parent_row.id IS NULL OR receipt_row.id IS NULL OR parent_row.status<>'succeeded' OR route_row.provider_platform_account_id<>receipt_row.provider_platform_account_id
  OR route_row.charge_account_id IS DISTINCT FROM receipt_row.charge_account_id OR parent_row.provider_ref IS DISTINCT FROM receipt_row.provider_payment_intent_ref
  OR receipt_row.currency<>parent_row.currency OR(route_row.application_fee_minor>0 AND original_fee IS NULL) THEN RETURN NEXT;RETURN;END IF;
 SELECT (SELECT count(*) FROM merchant_fee_refunds fee WHERE fee.payment_id=target_payment)
  +(SELECT count(*) FROM merchant_fee_observations ack JOIN merchant_fee_refunds fee ON fee.id=ack.operation_id WHERE fee.payment_id=target_payment)
  +(SELECT count(*) FROM merchant_fee_refund_invocations invocation WHERE invocation.payment_id=target_payment)
  +(SELECT count(*) FROM original_cash_recoveries recovery WHERE recovery.payment_id=target_payment OR recovery.subscription_charge_receipt_id=receipt_row.id)
  +(SELECT count(*) FROM original_cash_recovery_operations operation JOIN original_cash_recoveries recovery ON recovery.id=operation.recovery_id WHERE recovery.payment_id=target_payment OR recovery.subscription_charge_receipt_id=receipt_row.id)
  +(SELECT count(*) FROM original_cash_recovery_facts fact JOIN original_cash_recoveries recovery ON recovery.id=fact.recovery_id WHERE recovery.payment_id=target_payment OR recovery.subscription_charge_receipt_id=receipt_row.id) INTO row_count;
 IF row_count>5000 OR EXISTS(SELECT 1 FROM original_cash_recoveries recovery WHERE(recovery.payment_id=target_payment OR recovery.subscription_charge_receipt_id=receipt_row.id) AND(
  recovery.owner->'cash'->>'providerRef' IS DISTINCT FROM receipt_row.provider_payment_intent_ref OR recovery.owner->'cash'->>'providerPlatformAccountId' IS DISTINCT FROM receipt_row.provider_platform_account_id
  OR recovery.owner->'cash'->>'chargeAccountId' IS DISTINCT FROM receipt_row.charge_account_id))
  OR(SELECT count(*) FROM original_cash_recoveries recovery WHERE recovery.payment_id=target_payment OR recovery.subscription_charge_receipt_id=receipt_row.id)>1 THEN RETURN NEXT;RETURN;END IF;
 pending_calls:=EXISTS(SELECT 1 FROM merchant_fee_refunds fee WHERE fee.payment_id=target_payment AND fee.status IN('reserved','dispatching','unknown'))
  OR EXISTS(SELECT 1 FROM merchant_fee_refund_invocations invocation WHERE invocation.payment_id=target_payment AND invocation.finish IS NULL AND invocation.stop IS NULL)
  OR EXISTS(SELECT 1 FROM original_cash_recovery_operations operation JOIN original_cash_recoveries recovery ON recovery.id=operation.recovery_id
   WHERE(recovery.payment_id=target_payment OR recovery.subscription_charge_receipt_id=receipt_row.id) AND NOT EXISTS(SELECT 1 FROM original_cash_recovery_facts terminal WHERE terminal.operation_id=operation.id
    AND(terminal.kind='finish' AND terminal.evidence->>'callerInstanceId'=operation.caller->>'id' OR terminal.kind='stop' AND terminal.evidence->>'operationDigest'=operation.digest)));
 FOR fee_record IN SELECT fee.* FROM merchant_fee_refunds fee WHERE fee.payment_id=target_payment ORDER BY fee.id LOOP
  IF fee_record.status<>'accepted' THEN
   IF EXISTS(SELECT 1 FROM merchant_fee_observations ack WHERE ack.operation_id=fee_record.id) THEN RETURN NEXT;RETURN;END IF;
   CONTINUE;
  END IF;
  IF fee_record.provider_ref IS NULL OR fee_record.application_fee_ref IS DISTINCT FROM original_fee OR fee_record.provider_charge_ref IS DISTINCT FROM receipt_row.provider_charge_ref
   OR fee_record.original_charge_receipt_id IS DISTINCT FROM receipt_row.id OR fee_record.provider_platform_account_id<>receipt_row.provider_platform_account_id OR fee_record.currency<>parent_row.currency
   OR NOT freeholder_merchant_fee_result_owned(fee_record.id,fee_record.provider_ref)
   OR NOT EXISTS(SELECT 1 FROM merchant_fee_observations ack WHERE ack.operation_id=fee_record.id)
   OR EXISTS(SELECT 1 FROM merchant_fee_observations ack WHERE ack.operation_id=fee_record.id AND(NOT ack.binding_verified OR ack.provider_ref IS DISTINCT FROM fee_record.provider_ref
    OR ack.application_fee_ref IS DISTINCT FROM original_fee OR ack.amount_minor<>fee_record.amount_minor OR ack.currency<>fee_record.currency)) THEN RETURN NEXT;RETURN;END IF;
  actual_rows:=actual_rows||jsonb_build_array(jsonb_build_object('ledger','merchant_fee','operationId',fee_record.id,'providerRef',fee_record.provider_ref,'amountMinor',fee_record.amount_minor,'currency',fee_record.currency,
   'witness',jsonb_build_object('fee',to_jsonb(fee_record),'ack',(SELECT jsonb_agg(to_jsonb(ack) ORDER BY ack.id) FROM merchant_fee_observations ack WHERE ack.operation_id=fee_record.id),
    'callers',(SELECT jsonb_agg(to_jsonb(invocation) ORDER BY invocation.id) FROM merchant_fee_refund_invocations invocation WHERE invocation.fee_operation_id=fee_record.id))));
 END LOOP;
 FOR auxiliary IN SELECT operation.* FROM original_cash_recovery_operations operation JOIN original_cash_recoveries recovery ON recovery.id=operation.recovery_id
  WHERE(recovery.payment_id=target_payment OR recovery.subscription_charge_receipt_id=receipt_row.id) AND operation.kind='fee' ORDER BY operation.id LOOP
  IF auxiliary.request->>'parentRef' IS DISTINCT FROM original_fee OR auxiliary.request->>'originalChargeRef' IS DISTINCT FROM receipt_row.provider_charge_ref
   OR auxiliary.request->>'originalAccountId' IS DISTINCT FROM route_row.recipient_account_id OR auxiliary.request->>'providerPlatformAccountId' IS DISTINCT FROM receipt_row.provider_platform_account_id
   OR auxiliary.request->>'currency' IS DISTINCT FROM parent_row.currency OR NOT freeholder_controlled_bank_minor(auxiliary.request->'amountMinor',true) THEN RETURN NEXT;RETURN;END IF;
  resource_count:=0;
  FOR observation IN SELECT fact.* FROM original_cash_recovery_facts fact JOIN original_cash_recovery_operations actual_observer ON actual_observer.id=fact.operation_id
   WHERE fact.kind='resource' AND(actual_observer.id=auxiliary.id OR actual_observer.kind='inspection' AND actual_observer.recovery_id=auxiliary.recovery_id AND actual_observer.request->>'auxiliaryOperationId'=auxiliary.id::text)
   ORDER BY fact.id LOOP
   resource_count:=resource_count+1;
   SELECT * INTO observer FROM original_cash_recovery_operations WHERE id=observation.operation_id;
   SELECT * INTO observer_finish FROM original_cash_recovery_facts terminal WHERE terminal.operation_id=observer.id AND terminal.kind='finish';
   IF observation.evidence->'bindingVerified' IS DISTINCT FROM 'true'::jsonb OR observation.evidence->>'operationId' IS DISTINCT FROM auxiliary.id::text
    OR observation.evidence->>'parentRef' IS DISTINCT FROM original_fee OR observation.evidence->'amountMinor' IS DISTINCT FROM auxiliary.request->'amountMinor'
    OR observation.evidence->>'currency' IS DISTINCT FROM parent_row.currency OR coalesce(observation.evidence->>'providerRef','')!~'^fr_[A-Za-z0-9_]+$'
    OR NOT EXISTS(SELECT 1 FROM original_cash_recovery_facts ack WHERE ack.operation_id=observer.id AND ack.kind='ack' AND ack.evidence->>'providerRef'=observation.evidence->>'providerRef'
     AND(observer.id=auxiliary.id OR ack.evidence->>'auxiliaryOperationId'=auxiliary.id::text)) THEN RETURN NEXT;RETURN;END IF;
   IF NOT EXISTS(SELECT 1 FROM original_cash_recovery_facts confirmation JOIN original_cash_recovery_operations returned_observer ON returned_observer.id=confirmation.operation_id
    JOIN original_cash_recovery_facts actual_finish ON actual_finish.operation_id=returned_observer.id AND actual_finish.kind='finish' AND actual_finish.evidence->>'outcome'='returned' AND actual_finish.evidence->>'callerInstanceId'=returned_observer.caller->>'id'
    WHERE confirmation.kind='resource' AND confirmation.evidence->>'providerRef'=observation.evidence->>'providerRef'
     AND(returned_observer.id=auxiliary.id OR returned_observer.kind='inspection' AND returned_observer.recovery_id=auxiliary.recovery_id AND returned_observer.request->>'auxiliaryOperationId'=auxiliary.id::text)
     AND NOT EXISTS(SELECT 1 FROM original_cash_recovery_facts terminal WHERE terminal.operation_id=returned_observer.id AND terminal.kind='stop')
     AND EXISTS(SELECT 1 FROM original_cash_recovery_facts ack WHERE ack.operation_id=returned_observer.id AND ack.kind='ack' AND ack.evidence->>'providerRef'=observation.evidence->>'providerRef' AND(returned_observer.id=auxiliary.id OR ack.evidence->>'auxiliaryOperationId'=auxiliary.id::text))) THEN pending_calls:=true;CONTINUE;END IF;
   actual_rows:=actual_rows||jsonb_build_array(jsonb_build_object('ledger','original_auxiliary','operationId',auxiliary.id,'providerRef',observation.evidence->>'providerRef','amountMinor',observation.evidence->'amountMinor','currency',parent_row.currency,
    'witness',jsonb_build_object('operation',to_jsonb(auxiliary),'observer',to_jsonb(observer),'resource',to_jsonb(observation),'facts',(SELECT jsonb_agg(to_jsonb(fact) ORDER BY fact.id) FROM original_cash_recovery_facts fact WHERE fact.operation_id=observer.id))));
  END LOOP;
  IF resource_count=0 THEN pending_calls:=true;END IF;
 END LOOP;
 SELECT EXISTS(SELECT 1 FROM jsonb_array_elements(actual_rows) item GROUP BY item->>'providerRef'
  HAVING count(DISTINCT (item->>'ledger',item->>'operationId',item->>'amountMinor',item->>'currency'))<>1) INTO conflicting;
 IF conflicting OR EXISTS(SELECT 1 FROM jsonb_array_elements(actual_rows) item GROUP BY item->>'ledger',item->>'operationId' HAVING count(DISTINCT item->>'providerRef')<>1) THEN RETURN NEXT;RETURN;END IF;
 IF EXISTS(SELECT 1 FROM merchant_fee_refunds another WHERE another.provider_platform_account_id=receipt_row.provider_platform_account_id AND another.payment_id<>target_payment
  AND EXISTS(SELECT 1 FROM jsonb_array_elements(actual_rows) owned WHERE owned->>'providerRef'=another.provider_ref))
  OR EXISTS(SELECT 1 FROM original_cash_recovery_facts actual_resource JOIN original_cash_recoveries another ON another.id=actual_resource.recovery_id
   WHERE actual_resource.kind='resource' AND another.owner->'cash'->>'providerPlatformAccountId'=receipt_row.provider_platform_account_id AND another.payment_id IS DISTINCT FROM target_payment AND another.subscription_charge_receipt_id IS DISTINCT FROM receipt_row.id
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(actual_rows) owned WHERE owned->>'providerRef'=actual_resource.evidence->>'providerRef')) THEN RETURN NEXT;RETURN;END IF;

 SELECT coalesce(sum((item->>'amountMinor')::numeric),0) INTO actual_returned FROM(SELECT DISTINCT ON(item->>'providerRef') item FROM jsonb_array_elements(actual_rows) item ORDER BY item->>'providerRef') physical;
 IF actual_returned>route_row.application_fee_minor THEN RETURN NEXT;RETURN;END IF;
 known:=true;pending:=pending_calls;evidence_fingerprint:=encode(sha256(convert_to(actual_rows::text,'UTF8')),'hex');RETURN NEXT;
 FOR entries IN SELECT jsonb_build_object('ledger',min(item->>'ledger'),'operationId',min(item->>'operationId'),'providerRef',item->>'providerRef','amountMinor',min(item->>'amountMinor'),'currency',min(item->>'currency'),'witnesses',jsonb_agg(item->'witness' ORDER BY(item->'witness')::text))
  FROM jsonb_array_elements(actual_rows) item GROUP BY item->>'providerRef' ORDER BY item->>'providerRef' LOOP
  ledger:=entries->>'ledger';operation_id:=(entries->>'operationId')::uuid;provider_ref:=entries->>'providerRef';amount_minor:=(entries->>'amountMinor')::bigint;
  evidence_fingerprint:=encode(sha256(convert_to((entries->'witnesses')::text,'UTF8')),'hex');RETURN NEXT;
 END LOOP;
END $$;
--> statement-breakpoint
CREATE FUNCTION freeholder_atomic_auxiliary_fee_target_valid(candidate jsonb) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE evidence jsonb;recovery original_cash_recoveries%ROWTYPE;parent_row payments%ROWTYPE;route_row merchant_agreement_payment_routes%ROWTYPE;receipt_row subscription_provider_charge_receipts%ROWTYPE;
 inventory original_cash_recovery_operations%ROWTYPE;target_row record;bank_row record;actual_returned numeric;resources_known boolean;resources_pending boolean;
BEGIN
 evidence:=candidate->'evidence';
 IF candidate->>'kind' IS DISTINCT FROM 'atomic_fee_target' OR candidate->>'operation_id' IS NOT NULL
  OR evidence->>'protocol' IS DISTINCT FROM 'freeholder.original-cash-atomic-fee-target.v1'
  OR coalesce(evidence->>'targetKey','')!~'^[a-f0-9]{64}$' OR coalesce(evidence->>'economicRevision','')!~'^[a-f0-9]{64}$'
  OR coalesce(evidence->>'sourceRevision','')!~'^[a-f0-9]{64}$' OR coalesce(evidence->>'unionRevision','')!~'^[a-f0-9]{64}$'
  OR NOT freeholder_controlled_bank_minor(evidence->'originalFeeMinor') OR NOT freeholder_controlled_bank_minor(evidence->'targetRetainedFeeMinor')
  OR NOT freeholder_controlled_bank_minor(evidence->'priorReturnedMinor') OR NOT freeholder_controlled_bank_minor(evidence->'amountMinor',true) THEN RETURN false;END IF;
 SELECT * INTO recovery FROM original_cash_recoveries WHERE id=(candidate->>'recovery_id')::uuid;
 SELECT * INTO parent_row FROM payments WHERE id=(evidence->>'paymentId')::uuid;
 SELECT * INTO route_row FROM merchant_agreement_payment_routes WHERE payment_id=parent_row.id;
 SELECT * INTO receipt_row FROM subscription_provider_charge_receipts WHERE id=route_row.original_charge_receipt_id;
 SELECT * INTO inventory FROM original_cash_recovery_operations WHERE id=(evidence->>'originalInventoryOperationId')::uuid;
 IF recovery.id IS NULL OR parent_row.id IS NULL OR receipt_row.id IS NULL OR inventory.id IS NULL OR inventory.recovery_id<>recovery.id OR inventory.kind<>'inspection' OR inventory.request ? 'auxiliaryOperationId'
  OR NOT(recovery.payment_id=parent_row.id OR recovery.subscription_charge_receipt_id=receipt_row.id)
  OR recovery.owner->'cash'->'applied' IS DISTINCT FROM 'true'::jsonb OR evidence->>'recoveryId' IS DISTINCT FROM recovery.id::text
  OR evidence->>'receiptId' IS DISTINCT FROM receipt_row.id::text OR evidence->>'invoiceId' IS DISTINCT FROM parent_row.invoice_id::text
  OR evidence->>'platform' IS DISTINCT FROM receipt_row.provider_platform_account_id OR evidence->>'account' IS DISTINCT FROM route_row.recipient_account_id
  OR evidence->>'paymentRef' IS DISTINCT FROM receipt_row.provider_payment_intent_ref OR evidence->>'chargeRef' IS DISTINCT FROM receipt_row.provider_charge_ref
  OR evidence->>'currency' IS DISTINCT FROM parent_row.currency OR evidence->>'originalFeeMinor' IS DISTINCT FROM route_row.application_fee_minor::text
  OR evidence->>'namespaceKey' IS DISTINCT FROM receipt_row.provider_platform_account_id||':'||coalesce(receipt_row.charge_account_id,'')||':'||receipt_row.provider_payment_intent_ref
  OR NOT EXISTS(SELECT 1 FROM original_cash_recovery_facts terminal WHERE terminal.operation_id=inventory.id AND terminal.kind='finish'
   AND terminal.evidence->>'outcome'='returned' AND terminal.evidence->>'callerInstanceId'=inventory.caller->>'id') THEN RETURN false;END IF;
 PERFORM freeholder_merchant_fee_require_prefix(parent_row.id);
 SELECT policy.* INTO target_row FROM freeholder_controlled_atomic_refund_targets(parent_row.invoice_id) policy WHERE policy.payment_id=parent_row.id AND policy.known;
 SELECT coalesce(bool_and(resource.known),false),coalesce(bool_or(resource.pending),true),coalesce(sum(resource.amount_minor),0) INTO resources_known,resources_pending,actual_returned FROM freeholder_atomic_fee_return_resources(parent_row.id) resource;
 SELECT * INTO bank_row FROM freeholder_controlled_receipt_bank_observation((evidence->>'collectionId')::uuid,receipt_row.id);
 RETURN target_row.payment_id IS NOT NULL AND target_row.receipt_id=receipt_row.id AND target_row.batch_id::text=evidence->>'batchId' AND target_row.receipt_proof_id::text=evidence->>'receiptProofId'
  AND target_row.original_fee_ref IS NOT DISTINCT FROM evidence->>'feeRef' AND target_row.target_retained_fee_minor::bigint::text=evidence->>'targetRetainedFeeMinor'
  AND EXISTS(SELECT 1 FROM controlled_cash_application_batches batch WHERE batch.id=target_row.batch_id AND batch.collection_id::text=evidence->>'collectionId')
  AND resources_known AND NOT resources_pending AND actual_returned::text=evidence->>'priorReturnedMinor'
  AND (evidence->>'amountMinor')::numeric=route_row.application_fee_minor-target_row.target_retained_fee_minor-actual_returned
  AND bank_row.actual_inspection_id IS NOT NULL AND bank_row.current_evidence->'fee'->>'providerRef'=evidence->>'feeRef'
  AND bank_row.current_evidence->'fee'->>'amountMinor'=route_row.application_fee_minor::text AND bank_row.current_evidence->'fee'->>'refundedMinor'=actual_returned::text
  AND EXISTS(SELECT 1 FROM original_cash_recovery_facts state WHERE state.operation_id=inventory.id AND state.kind='state' AND state.evidence=bank_row.current_evidence);
END $$;
--> statement-breakpoint
CREATE FUNCTION freeholder_atomic_auxiliary_fee_operation_valid(candidate jsonb) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE target_fact original_cash_recovery_facts%ROWTYPE;body jsonb;actual_returned numeric;resources_known boolean;resources_pending boolean;current_target record;parent_row payments%ROWTYPE;existing_call original_cash_recovery_operations%ROWTYPE;existing_mode boolean:=false;inventory original_cash_recovery_operations%ROWTYPE;bank_row record;
BEGIN
 body:=candidate->'request';
 SELECT * INTO existing_call FROM original_cash_recovery_operations WHERE id=(candidate->>'id')::uuid;
 IF existing_call.id IS NOT NULL THEN
  existing_mode:=true;
  IF to_jsonb(existing_call) IS DISTINCT FROM candidate OR existing_call.nonce_hash IS DISTINCT FROM encode(sha256(convert_to(coalesce(current_setting('freeholder.original_atomic_fee_nonce',true),''),'UTF8')),'hex')
   OR EXISTS(SELECT 1 FROM original_cash_recovery_facts terminal WHERE terminal.operation_id=existing_call.id AND terminal.kind IN('finish','stop','ack','resource')) THEN RETURN false;END IF;
 END IF;
 SELECT * INTO target_fact FROM original_cash_recovery_facts WHERE id=(body->>'targetFactId')::uuid AND kind='atomic_fee_target';
 IF target_fact.id IS NULL OR body->>'atomicFeeProtocol' IS DISTINCT FROM 'freeholder.original-cash-atomic-fee-operation.v1' OR candidate->>'kind' IS DISTINCT FROM 'fee' OR target_fact.recovery_id::text IS DISTINCT FROM candidate->>'recovery_id'
  OR body->>'operationId' IS DISTINCT FROM candidate->>'id' OR body->>'kind' IS DISTINCT FROM 'fee' OR body->>'providerPlatformAccountId' IS DISTINCT FROM target_fact.evidence->>'platform'
  OR body->>'originalChargeRef' IS DISTINCT FROM target_fact.evidence->>'chargeRef' OR body->>'originalAccountId' IS DISTINCT FROM target_fact.evidence->>'account'
  OR body->>'parentRef' IS DISTINCT FROM target_fact.evidence->>'feeRef' OR body->>'currency' IS DISTINCT FROM target_fact.evidence->>'currency'
  OR body->'originalAmountMinor' IS DISTINCT FROM target_fact.evidence->'originalFeeMinor' OR body->'alreadyReturnedMinor' IS DISTINCT FROM target_fact.evidence->'priorReturnedMinor'
  OR body->'amountMinor' IS DISTINCT FROM target_fact.evidence->'amountMinor' OR body->>'idempotencyKey' IS DISTINCT FROM 'original-cash-atomic-fee:'||target_fact.id::text
  OR body->>'frozenBody' IS DISTINCT FROM 'amount='||(target_fact.evidence->>'amountMinor')||'&metadata%5Bfreeholder_cash_auxiliary_id%5D='||(candidate->>'id')
  OR body->>'providerApiVersion' IS DISTINCT FROM (SELECT recovery.owner->'cash'->>'providerApiVersion' FROM original_cash_recoveries recovery WHERE recovery.id=target_fact.recovery_id)
  OR jsonb_typeof(candidate->'caller') IS DISTINCT FROM 'object' OR coalesce(candidate->'caller'->>'id','')!~'^[0-9a-f-]{36}$'
  OR coalesce(candidate->>'nonce_hash','')!~'^[a-f0-9]{64}$' THEN RETURN false;END IF;
 SELECT * INTO parent_row FROM payments WHERE id=(target_fact.evidence->>'paymentId')::uuid;
 PERFORM freeholder_merchant_fee_require_prefix(parent_row.id);
 SELECT policy.* INTO current_target FROM freeholder_controlled_atomic_refund_targets(parent_row.invoice_id) policy WHERE policy.payment_id=parent_row.id AND policy.known;
 SELECT coalesce(bool_and(resource.known),false),coalesce(bool_or(resource.pending),true),coalesce(sum(resource.amount_minor),0) INTO resources_known,resources_pending,actual_returned FROM freeholder_atomic_fee_return_resources(parent_row.id) resource;
 SELECT * INTO inventory FROM original_cash_recovery_operations WHERE id=(body->>'admissionInventoryOperationId')::uuid;
 SELECT * INTO bank_row FROM freeholder_controlled_receipt_bank_observation((target_fact.evidence->>'collectionId')::uuid,(target_fact.evidence->>'receiptId')::uuid);
 IF existing_mode AND((SELECT count(*) FROM original_cash_recovery_facts observed WHERE observed.operation_id=existing_call.id AND observed.kind='parent')<>1
  OR NOT EXISTS(SELECT 1 FROM original_cash_recovery_facts observed WHERE observed.operation_id=existing_call.id AND observed.kind='parent'
   AND observed.evidence->>'providerRef'=target_fact.evidence->>'feeRef' AND observed.evidence->>'accountId'=target_fact.evidence->>'account' AND observed.evidence->>'chargeRef'=target_fact.evidence->>'chargeRef'
   AND observed.evidence->'amountMinor'=target_fact.evidence->'originalFeeMinor' AND observed.evidence->'returnedMinor'=target_fact.evidence->'priorReturnedMinor' AND observed.evidence->>'currency'=target_fact.evidence->>'currency')) THEN RETURN false;END IF;
 RETURN parent_row.id IS NOT NULL AND current_target.payment_id IS NOT NULL AND current_target.target_retained_fee_minor::bigint::text=target_fact.evidence->>'targetRetainedFeeMinor'
  AND inventory.id IS NOT NULL AND inventory.recovery_id=target_fact.recovery_id AND inventory.kind='inspection' AND NOT inventory.request ? 'auxiliaryOperationId'
  AND EXISTS(SELECT 1 FROM original_cash_recovery_facts terminal WHERE terminal.operation_id=inventory.id AND terminal.kind='finish' AND terminal.evidence->>'outcome'='returned' AND terminal.evidence->>'callerInstanceId'=inventory.caller->>'id')
  AND bank_row.actual_inspection_id IS NOT NULL AND EXISTS(SELECT 1 FROM original_cash_recovery_facts state WHERE state.operation_id=inventory.id AND state.kind='state' AND state.evidence=bank_row.current_evidence)
  AND resources_known AND(NOT resources_pending OR existing_mode
   AND NOT EXISTS(SELECT 1 FROM merchant_fee_refunds fee WHERE fee.payment_id=parent_row.id AND fee.status IN('reserved','dispatching','unknown'))
   AND NOT EXISTS(SELECT 1 FROM merchant_fee_refund_invocations invocation WHERE invocation.payment_id=parent_row.id AND invocation.finish IS NULL AND invocation.stop IS NULL)
   AND NOT EXISTS(SELECT 1 FROM original_cash_recovery_operations other_fee WHERE other_fee.recovery_id=target_fact.recovery_id AND other_fee.kind='fee' AND other_fee.id<>existing_call.id
    AND NOT EXISTS(SELECT 1 FROM freeholder_atomic_fee_return_resources(parent_row.id) physical WHERE physical.known AND physical.ledger='original_auxiliary' AND physical.operation_id=other_fee.id)))
  AND actual_returned::text=target_fact.evidence->>'priorReturnedMinor'
  AND NOT EXISTS(SELECT 1 FROM original_cash_recovery_operations previous_call WHERE previous_call.recovery_id=target_fact.recovery_id AND previous_call.kind='fee' AND previous_call.request->>'targetFactId'=target_fact.id::text AND(NOT existing_mode OR previous_call.id<>existing_call.id))
  AND NOT EXISTS(SELECT 1 FROM original_cash_recovery_operations previous_call WHERE previous_call.recovery_id=target_fact.recovery_id AND(NOT existing_mode OR previous_call.id<>existing_call.id)
   AND NOT EXISTS(SELECT 1 FROM original_cash_recovery_facts terminal WHERE terminal.operation_id=previous_call.id AND(terminal.kind='finish' AND terminal.evidence->>'callerInstanceId'=previous_call.caller->>'id' OR terminal.kind='stop' AND terminal.evidence->>'operationDigest'=previous_call.digest)));
END $$;
--> statement-breakpoint
CREATE FUNCTION freeholder_atomic_auxiliary_fee_closure_valid(candidate jsonb) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE target_fact original_cash_recovery_facts%ROWTYPE;evidence jsonb;state_row record;inventory original_cash_recovery_operations%ROWTYPE;
BEGIN
 evidence:=candidate->'evidence';
 SELECT * INTO target_fact FROM original_cash_recovery_facts WHERE id=(evidence->>'targetFactId')::uuid AND kind='atomic_fee_target';
 IF target_fact.id IS NULL OR candidate->>'kind' IS DISTINCT FROM 'atomic_fee_closure' OR candidate->>'operation_id' IS NOT NULL
  OR target_fact.recovery_id::text IS DISTINCT FROM candidate->>'recovery_id' OR evidence->>'protocol' IS DISTINCT FROM 'freeholder.original-cash-atomic-fee-closure.v1'
  OR evidence->>'targetKey' IS DISTINCT FROM target_fact.evidence->>'targetKey' OR evidence->>'paymentId' IS DISTINCT FROM target_fact.evidence->>'paymentId'
  OR evidence->>'receiptId' IS DISTINCT FROM target_fact.evidence->>'receiptId' OR evidence->>'recoveryId' IS DISTINCT FROM target_fact.recovery_id::text
  OR evidence->'targetRetainedFeeMinor' IS DISTINCT FROM target_fact.evidence->'targetRetainedFeeMinor' OR coalesce(evidence->>'revision','')!~'^[a-f0-9]{64}$' THEN RETURN false;END IF;
 PERFORM freeholder_merchant_fee_require_prefix((evidence->>'paymentId')::uuid);
 SELECT * INTO state_row FROM freeholder_controlled_atomic_refund_fee_state((evidence->>'paymentId')::uuid);
 SELECT * INTO inventory FROM original_cash_recovery_operations WHERE id=(evidence->>'originalInventoryOperationId')::uuid;
 RETURN state_row.known IS TRUE AND state_row.reconciled IS TRUE AND state_row.receipt_id::text=evidence->>'receiptId'
  AND state_row.inspection_id::text=evidence->>'bankInspectionId' AND state_row.observation_id::text=evidence->>'bankObservationId'
  AND state_row.actual_retained_fee_minor::bigint::text=evidence->>'targetRetainedFeeMinor'
  AND(evidence->>'acceptedReturnedMinor')::numeric=(target_fact.evidence->>'originalFeeMinor')::numeric-state_row.actual_retained_fee_minor
  AND inventory.id IS NOT NULL AND inventory.recovery_id=target_fact.recovery_id AND inventory.kind='inspection' AND NOT inventory.request ? 'auxiliaryOperationId'
  AND EXISTS(SELECT 1 FROM original_cash_recovery_facts terminal WHERE terminal.operation_id=inventory.id AND terminal.kind='finish' AND terminal.evidence->>'outcome'='returned' AND terminal.evidence->>'callerInstanceId'=inventory.caller->>'id');
END $$;

--> statement-breakpoint
-- Exact full-body successors; old paths remain verbatim.
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
 IF TG_TABLE_NAME='original_cash_recovery_facts' AND body->>'kind' IN('atomic_fee_target','atomic_fee_closure') THEN
  PERFORM freeholder_merchant_fee_require_prefix((body->'evidence'->>'paymentId')::uuid);
 ELSIF TG_TABLE_NAME='original_cash_recovery_operations' AND body->'request'->>'atomicFeeProtocol'='freeholder.original-cash-atomic-fee-operation.v1' THEN
  PERFORM freeholder_merchant_fee_require_prefix((SELECT target.evidence->>'paymentId' FROM original_cash_recovery_facts target WHERE target.id=(body->'request'->>'targetFactId')::uuid AND target.kind='atomic_fee_target')::uuid);
 END IF;
 PERFORM pg_advisory_xact_lock(hashtext('subscription-cash:'||(original.owner->'cash'->>'providerPlatformAccountId')||':'||coalesce(original.owner->'cash'->>'chargeAccountId','')||':'||(original.owner->'cash'->>'providerRef')));
 IF TG_TABLE_NAME='original_cash_recovery_facts' AND body->>'kind' IN('atomic_fee_target','atomic_fee_closure') THEN
  IF(body->>'kind'='atomic_fee_target' AND NOT freeholder_atomic_auxiliary_fee_target_valid(to_jsonb(NEW)))
   OR(body->>'kind'='atomic_fee_closure' AND NOT freeholder_atomic_auxiliary_fee_closure_valid(to_jsonb(NEW))) THEN
   RAISE EXCEPTION 'Retain only the exact original atomic fee target or actual returned-bank closure' USING ERRCODE='23514';END IF;
  RETURN NEW;
 ELSIF TG_TABLE_NAME='original_cash_recovery_operations' AND body->'request'->>'atomicFeeProtocol'='freeholder.original-cash-atomic-fee-operation.v1' THEN
  IF NOT freeholder_atomic_auxiliary_fee_operation_valid(to_jsonb(NEW)) THEN RAISE EXCEPTION 'The original atomic auxiliary fee needs its exact current target and real source caller' USING ERRCODE='23514';END IF;
  RETURN NEW;
 END IF;

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
CREATE OR REPLACE FUNCTION freeholder_controlled_atomic_refund_targets(target_invoice uuid)
RETURNS TABLE(known boolean,payment_id uuid,receipt_id uuid,batch_id uuid,receipt_proof_id uuid,
 amount_minor float8,refunded_minor float8,original_fee_minor float8,original_fee_ref text,actual_fee_returned_minor float8,target_retained_fee_minor float8,
 principal_minor float8,fee_minor float8,revision text) LANGUAGE plpgsql STABLE AS $$
DECLARE invoice_row invoices%ROWTYPE;policy_row invoice_market_policies%ROWTYPE;
 collection_row subscription_controlled_collections%ROWTYPE;quote_row subscription_controlled_quotes%ROWTYPE;
 resource_row subscription_controlled_resources%ROWTYPE;item record;inventory jsonb;cash_total numeric;fee_total numeric;
 remaining_cash numeric;retained_fee numeric;whole_target numeric;residual numeric;take numeric;original_target numeric;already_returned numeric;budget bigint;
BEGIN
 IF NOT freeholder_atomic_auxiliary_fee_ready() THEN RETURN;END IF;
 SELECT * INTO invoice_row FROM invoices WHERE id=target_invoice;
 SELECT * INTO policy_row FROM invoice_market_policies WHERE invoice_id=target_invoice;
 SELECT * INTO collection_row FROM subscription_controlled_collections WHERE invoice_id=target_invoice;
 SELECT * INTO quote_row FROM subscription_controlled_quotes WHERE id=collection_row.quote_id;
 SELECT * INTO resource_row FROM subscription_controlled_resources WHERE id=quote_row.resource_id;
 -- No noncash source is guessed into this physical cash epoch. A credited or
 -- incomplete target remains debt until its genuine credit disposition exists.
 IF invoice_row.id IS NULL OR invoice_row.total_minor<=0 OR invoice_row.total_minor>9007199254740991
  OR invoice_row.credited_minor<>0 OR invoice_row.source_type IS DISTINCT FROM 'subscription'
  OR invoice_row.source_id IS DISTINCT FROM quote_row.canonical_source_id OR policy_row.model IS DISTINCT FROM 'seller_merchant'
  OR policy_row.collection_version<>0 OR policy_row.fee_minor<0 OR policy_row.fee_minor>invoice_row.total_minor
  OR collection_row.id IS NULL OR resource_row.id IS NULL OR collection_row.invoice_id IS DISTINCT FROM invoice_row.id
  OR NOT EXISTS(SELECT 1 FROM controlled_cash_application_batches b WHERE b.invoice_id=invoice_row.id AND b.protocol='controlled_cash_atomic.v1') THEN RETURN;END IF;
 SELECT (SELECT count(*) FROM payments WHERE invoice_id=target_invoice)
  +(SELECT count(*) FROM refunds f JOIN payments p ON p.id=f.payment_id WHERE p.invoice_id=target_invoice)
  +(SELECT count(*) FROM merchant_refund_requests q JOIN payments p ON p.id=q.payment_id WHERE p.invoice_id=target_invoice)
  +(SELECT count(*) FROM controlled_cash_application_batches WHERE invoice_id=target_invoice)
  +(SELECT count(*) FROM controlled_cash_application_receipts rp JOIN controlled_cash_application_batches b ON b.id=rp.batch_id WHERE b.invoice_id=target_invoice)
  +(SELECT count(*)*6 FROM payments WHERE invoice_id=target_invoice)+3
  +(SELECT count(*) FROM merchant_fee_refunds f JOIN payments p ON p.id=f.payment_id WHERE p.invoice_id=target_invoice)
  +(SELECT count(*) FROM merchant_fee_observations ack JOIN merchant_fee_refunds f ON f.id=ack.operation_id JOIN payments p ON p.id=f.payment_id WHERE p.invoice_id=target_invoice)
  +(SELECT count(*) FROM controlled_cash_application_links l JOIN payments p ON p.id=l.payment_id WHERE p.invoice_id=target_invoice) INTO budget;
 IF budget>5000 OR NOT EXISTS(SELECT 1 FROM payments WHERE invoice_id=target_invoice) THEN RETURN;END IF;
 IF EXISTS(SELECT 1 FROM payments p
  LEFT JOIN controlled_cash_application_links l ON l.payment_id=p.id
  LEFT JOIN controlled_cash_application_receipts rp ON rp.id=l.receipt_proof_id
  LEFT JOIN controlled_cash_application_batches b ON b.id=l.batch_id
  LEFT JOIN merchant_agreement_payment_routes route_row ON route_row.payment_id=p.id
  LEFT JOIN subscription_provider_charge_receipts cash_row ON cash_row.id=l.receipt_id
  LEFT JOIN subscription_controlled_charge_origins origin_row ON origin_row.receipt_id=cash_row.id
  LEFT JOIN merchant_cash_return_observations initial_bank ON initial_bank.id=rp.bank_observation_id and initial_bank.inspection_id=rp.bank_inspection_id
  LEFT JOIN merchant_cash_return_inspections initial_inspection ON initial_inspection.id=rp.bank_inspection_id
  LEFT JOIN merchant_cash_return_inspection_finishes initial_finish ON initial_finish.inspection_id=initial_inspection.id
  WHERE p.invoice_id=target_invoice AND(p.status<>'succeeded' OR p.provider<>'stripe' OR p.method<>'provider_schedule'
   OR p.amount_minor<=0 OR p.refunded_minor<0 OR p.refunded_minor>p.amount_minor OR p.currency<>invoice_row.currency
   OR l.receipt_id IS NULL OR rp.id IS NULL OR b.id IS NULL OR route_row.payment_id IS NULL OR cash_row.id IS NULL OR origin_row.receipt_id IS NULL
   OR b.protocol NOT IN('controlled_net_gross.v1','controlled_cash_atomic.v1') OR b.admission_transaction_id=txid_current()::text OR b.collection_id<>collection_row.id OR b.quote_id<>quote_row.id
   OR b.resource_id<>resource_row.id OR b.subscription_id<>resource_row.subscription_id OR b.invoice_id<>invoice_row.id OR b.terms_id<>collection_row.terms_id
   OR b.accepted_quote_digest<>collection_row.accepted_quote_digest OR b.canonical_target_digest<>collection_row.canonical_target_digest OR b.currency<>invoice_row.currency
   OR l.batch_id<>rp.batch_id OR l.receipt_id<>rp.receipt_id OR rp.batch_id<>b.id
   OR rp.amount_minor<>p.amount_minor OR rp.currency<>p.currency OR rp.payment_idempotency_key<>p.idempotency_key OR rp.payment_request_hash<>p.request_hash
   OR cash_row.subscription_id<>resource_row.subscription_id OR cash_row.amount_minor<>p.amount_minor OR cash_row.currency<>p.currency
   OR origin_row.resource_id<>resource_row.id OR origin_row.operation_id<>rp.origin_operation_id OR origin_row.call_id<>rp.origin_call_id OR origin_row.fact_id<>rp.origin_fact_id
   OR route_row.original_charge_receipt_id IS DISTINCT FROM l.receipt_id OR route_row.subscription_id<>resource_row.subscription_id
   OR route_row.provider_platform_account_id<>(resource_row.original_scope->>'providerPlatformAccountId') OR route_row.charge_account_id IS DISTINCT FROM (resource_row.original_scope->>'providerAccountId')
   OR route_row.provider_invoice_ref IS DISTINCT FROM cash_row.provider_invoice_ref OR route_row.provider_payment_intent_ref IS DISTINCT FROM cash_row.provider_payment_intent_ref
   OR p.provider_ref IS DISTINCT FROM cash_row.provider_payment_intent_ref OR route_row.application_fee_minor<>rp.fee_minor
   OR rp.fee_minor<0 OR rp.fee_minor>rp.amount_minor
   OR initial_bank.id IS NULL OR initial_inspection.id IS NULL OR initial_finish.inspection_id IS NULL
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(b.before_entries) frozen WHERE frozen->>'table'='merchant_cash_return_observations' AND frozen->>'id'=initial_bank.id::text AND frozen->>'hashDomain'='postgres_row'
    AND frozen->>'fingerprint'=encode(sha256(convert_to(to_jsonb(initial_bank)::text,'UTF8')),'hex'))
   OR initial_inspection.subscription_charge_receipt_id IS DISTINCT FROM cash_row.id OR initial_finish.outcome IS DISTINCT FROM 'returned'
   OR initial_finish.caller_instance_id IS DISTINCT FROM rp.bank_finish_caller_id OR initial_finish.caller_instance_id::text IS DISTINCT FROM initial_inspection.caller->>'id'
   OR initial_bank.evidence->>'paymentProviderRef' IS DISTINCT FROM cash_row.provider_payment_intent_ref
   OR initial_bank.evidence->>'providerChargeRef' IS DISTINCT FROM cash_row.provider_charge_ref
   OR initial_bank.evidence->>'providerPlatformAccountId' IS DISTINCT FROM cash_row.provider_platform_account_id
   OR initial_bank.evidence->>'chargeAccountId' IS DISTINCT FROM cash_row.charge_account_id
   OR initial_bank.evidence->>'providerApiVersion' IS DISTINCT FROM cash_row.provider_api_version OR initial_bank.evidence->>'amountMinor' IS DISTINCT FROM p.amount_minor::text
   OR initial_bank.evidence->>'currency' IS DISTINCT FROM cash_row.currency OR initial_bank.evidence->>'feeFieldObserved' IS DISTINCT FROM 'true'
   OR(rp.fee_minor=0 AND(initial_bank.evidence->'fee' IS DISTINCT FROM 'null'::jsonb OR cash_row.application_fee_ref IS NOT NULL))
   OR(rp.fee_minor>0 AND(initial_bank.evidence->'fee'->>'providerRef' IS NULL
    OR initial_bank.evidence->'fee'->>'amountMinor' IS DISTINCT FROM rp.fee_minor::text OR initial_bank.evidence->'fee'->>'refundedMinor' IS DISTINCT FROM '0'
    OR initial_bank.evidence->'fee'->>'currency' IS DISTINCT FROM cash_row.currency OR initial_bank.evidence->'fee'->>'originatingChargeRef' IS DISTINCT FROM cash_row.provider_charge_ref
    OR initial_bank.evidence->'fee'->>'accountId' IS DISTINCT FROM route_row.recipient_account_id
    OR(cash_row.application_fee_ref IS NOT NULL AND cash_row.application_fee_ref IS DISTINCT FROM initial_bank.evidence->'fee'->>'providerRef')))
   OR b.digest!~'^[a-f0-9]{64}$' OR b.authentication!~'^[a-f0-9]{64}$' OR rp.digest!~'^[a-f0-9]{64}$' OR rp.authentication!~'^[a-f0-9]{64}$')) THEN RETURN;END IF;
 -- Every immutable promised receipt has its actual once-only generated local
 -- payment. A partially staged or foreign batch is never a refund authority.
 IF EXISTS(SELECT 1 FROM controlled_cash_application_batches b WHERE b.invoice_id=target_invoice AND(
  jsonb_array_length(b.requested_receipt_ids)<>(SELECT count(*) FROM controlled_cash_application_receipts rp WHERE rp.batch_id=b.id)
  OR EXISTS(SELECT 1 FROM controlled_cash_application_receipts rp LEFT JOIN controlled_cash_application_links l ON l.receipt_proof_id=rp.id
   LEFT JOIN payments p ON p.id=l.payment_id WHERE rp.batch_id=b.id AND(l.receipt_id IS NULL OR l.batch_id<>b.id OR l.receipt_id<>rp.receipt_id OR p.invoice_id IS DISTINCT FROM target_invoice
    OR NOT b.requested_receipt_ids @> jsonb_build_array(rp.receipt_id::text)))
  OR b.expected_cash_minor<>(SELECT coalesce(sum(rp.amount_minor),0) FROM controlled_cash_application_receipts rp WHERE rp.batch_id=b.id)
  OR b.expected_fee_minor<>(SELECT coalesce(sum(rp.fee_minor),0) FROM controlled_cash_application_receipts rp WHERE rp.batch_id=b.id))) THEN RETURN;END IF;
 IF EXISTS(SELECT 1 FROM refunds f JOIN payments p ON p.id=f.payment_id LEFT JOIN merchant_refund_requests q ON q.refund_id=f.id
  WHERE p.invoice_id=target_invoice AND(f.status IN('created','processing') OR f.failure_code='provider_already_refunded'
   OR(f.status='succeeded' AND(q.id IS NULL OR q.purpose<>'invoice_refund' OR q.payment_id<>p.id OR f.invoice_id<>invoice_row.id OR q.amount_minor<>f.amount_minor
    OR f.currency<>p.currency OR q.currency<>f.currency OR q.idempotency_key<>f.idempotency_key OR q.original_payment_ref<>p.provider_ref
    OR q.provider_platform_account_id<>(resource_row.original_scope->>'providerPlatformAccountId') OR q.charge_account_id IS DISTINCT FROM (resource_row.original_scope->>'providerAccountId')
    OR NOT freeholder_original_refund_resolved(q.id,'succeeded',f.provider_ref)))))
  OR EXISTS(SELECT 1 FROM payments p WHERE p.invoice_id=target_invoice AND p.refunded_minor<>(SELECT coalesce(sum(f.amount_minor),0) FROM refunds f WHERE f.payment_id=p.id AND f.status='succeeded')) THEN RETURN;END IF;
 IF EXISTS(SELECT 1 FROM payments actual_payment WHERE actual_payment.invoice_id=target_invoice AND NOT EXISTS(
  SELECT 1 FROM freeholder_atomic_fee_return_resources(actual_payment.id) physical WHERE physical.ledger='inventory' AND physical.known)) THEN RETURN;END IF;
 -- Actual accepted fee returns are irreversible physical facts. Require the
 -- exact original resource and ACK before using them as an allocation ceiling.
 IF EXISTS(SELECT 1 FROM merchant_fee_refunds f JOIN payments p ON p.id=f.payment_id
  JOIN merchant_agreement_payment_routes route_row ON route_row.payment_id=p.id JOIN subscription_provider_charge_receipts receipt_row ON receipt_row.id=route_row.original_charge_receipt_id
  JOIN controlled_cash_application_links initial_link ON initial_link.payment_id=p.id JOIN controlled_cash_application_receipts initial_proof ON initial_proof.id=initial_link.receipt_proof_id
  JOIN merchant_cash_return_observations initial_bank ON initial_bank.id=initial_proof.bank_observation_id
  WHERE p.invoice_id=target_invoice AND f.status='accepted' AND(f.provider_platform_account_id<>route_row.provider_platform_account_id
   OR f.original_charge_receipt_id IS DISTINCT FROM receipt_row.id OR f.application_fee_ref IS DISTINCT FROM coalesce(receipt_row.application_fee_ref,initial_bank.evidence->'fee'->>'providerRef')
   OR f.provider_charge_ref IS DISTINCT FROM receipt_row.provider_charge_ref OR f.currency<>p.currency
   OR NOT EXISTS(SELECT 1 FROM merchant_fee_observations ack WHERE ack.operation_id=f.id AND ack.binding_verified AND ack.provider_ref=f.provider_ref
    AND ack.application_fee_ref=f.application_fee_ref AND ack.amount_minor=f.amount_minor AND ack.currency=f.currency)))
  OR EXISTS(SELECT 1 FROM payments p JOIN merchant_agreement_payment_routes route_row ON route_row.payment_id=p.id WHERE p.invoice_id=target_invoice
   AND (SELECT coalesce(sum(physical.amount_minor),0) FROM freeholder_atomic_fee_return_resources(p.id) physical WHERE physical.known)>route_row.application_fee_minor) THEN RETURN;END IF;
 SELECT sum(p.amount_minor),sum(route_row.application_fee_minor),sum(p.amount_minor-p.refunded_minor),
  sum(least(floor(route_row.application_fee_minor::numeric*(p.amount_minor-p.refunded_minor)/p.amount_minor),route_row.application_fee_minor-(SELECT coalesce(sum(physical.amount_minor),0) FROM freeholder_atomic_fee_return_resources(p.id) physical WHERE physical.known)))
  INTO cash_total,fee_total,remaining_cash,retained_fee FROM payments p JOIN merchant_agreement_payment_routes route_row ON route_row.payment_id=p.id WHERE p.invoice_id=target_invoice;
 IF cash_total<>invoice_row.paid_minor OR cash_total>invoice_row.total_minor
  OR cash_total-remaining_cash<>invoice_row.refunded_minor OR fee_total<>floor(policy_row.fee_minor::numeric*cash_total/invoice_row.total_minor) THEN RETURN;END IF;
 whole_target:=floor(policy_row.fee_minor::numeric*remaining_cash/invoice_row.total_minor);residual:=greatest(0,retained_fee-whole_target);
 SELECT jsonb_agg(jsonb_build_object('payment',to_jsonb(p),'route',to_jsonb(route_row),'link',to_jsonb(l),'proof',to_jsonb(rp),'batch',to_jsonb(b)) ORDER BY l.receipt_id)
  INTO inventory FROM payments p JOIN merchant_agreement_payment_routes route_row ON route_row.payment_id=p.id JOIN controlled_cash_application_links l ON l.payment_id=p.id
  JOIN controlled_cash_application_receipts rp ON rp.id=l.receipt_proof_id JOIN controlled_cash_application_batches b ON b.id=l.batch_id WHERE p.invoice_id=target_invoice;
 revision:=encode(sha256(convert_to(jsonb_build_object('invoice',to_jsonb(invoice_row),'policy',to_jsonb(policy_row),'collection',to_jsonb(collection_row),'inventory',inventory,
  'refunds',(SELECT coalesce(jsonb_agg(to_jsonb(f) ORDER BY f.id),'[]'::jsonb) FROM refunds f JOIN payments p ON p.id=f.payment_id WHERE p.invoice_id=target_invoice),
  'feeReturns',(SELECT coalesce(jsonb_agg(to_jsonb(f) ORDER BY f.id),'[]'::jsonb) FROM merchant_fee_refunds f JOIN payments p ON p.id=f.payment_id WHERE p.invoice_id=target_invoice))::text,'UTF8')),'hex');
 FOR item IN SELECT p.*,route_row.application_fee_minor,l.receipt_id,l.batch_id,l.receipt_proof_id,coalesce(original_receipt.application_fee_ref,initial_bank.evidence->'fee'->>'providerRef') as original_fee_ref FROM payments p
  JOIN merchant_agreement_payment_routes route_row ON route_row.payment_id=p.id JOIN controlled_cash_application_links l ON l.payment_id=p.id
  JOIN controlled_cash_application_receipts initial_proof ON initial_proof.id=l.receipt_proof_id JOIN merchant_cash_return_observations initial_bank ON initial_bank.id=initial_proof.bank_observation_id
  JOIN subscription_provider_charge_receipts original_receipt ON original_receipt.id=l.receipt_id
  WHERE p.invoice_id=target_invoice ORDER BY l.receipt_id LOOP
  SELECT coalesce(sum(physical.amount_minor),0) INTO already_returned FROM freeholder_atomic_fee_return_resources(item.id) physical WHERE physical.known;
  original_target:=least(floor(item.application_fee_minor::numeric*(item.amount_minor-item.refunded_minor)/item.amount_minor),item.application_fee_minor-already_returned);
  take:=least(residual,original_target);residual:=residual-take;
  known:=true;payment_id:=item.id;receipt_id:=item.receipt_id;batch_id:=item.batch_id;receipt_proof_id:=item.receipt_proof_id;
  amount_minor:=item.amount_minor;refunded_minor:=item.refunded_minor;original_fee_minor:=item.application_fee_minor;
  original_fee_ref:=item.original_fee_ref;actual_fee_returned_minor:=already_returned;target_retained_fee_minor:=original_target-take;principal_minor:=invoice_row.total_minor;fee_minor:=policy_row.fee_minor;RETURN NEXT;
 END LOOP;
END $$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION freeholder_controlled_atomic_refund_fee_state(target_payment uuid)
RETURNS TABLE(known boolean,actual_retained_fee_minor float8,reconciled boolean,receipt_id uuid,inspection_id uuid,observation_id uuid,bank_namespace_revision text)
LANGUAGE plpgsql STABLE AS $$
DECLARE parent_row payments%ROWTYPE;route_row merchant_agreement_payment_routes%ROWTYPE;
 original_receipt subscription_provider_charge_receipts%ROWTYPE;target_row record;bank_row record;returned_fee numeric;
BEGIN
 SELECT * INTO parent_row FROM payments WHERE id=target_payment;
 SELECT * INTO route_row FROM merchant_agreement_payment_routes WHERE payment_id=target_payment;
 SELECT * INTO original_receipt FROM subscription_provider_charge_receipts WHERE id=route_row.original_charge_receipt_id;
 SELECT target_policy.* INTO target_row FROM freeholder_controlled_atomic_refund_targets(parent_row.invoice_id) target_policy WHERE target_policy.payment_id=target_payment AND target_policy.known;
 IF target_row.payment_id IS NULL OR original_receipt.id IS NULL THEN RETURN;END IF;
 SELECT coalesce(sum(physical.amount_minor),0) INTO returned_fee FROM freeholder_atomic_fee_return_resources(target_payment) physical WHERE physical.known;
 IF returned_fee>route_row.application_fee_minor OR EXISTS(SELECT 1 FROM merchant_fee_refunds f WHERE f.payment_id=target_payment AND f.status='accepted' AND(
  f.provider_platform_account_id<>route_row.provider_platform_account_id OR f.original_charge_receipt_id IS DISTINCT FROM original_receipt.id
  OR f.application_fee_ref IS DISTINCT FROM target_row.original_fee_ref OR f.provider_charge_ref IS DISTINCT FROM original_receipt.provider_charge_ref OR f.currency<>parent_row.currency
  OR NOT EXISTS(SELECT 1 FROM merchant_fee_observations ack WHERE ack.operation_id=f.id AND ack.binding_verified AND ack.provider_ref=f.provider_ref
   AND ack.application_fee_ref=f.application_fee_ref AND ack.amount_minor=f.amount_minor AND ack.currency=f.currency))) THEN RETURN;END IF;
 known:=false;receipt_id:=original_receipt.id;reconciled:=false;
 SELECT * INTO bank_row FROM freeholder_controlled_receipt_bank_observation(
  (SELECT collection_id FROM controlled_cash_application_links l JOIN controlled_cash_application_batches b ON b.id=l.batch_id WHERE l.payment_id=target_payment),original_receipt.id);
 IF bank_row.actual_inspection_id IS NOT NULL THEN inspection_id:=bank_row.actual_inspection_id;observation_id:=bank_row.actual_observation_id;bank_namespace_revision:=bank_row.bank_fingerprint;END IF;
 -- Report actual bank-retained fee, never an inferred collected balance while
 -- an unknown/dashboard refund is still unassigned. A read older than an
 -- accepted positive ACK cannot outweigh that retained money fact.
 IF bank_row.actual_inspection_id IS NOT NULL AND bank_row.current_evidence->>'amountRefundedMinor'=parent_row.refunded_minor::text THEN
  IF route_row.application_fee_minor=0 AND target_row.original_fee_ref IS NULL AND bank_row.current_evidence->'fee'='null'::jsonb AND returned_fee=0 THEN
   known:=true;actual_retained_fee_minor:=0;
  ELSIF bank_row.current_evidence->'fee'->>'providerRef'=target_row.original_fee_ref
   AND bank_row.current_evidence->'fee'->>'originatingChargeRef'=original_receipt.provider_charge_ref
   AND bank_row.current_evidence->'fee'->>'accountId'=route_row.recipient_account_id
   AND bank_row.current_evidence->'fee'->>'currency'=parent_row.currency
   AND bank_row.current_evidence->'fee'->>'amountMinor'=route_row.application_fee_minor::text
   AND coalesce(bank_row.current_evidence->'fee'->>'refundedMinor','') ~ '^[0-9]+$'
   AND (bank_row.current_evidence->'fee'->>'refundedMinor')::numeric BETWEEN returned_fee AND route_row.application_fee_minor THEN
   known:=true;actual_retained_fee_minor:=route_row.application_fee_minor-(bank_row.current_evidence->'fee'->>'refundedMinor')::numeric;
  END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM freeholder_atomic_fee_return_resources(target_payment) physical WHERE NOT physical.known OR physical.pending)
  AND NOT EXISTS(SELECT 1 FROM merchant_fee_refunds f WHERE f.payment_id=target_payment AND f.status IN('reserved','dispatching','unknown'))
  AND NOT EXISTS(SELECT 1 FROM merchant_fee_refund_invocations actual_caller WHERE actual_caller.payment_id=target_payment AND actual_caller.finish IS NULL AND actual_caller.stop IS NULL)
  AND NOT EXISTS(SELECT 1 FROM merchant_fee_observations ack JOIN merchant_fee_refunds f ON f.id=ack.operation_id WHERE f.payment_id=target_payment AND(f.status<>'accepted' OR NOT ack.binding_verified
   OR ack.provider_ref IS DISTINCT FROM f.provider_ref OR ack.application_fee_ref IS DISTINCT FROM f.application_fee_ref OR ack.amount_minor<>f.amount_minor OR ack.currency<>f.currency))
  AND NOT EXISTS(SELECT 1 FROM merchant_payment_observations raw_fee WHERE raw_fee.payment_id=target_payment AND raw_fee.status='succeeded' AND(
   (raw_fee.observed_fee_refunded_minor IS NOT NULL AND raw_fee.observed_fee_refunded_minor>returned_fee)
   OR(raw_fee.observed_application_fee_minor IS NOT NULL AND raw_fee.observed_application_fee_minor<>route_row.application_fee_minor)
   OR(raw_fee.application_fee_ref IS NOT NULL AND raw_fee.application_fee_ref IS DISTINCT FROM target_row.original_fee_ref)))
  AND NOT EXISTS(SELECT 1 FROM merchant_fee_refund_invocations raw_source WHERE raw_source.payment_id=target_payment AND raw_source.kind='source_inspect' AND raw_source.request->>'readKind'='fee_preflight' AND raw_source.first_result IS NOT NULL AND(
   raw_source.first_result->'body'->'result'->>'source' IS DISTINCT FROM 'fee_preflight'
   OR raw_source.first_result->'body'->'result'->>'applicationFeeRef' IS DISTINCT FROM target_row.original_fee_ref
   OR raw_source.first_result->'body'->'result'->>'accountId' IS DISTINCT FROM route_row.recipient_account_id
   OR (CASE WHEN route_row.collection_kind='destination' THEN raw_source.first_result->'body'->'result'->>'originatingChargeRef' ELSE raw_source.first_result->'body'->'result'->>'chargeRef' END) IS DISTINCT FROM original_receipt.provider_charge_ref
   OR upper(raw_source.first_result->'body'->'result'->>'currency') IS DISTINCT FROM parent_row.currency
   OR raw_source.first_result->'body'->'result'->'amountMinor' IS DISTINCT FROM to_jsonb(route_row.application_fee_minor)
   OR(CASE WHEN freeholder_controlled_bank_minor(raw_source.first_result->'body'->'result'->'returnedMinor') THEN (raw_source.first_result->'body'->'result'->>'returnedMinor')::numeric>returned_fee ELSE true END)))
  AND NOT EXISTS(SELECT 1 FROM original_cash_recovery_facts raw_fact JOIN original_cash_recovery_operations raw_operation ON raw_operation.id=raw_fact.operation_id
   JOIN original_cash_recoveries raw_owner ON raw_owner.id=raw_operation.recovery_id
   WHERE(raw_owner.payment_id=target_payment OR raw_owner.subscription_charge_receipt_id=original_receipt.id) AND(
    (raw_fact.kind='state' AND raw_fact.evidence->'fee' IS NOT NULL AND raw_fact.evidence->'fee'<>'null'::jsonb AND(
     raw_fact.evidence->'fee'->>'providerRef' IS DISTINCT FROM target_row.original_fee_ref OR raw_fact.evidence->'fee'->>'amountMinor' IS DISTINCT FROM route_row.application_fee_minor::text
     OR raw_fact.evidence->'fee'->>'currency' IS DISTINCT FROM parent_row.currency OR(CASE WHEN freeholder_controlled_bank_minor(raw_fact.evidence->'fee'->'refundedMinor') THEN(raw_fact.evidence->'fee'->>'refundedMinor')::numeric>returned_fee ELSE true END)))
    OR(raw_fact.kind='parent' AND(raw_operation.kind='fee' OR EXISTS(SELECT 1 FROM original_cash_recovery_operations auxiliary WHERE auxiliary.id::text=raw_operation.request->>'auxiliaryOperationId' AND auxiliary.kind='fee')) AND(
     raw_fact.evidence->>'providerRef' IS DISTINCT FROM target_row.original_fee_ref OR raw_fact.evidence->>'accountId' IS DISTINCT FROM route_row.recipient_account_id OR raw_fact.evidence->>'chargeRef' IS DISTINCT FROM original_receipt.provider_charge_ref
     OR raw_fact.evidence->>'amountMinor' IS DISTINCT FROM route_row.application_fee_minor::text OR raw_fact.evidence->>'currency' IS DISTINCT FROM parent_row.currency
     OR(CASE WHEN freeholder_controlled_bank_minor(raw_fact.evidence->'returnedMinor') THEN(raw_fact.evidence->>'returnedMinor')::numeric>returned_fee ELSE true END)))))
  AND known AND bank_row.actual_inspection_id IS NOT NULL AND actual_retained_fee_minor=target_row.target_retained_fee_minor
  AND bank_row.current_evidence->>'amountRefundedMinor'=parent_row.refunded_minor::text
  AND ((route_row.application_fee_minor=0 AND target_row.original_fee_ref IS NULL AND bank_row.current_evidence->'fee'='null'::jsonb AND returned_fee=0)
   OR(route_row.application_fee_minor>0 AND bank_row.current_evidence->'fee'->>'providerRef'=target_row.original_fee_ref
    AND bank_row.current_evidence->'fee'->>'originatingChargeRef'=original_receipt.provider_charge_ref
    AND bank_row.current_evidence->'fee'->>'accountId'=route_row.recipient_account_id
    AND bank_row.current_evidence->'fee'->>'currency'=parent_row.currency
    AND bank_row.current_evidence->'fee'->>'amountMinor'=route_row.application_fee_minor::text
    AND bank_row.current_evidence->'fee'->>'refundedMinor'=returned_fee::text)) THEN reconciled:=true;END IF;
 RETURN NEXT;
END $$;

--> statement-breakpoint
CREATE FUNCTION freeholder_atomic_auxiliary_fee_ready() RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT coalesce(
  EXISTS(SELECT 1 FROM pg_proc installed WHERE installed.oid=to_regprocedure('freeholder_atomic_fee_return_resources(uuid)') AND encode(sha256(convert_to(installed.prosrc,'UTF8')),'hex')='cfbe55472bfece3e7ba5d67ba7e5b8285481b3cc946ed69c50a21e333e634b34')
  AND EXISTS(SELECT 1 FROM pg_proc installed WHERE installed.oid=to_regprocedure('freeholder_atomic_auxiliary_fee_target_valid(jsonb)') AND encode(sha256(convert_to(installed.prosrc,'UTF8')),'hex')='9c00662eaf2303b5eb83c03cf7101fb827caaddeb3966bc0eef2e0776af70828')
  AND EXISTS(SELECT 1 FROM pg_proc installed WHERE installed.oid=to_regprocedure('freeholder_atomic_auxiliary_fee_operation_valid(jsonb)') AND encode(sha256(convert_to(installed.prosrc,'UTF8')),'hex')='4fef21d307faa1396cbca7865ddbb868d80005a9779c208563379493cd3bbf8b')
  AND EXISTS(SELECT 1 FROM pg_proc installed WHERE installed.oid=to_regprocedure('freeholder_atomic_auxiliary_fee_closure_valid(jsonb)') AND encode(sha256(convert_to(installed.prosrc,'UTF8')),'hex')='10ed65903fc91e3d149cd073a70fe362ef1403269f6a4c0744a983cf3b643394')
  AND EXISTS(SELECT 1 FROM pg_proc installed WHERE installed.oid=to_regprocedure('freeholder_guard_original_cash_recovery()') AND encode(sha256(convert_to(installed.prosrc,'UTF8')),'hex')='1971de37dfc39be8ca4178ee86c9684e699c92e875b1de35f5d4d4b3d83758fc')
  AND EXISTS(SELECT 1 FROM pg_proc installed WHERE installed.oid=to_regprocedure('freeholder_controlled_atomic_refund_targets(uuid)') AND encode(sha256(convert_to(installed.prosrc,'UTF8')),'hex')='3674003607c940ea38100ad9f2ea6c38f848c0023a9db38acb9cc0f9f20bd9f8')
  AND EXISTS(SELECT 1 FROM pg_proc installed WHERE installed.oid=to_regprocedure('freeholder_controlled_atomic_refund_fee_state(uuid)') AND encode(sha256(convert_to(installed.prosrc,'UTF8')),'hex')='7564bec682b47fba4517097002e7c1e92da6aca21f4a7c678ddb080da08a4f3d')
  AND EXISTS(SELECT 1 FROM pg_proc installed WHERE installed.oid=to_regprocedure('freeholder_merchant_fee_invocations_ready()') AND encode(sha256(convert_to(installed.prosrc,'UTF8')),'hex')='a96a6480d97e9589b1afa5e0cd3232b169c89bc55e9620379d0996ef4e70956f')
  AND freeholder_merchant_fee_invocations_ready()
  AND (SELECT count(*) FROM pg_trigger installed WHERE installed.tgname='original_cash_recovery_guard' AND installed.tgrelid IN('original_cash_recoveries'::regclass,'original_cash_recovery_operations'::regclass,'original_cash_recovery_facts'::regclass,'original_cash_recovery_closures'::regclass) AND installed.tgfoid=to_regprocedure('freeholder_guard_original_cash_recovery()') AND installed.tgtype=31 AND installed.tgenabled IN('O','A') AND NOT installed.tgisinternal)=4
  AND EXISTS(SELECT 1 FROM pg_constraint installed WHERE installed.conrelid='original_cash_recovery_facts'::regclass AND installed.conname='original_cash_recovery_facts_kind' AND installed.contype='c' AND installed.convalidated AND pg_get_expr(installed.conbin,installed.conrelid)='(kind = ANY (ARRAY[''primary''::text, ''refund''::text, ''state''::text, ''parent''::text, ''ack''::text, ''resource''::text, ''finish''::text, ''stop''::text, ''legacy_fee_stop''::text, ''customer_request''::text, ''partial_target''::text, ''partial_closure''::text, ''unassigned_refund_review''::text, ''atomic_fee_target''::text, ''atomic_fee_closure''::text]))')
  AND EXISTS(SELECT 1 FROM pg_index installed JOIN pg_class idx ON idx.oid=installed.indexrelid WHERE installed.indrelid='original_cash_recovery_facts'::regclass AND idx.relname='original_cash_atomic_fee_target' AND installed.indisunique AND installed.indisvalid AND installed.indisready AND installed.indkey::text='2 0' AND pg_get_expr(installed.indexprs,installed.indrelid)='(evidence ->> ''targetKey''::text)' AND pg_get_expr(installed.indpred,installed.indrelid)='(kind = ''atomic_fee_target''::text)')
  AND EXISTS(SELECT 1 FROM pg_index installed JOIN pg_class idx ON idx.oid=installed.indexrelid WHERE installed.indrelid='original_cash_recovery_facts'::regclass AND idx.relname='original_cash_atomic_fee_closure' AND installed.indisunique AND installed.indisvalid AND installed.indisready AND installed.indkey::text='2 0 0' AND pg_get_expr(installed.indexprs,installed.indrelid)='(evidence ->> ''targetFactId''::text), (evidence ->> ''revision''::text)' AND pg_get_expr(installed.indpred,installed.indrelid)='(kind = ''atomic_fee_closure''::text)'),false);
$$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION freeholder_merchant_fee_invocations_ready() RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT coalesce(
  EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('freeholder_controlled_atomic_refund_targets(uuid)') AND p.provolatile='s' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='3674003607c940ea38100ad9f2ea6c38f848c0023a9db38acb9cc0f9f20bd9f8')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('freeholder_controlled_atomic_refund_fee_state(uuid)') AND p.provolatile='s' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='7564bec682b47fba4517097002e7c1e92da6aca21f4a7c678ddb080da08a4f3d')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('freeholder_original_line_fee_target_before_atomic_refund(uuid)') AND p.provolatile='s' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='af210d88b54994b428c1753d77b0a08433c1bbf99b981cb6e8a667fbf3eeecf2')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('freeholder_original_line_fee_target(uuid)') AND p.provolatile='s' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='483772f438020df8859f9f8902d9c7446b371a206faf8321b2a2cbdc0ce45eeb')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('freeholder_agreement_fee_current(uuid)') AND p.provolatile='s' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='20a4424932e49d6c5b2dd57357f04850d2a5d183360a3f3499c4dc57b0c5752e')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('guard_merchant_fee_refund()') AND p.provolatile='v' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='4d4d92c8fd172c9a46418a7ef7315118e09251324e5ffaa40b89ac4be1ff9fb9')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('freeholder_merchant_fee_require_prefix(uuid)') AND p.provolatile='s' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='0f301ca4e56a7c2437bc71e4ada88363192a9a6d7c622c703b030a5a8ca5f93c')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('freeholder_merchant_fee_invocation_guard()') AND p.provolatile='v' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='f3b31e8db5cf6858a21fa0b30cf2c9beb7b6497b33ebcbaf6fdd61583c99b54d')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('freeholder_merchant_fee_source_ready(uuid,uuid)') AND p.provolatile='s' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='87eb65b5cfb2bc7ef5db85e79d4c3e7d4b6ca9ea1eac9fc6a0d243316e6a7b56')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('freeholder_merchant_fee_post_ready(uuid)') AND p.provolatile='s' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='2f5dc99c4ca929929a9467ecbbb221f2787b7c91be430fed6f642c77cb28f6c1')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('freeholder_merchant_fee_preflight_owned(uuid)') AND p.provolatile='s' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='fc0bc6c1e344d085337315b4abf966ab2d03663577ca8e98253bc63895233abd')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('freeholder_merchant_fee_preflight_ready(uuid)') AND p.provolatile='s' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='bde7a25cccf486aa012ba744415cb0015b8266e34aa060955e36ff534166461f')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('freeholder_merchant_fee_result_owned(uuid,text)') AND p.provolatile='s' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='95fbbd9f094622245740e4a437e31a79c3a8934a5fe215972ee3c72260149699')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('freeholder_merchant_fee_birth_guard()') AND p.provolatile='v' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='32d551973c0a224908af2ea21bce08a7ad961c7a1bfb5020788d35fa632ee54f')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('freeholder_guard_original_cash_old_fee_dispatch()') AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='360ceca348dd283873a08ab37e9b4a56e178946900c35aa1fb7b5738256423b2')
  AND freeholder_controlled_subscription_route_ready()
  AND EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid='merchant_fee_refund_invocations'::regclass AND t.tgname='merchant_fee_invocation_guard' AND t.tgfoid=to_regprocedure('freeholder_merchant_fee_invocation_guard()') AND t.tgenabled IN('O','A') AND t.tgtype=31 AND NOT t.tgisinternal)
  AND EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid='merchant_fee_refunds'::regclass AND t.tgname='merchant_fee_birth_guard' AND t.tgfoid=to_regprocedure('freeholder_merchant_fee_birth_guard()') AND t.tgenabled IN('O','A') AND t.tgtype=5 AND t.tgdeferrable AND t.tginitdeferred AND NOT t.tgisinternal)
  AND EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid='merchant_fee_refunds'::regclass AND t.tgname='merchant_fee_refund_guard' AND t.tgfoid=to_regprocedure('guard_merchant_fee_refund()') AND t.tgenabled IN('O','A') AND t.tgtype=31 AND NOT t.tgisinternal)
  AND EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid='merchant_fee_refunds'::regclass AND t.tgname='original_cash_old_fee_dispatch' AND t.tgfoid=to_regprocedure('freeholder_guard_original_cash_old_fee_dispatch()') AND t.tgenabled IN('O','A') AND t.tgtype=23 AND NOT t.tgisinternal)
  AND (SELECT count(*) FROM pg_constraint c WHERE c.conrelid='merchant_fee_refund_invocations'::regclass AND c.convalidated AND c.conname IN('merchant_fee_refund_invocations_pkey','merchant_fee_invocations_operation_fk','merchant_fee_invocations_payment_fk','merchant_fee_invocations_receipt_fk','merchant_fee_invocations_kind','merchant_fee_invocations_owner','merchant_fee_invocations_source','merchant_fee_invocations_header','merchant_fee_invocations_proofs'))=9
  AND EXISTS(SELECT 1 FROM pg_index i JOIN pg_class idx ON idx.oid=i.indexrelid WHERE i.indrelid='merchant_fee_refund_invocations'::regclass AND idx.relname='merchant_fee_invocations_ordinal' AND i.indisvalid AND i.indisready AND i.indisunique=true AND i.indkey::text='2 4 6' AND i.indexprs IS NULL AND i.indpred IS NULL)
  AND EXISTS(SELECT 1 FROM pg_index i JOIN pg_class idx ON idx.oid=i.indexrelid WHERE i.indrelid='merchant_fee_refund_invocations'::regclass AND idx.relname='merchant_fee_invocations_post' AND i.indisvalid AND i.indisready AND i.indisunique=true AND i.indkey::text='5' AND i.indexprs IS NULL AND pg_get_expr(i.indpred,i.indrelid)='(kind = ''post''::text)')
  AND EXISTS(SELECT 1 FROM pg_index i JOIN pg_class idx ON idx.oid=i.indexrelid WHERE i.indrelid='merchant_fee_refund_invocations'::regclass AND idx.relname='merchant_fee_invocations_operation' AND i.indisvalid AND i.indisready AND i.indisunique=false AND i.indkey::text='5 17' AND i.indexprs IS NULL AND i.indpred IS NULL)
  AND EXISTS(SELECT 1 FROM pg_index i JOIN pg_class idx ON idx.oid=i.indexrelid WHERE i.indrelid='merchant_fee_refund_invocations'::regclass AND idx.relname='merchant_fee_invocations_receipt' AND i.indisvalid AND i.indisready AND i.indisunique=false AND i.indkey::text='3 6' AND i.indexprs IS NULL AND i.indpred IS NULL)
  AND EXISTS(SELECT 1 FROM pg_index i JOIN pg_class idx ON idx.oid=i.indexrelid WHERE i.indrelid='merchant_fee_refund_invocations'::regclass AND idx.relname='merchant_fee_invocations_preflight' AND i.indisvalid AND i.indisready AND i.indisunique=true AND i.indkey::text='0' AND pg_get_expr(i.indexprs,i.indrelid)='(request ->> ''parentFeeInvocationId''::text)' AND pg_get_expr(i.indpred,i.indrelid)='((kind = ''source_inspect''::text) AND ((request ->> ''readKind''::text) = ''fee_preflight''::text))'),false);
$$;
