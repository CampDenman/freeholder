-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
-- C12.38/C9.33/C1.08: OWNED UNAPPLIED after genuine complete fde + c942 route.
-- Actual target protocol stays v1. Only a signed, same-TX complete atomic batch
-- selects v2 endpoint conservation; every legacy prefix rule remains in place.
ALTER TABLE controlled_cash_application_batches DROP CONSTRAINT controlled_cash_batches_protocol;
--> statement-breakpoint
ALTER TABLE controlled_cash_application_batches ADD CONSTRAINT controlled_cash_batches_protocol CHECK(protocol IN('controlled_net_gross.v1','controlled_cash_atomic.v1') AND admission_transaction_id ~ '^[0-9]+$');
--> statement-breakpoint
CREATE OR REPLACE FUNCTION freeholder_controlled_cash_guard_batch() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actual_collection subscription_controlled_collections%ROWTYPE; actual_quote subscription_controlled_quotes%ROWTYPE; actual_invoice invoices%ROWTYPE;
 actual_snapshot jsonb; actual_bank jsonb; selected_ids uuid[]; expected_cash numeric; actual_mutable jsonb;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Original controlled cash application admissions are immutable financial evidence' USING ERRCODE='23514';END IF;
 SELECT * INTO actual_collection FROM subscription_controlled_collections WHERE id=NEW.collection_id;
 SELECT * INTO actual_quote FROM subscription_controlled_quotes WHERE id=actual_collection.quote_id;
 SELECT * INTO actual_invoice FROM invoices WHERE id=actual_collection.invoice_id;
 PERFORM freeholder_controlled_cash_require_prefix(NEW.resource_id);
 IF NEW.protocol NOT IN('controlled_net_gross.v1','controlled_cash_atomic.v1') OR actual_collection.id IS NULL OR actual_quote.id IS NULL OR actual_invoice.id IS NULL OR NEW.admission_transaction_id IS DISTINCT FROM txid_current()::text
  OR actual_collection.quote_id IS DISTINCT FROM NEW.quote_id OR actual_quote.resource_id IS DISTINCT FROM NEW.resource_id
  OR NOT EXISTS(SELECT 1 FROM subscription_controlled_resources original_resource WHERE original_resource.id=NEW.resource_id AND original_resource.subscription_id=NEW.subscription_id)
  OR actual_collection.invoice_id IS DISTINCT FROM NEW.invoice_id OR actual_collection.terms_id IS DISTINCT FROM NEW.terms_id
  OR actual_collection.accepted_quote_digest IS DISTINCT FROM NEW.accepted_quote_digest OR actual_collection.canonical_target_digest IS DISTINCT FROM NEW.canonical_target_digest
  OR actual_invoice.currency IS DISTINCT FROM NEW.currency OR actual_invoice.status IS DISTINCT FROM NEW.invoice_before_status
  OR actual_invoice.paid_minor IS DISTINCT FROM NEW.invoice_before_paid_minor OR actual_invoice.credited_minor IS DISTINCT FROM NEW.invoice_before_credited_minor OR actual_invoice.refunded_minor<>0
  OR to_jsonb(actual_invoice)->>'paid_at' IS DISTINCT FROM NEW.invoice_before_paid_at OR to_jsonb(actual_invoice)->>'updated_at' IS DISTINCT FROM NEW.invoice_before_updated_at
  OR encode(sha256(convert_to(to_jsonb(actual_invoice)::text,'UTF8')),'hex') IS DISTINCT FROM NEW.invoice_before_fingerprint THEN
  RAISE EXCEPTION 'The immutable application admission must bind the exact real accepted collection and complete current canonical invoice' USING ERRCODE='23514';END IF;
 actual_snapshot=freeholder_controlled_cash_parent_snapshot(NEW.collection_id);
 IF actual_snapshot->'entries' IS DISTINCT FROM NEW.before_entries OR actual_snapshot->>'revision' IS DISTINCT FROM NEW.parent_pg_revision THEN
  RAISE EXCEPTION 'A parent admission cannot omit or rewrite any physical current source family or raw occurrence' USING ERRCODE='23514';END IF;
 SELECT coalesce(array_agg(value::uuid ORDER BY value::uuid),ARRAY[]::uuid[]) INTO selected_ids FROM jsonb_array_elements_text(NEW.requested_receipt_ids);
 IF cardinality(selected_ids) NOT BETWEEN 1 AND 5000 OR cardinality(selected_ids)<>(SELECT count(DISTINCT value) FROM unnest(selected_ids) value)
  OR NEW.requested_receipt_ids IS DISTINCT FROM to_jsonb(selected_ids) THEN RAISE EXCEPTION 'Freeze the exact sorted unique retained receipt UUID batch' USING ERRCODE='23514';END IF;
 actual_bank=freeholder_controlled_cash_bank_invoice(NEW.collection_id);
 IF EXISTS(SELECT 1 FROM unnest(selected_ids) selected_id WHERE NOT(actual_bank->'positiveReceiptIds' @> to_jsonb(ARRAY[selected_id])))
  OR EXISTS(SELECT 1 FROM merchant_agreement_payment_routes prior_route WHERE prior_route.original_charge_receipt_id=ANY(selected_ids))
  OR EXISTS(SELECT 1 FROM controlled_cash_application_links prior_link WHERE prior_link.receipt_id=ANY(selected_ids))
  OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(actual_bank->'positiveReceiptIds') bank_id WHERE NOT(bank_id::uuid=ANY(selected_ids)) AND NOT EXISTS(
   SELECT 1 FROM merchant_agreement_payment_routes original_route JOIN payments original_payment ON original_payment.id=original_route.payment_id
   WHERE original_route.original_charge_receipt_id=bank_id::uuid AND original_payment.invoice_id=NEW.invoice_id AND original_payment.status='succeeded'
    AND original_payment.refunded_minor=0 AND original_payment.provider='stripe' AND original_payment.method='provider_schedule')) THEN
  RAISE EXCEPTION 'Every actual positive bank receipt must be either exact already canonical cash or explicitly admitted new cash; no receipt reuse or value adoption' USING ERRCODE='23514';END IF;
 SELECT sum(original_receipt.amount_minor) INTO expected_cash FROM subscription_provider_charge_receipts original_receipt WHERE original_receipt.id=ANY(selected_ids) AND original_receipt.currency=NEW.currency;
 IF expected_cash IS DISTINCT FROM NEW.expected_cash_minor::numeric OR NEW.invoice_before_paid_minor::numeric+expected_cash+NEW.invoice_before_credited_minor>actual_invoice.total_minor::numeric
  OR NEW.invoice_before_paid_minor::numeric+expected_cash IS DISTINCT FROM (actual_bank->>'paidMinor')::numeric THEN
  RAISE EXCEPTION 'Preserve actual partial bank cash and unpaid remainder; never clip an overage or invent a second principal' USING ERRCODE='23514';END IF;
 -- Freeze only the exact shared plan columns that settlement may mutate, with
 -- original PG timestamp precision and full-row SHA for every affected row.
 SELECT coalesce(jsonb_agg(jsonb_build_object('table',candidate.family,'id',candidate.identity,'fingerprint',candidate.fingerprint,'fields',candidate.fields) ORDER BY candidate.family,candidate.identity),'[]'::jsonb)
 INTO actual_mutable FROM(
  SELECT 'payment_plans'::text family,actual_plan.id::text identity,encode(sha256(convert_to(to_jsonb(actual_plan)::text,'UTF8')),'hex') fingerprint,
   jsonb_build_object('paid_minor',actual_plan.paid_minor,'status',actual_plan.status,'updated_at',to_jsonb(actual_plan)->>'updated_at') fields FROM payment_plans actual_plan WHERE actual_plan.invoice_id=NEW.invoice_id
  UNION ALL SELECT 'payment_plan_installments',actual_installment.id::text,encode(sha256(convert_to(to_jsonb(actual_installment)::text,'UTF8')),'hex'),
   jsonb_build_object('paid_minor',actual_installment.paid_minor,'status',actual_installment.status,'updated_at',to_jsonb(actual_installment)->>'updated_at')
   FROM payment_plan_installments actual_installment JOIN payment_plans actual_plan ON actual_plan.id=actual_installment.plan_id WHERE actual_plan.invoice_id=NEW.invoice_id
 ) candidate;
 IF NEW.mutable_before_rows IS DISTINCT FROM actual_mutable THEN RAISE EXCEPTION 'The full exact original payment-plan preimage must be complete; no plan-row backfill or partial selector' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION freeholder_controlled_cash_guard_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE admitted_batch controlled_cash_application_batches%ROWTYPE; original_receipt subscription_provider_charge_receipts%ROWTYPE; original_origin subscription_controlled_charge_origins%ROWTYPE;
 actual_bank record; actual_observation subscription_provider_charge_observations%ROWTYPE; actual_inspection merchant_cash_return_inspections%ROWTYPE; exact_observation_ids uuid[];
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Original exact receipt/bank admissions are immutable' USING ERRCODE='23514';END IF;
 SELECT * INTO admitted_batch FROM controlled_cash_application_batches WHERE id=NEW.batch_id;
 IF admitted_batch.id IS NULL OR admitted_batch.protocol NOT IN('controlled_net_gross.v1','controlled_cash_atomic.v1') OR admitted_batch.admission_transaction_id IS DISTINCT FROM txid_current()::text THEN RAISE EXCEPTION 'Receipt admission belongs to the same actual original application transaction' USING ERRCODE='23514';END IF;
 PERFORM freeholder_controlled_cash_prewrite(admitted_batch.id);
 SELECT * INTO original_receipt FROM subscription_provider_charge_receipts WHERE id=NEW.receipt_id;
 SELECT * INTO original_origin FROM subscription_controlled_charge_origins WHERE receipt_id=NEW.receipt_id;
 SELECT * INTO actual_inspection FROM merchant_cash_return_inspections WHERE id=NEW.bank_inspection_id;
 SELECT * INTO actual_observation FROM subscription_provider_charge_observations WHERE id=NEW.original_observation_id;
 SELECT * INTO actual_bank FROM freeholder_controlled_receipt_bank_observation(admitted_batch.collection_id,NEW.receipt_id);
 IF original_receipt.id IS NULL OR original_origin.receipt_id IS NULL OR actual_inspection.id IS NULL OR actual_observation.id IS NULL OR actual_bank.actual_inspection_id IS NULL
  OR NOT(admitted_batch.requested_receipt_ids @> to_jsonb(ARRAY[NEW.receipt_id])) OR original_receipt.subscription_id IS DISTINCT FROM admitted_batch.subscription_id
  OR NEW.ordinal IS DISTINCT FROM(SELECT ordinal::integer FROM jsonb_array_elements_text(admitted_batch.requested_receipt_ids) WITH ORDINALITY selected_id(value,ordinal) WHERE value=NEW.receipt_id::text)
  OR original_origin.resource_id IS DISTINCT FROM admitted_batch.resource_id OR original_origin.operation_id IS DISTINCT FROM NEW.origin_operation_id OR original_origin.call_id IS DISTINCT FROM NEW.origin_call_id OR original_origin.fact_id IS DISTINCT FROM NEW.origin_fact_id
  OR original_receipt.amount_minor IS DISTINCT FROM NEW.amount_minor OR original_receipt.currency IS DISTINCT FROM NEW.currency OR NEW.currency IS DISTINCT FROM admitted_batch.currency
  OR encode(sha256(convert_to(to_jsonb(original_receipt)::text,'UTF8')),'hex') IS DISTINCT FROM NEW.receipt_fingerprint
  OR actual_inspection.payment_id IS NOT NULL OR actual_inspection.subscription_charge_receipt_id IS DISTINCT FROM NEW.receipt_id OR actual_inspection.subscription_charge_observation_id IS DISTINCT FROM NEW.original_observation_id
  OR actual_inspection.caller->>'id' IS DISTINCT FROM NEW.bank_finish_caller_id::text OR actual_bank.actual_inspection_id IS DISTINCT FROM NEW.bank_inspection_id OR actual_bank.actual_observation_id IS DISTINCT FROM NEW.bank_observation_id
  OR NEW.processed_at IS DISTINCT FROM(SELECT date_trunc('milliseconds',original_bank.created_at) FROM merchant_cash_return_observations original_bank WHERE original_bank.id=NEW.bank_observation_id AND original_bank.inspection_id=NEW.bank_inspection_id)
  OR actual_bank.immutable_bank_fingerprint IS DISTINCT FROM NEW.immutable_bank_revision OR actual_bank.bank_fingerprint IS DISTINCT FROM NEW.namespace_revision
  OR actual_observation.subscription_id IS DISTINCT FROM original_receipt.subscription_id OR actual_observation.provider_payment_intent_ref IS DISTINCT FROM original_receipt.provider_payment_intent_ref
  OR actual_observation.provider_platform_account_id IS DISTINCT FROM original_receipt.provider_platform_account_id OR actual_observation.charge_account_id IS DISTINCT FROM original_receipt.charge_account_id
  OR actual_observation.amount_minor IS DISTINCT FROM original_receipt.amount_minor OR actual_observation.currency IS DISTINCT FROM original_receipt.currency
  OR actual_observation.provider_invoice_ref IS DISTINCT FROM original_receipt.provider_invoice_ref OR actual_observation.provider_subscription_ref IS DISTINCT FROM original_receipt.provider_subscription_ref
  OR actual_observation.provider_charge_ref IS NOT NULL AND actual_observation.provider_charge_ref IS DISTINCT FROM original_receipt.provider_charge_ref
  OR NOT actual_observation.customer_charge_verified OR NOT actual_observation.merchant_route_verified THEN
  RAISE EXCEPTION 'Only genuine original receipt/caller/returned bank lineage in the exact platform/account/PI namespace can supply a prospective cash admission' USING ERRCODE='23514';END IF;
 -- Match the existing authenticated source's retained display order. This is
 -- array identity only: genuine bank chronology uses the separate lineage.
 SELECT coalesce(array_agg(observed.id ORDER BY observed.created_at,observed.id),ARRAY[]::uuid[]) INTO exact_observation_ids FROM subscription_provider_charge_observations observed
  WHERE observed.subscription_id=original_receipt.subscription_id AND observed.provider_platform_account_id=original_receipt.provider_platform_account_id
   AND observed.charge_account_id IS NOT DISTINCT FROM original_receipt.charge_account_id AND observed.provider_payment_intent_ref=original_receipt.provider_payment_intent_ref;
 IF NEW.original_observation_ids IS DISTINCT FROM to_jsonb(exact_observation_ids)
  OR EXISTS(SELECT 1 FROM subscription_provider_charge_observations observed WHERE observed.id=ANY(exact_observation_ids) AND(
   observed.provider_api_version IS DISTINCT FROM original_receipt.provider_api_version OR observed.provider_subscription_ref IS DISTINCT FROM original_receipt.provider_subscription_ref
   OR observed.provider_invoice_ref IS DISTINCT FROM original_receipt.provider_invoice_ref OR observed.amount_minor IS DISTINCT FROM original_receipt.amount_minor OR observed.currency IS DISTINCT FROM original_receipt.currency
   OR observed.provider_charge_ref IS NOT NULL AND observed.provider_charge_ref IS DISTINCT FROM original_receipt.provider_charge_ref
   OR observed.actual_destination_account_id IS DISTINCT FROM original_receipt.actual_destination_account_id OR observed.actual_settlement_merchant_account_id IS DISTINCT FROM original_receipt.actual_settlement_merchant_account_id
   OR NOT observed.customer_charge_verified OR NOT observed.merchant_route_verified))
  OR NOT freeholder_controlled_bank_unreturned(actual_bank.original_expectation||jsonb_build_object('feeMinor',NEW.fee_minor),actual_bank.current_evidence)
  OR NEW.payment_idempotency_key IS DISTINCT FROM 'controlled-receipt:'||admitted_batch.collection_id::text||':'||NEW.receipt_id::text
  OR NEW.payment_request_hash IS DISTINCT FROM encode(sha256(convert_to(format('{"amountMinor":%s,"idempotencyKey":"%s","invoiceId":"%s","metadata":{},"method":"provider_schedule","provider":"stripe","subscriptionChargeReceiptId":"%s"}',
   NEW.amount_minor,NEW.payment_idempotency_key,admitted_batch.invoice_id,NEW.receipt_id),'UTF8')),'hex') THEN
  RAISE EXCEPTION 'Keep every original observation and exact real shared request; current fee/recipient/refund/dispute facts cannot be waived by a marker' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION freeholder_controlled_cash_receipts_complete(target_batch_uuid uuid) RETURNS void LANGUAGE plpgsql VOLATILE AS $$
