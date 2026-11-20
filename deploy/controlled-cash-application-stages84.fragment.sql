-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
-- C12.38/C1.08/C9.33: OWNED UNAPPLIED continuation after the exact frozen
-- controlled-cash-application-protocol84.fragment.sql. No current SQL changes.
-- Exact actual shared canonical deltas, never a cached or public allowed flag.
CREATE FUNCTION freeholder_controlled_cash_plan_status(target_batch_uuid uuid,through_ordinal integer) RETURNS text LANGUAGE plpgsql VOLATILE AS $$
DECLARE admitted_batch controlled_cash_application_batches%ROWTYPE; actual_plan payment_plans%ROWTYPE; original_plan jsonb; delta numeric; last_settled_at timestamptz;
BEGIN
 SELECT * INTO admitted_batch FROM controlled_cash_application_batches WHERE id=target_batch_uuid;
 SELECT * INTO actual_plan FROM payment_plans WHERE invoice_id=admitted_batch.invoice_id;
 IF actual_plan.id IS NULL THEN RETURN null;END IF;
 SELECT original_row->'fields' INTO original_plan FROM jsonb_array_elements(admitted_batch.mutable_before_rows) original_row WHERE original_row->>'table'='payment_plans' AND original_row->>'id'=actual_plan.id::text;
 IF original_plan IS NULL THEN RAISE EXCEPTION 'A later plan cannot be adopted as an original application before-image' USING ERRCODE='23514';END IF;
 SELECT coalesce(sum(actual_allocation.amount_minor),0) INTO delta FROM payment_allocations actual_allocation
 JOIN controlled_cash_application_links actual_link ON actual_link.payment_id=actual_allocation.payment_id AND actual_link.batch_id=admitted_batch.id
 JOIN controlled_cash_application_receipts receipt_proof ON receipt_proof.id=actual_link.receipt_proof_id AND receipt_proof.ordinal<=through_ordinal
 JOIN payment_plan_installments actual_installment ON actual_installment.id=actual_allocation.installment_id AND actual_installment.plan_id=actual_plan.id;
 IF delta=0 THEN RETURN original_plan->>'status';END IF;
 IF(original_plan->>'paid_minor')::numeric+delta=actual_plan.principal_minor::numeric THEN RETURN 'completed';END IF;
 SELECT receipt_proof.processed_at INTO last_settled_at FROM controlled_cash_application_receipts receipt_proof
 JOIN controlled_cash_application_links actual_link ON actual_link.receipt_proof_id=receipt_proof.id AND actual_link.batch_id=admitted_batch.id
 JOIN payments actual_payment ON actual_payment.id=actual_link.payment_id AND actual_payment.status='succeeded'
 WHERE receipt_proof.ordinal<=through_ordinal ORDER BY receipt_proof.ordinal DESC LIMIT 1;
 IF last_settled_at IS NULL THEN RAISE EXCEPTION 'A planned allocation cannot supply a real settled payment date' USING ERRCODE='23514';END IF;
 IF EXISTS(SELECT 1 FROM payment_plan_installments actual_installment
  JOIN LATERAL(SELECT original_row->'fields' AS fields FROM jsonb_array_elements(admitted_batch.mutable_before_rows) original_row WHERE original_row->>'table'='payment_plan_installments' AND original_row->>'id'=actual_installment.id::text) original_installment ON true
  WHERE actual_installment.plan_id=actual_plan.id AND actual_installment.due_at<last_settled_at
   AND(original_installment.fields->>'paid_minor')::numeric+coalesce((SELECT sum(actual_allocation.amount_minor) FROM payment_allocations actual_allocation
    JOIN controlled_cash_application_links actual_link ON actual_link.payment_id=actual_allocation.payment_id AND actual_link.batch_id=admitted_batch.id
    JOIN controlled_cash_application_receipts receipt_proof ON receipt_proof.id=actual_link.receipt_proof_id AND receipt_proof.ordinal<=through_ordinal
    WHERE actual_allocation.installment_id=actual_installment.id),0)<actual_installment.amount_minor::numeric) THEN RETURN 'defaulted';END IF;
 RETURN 'active';
