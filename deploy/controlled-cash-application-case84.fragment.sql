-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
-- C12.38: OWNED UNAPPLIED syntax-only successor AFTER frozen783 stages.
-- Frozen core/stages remain byte-identical. Parentheses only around scalar
-- CASE operands inside IF/ELSIF expressions; all complete bodies retained.
CREATE OR REPLACE FUNCTION freeholder_controlled_cash_require_prefix(target_resource_uuid uuid) RETURNS void LANGUAGE plpgsql VOLATILE AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_locks actual_lock WHERE actual_lock.pid=pg_backend_pid() AND actual_lock.locktype='advisory' AND actual_lock.granted
  AND actual_lock.database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND actual_lock.mode='ExclusiveLock' AND actual_lock.objsubid=1
  AND actual_lock.classid::bigint=(CASE WHEN hashtext('controlled-provider:'||target_resource_uuid::text)<0 THEN 4294967295::bigint ELSE 0::bigint END)
  AND actual_lock.objid::bigint=(hashtext('controlled-provider:'||target_resource_uuid::text)::bigint & 4294967295::bigint))
 OR NOT EXISTS(SELECT 1 FROM pg_locks identity_lock WHERE identity_lock.pid=pg_backend_pid() AND identity_lock.locktype='advisory' AND identity_lock.granted
  AND identity_lock.database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND identity_lock.mode IN('ShareLock','ExclusiveLock') AND identity_lock.objsubid=1
  AND ((identity_lock.classid::bigint << 32) | identity_lock.objid::bigint)=hashtext('contact-identity-privacy')::bigint) THEN
  RAISE EXCEPTION 'The actual contact/resource prefix must already be held before canonical application; never acquire it in reverse' USING ERRCODE='23514';END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION freeholder_controlled_cash_before_settlement(target_payment_uuid uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
DECLARE link_record controlled_cash_application_links%ROWTYPE; receipt_record controlled_cash_application_receipts%ROWTYPE; batch_record controlled_cash_application_batches%ROWTYPE;
 payment_record payments%ROWTYPE; stage_record jsonb; prior_cash numeric; prior_fee numeric;
BEGIN
 SELECT * INTO link_record FROM controlled_cash_application_links WHERE payment_id=target_payment_uuid;
 SELECT * INTO receipt_record FROM controlled_cash_application_receipts WHERE id=link_record.receipt_proof_id;
 SELECT * INTO batch_record FROM controlled_cash_application_batches WHERE id=link_record.batch_id;
 SELECT * INTO payment_record FROM payments WHERE id=target_payment_uuid;
 IF link_record.receipt_id IS NULL OR receipt_record.id IS NULL OR batch_record.id IS NULL OR payment_record.id IS NULL OR payment_record.status NOT IN('created','processing') THEN
  RAISE EXCEPTION 'Only a genuine newly linked original receipt can cross the current settlement boundary' USING ERRCODE='23514';END IF;
 stage_record=freeholder_controlled_cash_stage(batch_record.id,receipt_record.receipt_id,payment_record.id);
 IF(SELECT count(*) FROM merchant_agreement_payment_routes original_route WHERE original_route.payment_id=payment_record.id)<>1
  OR(SELECT count(*) FROM merchant_payment_observations original_observation WHERE original_observation.payment_id=payment_record.id)<>1
  OR(SELECT count(*) FROM agreement_fee_cash_assignments original_fee WHERE original_fee.payment_id=payment_record.id)<>(CASE WHEN EXISTS(SELECT 1 FROM agreement_fee_duties actual_duty WHERE actual_duty.invoice_id=batch_record.invoice_id) THEN 1 ELSE 0 END)
  OR(SELECT count(*) FROM money_state_events created_event WHERE created_event.subject_type='payment' AND created_event.subject_id=payment_record.id AND created_event.from_state IS NULL AND created_event.to_state='created')<>1
  OR(SELECT count(*) FROM controlled_cash_application_links earlier_link JOIN controlled_cash_application_receipts earlier_proof ON earlier_proof.id=earlier_link.receipt_proof_id AND earlier_proof.ordinal<receipt_record.ordinal
   JOIN payments earlier_payment ON earlier_payment.id=earlier_link.payment_id AND earlier_payment.status='succeeded' WHERE earlier_link.batch_id=batch_record.id)<>receipt_record.ordinal-1 THEN
  RAISE EXCEPTION 'Settle only after the actual current route, exact returned-bank observation, fee promise, creation history and every earlier real receipt are complete' USING ERRCODE='23514';END IF;
 SELECT coalesce(sum(original_payment.amount_minor),0),coalesce(sum(original_route.application_fee_minor),0) INTO prior_cash,prior_fee FROM payments original_payment
  JOIN merchant_agreement_payment_routes original_route ON original_route.payment_id=original_payment.id WHERE original_payment.invoice_id=batch_record.invoice_id AND original_payment.status='succeeded';
 IF prior_cash IS DISTINCT FROM receipt_record.prior_cash_minor::numeric OR prior_fee IS DISTINCT FROM receipt_record.prior_allocated_fee_minor::numeric THEN
  RAISE EXCEPTION 'A later frozen fee plan is usable only when its exact earlier cash/fee allocations ACTUALLY exist; no virtual paid prefix' USING ERRCODE='23514';END IF;
 RETURN stage_record;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION freeholder_controlled_cash_stage(target_batch_uuid uuid,target_receipt_uuid uuid DEFAULT null,target_payment_uuid uuid DEFAULT null) RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
DECLARE batch_record controlled_cash_application_batches%ROWTYPE; target_proof controlled_cash_application_receipts%ROWTYPE; receipt_record controlled_cash_application_receipts%ROWTYPE;
 link_record controlled_cash_application_links%ROWTYPE; payment_record payments%ROWTYPE; invoice_record invoices%ROWTYPE; bank_record record; normalized_parent jsonb; final_snapshot jsonb;
 count_links integer; count_receipts integer; route_count integer; fee_count integer; observation_count integer; created_count integer; processing_count integer; succeeded_count integer; invoice_event_count integer; plan_event_count integer;
 prior_cash numeric; prior_count integer; settled_cash numeric=0; settled_fee numeric=0; settled_ids jsonb='[]'::jsonb; bank_revisions jsonb='[]'::jsonb;
 expected_from text; expected_to text; plan_from text; plan_to text; has_duty boolean;
BEGIN
 SELECT * INTO batch_record FROM controlled_cash_application_batches WHERE id=target_batch_uuid;
 SELECT * INTO invoice_record FROM invoices WHERE id=batch_record.invoice_id;
 IF batch_record.id IS NULL OR invoice_record.id IS NULL OR batch_record.admission_transaction_id IS DISTINCT FROM txid_current()::text THEN RAISE EXCEPTION 'Only this original real transaction can prove its own canonical stage' USING ERRCODE='23514';END IF;
 IF target_receipt_uuid IS NOT NULL THEN
  SELECT * INTO target_proof FROM controlled_cash_application_receipts WHERE batch_id=batch_record.id AND receipt_id=target_receipt_uuid;
  IF target_proof.id IS NULL THEN RAISE EXCEPTION 'The target stage must be an exact actual admitted receipt UUID' USING ERRCODE='23514';END IF;
 ELSE IF target_payment_uuid IS NOT NULL THEN RAISE EXCEPTION 'A canonical payment cannot supply an unbound batch stage' USING ERRCODE='23514';END IF;END IF;
 normalized_parent=freeholder_controlled_cash_normalized_parent(batch_record.id);
 SELECT count(*) INTO count_links FROM controlled_cash_application_links WHERE batch_id=batch_record.id;
 SELECT count(*) INTO count_receipts FROM controlled_cash_application_receipts WHERE batch_id=batch_record.id;
 has_duty=EXISTS(SELECT 1 FROM agreement_fee_duties actual_duty WHERE actual_duty.invoice_id=batch_record.invoice_id);
 FOR receipt_record IN SELECT actual_proof.* FROM controlled_cash_application_receipts actual_proof WHERE actual_proof.batch_id=batch_record.id ORDER BY actual_proof.ordinal LOOP
  SELECT * INTO bank_record FROM freeholder_controlled_receipt_bank_observation(batch_record.collection_id,receipt_record.receipt_id);
  IF bank_record.actual_inspection_id IS NULL OR bank_record.actual_inspection_id IS DISTINCT FROM receipt_record.bank_inspection_id OR bank_record.actual_observation_id IS DISTINCT FROM receipt_record.bank_observation_id
   OR bank_record.immutable_bank_fingerprint IS DISTINCT FROM receipt_record.immutable_bank_revision
   OR count_links=0 AND bank_record.bank_fingerprint IS DISTINCT FROM receipt_record.namespace_revision
   OR NOT freeholder_controlled_bank_unreturned(bank_record.original_expectation||jsonb_build_object('feeMinor',receipt_record.fee_minor),bank_record.current_evidence) THEN
   RAISE EXCEPTION 'Require every exact immutable returned source bank proof plus FULL current parent normalization; never cache scalar authority across a changed namespace' USING ERRCODE='23514';END IF;
  bank_revisions=bank_revisions||jsonb_build_array(jsonb_build_object('receiptId',receipt_record.receipt_id,'immutableBankRevision',bank_record.immutable_bank_fingerprint,'currentNamespaceRevision',bank_record.bank_fingerprint));
  SELECT * INTO link_record FROM controlled_cash_application_links WHERE batch_id=batch_record.id AND receipt_proof_id=receipt_record.id AND receipt_id=receipt_record.receipt_id;
  IF link_record.receipt_id IS NULL THEN
   IF target_receipt_uuid IS NULL OR receipt_record.ordinal<target_proof.ordinal OR receipt_record.receipt_id=target_receipt_uuid AND target_payment_uuid IS NOT NULL THEN
    RAISE EXCEPTION 'A missing actual earlier payment cannot be supplied by planned receipt order or a completed-looking batch' USING ERRCODE='23514';END IF;
   CONTINUE;
  END IF;
  SELECT * INTO payment_record FROM payments WHERE id=link_record.payment_id;
  IF target_receipt_uuid IS NOT NULL AND(receipt_record.ordinal>target_proof.ordinal OR receipt_record.receipt_id=target_receipt_uuid AND link_record.payment_id IS DISTINCT FROM target_payment_uuid)
   OR payment_record.status<>'succeeded' AND(receipt_record.receipt_id IS DISTINCT FROM target_receipt_uuid OR link_record.payment_id IS DISTINCT FROM target_payment_uuid) THEN
   RAISE EXCEPTION 'Only the exact current genuine payment may be in progress; every earlier receipt must already be real settled canonical cash' USING ERRCODE='23514';END IF;
  PERFORM freeholder_controlled_cash_normalized_payment(payment_record.id);
  SELECT count(*) INTO route_count FROM merchant_agreement_payment_routes WHERE payment_id=payment_record.id;
  SELECT count(*) INTO fee_count FROM agreement_fee_cash_assignments WHERE payment_id=payment_record.id;
  SELECT count(*) INTO observation_count FROM merchant_payment_observations WHERE payment_id=payment_record.id;
  SELECT count(*) FILTER(WHERE actual_event.to_state='created'),count(*) FILTER(WHERE actual_event.to_state='processing'),count(*) FILTER(WHERE actual_event.to_state='succeeded')
   INTO created_count,processing_count,succeeded_count FROM money_state_events actual_event WHERE actual_event.subject_type='payment' AND actual_event.subject_id=payment_record.id;
  IF route_count>1 OR fee_count>(CASE WHEN has_duty THEN 1 ELSE 0 END) OR observation_count>1 OR created_count>1 OR processing_count>1 OR succeeded_count>1
   OR payment_record.status='created' AND(processing_count<>0 OR succeeded_count<>0) OR payment_record.status='processing' AND(created_count<>1 OR processing_count<>1 OR succeeded_count<>0)
   OR payment_record.status='succeeded' AND(route_count<>1 OR fee_count<>(CASE WHEN has_duty THEN 1 ELSE 0 END) OR observation_count<>1 OR created_count<>1 OR succeeded_count<>1) THEN
   RAISE EXCEPTION 'The exact real shared payment/route/fee/observation/event prefix must be complete at settlement and unique at every stage' USING ERRCODE='23514';END IF;
  IF route_count=1 THEN PERFORM freeholder_controlled_cash_validate_route(payment_record.id);END IF;
  SELECT count(*) INTO invoice_event_count FROM money_state_events actual_event WHERE actual_event.subject_type='invoice' AND actual_event.subject_id=batch_record.invoice_id AND actual_event.metadata->>'paymentId'=payment_record.id::text;
  SELECT count(*) INTO plan_event_count FROM money_state_events actual_event JOIN payment_plans actual_plan ON actual_plan.id=actual_event.subject_id AND actual_plan.invoice_id=batch_record.invoice_id WHERE actual_event.subject_type='payment_plan' AND actual_event.metadata->>'paymentId'=payment_record.id::text;
  IF payment_record.status='succeeded' THEN
   SELECT count(*),batch_record.invoice_before_paid_minor::numeric+coalesce(sum(prior_payment.amount_minor),0) INTO prior_count,prior_cash FROM controlled_cash_application_links prior_link
    JOIN controlled_cash_application_receipts prior_proof ON prior_proof.id=prior_link.receipt_proof_id AND prior_proof.ordinal<receipt_record.ordinal
    JOIN payments prior_payment ON prior_payment.id=prior_link.payment_id AND prior_payment.status='succeeded' WHERE prior_link.batch_id=batch_record.id;
   IF prior_count<>receipt_record.ordinal-1 OR prior_cash IS DISTINCT FROM receipt_record.prior_cash_minor::numeric THEN RAISE EXCEPTION 'Every cumulative plan prefix must already exist as exact actual succeeded receipts before later use' USING ERRCODE='23514';END IF;
   expected_from=CASE WHEN prior_count=0 THEN batch_record.invoice_before_status WHEN prior_cash+batch_record.invoice_before_credited_minor=invoice_record.total_minor THEN 'paid' ELSE 'partially_paid' END;
   expected_to=CASE WHEN prior_cash+receipt_record.amount_minor+batch_record.invoice_before_credited_minor=invoice_record.total_minor THEN 'paid' ELSE 'partially_paid' END;
   plan_from=freeholder_controlled_cash_plan_status(batch_record.id,receipt_record.ordinal-1);plan_to=freeholder_controlled_cash_plan_status(batch_record.id,receipt_record.ordinal);
   IF invoice_event_count<>(CASE WHEN expected_from IS DISTINCT FROM expected_to THEN 1 ELSE 0 END) OR plan_event_count<>(CASE WHEN plan_from IS DISTINCT FROM plan_to THEN 1 ELSE 0 END) THEN
    RAISE EXCEPTION 'Preserve the exact shared status-change event set; a sum alone cannot supply canonical settlement history' USING ERRCODE='23514';END IF;
   settled_cash=settled_cash+receipt_record.amount_minor;settled_fee=settled_fee+receipt_record.fee_minor;settled_ids=settled_ids||jsonb_build_array(receipt_record.receipt_id);
  ELSIF invoice_event_count<>0 OR plan_event_count<>0 THEN RAISE EXCEPTION 'An unfinished receipt cannot fabricate an invoice or plan paid effect' USING ERRCODE='23514';END IF;
 END LOOP;
 IF target_receipt_uuid IS NULL AND(count_links<>count_receipts OR jsonb_array_length(settled_ids)<>count_receipts OR settled_cash IS DISTINCT FROM batch_record.expected_cash_minor::numeric OR settled_fee IS DISTINCT FROM batch_record.expected_fee_minor::numeric) THEN
  RAISE EXCEPTION 'The whole immutable real receipt batch must conserve exact cash/fee/credit and settle atomically; partial batch refusal rolls back every canonical write' USING ERRCODE='23514';END IF;
 IF target_receipt_uuid IS NOT NULL AND NOT EXISTS(SELECT 1 FROM controlled_cash_application_links actual_link WHERE actual_link.batch_id=batch_record.id AND actual_link.receipt_id=target_receipt_uuid)
  AND count_links<>target_proof.ordinal-1 THEN RAISE EXCEPTION 'The next birth must be the exact next real receipt after a complete actual settled prefix' USING ERRCODE='23514';END IF;
 final_snapshot=freeholder_controlled_cash_parent_snapshot(batch_record.collection_id);
 IF final_snapshot->'entries' IS DISTINCT FROM normalized_parent->'currentEntries' OR final_snapshot->>'revision' IS DISTINCT FROM normalized_parent->>'currentParentRevision' THEN
  RAISE EXCEPTION 'Current external raw/financial/source evidence changed during stage verification; preserve it and refuse this money mutation' USING ERRCODE='23514';END IF;
 RETURN normalized_parent||jsonb_build_object('receiptId',target_receipt_uuid,'paymentId',target_payment_uuid,'settledReceiptIds',settled_ids,'bankRevisions',bank_revisions,'complete',target_receipt_uuid IS NULL);
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION freeholder_controlled_cash_require_current_locks(target_batch_uuid uuid) RETURNS void LANGUAGE plpgsql VOLATILE AS $$
DECLARE batch_record controlled_cash_application_batches%ROWTYPE; current_scope jsonb; required_key text;
BEGIN
 SELECT * INTO batch_record FROM controlled_cash_application_batches WHERE id=target_batch_uuid;
 IF batch_record.id IS NULL OR batch_record.admission_transaction_id IS DISTINCT FROM txid_current()::text THEN RAISE EXCEPTION 'Canonical lock evidence belongs to this genuine original transaction' USING ERRCODE='23514';END IF;
 PERFORM freeholder_controlled_cash_require_prefix(batch_record.resource_id);
 current_scope=freeholder_controlled_cash_scope(batch_record.collection_id);
 FOR required_key IN
  SELECT 'payment:'||actual_id::text FROM unnest(freeholder_controlled_cash_scope_ids(current_scope,'payments')) actual_id
   WHERE NOT EXISTS(SELECT 1 FROM controlled_cash_application_links own_link WHERE own_link.batch_id=batch_record.id AND own_link.payment_id=actual_id)
  UNION SELECT 'invoice:'||actual_id::text FROM unnest(freeholder_controlled_cash_scope_ids(current_scope,'invoices')) actual_id
  UNION SELECT 'credit-note:'||actual_id::text FROM unnest(freeholder_controlled_cash_scope_ids(current_scope,'notes')) actual_id
  UNION SELECT 'subscription-cash:'||(actual_namespace->>'platform')||':'||coalesce(actual_namespace->>'account','')||':'||(actual_namespace->>'intent') FROM jsonb_array_elements(current_scope->'namespaces') actual_namespace
 LOOP
  IF required_key IS NULL OR NOT EXISTS(SELECT 1 FROM pg_locks actual_lock WHERE actual_lock.pid=pg_backend_pid() AND actual_lock.locktype='advisory' AND actual_lock.granted
   AND actual_lock.database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND actual_lock.mode='ExclusiveLock' AND actual_lock.objsubid=1
   AND actual_lock.classid::bigint=(CASE WHEN hashtext(required_key)<0 THEN 4294967295::bigint ELSE 0::bigint END)
   AND actual_lock.objid::bigint=(hashtext(required_key)::bigint & 4294967295::bigint)) THEN
   RAISE EXCEPTION 'The full current original canonical/credit/cash namespace locks must ALREADY be held; no late reverse acquisition or caller flag' USING ERRCODE='23514';END IF;
 END LOOP;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION freeholder_controlled_cash_validate_state_event(target_event_uuid uuid) RETURNS void LANGUAGE plpgsql VOLATILE AS $$
DECLARE event_record money_state_events%ROWTYPE; link_record controlled_cash_application_links%ROWTYPE; receipt_record controlled_cash_application_receipts%ROWTYPE; batch_record controlled_cash_application_batches%ROWTYPE;
 payment_record payments%ROWTYPE; invoice_record invoices%ROWTYPE; plan_record payment_plans%ROWTYPE; expected_from text; expected_to text; prior_cash numeric; prior_count integer;
BEGIN
 SELECT * INTO event_record FROM money_state_events WHERE id=target_event_uuid;
 IF event_record.subject_type='payment' THEN SELECT * INTO link_record FROM controlled_cash_application_links WHERE payment_id=event_record.subject_id;
 ELSE SELECT * INTO link_record FROM controlled_cash_application_links WHERE payment_id::text=event_record.metadata->>'paymentId';END IF;
 SELECT * INTO receipt_record FROM controlled_cash_application_receipts WHERE id=link_record.receipt_proof_id;
 SELECT * INTO batch_record FROM controlled_cash_application_batches WHERE id=link_record.batch_id;
 SELECT * INTO payment_record FROM payments WHERE id=link_record.payment_id;
 SELECT * INTO invoice_record FROM invoices WHERE id=batch_record.invoice_id;
 IF event_record.id IS NULL OR link_record.receipt_id IS NULL OR receipt_record.id IS NULL OR batch_record.id IS NULL OR payment_record.id IS NULL
  OR batch_record.admission_transaction_id IS DISTINCT FROM txid_current()::text OR event_record.actor IS DISTINCT FROM 'system' THEN
  RAISE EXCEPTION 'Only a genuine system transition of an actual newly linked original receipt payment is an own state event' USING ERRCODE='23514';END IF;
 IF event_record.subject_type='payment' THEN
  IF event_record.subject_id IS DISTINCT FROM payment_record.id OR event_record.metadata IS DISTINCT FROM '{}'::jsonb OR event_record.reason IS NOT NULL OR event_record.occurred_at IS DISTINCT FROM now()
   OR(event_record.from_state IS NULL AND event_record.to_state='created'
    OR event_record.from_state='created' AND event_record.to_state='processing' AND payment_record.status IN('processing','succeeded')
    OR event_record.to_state='succeeded' AND payment_record.status='succeeded' AND event_record.from_state=(CASE WHEN EXISTS(SELECT 1 FROM money_state_events processing_event WHERE processing_event.subject_type='payment' AND processing_event.subject_id=payment_record.id AND processing_event.from_state='created' AND processing_event.to_state='processing') THEN 'processing' ELSE 'created' END)) IS NOT TRUE THEN
   RAISE EXCEPTION 'Preserve the exact optional created/processing/succeeded shared event chain and original system metadata' USING ERRCODE='23514';END IF;
  RETURN;
 END IF;
 IF event_record.metadata IS DISTINCT FROM jsonb_build_object('paymentId',payment_record.id,'amountMinor',payment_record.amount_minor) OR payment_record.status IS DISTINCT FROM 'succeeded' THEN
  RAISE EXCEPTION 'A planned receipt cannot supply a real invoice/plan settlement event or fabricated payment metadata' USING ERRCODE='23514';END IF;
 IF event_record.subject_type='invoice' THEN
  SELECT count(*),batch_record.invoice_before_paid_minor::numeric+coalesce(sum(prior_payment.amount_minor),0) INTO prior_count,prior_cash FROM controlled_cash_application_links prior_link
   JOIN controlled_cash_application_receipts prior_proof ON prior_proof.id=prior_link.receipt_proof_id AND prior_proof.ordinal<receipt_record.ordinal
   JOIN payments prior_payment ON prior_payment.id=prior_link.payment_id AND prior_payment.status='succeeded' WHERE prior_link.batch_id=batch_record.id;
  expected_from=CASE WHEN prior_count=0 THEN batch_record.invoice_before_status WHEN prior_cash+batch_record.invoice_before_credited_minor=invoice_record.total_minor THEN 'paid' ELSE 'partially_paid' END;
  expected_to=CASE WHEN prior_cash+receipt_record.amount_minor+batch_record.invoice_before_credited_minor=invoice_record.total_minor THEN 'paid' ELSE 'partially_paid' END;
  IF event_record.subject_id IS DISTINCT FROM batch_record.invoice_id OR event_record.reason IS DISTINCT FROM 'payment_settled' OR event_record.occurred_at IS DISTINCT FROM now()
   OR expected_from=expected_to OR event_record.from_state IS DISTINCT FROM expected_from OR event_record.to_state IS DISTINCT FROM expected_to THEN
   RAISE EXCEPTION 'Only the actual receipt ordinal and prior canonical cash/credit derive an invoice status transition' USING ERRCODE='23514';END IF;
  RETURN;
 END IF;
 IF event_record.subject_type='payment_plan' THEN
  SELECT * INTO plan_record FROM payment_plans WHERE invoice_id=batch_record.invoice_id;
  expected_from=freeholder_controlled_cash_plan_status(batch_record.id,receipt_record.ordinal-1);expected_to=freeholder_controlled_cash_plan_status(batch_record.id,receipt_record.ordinal);
  IF plan_record.id IS NULL OR event_record.subject_id IS DISTINCT FROM plan_record.id OR event_record.reason IS DISTINCT FROM 'payment_allocated' OR event_record.occurred_at IS DISTINCT FROM receipt_record.processed_at
   OR expected_from=expected_to OR event_record.from_state IS DISTINCT FROM expected_from OR event_record.to_state IS DISTINCT FROM expected_to THEN
   RAISE EXCEPTION 'Retain only an actual original FIFO plan status change at its genuine bank observation settlement date' USING ERRCODE='23514';END IF;
  RETURN;
 END IF;
 RAISE EXCEPTION 'Unrelated financial state events remain current parent debt; never erase them as own application effects' USING ERRCODE='23514';
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION freeholder_controlled_cash_validate_route(target_payment_uuid uuid) RETURNS void LANGUAGE plpgsql VOLATILE AS $$
DECLARE link_record controlled_cash_application_links%ROWTYPE; receipt_record controlled_cash_application_receipts%ROWTYPE; batch_record controlled_cash_application_batches%ROWTYPE;
 route_record merchant_agreement_payment_routes%ROWTYPE; original_receipt subscription_provider_charge_receipts%ROWTYPE; resource_record subscription_controlled_resources%ROWTYPE; bank_record record;
BEGIN
 SELECT * INTO link_record FROM controlled_cash_application_links WHERE payment_id=target_payment_uuid;
 SELECT * INTO receipt_record FROM controlled_cash_application_receipts WHERE id=link_record.receipt_proof_id;
 SELECT * INTO batch_record FROM controlled_cash_application_batches WHERE id=link_record.batch_id;
 SELECT * INTO original_receipt FROM subscription_provider_charge_receipts WHERE id=link_record.receipt_id;
 SELECT * INTO resource_record FROM subscription_controlled_resources WHERE id=batch_record.resource_id;
 SELECT * INTO route_record FROM merchant_agreement_payment_routes WHERE payment_id=target_payment_uuid;
 IF batch_record.id IS NULL OR receipt_record.id IS NULL OR original_receipt.id IS NULL OR resource_record.id IS NULL OR route_record.payment_id IS NULL
  OR batch_record.admission_transaction_id IS DISTINCT FROM txid_current()::text OR receipt_record.batch_id IS DISTINCT FROM batch_record.id OR receipt_record.receipt_id IS DISTINCT FROM original_receipt.id
  OR route_record.original_charge_receipt_id IS DISTINCT FROM original_receipt.id OR route_record.subscription_id IS DISTINCT FROM batch_record.subscription_id
  OR route_record.created_at IS DISTINCT FROM now() OR route_record.agreement_routing_version<>1 OR route_record.origin_kind IS DISTINCT FROM 'provider_schedule' OR route_record.provider_api_version IS DISTINCT FROM original_receipt.provider_api_version
  OR route_record.provider_platform_account_id IS DISTINCT FROM original_receipt.provider_platform_account_id OR route_record.charge_account_id IS DISTINCT FROM original_receipt.charge_account_id
  OR route_record.provider_subscription_ref IS DISTINCT FROM original_receipt.provider_subscription_ref OR route_record.provider_invoice_ref IS DISTINCT FROM original_receipt.provider_invoice_ref
  OR route_record.provider_payment_intent_ref IS DISTINCT FROM original_receipt.provider_payment_intent_ref OR route_record.provider_charge_ref IS DISTINCT FROM original_receipt.provider_charge_ref
  OR route_record.recipient_account_id IS DISTINCT FROM coalesce(resource_record.original_scope->>'destinationAccountId',resource_record.original_scope->>'providerAccountId')
  OR route_record.settlement_merchant_account_id IS DISTINCT FROM coalesce(resource_record.original_scope->>'settlementMerchantAccountId',resource_record.original_scope->>'providerAccountId')
  OR route_record.collection_kind IS DISTINCT FROM (CASE WHEN resource_record.original_scope->>'destinationAccountId' IS NOT NULL THEN 'destination' ELSE 'direct' END)
  OR route_record.application_fee_minor IS DISTINCT FROM receipt_record.fee_minor THEN
  RAISE EXCEPTION 'Only the actual uniquely linked receipt/payment and exact original accepted fee/recipient route may cross the controlled canonical boundary' USING ERRCODE='23514';END IF;
 PERFORM freeholder_controlled_cash_normalized_payment(target_payment_uuid);
 SELECT * INTO bank_record FROM freeholder_controlled_receipt_bank_observation(batch_record.collection_id,original_receipt.id);
 IF bank_record.actual_inspection_id IS NULL OR bank_record.actual_inspection_id IS DISTINCT FROM receipt_record.bank_inspection_id OR bank_record.actual_observation_id IS DISTINCT FROM receipt_record.bank_observation_id
  OR bank_record.immutable_bank_fingerprint IS DISTINCT FROM receipt_record.immutable_bank_revision
  OR NOT freeholder_controlled_bank_unreturned(bank_record.original_expectation||jsonb_build_object('feeMinor',receipt_record.fee_minor),bank_record.current_evidence) THEN
  RAISE EXCEPTION 'The exact current immutable returned bank/fee/recipient facts must remain genuine across our own canonical writes' USING ERRCODE='23514';END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION freeholder_controlled_cash_normalized_plans(target_batch_uuid uuid)
RETURNS TABLE(family text,identity text,fingerprint text) LANGUAGE plpgsql VOLATILE AS $$
DECLARE admitted_batch controlled_cash_application_batches%ROWTYPE; actual_plan payment_plans%ROWTYPE; original_plan jsonb; installment_record payment_plan_installments%ROWTYPE; original_installment jsonb;
 receipt_record record; remaining numeric; available numeric; expected_allocation numeric; allocation_count integer; allocation_sum numeric; prior_allocation numeric; total_delta numeric; installment_delta numeric;
 restored text; expected_status text; last_ordinal integer;
BEGIN
 SELECT * INTO admitted_batch FROM controlled_cash_application_batches WHERE id=target_batch_uuid;
 IF admitted_batch.id IS NULL OR admitted_batch.admission_transaction_id IS DISTINCT FROM txid_current()::text THEN RAISE EXCEPTION 'Normalize only the genuine current application transaction' USING ERRCODE='23514';END IF;
 SELECT * INTO actual_plan FROM payment_plans WHERE invoice_id=admitted_batch.invoice_id;
 IF actual_plan.id IS NULL THEN
  IF jsonb_array_length(admitted_batch.mutable_before_rows)<>0 OR EXISTS(SELECT 1 FROM payment_allocations actual_allocation JOIN controlled_cash_application_links actual_link ON actual_link.payment_id=actual_allocation.payment_id WHERE actual_link.batch_id=admitted_batch.id) THEN
   RAISE EXCEPTION 'A nonexistent original plan cannot own new allocations or lose a retained before-row' USING ERRCODE='23514';END IF;
  RETURN;
 END IF;
 SELECT original_row INTO original_plan FROM jsonb_array_elements(admitted_batch.mutable_before_rows) original_row WHERE original_row->>'table'='payment_plans' AND original_row->>'id'=actual_plan.id::text;
 IF original_plan IS NULL OR actual_plan.currency IS DISTINCT FROM admitted_batch.currency
  OR jsonb_array_length(admitted_batch.mutable_before_rows)<>1+(SELECT count(*) FROM payment_plan_installments actual_installment WHERE actual_installment.plan_id=actual_plan.id) THEN
  RAISE EXCEPTION 'Preserve the full exact original plan and installment set; no new/omitted principal row' USING ERRCODE='23514';END IF;
 IF EXISTS(SELECT 1 FROM payment_allocations actual_allocation JOIN controlled_cash_application_links actual_link ON actual_link.payment_id=actual_allocation.payment_id
  JOIN payments actual_payment ON actual_payment.id=actual_link.payment_id LEFT JOIN payment_plan_installments actual_installment ON actual_installment.id=actual_allocation.installment_id
  WHERE actual_link.batch_id=admitted_batch.id AND(actual_payment.status IS DISTINCT FROM 'succeeded' OR actual_installment.plan_id IS DISTINCT FROM actual_plan.id)) THEN
  RAISE EXCEPTION 'Only actual settled receipt payments can fund their exact original invoice plan' USING ERRCODE='23514';END IF;
 FOR receipt_record IN SELECT actual_proof.*,actual_payment.status AS payment_status FROM controlled_cash_application_receipts actual_proof
  JOIN controlled_cash_application_links actual_link ON actual_link.receipt_proof_id=actual_proof.id AND actual_link.batch_id=admitted_batch.id
  JOIN payments actual_payment ON actual_payment.id=actual_link.payment_id WHERE actual_proof.batch_id=admitted_batch.id ORDER BY actual_proof.ordinal LOOP
  IF receipt_record.payment_status<>'succeeded' THEN CONTINUE;END IF;
  IF original_plan->'fields'->>'status' NOT IN('active','defaulted') THEN
   IF EXISTS(SELECT 1 FROM payment_allocations actual_allocation JOIN controlled_cash_application_links actual_link ON actual_link.payment_id=actual_allocation.payment_id WHERE actual_link.receipt_proof_id=receipt_record.id) THEN
    RAISE EXCEPTION 'The unchanged shared spine does not allocate into a cancelled/completed original plan' USING ERRCODE='23514';END IF;
   CONTINUE;
  END IF;
  remaining=receipt_record.amount_minor;
  FOR installment_record IN SELECT installment_row.* FROM payment_plan_installments installment_row WHERE installment_row.plan_id=actual_plan.id ORDER BY installment_row.due_at,installment_row.position LOOP
   SELECT original_row INTO original_installment FROM jsonb_array_elements(admitted_batch.mutable_before_rows) original_row WHERE original_row->>'table'='payment_plan_installments' AND original_row->>'id'=installment_record.id::text;
   IF original_installment IS NULL THEN RAISE EXCEPTION 'Every actual installment must retain its original full-row preimage' USING ERRCODE='23514';END IF;
   SELECT coalesce(sum(actual_allocation.amount_minor),0) INTO prior_allocation FROM payment_allocations actual_allocation
    JOIN controlled_cash_application_links actual_link ON actual_link.payment_id=actual_allocation.payment_id AND actual_link.batch_id=admitted_batch.id
    JOIN controlled_cash_application_receipts prior_proof ON prior_proof.id=actual_link.receipt_proof_id AND prior_proof.ordinal<receipt_record.ordinal WHERE actual_allocation.installment_id=installment_record.id;
   available=installment_record.amount_minor::numeric-(original_installment->'fields'->>'paid_minor')::numeric-prior_allocation;
   IF available<0 THEN RAISE EXCEPTION 'Earlier actual receipts cannot allocate the same installment principal twice' USING ERRCODE='23514';END IF;
   expected_allocation=CASE WHEN original_installment->'fields'->>'status' IN('scheduled','due','partially_paid','defaulted') THEN least(remaining,available) ELSE 0 END;
   SELECT count(*),coalesce(sum(actual_allocation.amount_minor),0) INTO allocation_count,allocation_sum FROM payment_allocations actual_allocation
    JOIN controlled_cash_application_links actual_link ON actual_link.payment_id=actual_allocation.payment_id AND actual_link.receipt_proof_id=receipt_record.id WHERE actual_allocation.installment_id=installment_record.id;
   IF allocation_sum IS DISTINCT FROM expected_allocation OR allocation_count<>(CASE WHEN expected_allocation>0 THEN 1 ELSE 0 END) THEN
    RAISE EXCEPTION 'Require the exact real oldest-due/position FIFO allocation, not a sum-only plan distribution' USING ERRCODE='23514';END IF;
   remaining=remaining-expected_allocation;
  END LOOP;
  IF remaining<>0 THEN RAISE EXCEPTION 'Actual settlement cannot exceed the exact unallocated original plan principal' USING ERRCODE='23514';END IF;
 END LOOP;
 SELECT coalesce(sum(actual_allocation.amount_minor),0) INTO total_delta FROM payment_allocations actual_allocation JOIN controlled_cash_application_links actual_link ON actual_link.payment_id=actual_allocation.payment_id AND actual_link.batch_id=admitted_batch.id;
 SELECT coalesce(max(receipt_proof.ordinal),0) INTO last_ordinal FROM controlled_cash_application_receipts receipt_proof JOIN controlled_cash_application_links actual_link ON actual_link.receipt_proof_id=receipt_proof.id AND actual_link.batch_id=admitted_batch.id JOIN payments actual_payment ON actual_payment.id=actual_link.payment_id AND actual_payment.status='succeeded';
 expected_status=freeholder_controlled_cash_plan_status(admitted_batch.id,last_ordinal);
 IF actual_plan.paid_minor::numeric IS DISTINCT FROM(original_plan->'fields'->>'paid_minor')::numeric+total_delta OR actual_plan.status IS DISTINCT FROM expected_status THEN
  RAISE EXCEPTION 'The actual plan status and paid principal must derive only from its genuine allocated receipt prefix' USING ERRCODE='23514';END IF;
 restored=encode(sha256(convert_to((to_jsonb(actual_plan)||(original_plan->'fields')||jsonb_build_object('updated_at',(original_plan->'fields'->>'updated_at')::timestamptz))::text,'UTF8')),'hex');
 IF restored IS DISTINCT FROM original_plan->>'fingerprint' THEN RAISE EXCEPTION 'No other plan field can change during cash application' USING ERRCODE='23514';END IF;
 family='payment_plans';identity=actual_plan.id::text;fingerprint=restored;RETURN NEXT;
 FOR installment_record IN SELECT installment_row.* FROM payment_plan_installments installment_row WHERE installment_row.plan_id=actual_plan.id LOOP
  SELECT original_row INTO original_installment FROM jsonb_array_elements(admitted_batch.mutable_before_rows) original_row WHERE original_row->>'table'='payment_plan_installments' AND original_row->>'id'=installment_record.id::text;
  SELECT coalesce(sum(actual_allocation.amount_minor),0) INTO installment_delta FROM payment_allocations actual_allocation JOIN controlled_cash_application_links actual_link ON actual_link.payment_id=actual_allocation.payment_id AND actual_link.batch_id=admitted_batch.id WHERE actual_allocation.installment_id=installment_record.id;
  expected_status=CASE WHEN installment_delta=0 THEN original_installment->'fields'->>'status' WHEN installment_record.paid_minor=installment_record.amount_minor THEN 'paid' ELSE 'partially_paid' END;
  IF installment_record.paid_minor::numeric IS DISTINCT FROM(original_installment->'fields'->>'paid_minor')::numeric+installment_delta OR installment_record.status IS DISTINCT FROM expected_status THEN
   RAISE EXCEPTION 'Only genuine original FIFO allocations may change the exact installment paid/status columns' USING ERRCODE='23514';END IF;
  restored=encode(sha256(convert_to((to_jsonb(installment_record)||(original_installment->'fields')||jsonb_build_object('updated_at',(original_installment->'fields'->>'updated_at')::timestamptz))::text,'UTF8')),'hex');
  IF restored IS DISTINCT FROM original_installment->>'fingerprint' THEN RAISE EXCEPTION 'Preserve every other full installment row field and timestamp preimage' USING ERRCODE='23514';END IF;
  family='payment_plan_installments';identity=installment_record.id::text;fingerprint=restored;RETURN NEXT;
 END LOOP;
END $$;