DECLARE admitted_batch controlled_cash_application_batches%ROWTYPE; proof_count integer; actual_ids jsonb; actual_cash numeric; actual_fee numeric;
 actual_invoice invoices%ROWTYPE; original_policy invoice_market_policies%ROWTYPE; actual_duty agreement_fee_duties%ROWTYPE;
 original_paid numeric; original_fee numeric; carried_fee numeric; cash_principal numeric; fee_target numeric; receipt_record controlled_cash_application_receipts%ROWTYPE;
BEGIN
 SELECT * INTO admitted_batch FROM controlled_cash_application_batches WHERE id=target_batch_uuid;
 IF admitted_batch.id IS NULL OR admitted_batch.protocol NOT IN('controlled_net_gross.v1','controlled_cash_atomic.v1') OR admitted_batch.admission_transaction_id IS DISTINCT FROM txid_current()::text THEN RAISE EXCEPTION 'Use only the same real immutable application transaction' USING ERRCODE='23514';END IF;
 SELECT count(*),jsonb_agg(receipt_proof.receipt_id ORDER BY receipt_proof.ordinal),sum(receipt_proof.amount_minor),sum(receipt_proof.fee_minor)
 INTO proof_count,actual_ids,actual_cash,actual_fee FROM controlled_cash_application_receipts receipt_proof WHERE receipt_proof.batch_id=admitted_batch.id;
 IF proof_count NOT BETWEEN 1 AND 5000 OR actual_ids IS DISTINCT FROM admitted_batch.requested_receipt_ids OR actual_cash IS DISTINCT FROM admitted_batch.expected_cash_minor::numeric OR actual_fee IS DISTINCT FROM admitted_batch.expected_fee_minor::numeric
  OR EXISTS(SELECT 1 FROM controlled_cash_application_receipts receipt_proof WHERE receipt_proof.batch_id=admitted_batch.id AND receipt_proof.ordinal<1)
  OR(SELECT max(receipt_proof.ordinal) FROM controlled_cash_application_receipts receipt_proof WHERE receipt_proof.batch_id=admitted_batch.id)<>proof_count THEN
  RAISE EXCEPTION 'The exact complete UUID batch and contiguous receipt/fee prefix must exist before any payment mutation' USING ERRCODE='23514';END IF;
 SELECT * INTO actual_invoice FROM invoices WHERE id=admitted_batch.invoice_id;
 SELECT * INTO original_policy FROM invoice_market_policies WHERE invoice_id=admitted_batch.invoice_id;
 SELECT * INTO actual_duty FROM agreement_fee_duties WHERE invoice_id=admitted_batch.invoice_id;
 -- Original real payments only. New actual links in this batch are accounted
 -- separately by the exact staged delta; they never rewrite original paid cash.
 SELECT coalesce(sum(actual_payment.amount_minor),0),coalesce(sum(original_route.application_fee_minor),0)
 INTO original_paid,original_fee FROM payments actual_payment LEFT JOIN merchant_agreement_payment_routes original_route ON original_route.payment_id=actual_payment.id
 WHERE actual_payment.invoice_id=admitted_batch.invoice_id AND actual_payment.status='succeeded'
  AND NOT EXISTS(SELECT 1 FROM controlled_cash_application_links own_link WHERE own_link.batch_id=admitted_batch.id AND own_link.payment_id=actual_payment.id);
 IF original_policy.invoice_id IS NULL OR original_paid IS DISTINCT FROM admitted_batch.invoice_before_paid_minor::numeric
  OR EXISTS(SELECT 1 FROM payments actual_payment LEFT JOIN merchant_agreement_payment_routes original_route ON original_route.payment_id=actual_payment.id
   WHERE actual_payment.invoice_id=admitted_batch.invoice_id AND NOT EXISTS(SELECT 1 FROM controlled_cash_application_links own_link WHERE own_link.batch_id=admitted_batch.id AND own_link.payment_id=actual_payment.id)
    AND(actual_payment.status IN('created','processing') OR actual_payment.status='succeeded' AND(original_route.payment_id IS NULL OR actual_payment.refunded_minor<>0))) THEN
  RAISE EXCEPTION 'Keep complete real prior principal, original fee routes and every pending/refunded attempt; no virtual prefix or missing original fee owner' USING ERRCODE='23514';END IF;
 SELECT coalesce(sum(actual_application.fee_obligation_minor),0) INTO carried_fee FROM invoice_credit_applications actual_application WHERE actual_application.invoice_id=admitted_batch.invoice_id;
 IF(SELECT coalesce(sum(actual_reservation.amount_minor),0) FROM invoice_credit_applications actual_application JOIN invoice_credit_reservations actual_reservation ON actual_reservation.id=actual_application.reservation_id WHERE actual_application.invoice_id=admitted_batch.invoice_id) IS DISTINCT FROM admitted_batch.invoice_before_credited_minor::numeric
  OR EXISTS(SELECT 1 FROM invoice_credit_applications actual_application WHERE actual_application.invoice_id=admitted_batch.invoice_id AND actual_application.fee_evidence_digest IS NULL) THEN
  RAISE EXCEPTION 'Retain every actual original noncash credit and its fee assignment before physical cash application' USING ERRCODE='23514';END IF;
 cash_principal=actual_invoice.total_minor::numeric-admitted_batch.invoice_before_credited_minor::numeric;
 fee_target=greatest(0,original_policy.fee_minor::numeric-carried_fee);
 IF actual_duty.invoice_id IS NOT NULL THEN
  IF actual_duty.total_minor IS DISTINCT FROM actual_invoice.total_minor OR actual_duty.target_fee_minor IS DISTINCT FROM original_policy.fee_minor
   OR actual_duty.credited_minor IS DISTINCT FROM admitted_batch.invoice_before_credited_minor OR actual_duty.carried_fee_minor::numeric IS DISTINCT FROM carried_fee OR actual_duty.cash_principal_minor::numeric IS DISTINCT FROM cash_principal THEN
   RAISE EXCEPTION 'Preserve the frozen gross target fee duty and exact carried credit epoch' USING ERRCODE='23514';END IF;
  fee_target=actual_duty.cash_fee_target_minor;
 END IF;
 IF cash_principal<=0 OR fee_target>cash_principal OR original_fee IS DISTINCT FROM floor(fee_target*original_paid/cash_principal) THEN
  RAISE EXCEPTION 'Restore the exact original cumulative cash commission; never silently reprice historical fee allocations' USING ERRCODE='23514';END IF;
 FOR receipt_record IN SELECT actual_proof.* FROM controlled_cash_application_receipts actual_proof WHERE actual_proof.batch_id=admitted_batch.id ORDER BY actual_proof.ordinal LOOP
  IF receipt_record.prior_cash_minor::numeric IS DISTINCT FROM original_paid OR receipt_record.prior_allocated_fee_minor::numeric IS DISTINCT FROM original_fee
   OR(admitted_batch.protocol='controlled_net_gross.v1' AND receipt_record.fee_minor::numeric IS DISTINCT FROM floor(fee_target*(original_paid+receipt_record.amount_minor::numeric)/cash_principal)-original_fee) THEN
   RAISE EXCEPTION 'Every later fee plan must bind its exact preceding real receipt prefix and deterministic residual' USING ERRCODE='23514';END IF;
  original_paid=original_paid+receipt_record.amount_minor;original_fee=original_fee+receipt_record.fee_minor;
 END LOOP;
 IF original_fee IS DISTINCT FROM floor(fee_target*original_paid/cash_principal) THEN
  RAISE EXCEPTION 'Every actual fee must conserve the original cumulative endpoint within this complete atomic batch; unseen future receipts cannot supply a residual' USING ERRCODE='23514';END IF;
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
 IF link_record.receipt_id IS NULL OR receipt_record.id IS NULL OR batch_record.id IS NULL OR batch_record.protocol NOT IN('controlled_net_gross.v1','controlled_cash_atomic.v1') OR payment_record.id IS NULL OR payment_record.status NOT IN('created','processing') THEN
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
 IF batch_record.id IS NULL OR batch_record.protocol NOT IN('controlled_net_gross.v1','controlled_cash_atomic.v1') OR invoice_record.id IS NULL OR batch_record.admission_transaction_id IS DISTINCT FROM txid_current()::text THEN RAISE EXCEPTION 'Only this original real transaction can prove its own canonical stage' USING ERRCODE='23514';END IF;
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
 IF link_row.receipt_id IS NULL OR receipt_proof.id IS NULL OR batch_row.id IS NULL OR batch_row.protocol NOT IN('controlled_net_gross.v1','controlled_cash_atomic.v1')
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
 IF current_batch.protocol NOT IN('controlled_net_gross.v1','controlled_cash_atomic.v1') OR current_batch.collection_id IS DISTINCT FROM collection_row.id THEN RETURN false;END IF;
 IF batch_row.id<>current_batch.id AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(current_batch.before_entries) original_entry
  WHERE original_entry->>'table'='payments' AND original_entry->>'id'=payment_row.id::text
   AND original_entry->>'fingerprint'=encode(sha256(convert_to(to_jsonb(payment_row)::text,'UTF8')),'hex')) THEN RETURN false;END IF;
 stage=freeholder_controlled_cash_stage(current_batch.id,null,null);
 RETURN stage->>'complete'='true' AND stage->>'batchId'=current_batch.id::text
  AND stage->>'normalizedParentRevision'=current_batch.parent_pg_revision;