END $$;
--> statement-breakpoint
CREATE FUNCTION freeholder_controlled_cash_before_settlement(target_payment_uuid uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
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
  OR(SELECT count(*) FROM agreement_fee_cash_assignments original_fee WHERE original_fee.payment_id=payment_record.id)<>CASE WHEN EXISTS(SELECT 1 FROM agreement_fee_duties actual_duty WHERE actual_duty.invoice_id=batch_record.invoice_id) THEN 1 ELSE 0 END
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
-- Replace ONLY our own frozen first-birth function. Every previous immutable
-- admission/actual UUID rule remains; genuine exact staged prefix proof now
-- permits the next receipt instead of its explicit incomplete-first-leaf refusal.
CREATE OR REPLACE FUNCTION freeholder_controlled_cash_link_created_payment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE receipt_record controlled_cash_application_receipts%ROWTYPE; batch_record controlled_cash_application_batches%ROWTYPE;
BEGIN
 SELECT * INTO receipt_record FROM controlled_cash_application_receipts WHERE payment_idempotency_key=NEW.idempotency_key;
 IF receipt_record.id IS NULL THEN
  IF NEW.idempotency_key LIKE 'controlled-receipt:%' THEN RAISE EXCEPTION 'The controlled receipt namespace requires its actual immutable bank/parent batch admission' USING ERRCODE='23514';END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO batch_record FROM controlled_cash_application_batches WHERE id=receipt_record.batch_id;
 PERFORM freeholder_controlled_cash_require_prefix(batch_record.resource_id);
 PERFORM freeholder_controlled_cash_validate_birth(batch_record.id,NEW.id);
 INSERT INTO controlled_cash_application_links(receipt_id,receipt_proof_id,batch_id,payment_id,created_payment_fingerprint)
 VALUES(receipt_record.receipt_id,receipt_record.id,batch_record.id,NEW.id,encode(sha256(convert_to(to_jsonb(NEW)::text,'UTF8')),'hex'));
 -- The real newborn link lets exact normalization distinguish this one created
 -- row from every foreign pending caller. A refusal rolls both rows back.
 PERFORM freeholder_controlled_cash_stage(batch_record.id,receipt_record.receipt_id,NEW.id);
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION freeholder_controlled_cash_guard_payment_transition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE link_record controlled_cash_application_links%ROWTYPE; receipt_record controlled_cash_application_receipts%ROWTYPE; batch_record controlled_cash_application_batches%ROWTYPE; original_receipt subscription_provider_charge_receipts%ROWTYPE;
BEGIN
 SELECT * INTO link_record FROM controlled_cash_application_links WHERE payment_id=OLD.id;
 IF link_record.receipt_id IS NULL THEN RETURN NEW;END IF;
 SELECT * INTO batch_record FROM controlled_cash_application_batches WHERE id=link_record.batch_id;
 -- Later genuine refunds/disputes on committed original payments remain under
 -- their existing strict default guards. No old batch is a new application.
 IF batch_record.admission_transaction_id IS DISTINCT FROM txid_current()::text THEN RETURN NEW;END IF;
 SELECT * INTO receipt_record FROM controlled_cash_application_receipts WHERE id=link_record.receipt_proof_id;
 SELECT * INTO original_receipt FROM subscription_provider_charge_receipts WHERE id=receipt_record.receipt_id;
 IF(to_jsonb(NEW)-'status'-'provider_ref'-'processed_at'-'failure_code'-'failure_message'-'updated_at') IS DISTINCT FROM(to_jsonb(OLD)-'status'-'provider_ref'-'processed_at'-'failure_code'-'failure_message'-'updated_at')
  OR NEW.updated_at IS DISTINCT FROM now() OR NEW.failure_code IS NOT NULL OR NEW.failure_message IS NOT NULL
  OR(OLD.status='created' AND NEW.status='processing' AND NEW.processed_at IS NULL AND(NEW.provider_ref IS NULL OR NEW.provider_ref=original_receipt.provider_payment_intent_ref)
   OR OLD.status IN('created','processing') AND NEW.status='succeeded' AND NEW.provider_ref=original_receipt.provider_payment_intent_ref AND NEW.processed_at=receipt_record.processed_at) IS NOT TRUE THEN
  RAISE EXCEPTION 'Only the exact actual shared created/processing-to-succeeded money delta may cross this immutable admission; no failure/rebind/refund/access mutation' USING ERRCODE='23514';END IF;
 IF NEW.status='succeeded' THEN PERFORM freeholder_controlled_cash_before_settlement(OLD.id);
 ELSE PERFORM freeholder_controlled_cash_stage(batch_record.id,receipt_record.receipt_id,OLD.id);END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER controlled_cash_payment_transition BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION freeholder_controlled_cash_guard_payment_transition();
--> statement-breakpoint
CREATE FUNCTION freeholder_controlled_cash_application_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE batch_uuid uuid; batch_record controlled_cash_application_batches%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='controlled_cash_application_batches' THEN batch_uuid=NEW.id;
 ELSIF TG_TABLE_NAME IN('controlled_cash_application_receipts','controlled_cash_application_links') THEN batch_uuid=NEW.batch_id;
 ELSIF TG_TABLE_NAME='payments' THEN SELECT actual_link.batch_id INTO batch_uuid FROM controlled_cash_application_links actual_link JOIN controlled_cash_application_batches actual_batch ON actual_batch.id=actual_link.batch_id AND actual_batch.admission_transaction_id=txid_current()::text WHERE actual_link.payment_id=NEW.id;
 ELSIF TG_TABLE_NAME='invoices' THEN
  FOR batch_record IN SELECT actual_batch.* FROM controlled_cash_application_batches actual_batch WHERE actual_batch.invoice_id=NEW.id AND actual_batch.admission_transaction_id=txid_current()::text LOOP
   PERFORM freeholder_controlled_cash_stage(batch_record.id,null,null);
  END LOOP;
  RETURN null;
 END IF;
 IF batch_uuid IS NOT NULL THEN PERFORM freeholder_controlled_cash_stage(batch_uuid,null,null);END IF;
 RETURN null;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER controlled_cash_batch_complete AFTER INSERT ON controlled_cash_application_batches DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION freeholder_controlled_cash_application_complete();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER controlled_cash_receipt_complete AFTER INSERT ON controlled_cash_application_receipts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION freeholder_controlled_cash_application_complete();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER controlled_cash_link_complete AFTER INSERT ON controlled_cash_application_links DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION freeholder_controlled_cash_application_complete();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER controlled_cash_payment_complete AFTER INSERT OR UPDATE ON payments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION freeholder_controlled_cash_application_complete();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER controlled_cash_invoice_complete AFTER UPDATE ON invoices DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION freeholder_controlled_cash_application_complete();
--> statement-breakpoint
-- A stage is evidence of the exact actual canonical prefix, not bank/parent
-- authorization. A linked CURRENT created row may be observed between shared
-- service statements; only the separate strict settlement boundary below can
-- change its money status. NULL receipt means strict COMPLETE batch proof.
CREATE FUNCTION freeholder_controlled_cash_stage(target_batch_uuid uuid,target_receipt_uuid uuid DEFAULT null,target_payment_uuid uuid DEFAULT null) RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
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
  IF route_count>1 OR fee_count>CASE WHEN has_duty THEN 1 ELSE 0 END OR observation_count>1 OR created_count>1 OR processing_count>1 OR succeeded_count>1
   OR payment_record.status='created' AND(processing_count<>0 OR succeeded_count<>0) OR payment_record.status='processing' AND(created_count<>1 OR processing_count<>1 OR succeeded_count<>0)
   OR payment_record.status='succeeded' AND(route_count<>1 OR fee_count<>CASE WHEN has_duty THEN 1 ELSE 0 END OR observation_count<>1 OR created_count<>1 OR succeeded_count<>1) THEN
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
   IF invoice_event_count<>CASE WHEN expected_from IS DISTINCT FROM expected_to THEN 1 ELSE 0 END OR plan_event_count<>CASE WHEN plan_from IS DISTINCT FROM plan_to THEN 1 ELSE 0 END THEN
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
CREATE FUNCTION freeholder_controlled_cash_validate_birth(target_batch_uuid uuid,target_payment_uuid uuid) RETURNS uuid LANGUAGE plpgsql VOLATILE AS $$
DECLARE batch_record controlled_cash_application_batches%ROWTYPE; receipt_record controlled_cash_application_receipts%ROWTYPE; payment_record payments%ROWTYPE;
BEGIN
 SELECT * INTO batch_record FROM controlled_cash_application_batches WHERE id=target_batch_uuid;
 SELECT * INTO payment_record FROM payments WHERE id=target_payment_uuid;
 SELECT * INTO receipt_record FROM controlled_cash_application_receipts WHERE batch_id=target_batch_uuid AND payment_idempotency_key=payment_record.idempotency_key;
 IF batch_record.id IS NULL OR receipt_record.id IS NULL OR payment_record.id IS NULL OR batch_record.admission_transaction_id IS DISTINCT FROM txid_current()::text
  OR payment_record.invoice_id IS DISTINCT FROM batch_record.invoice_id OR payment_record.provider IS DISTINCT FROM 'stripe' OR payment_record.method IS DISTINCT FROM 'provider_schedule'
  OR payment_record.status IS DISTINCT FROM 'created' OR payment_record.amount_minor IS DISTINCT FROM receipt_record.amount_minor OR payment_record.currency IS DISTINCT FROM receipt_record.currency
  OR payment_record.request_hash IS DISTINCT FROM receipt_record.payment_request_hash OR payment_record.metadata IS DISTINCT FROM '{}'::jsonb OR payment_record.refunded_minor<>0
  OR payment_record.provider_ref IS NOT NULL OR payment_record.provider_checkout_ref IS NOT NULL OR payment_record.processed_at IS NOT NULL OR payment_record.failed_at IS NOT NULL
  OR payment_record.failure_code IS NOT NULL OR payment_record.failure_message IS NOT NULL OR payment_record.created_at IS DISTINCT FROM now() OR payment_record.updated_at IS DISTINCT FROM payment_record.created_at
  OR EXISTS(SELECT 1 FROM controlled_cash_application_links actual_link WHERE actual_link.payment_id=payment_record.id OR actual_link.receipt_id=receipt_record.receipt_id)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(batch_record.before_entries) original_entry WHERE original_entry->>'table'='payments' AND original_entry->>'id'=payment_record.id::text)
  OR NOT EXISTS(SELECT 1 FROM payments actual_payment WHERE actual_payment.id=payment_record.id AND actual_payment.xmin::text::numeric=mod(txid_current()::numeric,4294967296)) THEN
  RAISE EXCEPTION 'Require the actual same-transaction generated created-payment UUID and exact original receipt request; never adopt a planned or historical payment' USING ERRCODE='23514';END IF;
 RETURN receipt_record.receipt_id;
