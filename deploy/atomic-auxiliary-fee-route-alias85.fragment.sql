-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
-- C12.38: explicit physical column reference; preserve every fee/debt predicate.
CREATE OR REPLACE FUNCTION freeholder_atomic_fee_return_resources(target_payment uuid)
RETURNS TABLE(known boolean,pending boolean,ledger text,payment_id uuid,receipt_id uuid,operation_id uuid,provider_ref text,application_fee_ref text,amount_minor bigint,currency text,evidence_fingerprint text)
LANGUAGE plpgsql STABLE AS $$
DECLARE parent_row payments%ROWTYPE;route_row merchant_agreement_payment_routes%ROWTYPE;receipt_row subscription_provider_charge_receipts%ROWTYPE;
 original_fee text;fee_record record;auxiliary record;observation record;observer original_cash_recovery_operations%ROWTYPE;
 observer_finish original_cash_recovery_facts%ROWTYPE;actual_rows jsonb:='[]'::jsonb;pending_calls boolean:=false;
 row_count bigint;resource_count bigint;actual_returned numeric;conflicting boolean;entries jsonb;
BEGIN
 SELECT * INTO parent_row FROM payments WHERE id=target_payment;
 SELECT actual_route.* INTO route_row FROM merchant_agreement_payment_routes actual_route WHERE actual_route.payment_id=target_payment;
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
CREATE OR REPLACE FUNCTION freeholder_atomic_auxiliary_fee_ready() RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT coalesce(
  EXISTS(SELECT 1 FROM pg_proc installed WHERE installed.oid=to_regprocedure('freeholder_atomic_fee_return_resources(uuid)') AND encode(sha256(convert_to(installed.prosrc,'UTF8')),'hex')='91fd305274ea123483945235f43f2bfc5cf18207eb7701f590f056c08cebdb4f')
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