END $$;
--> statement-breakpoint
CREATE FUNCTION freeholder_controlled_cash_atomic_fee_valid(target_payment_uuid uuid,proposed_fee bigint,proposed_prior_cash numeric,proposed_prior_fee numeric) RETURNS boolean LANGUAGE plpgsql VOLATILE AS $$
DECLARE actual_link controlled_cash_application_links%ROWTYPE; receipt_record controlled_cash_application_receipts%ROWTYPE; batch_record controlled_cash_application_batches%ROWTYPE; current_stage jsonb;
BEGIN
 SELECT * INTO actual_link FROM controlled_cash_application_links WHERE payment_id=target_payment_uuid;
 SELECT * INTO receipt_record FROM controlled_cash_application_receipts WHERE id=actual_link.receipt_proof_id;
 SELECT * INTO batch_record FROM controlled_cash_application_batches WHERE id=actual_link.batch_id;
 IF actual_link.payment_id IS NULL OR receipt_record.id IS NULL OR batch_record.id IS NULL OR batch_record.protocol IS DISTINCT FROM 'controlled_cash_atomic.v1'
  OR batch_record.admission_transaction_id IS DISTINCT FROM txid_current()::text OR actual_link.receipt_id IS DISTINCT FROM receipt_record.receipt_id OR receipt_record.batch_id IS DISTINCT FROM batch_record.id
  OR proposed_fee IS DISTINCT FROM receipt_record.fee_minor OR proposed_prior_cash IS DISTINCT FROM receipt_record.prior_cash_minor::numeric OR proposed_prior_fee IS DISTINCT FROM receipt_record.prior_allocated_fee_minor::numeric THEN RETURN false;END IF;
 -- The full actual current normalized parent, immutable bank/current namespace,
 -- complete receipt set, real earlier settled prefix and endpoint are required.
 -- A pointer, a copied protocol string or an intermediate floor is insufficient.
 current_stage=freeholder_controlled_cash_stage(batch_record.id,receipt_record.receipt_id,target_payment_uuid);
 RETURN coalesce(current_stage->>'batchId'=batch_record.id::text AND current_stage->>'receiptId'=receipt_record.receipt_id::text
  AND current_stage->>'paymentId'=target_payment_uuid::text AND current_stage->>'normalizedParentRevision'=batch_record.parent_pg_revision AND current_stage->>'complete'='false',false);
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION freeholder_controlled_subscription_route_valid(proposed_route jsonb) RETURNS boolean LANGUAGE plpgsql VOLATILE AS $$
DECLARE pointer jsonb; batch_record controlled_cash_application_batches%ROWTYPE; receipt_proof controlled_cash_application_receipts%ROWTYPE;
 link_record controlled_cash_application_links%ROWTYPE; original_receipt subscription_provider_charge_receipts%ROWTYPE;
 origin_record subscription_controlled_charge_origins%ROWTYPE; resource_record subscription_controlled_resources%ROWTYPE; payment_record payments%ROWTYPE; stage_record jsonb;