END $$;
--> statement-breakpoint
CREATE FUNCTION freeholder_controlled_cash_require_current_locks(target_batch_uuid uuid) RETURNS void LANGUAGE plpgsql VOLATILE AS $$
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
   AND actual_lock.classid::bigint=CASE WHEN hashtext(required_key)<0 THEN 4294967295::bigint ELSE 0::bigint END
   AND actual_lock.objid::bigint=(hashtext(required_key)::bigint & 4294967295::bigint)) THEN
   RAISE EXCEPTION 'The full current original canonical/credit/cash namespace locks must ALREADY be held; no late reverse acquisition or caller flag' USING ERRCODE='23514';END IF;
 END LOOP;
END $$;
--> statement-breakpoint
-- Full CURRENT remains physically intact. This separate comparison reconstructs
-- only the explicitly verified actual own canonical deltas. Every other newly
-- discovered row/changed before-row, including an external raw callback, fails.
CREATE FUNCTION freeholder_controlled_cash_normalized_parent(target_batch_uuid uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
DECLARE batch_record controlled_cash_application_batches%ROWTYPE; current_snapshot jsonb; original_entry jsonb; current_entry jsonb; normalized_entries jsonb='[]'::jsonb; plan_entries jsonb;
 normalized_fingerprint text; normalized_revision text; linked_payment_uuid uuid; own_receipt_uuid uuid; original_fee_record agreement_fee_cash_assignments%ROWTYPE;
BEGIN
 SELECT * INTO batch_record FROM controlled_cash_application_batches WHERE id=target_batch_uuid;
 IF batch_record.id IS NULL OR batch_record.admission_transaction_id IS DISTINCT FROM txid_current()::text THEN RAISE EXCEPTION 'An immutable original current transaction is required for canonical normalization' USING ERRCODE='23514';END IF;
 PERFORM freeholder_controlled_cash_require_current_locks(batch_record.id);
 PERFORM freeholder_controlled_cash_receipts_complete(batch_record.id);
 current_snapshot=freeholder_controlled_cash_parent_snapshot(batch_record.collection_id);
 SELECT coalesce(jsonb_agg(jsonb_build_object('table',normalized_plan.family,'id',normalized_plan.identity,'fingerprint',normalized_plan.fingerprint,'hashDomain','postgres_row')),'[]'::jsonb)
 INTO plan_entries FROM freeholder_controlled_cash_normalized_plans(batch_record.id) normalized_plan;
 FOR original_entry IN SELECT value FROM jsonb_array_elements(batch_record.before_entries) WITH ORDINALITY original_rows(value,ordinal) ORDER BY ordinal LOOP
  SELECT value INTO current_entry FROM jsonb_array_elements(current_snapshot->'entries') WHERE value->>'table'=original_entry->>'table' AND value->>'id'=original_entry->>'id';
  IF current_entry IS NULL THEN RAISE EXCEPTION 'A retained original physical financial row is missing; application cannot erase its debt' USING ERRCODE='23514';END IF;
  normalized_fingerprint=current_entry->>'fingerprint';
  IF original_entry->>'table'='invoices' AND original_entry->>'id'=batch_record.invoice_id::text THEN normalized_fingerprint=freeholder_controlled_cash_normalized_invoice(batch_record.id);
  ELSIF EXISTS(SELECT 1 FROM jsonb_array_elements(plan_entries) normalized_plan WHERE normalized_plan->>'table'=original_entry->>'table' AND normalized_plan->>'id'=original_entry->>'id') THEN
   SELECT normalized_plan->>'fingerprint' INTO normalized_fingerprint FROM jsonb_array_elements(plan_entries) normalized_plan WHERE normalized_plan->>'table'=original_entry->>'table' AND normalized_plan->>'id'=original_entry->>'id';
  END IF;
  IF normalized_fingerprint IS DISTINCT FROM original_entry->>'fingerprint' THEN RAISE EXCEPTION 'An original source/financial/privacy/raw row changed outside the exact actual own-canonical delta' USING ERRCODE='23514';END IF;
  normalized_entries=normalized_entries||jsonb_build_array(jsonb_build_object('table',original_entry->>'table','id',original_entry->>'id','fingerprint',normalized_fingerprint,'hashDomain','postgres_row'));
 END LOOP;
 FOR current_entry IN SELECT current_rows.value FROM jsonb_array_elements(current_snapshot->'entries') current_rows(value) WHERE NOT EXISTS(
  SELECT 1 FROM jsonb_array_elements(batch_record.before_entries) original_rows(value) WHERE original_rows.value->>'table'=current_rows.value->>'table' AND original_rows.value->>'id'=current_rows.value->>'id') LOOP
  CASE current_entry->>'table'
  WHEN 'controlled_cash_application_batches' THEN
   IF current_entry->>'id' IS DISTINCT FROM batch_record.id::text THEN RAISE EXCEPTION 'Another batch is not an own application effect' USING ERRCODE='23514';END IF;
  WHEN 'controlled_cash_application_receipts' THEN
   IF NOT EXISTS(SELECT 1 FROM controlled_cash_application_receipts actual_proof WHERE actual_proof.batch_id=batch_record.id AND actual_proof.id::text=current_entry->>'id') THEN RAISE EXCEPTION 'Another receipt admission remains current debt' USING ERRCODE='23514';END IF;
  WHEN 'controlled_cash_application_links' THEN
   IF NOT EXISTS(SELECT 1 FROM controlled_cash_application_links actual_link WHERE actual_link.batch_id=batch_record.id AND actual_link.receipt_id::text=current_entry->>'id' AND actual_link.created_at=now()) THEN RAISE EXCEPTION 'Another lifetime receipt link is not this actual canonical delta' USING ERRCODE='23514';END IF;
  WHEN 'payments' THEN
   SELECT actual_link.payment_id INTO linked_payment_uuid FROM controlled_cash_application_links actual_link WHERE actual_link.batch_id=batch_record.id AND actual_link.payment_id::text=current_entry->>'id';
   IF linked_payment_uuid IS NULL THEN RAISE EXCEPTION 'An unowned new payment remains current financial debt' USING ERRCODE='23514';END IF;
   PERFORM freeholder_controlled_cash_normalized_payment(linked_payment_uuid);
  WHEN 'merchant_agreement_payment_routes' THEN
   SELECT actual_link.payment_id INTO linked_payment_uuid FROM controlled_cash_application_links actual_link WHERE actual_link.batch_id=batch_record.id AND actual_link.payment_id::text=current_entry->>'id';
   IF linked_payment_uuid IS NULL THEN RAISE EXCEPTION 'A foreign new route cannot be removed as an own effect' USING ERRCODE='23514';END IF;PERFORM freeholder_controlled_cash_validate_route(linked_payment_uuid);
  WHEN 'merchant_payment_observations' THEN
   IF NOT EXISTS(SELECT 1 FROM merchant_payment_observations actual_observation JOIN controlled_cash_application_links actual_link ON actual_link.payment_id=actual_observation.payment_id AND actual_link.batch_id=batch_record.id WHERE actual_observation.id::text=current_entry->>'id') THEN RAISE EXCEPTION 'A new unowned/late raw observation remains current debt' USING ERRCODE='23514';END IF;
   PERFORM freeholder_controlled_cash_validate_observation((current_entry->>'id')::uuid);
  WHEN 'agreement_fee_cash_assignments' THEN
   SELECT actual_fee.* INTO original_fee_record FROM agreement_fee_cash_assignments actual_fee JOIN controlled_cash_application_links actual_link ON actual_link.payment_id=actual_fee.payment_id AND actual_link.batch_id=batch_record.id
    JOIN controlled_cash_application_receipts actual_proof ON actual_proof.id=actual_link.receipt_proof_id
    WHERE actual_fee.payment_id::text=current_entry->>'id' AND actual_fee.invoice_id=batch_record.invoice_id AND actual_fee.amount_minor=actual_proof.amount_minor AND actual_fee.fee_obligation_minor=actual_proof.fee_minor AND actual_fee.origin='provider' AND actual_fee.created_at=now();
   IF original_fee_record.payment_id IS NULL OR original_fee_record.original_evidence_digest IS DISTINCT FROM freeholder_controlled_cash_fee_evidence(original_fee_record.payment_id) THEN
    RAISE EXCEPTION 'Every new actual fee assignment must preserve its exact original commercial owner/body and current receipt allocation; no invented collected fee' USING ERRCODE='23514';END IF;
  WHEN 'payment_allocations' THEN
   IF NOT EXISTS(SELECT 1 FROM payment_allocations actual_allocation JOIN controlled_cash_application_links actual_link ON actual_link.payment_id=actual_allocation.payment_id AND actual_link.batch_id=batch_record.id
    JOIN payment_plan_installments actual_installment ON actual_installment.id=actual_allocation.installment_id JOIN payment_plans actual_plan ON actual_plan.id=actual_installment.plan_id AND actual_plan.invoice_id=batch_record.invoice_id
    WHERE actual_allocation.id::text=current_entry->>'id' AND actual_allocation.created_at=now()) THEN RAISE EXCEPTION 'Only independently proved actual original FIFO allocation rows may be own effects' USING ERRCODE='23514';END IF;
  WHEN 'money_state_events' THEN PERFORM freeholder_controlled_cash_validate_state_event((current_entry->>'id')::uuid);
  ELSE RAISE EXCEPTION 'Every other new raw/financial/privacy/caller row stays effective; no marker, reason filter or later zero can clear it' USING ERRCODE='23514';
  END CASE;
 END LOOP;
 IF normalized_entries IS DISTINCT FROM batch_record.before_entries THEN RAISE EXCEPTION 'Reconstruction must preserve the complete original table/identity/hash set without omissions' USING ERRCODE='23514';END IF;
 SELECT encode(sha256(convert_to(string_agg((entry->>'table')||':'||(entry->>'id')||':'||(entry->>'fingerprint'),E'\n' ORDER BY entry->>'table',entry->>'id'),'UTF8')),'hex') INTO normalized_revision FROM jsonb_array_elements(normalized_entries) entry;
 IF normalized_revision IS DISTINCT FROM batch_record.parent_pg_revision THEN RAISE EXCEPTION 'The normalized PG parent preimage must exactly match its own immutable PG domain' USING ERRCODE='23514';END IF;
 RETURN jsonb_build_object('batchId',batch_record.id,'collectionId',batch_record.collection_id,'normalizedParentRevision',normalized_revision,'currentParentRevision',current_snapshot->>'revision','currentEntries',current_snapshot->'entries','physicalRowCount',current_snapshot->'physicalRowCount');
END $$;
--> statement-breakpoint
CREATE FUNCTION freeholder_controlled_cash_validate_state_event(target_event_uuid uuid) RETURNS void LANGUAGE plpgsql VOLATILE AS $$
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
    OR event_record.to_state='succeeded' AND payment_record.status='succeeded' AND event_record.from_state=CASE WHEN EXISTS(SELECT 1 FROM money_state_events processing_event WHERE processing_event.subject_type='payment' AND processing_event.subject_id=payment_record.id AND processing_event.from_state='created' AND processing_event.to_state='processing') THEN 'processing' ELSE 'created' END) IS NOT TRUE THEN
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
-- The exact canonical fee body below contains only this fixed ASCII-keyed
-- commercial shape, ASCII identifiers/enums and safe integers. This is the
-- explicitly named JS-canonical digest domain, NEVER a PG full-row hash.
CREATE FUNCTION freeholder_controlled_cash_ascii_canonical(actual_value jsonb) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE result text;
BEGIN
 CASE jsonb_typeof(actual_value)
 WHEN 'object' THEN
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(actual_value) actual_key WHERE actual_key !~ '^[a-z][A-Za-z0-9]*$')
   OR(SELECT count(*)<>count(DISTINCT lower(actual_key)) FROM jsonb_object_keys(actual_value) actual_key) THEN RAISE EXCEPTION 'Unsupported canonical commercial body key' USING ERRCODE='23514';END IF;
  -- The fixed source keys have distinct case-folded identities. JS localeCompare
  -- orders originalChargeReceiptId before originKind; raw byte/C order does NOT.
  -- Explicit folded ASCII order matches that known commercial shape, refusing
  -- unsupported case-only key collisions rather than guessing a collation.
  SELECT '{'||coalesce(string_agg(to_jsonb(actual_key)::text||':'||freeholder_controlled_cash_ascii_canonical(actual_item),',' ORDER BY lower(actual_key) COLLATE "C"),'')||'}' INTO result FROM jsonb_each(actual_value) entry(actual_key,actual_item);RETURN result;
 WHEN 'array' THEN
  SELECT '['||coalesce(string_agg(freeholder_controlled_cash_ascii_canonical(actual_item),',' ORDER BY ordinal),'')||']' INTO result FROM jsonb_array_elements(actual_value) WITH ORDINALITY entry(actual_item,ordinal);RETURN result;
 WHEN 'number' THEN
  IF actual_value::text !~ '^[0-9]+$' OR(actual_value::text)::numeric>9007199254740991 THEN RAISE EXCEPTION 'Unsupported noninteger commercial hash amount' USING ERRCODE='23514';END IF;RETURN actual_value::text;
 WHEN 'string' THEN
  IF actual_value#>>'{}' !~ '^[ -~]*$' THEN RAISE EXCEPTION 'Unsupported non-ASCII original commercial evidence field' USING ERRCODE='23514';END IF;RETURN actual_value::text;
 WHEN 'boolean' THEN RETURN actual_value::text;
 WHEN 'null' THEN RETURN 'null';
 ELSE RAISE EXCEPTION 'Missing actual canonical commercial body' USING ERRCODE='23514';
 END CASE;
END $$;
--> statement-breakpoint
CREATE FUNCTION freeholder_controlled_cash_fee_evidence(target_payment_uuid uuid) RETURNS text LANGUAGE plpgsql VOLATILE AS $$
DECLARE payment_record payments%ROWTYPE; route_record merchant_agreement_payment_routes%ROWTYPE; duty_record agreement_fee_duties%ROWTYPE; commercial_body jsonb;
BEGIN
 SELECT * INTO payment_record FROM payments WHERE id=target_payment_uuid;
 SELECT * INTO route_record FROM merchant_agreement_payment_routes WHERE payment_id=target_payment_uuid;
 SELECT * INTO duty_record FROM agreement_fee_duties WHERE invoice_id=payment_record.invoice_id;
 IF payment_record.id IS NULL OR route_record.payment_id IS NULL OR duty_record.invoice_id IS NULL THEN RAISE EXCEPTION 'Require this actual provider payment, original route and gross fee duty before deriving its commercial evidence body' USING ERRCODE='23514';END IF;
 commercial_body=jsonb_build_object('originalOwnerDigest',duty_record.original_owner_digest,'payment',jsonb_build_object(
  'id',payment_record.id,'invoiceId',payment_record.invoice_id,'provider',payment_record.provider,'method',payment_record.method,'currency',payment_record.currency,'amountMinor',payment_record.amount_minor,'requestHash',payment_record.request_hash,
  'createdAt',to_char(payment_record.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),'record',null,'route',jsonb_build_object(
  'paymentId',route_record.payment_id,'subscriptionId',route_record.subscription_id,'agreementRoutingVersion',route_record.agreement_routing_version,'collectionKind',route_record.collection_kind,
  'providerPlatformAccountId',route_record.provider_platform_account_id,'chargeAccountId',route_record.charge_account_id,'recipientAccountId',route_record.recipient_account_id,'settlementMerchantAccountId',route_record.settlement_merchant_account_id,
  'applicationFeeMinor',route_record.application_fee_minor,'providerApiVersion',route_record.provider_api_version,'originKind',route_record.origin_kind,'providerSubscriptionRef',route_record.provider_subscription_ref,
  'providerInvoiceRef',route_record.provider_invoice_ref,'providerPaymentIntentRef',route_record.provider_payment_intent_ref,'providerChargeRef',route_record.provider_charge_ref,'originalChargeReceiptId',route_record.original_charge_receipt_id,
  'createdAt',to_char(route_record.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
 RETURN encode(sha256(convert_to(freeholder_controlled_cash_ascii_canonical(commercial_body),'UTF8')),'hex');
END $$;
--> statement-breakpoint
CREATE FUNCTION freeholder_controlled_cash_validate_route(target_payment_uuid uuid) RETURNS void LANGUAGE plpgsql VOLATILE AS $$
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
  OR route_record.collection_kind IS DISTINCT FROM CASE WHEN resource_record.original_scope->>'destinationAccountId' IS NOT NULL THEN 'destination' ELSE 'direct' END
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
CREATE FUNCTION freeholder_controlled_cash_validate_observation(target_observation_uuid uuid) RETURNS void LANGUAGE plpgsql VOLATILE AS $$
DECLARE observation_record merchant_payment_observations%ROWTYPE; link_record controlled_cash_application_links%ROWTYPE; receipt_record controlled_cash_application_receipts%ROWTYPE; batch_record controlled_cash_application_batches%ROWTYPE;
 route_record merchant_agreement_payment_routes%ROWTYPE; bank_record record; expected_observation jsonb;
BEGIN
 SELECT * INTO observation_record FROM merchant_payment_observations WHERE id=target_observation_uuid;
 SELECT * INTO link_record FROM controlled_cash_application_links WHERE payment_id=observation_record.payment_id;
 SELECT * INTO receipt_record FROM controlled_cash_application_receipts WHERE id=link_record.receipt_proof_id;
 SELECT * INTO batch_record FROM controlled_cash_application_batches WHERE id=link_record.batch_id;
 SELECT * INTO route_record FROM merchant_agreement_payment_routes WHERE payment_id=link_record.payment_id;
 IF observation_record.id IS NULL OR batch_record.id IS NULL OR receipt_record.id IS NULL OR route_record.payment_id IS NULL OR observation_record.observed_at IS DISTINCT FROM now() THEN
  RAISE EXCEPTION 'Only a genuine same-transaction exact receipt bank observation can be an own canonical delta' USING ERRCODE='23514';END IF;
 PERFORM freeholder_controlled_cash_validate_route(link_record.payment_id);
 SELECT * INTO bank_record FROM freeholder_controlled_receipt_bank_observation(batch_record.collection_id,receipt_record.receipt_id);
 expected_observation=jsonb_build_object('payment_id',link_record.payment_id,'provider_event_ref','controlled-cash-bank:'||receipt_record.bank_observation_id::text||':'||receipt_record.receipt_id::text,
  'provider_api_version','2026-10-28.endive','provider_ref',route_record.provider_payment_intent_ref,'status','succeeded','amount_minor',receipt_record.amount_minor,'currency',receipt_record.currency,
  'provider_platform_account_id',route_record.provider_platform_account_id,'charge_account_id',route_record.charge_account_id,'recipient_account_id',route_record.recipient_account_id,'settlement_merchant_account_id',route_record.settlement_merchant_account_id,
  'application_fee_minor',receipt_record.fee_minor,'provider_charge_ref',route_record.provider_charge_ref,'application_fee_ref',bank_record.current_evidence->'fee'->>'providerRef','transfer_ref',bank_record.current_evidence->'transfer'->>'providerRef',
  'route_verified',true,'customer_charge_verified',true,'application_fee_currency',coalesce(bank_record.current_evidence->'fee'->>'currency',receipt_record.currency),
  'observed_application_fee_minor',coalesce((bank_record.current_evidence->'fee'->>'amountMinor')::bigint,0),'observed_fee_refunded_minor',coalesce((bank_record.current_evidence->'fee'->>'refundedMinor')::bigint,0),'settlement_verified',true);
 IF(to_jsonb(observation_record)-'id'-'observed_at') IS DISTINCT FROM expected_observation THEN
  RAISE EXCEPTION 'Every own observation field must derive from this exact genuine returned bank capture/fee/recipient proof; no public evidence override' USING ERRCODE='23514';END IF;
END $$;
--> statement-breakpoint
-- Reconstruct ONLY the actual shared plan columns, after independently proving
-- each real payment's FIFO allocations. Whole current rows retain due dates,
-- currency, principal, cancellation, source and every other immutable field.
CREATE FUNCTION freeholder_controlled_cash_normalized_plans(target_batch_uuid uuid)
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
   IF allocation_sum IS DISTINCT FROM expected_allocation OR allocation_count<>CASE WHEN expected_allocation>0 THEN 1 ELSE 0 END THEN
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