BEGIN
 pointer=nullif(current_setting('freeholder.controlled_cash_application_batch_v1',true),'')::jsonb;
 IF pointer IS NULL OR jsonb_typeof(pointer) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(pointer))<>4
  OR NOT(pointer ?& ARRAY['batchId','collectionId','receiptId','admissionDigest'])
  OR coalesce(pointer->>'batchId','')!~'^[a-f0-9-]{36}$' OR coalesce(pointer->>'collectionId','')!~'^[a-f0-9-]{36}$'
  OR coalesce(pointer->>'receiptId','')!~'^[a-f0-9-]{36}$' OR coalesce(pointer->>'admissionDigest','')!~'^[a-f0-9]{64}$' THEN RETURN false;END IF;
 SELECT * INTO batch_record FROM controlled_cash_application_batches WHERE id=(pointer->>'batchId')::uuid;
 SELECT * INTO receipt_proof FROM controlled_cash_application_receipts WHERE batch_id=batch_record.id AND receipt_id=(pointer->>'receiptId')::uuid;
 SELECT * INTO link_record FROM controlled_cash_application_links WHERE batch_id=batch_record.id AND receipt_proof_id=receipt_proof.id AND receipt_id=receipt_proof.receipt_id;
 SELECT * INTO original_receipt FROM subscription_provider_charge_receipts WHERE id=receipt_proof.receipt_id;
 SELECT * INTO origin_record FROM subscription_controlled_charge_origins WHERE receipt_id=original_receipt.id;
 SELECT * INTO resource_record FROM subscription_controlled_resources WHERE id=batch_record.resource_id;
 SELECT * INTO payment_record FROM payments WHERE id=link_record.payment_id;
 IF batch_record.id IS NULL OR receipt_proof.id IS NULL OR link_record.payment_id IS NULL OR original_receipt.id IS NULL OR origin_record.receipt_id IS NULL OR resource_record.id IS NULL OR payment_record.id IS NULL
  OR batch_record.protocol NOT IN('controlled_net_gross.v1','controlled_cash_atomic.v1') OR batch_record.digest IS DISTINCT FROM pointer->>'admissionDigest'
  OR batch_record.collection_id::text IS DISTINCT FROM pointer->>'collectionId' OR batch_record.admission_transaction_id IS DISTINCT FROM txid_current()::text
  OR origin_record.resource_id IS DISTINCT FROM batch_record.resource_id OR origin_record.operation_id IS DISTINCT FROM receipt_proof.origin_operation_id
  OR origin_record.call_id IS DISTINCT FROM receipt_proof.origin_call_id OR origin_record.fact_id IS DISTINCT FROM receipt_proof.origin_fact_id
  OR original_receipt.subscription_id IS DISTINCT FROM batch_record.subscription_id OR resource_record.subscription_id IS DISTINCT FROM batch_record.subscription_id
  OR original_receipt.amount_minor IS DISTINCT FROM receipt_proof.amount_minor OR original_receipt.currency IS DISTINCT FROM receipt_proof.currency
  OR payment_record.invoice_id IS DISTINCT FROM batch_record.invoice_id OR payment_record.status IS DISTINCT FROM 'created'
  OR payment_record.provider IS DISTINCT FROM 'stripe' OR payment_record.method IS DISTINCT FROM 'provider_schedule'
  OR payment_record.amount_minor IS DISTINCT FROM receipt_proof.amount_minor OR payment_record.currency IS DISTINCT FROM receipt_proof.currency
  OR payment_record.idempotency_key IS DISTINCT FROM receipt_proof.payment_idempotency_key OR payment_record.request_hash IS DISTINCT FROM receipt_proof.payment_request_hash
  OR proposed_route->>'payment_id' IS DISTINCT FROM payment_record.id::text OR proposed_route->>'subscription_id' IS DISTINCT FROM batch_record.subscription_id::text
  OR proposed_route->>'agreement_routing_version' IS DISTINCT FROM '1' OR proposed_route->>'origin_kind' IS DISTINCT FROM 'provider_schedule'
  OR proposed_route->>'original_charge_receipt_id' IS DISTINCT FROM original_receipt.id::text
  OR proposed_route->>'provider_api_version' IS DISTINCT FROM original_receipt.provider_api_version
  OR proposed_route->>'provider_platform_account_id' IS DISTINCT FROM original_receipt.provider_platform_account_id
  OR proposed_route->>'charge_account_id' IS DISTINCT FROM original_receipt.charge_account_id
  OR proposed_route->>'provider_subscription_ref' IS DISTINCT FROM original_receipt.provider_subscription_ref
  OR proposed_route->>'provider_invoice_ref' IS DISTINCT FROM original_receipt.provider_invoice_ref
  OR proposed_route->>'provider_payment_intent_ref' IS DISTINCT FROM original_receipt.provider_payment_intent_ref
  OR proposed_route->>'provider_charge_ref' IS DISTINCT FROM original_receipt.provider_charge_ref OR original_receipt.provider_charge_ref IS NULL
  OR proposed_route->>'recipient_account_id' IS DISTINCT FROM coalesce(resource_record.original_scope->>'destinationAccountId',resource_record.original_scope->>'providerAccountId')
  OR proposed_route->>'settlement_merchant_account_id' IS DISTINCT FROM coalesce(resource_record.original_scope->>'settlementMerchantAccountId',resource_record.original_scope->>'providerAccountId')
  OR proposed_route->>'collection_kind' IS DISTINCT FROM (CASE WHEN resource_record.original_scope->>'destinationAccountId' IS NOT NULL THEN 'destination' ELSE 'direct' END)
  OR proposed_route->>'application_fee_minor' IS DISTINCT FROM receipt_proof.fee_minor::text
  OR (proposed_route->>'created_at')::timestamptz IS DISTINCT FROM now() THEN RETURN false;END IF;
 -- Real post-birth row/link, exact settled prefix, complete current PG graph and
 -- immutable returned bank proof. Never a marker-only or planned-payment grant.
 stage_record=freeholder_controlled_cash_stage(batch_record.id,receipt_proof.receipt_id,payment_record.id);
 RETURN coalesce(stage_record->>'batchId'=batch_record.id::text AND stage_record->>'collectionId'=batch_record.collection_id::text
  AND stage_record->>'receiptId'=receipt_proof.receipt_id::text AND stage_record->>'paymentId'=payment_record.id::text
  AND stage_record->>'normalizedParentRevision'=batch_record.parent_pg_revision AND stage_record->>'complete'='false',false);
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_merchant_agreement_payment_route() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE payment payments%ROWTYPE; parent invoices%ROWTYPE; policy invoice_market_policies%ROWTYPE; original record; paid numeric; prior_fee numeric; duty agreement_fee_duties%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Original agreement payment routing is immutable.' USING ERRCODE='23514'; END IF;
 SELECT * INTO payment FROM payments WHERE id=NEW.payment_id;
 SELECT * INTO parent FROM invoices WHERE id=payment.invoice_id FOR UPDATE;
 SELECT * INTO policy FROM invoice_market_policies WHERE invoice_id=payment.invoice_id;
 SELECT scope.* INTO original FROM subscription_merchant_scopes scope JOIN subscriptions s ON s.id=scope.subscription_id
  WHERE scope.subscription_id=NEW.subscription_id AND s.merchant_scope_version=1;
 IF payment.id IS NULL OR parent.id IS NULL OR original.subscription_id IS NULL OR parent.source_type IS DISTINCT FROM 'subscription'
  OR split_part(parent.source_id,':',1) IS DISTINCT FROM NEW.subscription_id::text OR policy.invoice_id IS NULL OR policy.model IS DISTINCT FROM 'seller_merchant'
  OR payment.currency IS DISTINCT FROM parent.currency
  OR payment.provider<>'stripe' OR payment.status<>'created' OR payment.method NOT IN('hosted_checkout','saved_method','provider_schedule')
  OR NEW.collection_kind IS DISTINCT FROM original.collection_kind OR NEW.provider_platform_account_id IS DISTINCT FROM original.provider_platform_account_id
  OR NEW.charge_account_id IS DISTINCT FROM original.charge_account_id OR NEW.recipient_account_id IS DISTINCT FROM original.recipient_account_id
  OR NEW.settlement_merchant_account_id IS DISTINCT FROM original.settlement_merchant_account_id
  OR(NEW.origin_kind='provider_schedule') IS DISTINCT FROM(payment.method='provider_schedule')
  OR(NEW.origin_kind='provider_schedule' AND NEW.provider_api_version IS DISTINCT FROM original.provider_schedule_api_version)
  OR(NEW.origin_kind='provider_schedule' AND NOT EXISTS(SELECT 1 FROM subscription_provider_charge_receipts receipt WHERE receipt.id=NEW.original_charge_receipt_id
   AND receipt.subscription_id=NEW.subscription_id AND receipt.provider_platform_account_id=NEW.provider_platform_account_id AND receipt.charge_account_id IS NOT DISTINCT FROM NEW.charge_account_id
   AND receipt.provider_api_version=NEW.provider_api_version AND receipt.provider_subscription_ref=NEW.provider_subscription_ref AND receipt.provider_invoice_ref=NEW.provider_invoice_ref
   AND receipt.provider_payment_intent_ref=NEW.provider_payment_intent_ref AND receipt.provider_charge_ref=NEW.provider_charge_ref AND receipt.amount_minor=payment.amount_minor AND receipt.currency=payment.currency))
  OR EXISTS(SELECT 1 FROM merchant_payment_observations o JOIN payments p ON p.id=o.payment_id WHERE p.invoice_id=payment.invoice_id AND o.status='succeeded' AND(p.status<>'succeeded' OR o.amount_minor<>p.amount_minor OR o.currency<>p.currency OR(o.provider_ref IS DISTINCT FROM p.provider_ref AND o.provider_ref IS DISTINCT FROM p.provider_checkout_ref)))
  OR NEW.application_fee_minor>payment.amount_minor
  OR EXISTS(SELECT 1 FROM payment_merchant_routes WHERE payment_id=NEW.payment_id)
  OR EXISTS(SELECT 1 FROM merchant_payment_routes WHERE payment_id=NEW.payment_id)
  OR EXISTS(SELECT 1 FROM payments p WHERE p.invoice_id=payment.invoice_id AND p.id<>payment.id AND p.status IN('created','processing')) THEN
  RAISE EXCEPTION 'Bind each new agreement payment to its immutable original merchant namespace.' USING ERRCODE='23514';
 END IF;
 IF split_part(parent.source_id,':',2)='proration' THEN
  SELECT * INTO duty FROM agreement_fee_duties WHERE invoice_id=parent.id;
  SELECT coalesce(sum(p.amount_minor),0),coalesce(sum(coalesce(a.fee_owed_minor,g.application_fee_minor)),0) INTO paid,prior_fee FROM payments p
   LEFT JOIN commercial_payment_attestations a ON a.payment_id=p.id LEFT JOIN merchant_agreement_payment_routes g ON g.payment_id=p.id
   WHERE p.invoice_id=parent.id AND p.status='succeeded';
  IF duty.invoice_id IS NULL OR (NEW.origin_kind<>'attempt' AND NOT freeholder_controlled_subscription_route_valid(to_jsonb(NEW))) OR duty.total_minor<>parent.total_minor OR duty.credited_minor<>parent.credited_minor OR duty.target_fee_minor<>policy.fee_minor
   OR duty.cash_principal_minor<=0 OR paid<>parent.paid_minor OR paid+payment.amount_minor>duty.cash_principal_minor
   OR(NOT freeholder_controlled_cash_atomic_fee_valid(payment.id,NEW.application_fee_minor,paid,prior_fee) AND(
    prior_fee<>floor(duty.cash_fee_target_minor::numeric*paid/duty.cash_principal_minor)
    OR NEW.application_fee_minor<>floor(duty.cash_fee_target_minor::numeric*(paid+payment.amount_minor)/duty.cash_principal_minor)-prior_fee))
   OR EXISTS(SELECT 1 FROM payments p LEFT JOIN commercial_payment_attestations a ON a.payment_id=p.id LEFT JOIN merchant_agreement_payment_routes g ON g.payment_id=p.id WHERE p.invoice_id=parent.id AND p.status='succeeded'
    AND((a.payment_id IS NOT NULL)::integer+(g.payment_id IS NOT NULL)::integer<>1 OR p.refunded_minor<>0)) THEN
   RAISE EXCEPTION 'Bind only the physically bounded original gross-target fee while preserving its separately frozen merchant receivable and actual source assignments' USING ERRCODE='23514';END IF;
  RETURN NEW;
 END IF;
 SELECT COALESCE(sum(p.amount_minor),0),COALESCE(sum(r.application_fee_minor),0) INTO paid,prior_fee
 FROM payments p JOIN merchant_agreement_payment_routes r ON r.payment_id=p.id WHERE p.invoice_id=payment.invoice_id AND p.status='succeeded';
 IF parent.total_minor=0 OR paid<>parent.paid_minor OR paid+payment.amount_minor>parent.total_minor
  OR(NOT freeholder_controlled_cash_atomic_fee_valid(payment.id,NEW.application_fee_minor,paid,prior_fee) AND(
   prior_fee<>floor(policy.fee_minor::numeric*paid/parent.total_minor)
   OR NEW.application_fee_minor<>floor(policy.fee_minor::numeric*(paid+payment.amount_minor)/parent.total_minor)-prior_fee)) THEN
  RAISE EXCEPTION 'The original agreement payment and application fee must conserve every invoice cent.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION freeholder_guard_agreement_fee() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE duty agreement_fee_duties%ROWTYPE;i invoices%ROWTYPE;a subscription_prorations%ROWTYPE;p payments%ROWTYPE;x invoice_credit_applications%ROWTYPE;r invoice_credit_reservations%ROWTYPE;
 prior_cash numeric;prior_fee numeric;current_state record;
BEGIN
 IF TG_OP<>'INSERT' OR current_setting('freeholder.agreement_fee_v1',true) IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'Original commission duty, assignments, eligibility and actual remittances are immutable guarded receipts' USING ERRCODE='23514';END IF;
 SELECT * INTO i FROM invoices WHERE id=NEW.invoice_id;
 IF TG_TABLE_NAME='agreement_fee_duties' THEN
  SELECT * INTO a FROM subscription_prorations WHERE id=NEW.acceptance_id;
  IF a.id IS NULL OR a.state<>'accepted' OR a.original_trial_ends_at IS NOT NULL OR a.debit_invoice_id IS DISTINCT FROM i.id OR i.source_type<>'subscription' OR i.source_id<>a.subscription_id::text||':proration:'||a.id::text
   OR i.currency<>NEW.currency OR i.total_minor<>NEW.total_minor OR i.credited_minor<>NEW.credited_minor OR i.paid_minor<>0 OR i.status IN('draft','void')
   OR NEW.merchant_profile_id<>a.profile_id OR NEW.profile_version<>a.profile_version OR NEW.accepted_quote_digest<>a.accepted_quote_digest OR NEW.target_fee_minor<>a.debit_fee_obligation_minor OR NEW.carried_fee_minor<>a.applied_fee_obligation_minor
   OR NOT EXISTS(SELECT 1 FROM invoice_market_policies m WHERE m.invoice_id=i.id AND m.model='seller_merchant' AND m.fee_minor=NEW.target_fee_minor)
   OR(SELECT count(*) FROM invoice_lines WHERE invoice_id=i.id)<>1 THEN RAISE EXCEPTION 'Freeze one exact accepted target commission epoch before collection, without rewriting an old or order-v1 policy' USING ERRCODE='23514';END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO duty FROM agreement_fee_duties WHERE invoice_id=NEW.invoice_id;
 IF duty.invoice_id IS NULL OR i.id IS NULL THEN RAISE EXCEPTION 'Restore the exact original accepted commission duty before its children' USING ERRCODE='23514';END IF;
 IF TG_TABLE_NAME='agreement_fee_credit_assignments' THEN
  SELECT * INTO x FROM invoice_credit_applications WHERE reservation_id=NEW.application_id;SELECT * INTO r FROM invoice_credit_reservations WHERE id=x.reservation_id;
  IF x.reservation_id IS NULL OR x.invoice_id<>i.id OR r.target_source_id<>i.source_id OR NEW.amount_minor<>r.amount_minor OR NEW.fee_obligation_minor<>x.fee_obligation_minor OR NEW.proven_collected_minor<>x.fee_proven_collected_minor OR x.fee_evidence_digest IS NULL THEN
   RAISE EXCEPTION 'Each carried commission assignment retains its exact actual application and original fee proof' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='agreement_fee_cash_assignments' THEN
  SELECT * INTO p FROM payments WHERE id=NEW.payment_id;
  IF p.id IS NULL OR p.invoice_id<>i.id OR p.status<>'created' OR p.currency<>duty.currency OR NEW.amount_minor<>p.amount_minor OR freeholder_original_payment_fee(p.id) IS DISTINCT FROM NEW.fee_obligation_minor
   OR(NEW.origin='recorded_external' AND(p.provider<>'manual' OR NOT EXISTS(SELECT 1 FROM commercial_payment_attestations WHERE payment_id=p.id)))
   OR(NEW.origin='provider' AND(p.provider<>'stripe' OR NOT EXISTS(SELECT 1 FROM merchant_agreement_payment_routes WHERE payment_id=p.id))) THEN
   RAISE EXCEPTION 'A physical fee assignment needs its exact real principal attempt and one original provider route or external attestation' USING ERRCODE='23514';END IF;
  SELECT coalesce(sum(q.amount_minor),0),coalesce(sum(c.fee_obligation_minor),0) INTO prior_cash,prior_fee FROM payments q LEFT JOIN agreement_fee_cash_assignments c ON c.payment_id=q.id WHERE q.invoice_id=i.id AND q.id<>p.id AND q.status='succeeded';
  IF duty.cash_principal_minor<=0 OR prior_cash<>i.paid_minor OR prior_cash+p.amount_minor>duty.cash_principal_minor
   OR(NOT freeholder_controlled_cash_atomic_fee_valid(p.id,NEW.fee_obligation_minor,prior_cash,prior_fee) AND(
    prior_fee<>floor(duty.cash_fee_target_minor::numeric*prior_cash/duty.cash_principal_minor)
    OR NEW.fee_obligation_minor<>floor(duty.cash_fee_target_minor::numeric*(prior_cash+p.amount_minor)/duty.cash_principal_minor)-prior_fee))
   OR EXISTS(SELECT 1 FROM payments q LEFT JOIN agreement_fee_cash_assignments c ON c.payment_id=q.id WHERE q.invoice_id=i.id AND q.id<>p.id AND(q.status IN('created','processing')OR(q.status='succeeded' AND(c.payment_id IS NULL OR q.refunded_minor<>0)))) THEN
   RAISE EXCEPTION 'Preserve complete original cash assignments and cumulative physical-fee residuals within the actual cash cap' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='agreement_fee_eligibility' THEN
  SELECT * INTO a FROM subscription_prorations WHERE id=duty.acceptance_id;
  SELECT * INTO current_state FROM freeholder_agreement_fee_current(i.id);
  IF NOT current_state.known OR i.status<>'paid' OR i.paid_at IS NULL OR NEW.paid_at<>i.paid_at OR i.paid_at>a.effective_at OR i.refunded_minor<>0 OR i.paid_minor+i.credited_minor<>i.total_minor
   OR NEW.cash_payment_ids IS DISTINCT FROM coalesce((SELECT jsonb_agg(eligible_payment.id::text ORDER BY eligible_payment.id) FROM payments eligible_payment WHERE eligible_payment.invoice_id=i.id AND eligible_payment.status='succeeded'),'[]'::jsonb)
   OR NEW.credit_application_ids IS DISTINCT FROM coalesce((SELECT jsonb_agg(c.application_id::text ORDER BY c.application_id) FROM agreement_fee_credit_assignments c WHERE c.invoice_id=i.id),'[]'::jsonb) THEN
   RAISE EXCEPTION 'Only authentic full canonical consideration in the accepted window establishes eligibility; it never proves commission remittance' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='agreement_fee_remittances' THEN
  SELECT * INTO current_state FROM freeholder_agreement_fee_current(i.id);
  IF NOT current_state.known OR NOT current_state.eligible OR NEW.currency<>duty.currency THEN RAISE EXCEPTION 'Resolve complete actual cash and noncash disposition before attesting commission money' USING ERRCODE='23514';END IF;
  IF NEW.direction='remitted' AND current_state.recorded+NEW.amount_minor>current_state.owed THEN RAISE EXCEPTION 'An actual remittance cannot exceed the current original whole-consideration receivable' USING ERRCODE='23514';END IF;
  IF NEW.direction='returned' AND NOT EXISTS(SELECT 1 FROM agreement_fee_remittances f WHERE f.id=NEW.original_remittance_id AND f.invoice_id=i.id AND f.direction='remitted'
   AND coalesce((SELECT sum(q.amount_minor) FROM agreement_fee_remittances q WHERE q.original_remittance_id=f.id),0)+NEW.amount_minor<=f.amount_minor) THEN
   RAISE EXCEPTION 'An actual commission return names its exact original bounded remittance receipt' USING ERRCODE='23514';END IF;
 ELSE RAISE EXCEPTION 'Unknown original commission receipt family' USING ERRCODE='23514';END IF;
 RETURN NEW;
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
  AND EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid='merchant_agreement_payment_routes'::regclass AND t.tgname='merchant_agreement_payment_route_guard' AND t.tgfoid=to_regprocedure('guard_merchant_agreement_payment_route()') AND t.tgenabled IN('O','A') AND t.tgtype=31 AND NOT t.tgisinternal)
  AND EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid='merchant_agreement_payment_routes'::regclass AND t.tgname='subscription_controlled_agreement_route_guard' AND t.tgfoid=to_regprocedure('guard_subscription_controlled_agreement_route()') AND t.tgenabled IN('O','A') AND t.tgtype=23 AND NOT t.tgisinternal),false);
$$;
