-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
-- C12.38/C9.33: UNAPPLIED after the complete atomic application suffix.
-- Original per-charge Fi stays immutable. Existing exact fee operations retain
-- the computed current target, original fee/PI/account and real returned ACK.
CREATE FUNCTION freeholder_controlled_atomic_refund_targets(target_invoice uuid)
RETURNS TABLE(known boolean,payment_id uuid,receipt_id uuid,batch_id uuid,receipt_proof_id uuid,
 amount_minor float8,refunded_minor float8,original_fee_minor float8,original_fee_ref text,actual_fee_returned_minor float8,target_retained_fee_minor float8,
 principal_minor float8,fee_minor float8,revision text) LANGUAGE plpgsql STABLE AS $$
DECLARE invoice_row invoices%ROWTYPE;policy_row invoice_market_policies%ROWTYPE;
 collection_row subscription_controlled_collections%ROWTYPE;quote_row subscription_controlled_quotes%ROWTYPE;
 resource_row subscription_controlled_resources%ROWTYPE;item record;inventory jsonb;cash_total numeric;fee_total numeric;
 remaining_cash numeric;retained_fee numeric;whole_target numeric;residual numeric;take numeric;original_target numeric;already_returned numeric;budget bigint;
BEGIN
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
   AND (SELECT coalesce(sum(f.amount_minor),0) FROM merchant_fee_refunds f WHERE f.payment_id=p.id AND f.status='accepted')>route_row.application_fee_minor) THEN RETURN;END IF;
 SELECT sum(p.amount_minor),sum(route_row.application_fee_minor),sum(p.amount_minor-p.refunded_minor),
  sum(least(floor(route_row.application_fee_minor::numeric*(p.amount_minor-p.refunded_minor)/p.amount_minor),route_row.application_fee_minor-(SELECT coalesce(sum(f.amount_minor),0) FROM merchant_fee_refunds f WHERE f.payment_id=p.id AND f.status='accepted')))
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
  SELECT coalesce(sum(f.amount_minor),0) INTO already_returned FROM merchant_fee_refunds f WHERE f.payment_id=item.id AND f.status='accepted';
  original_target:=least(floor(item.application_fee_minor::numeric*(item.amount_minor-item.refunded_minor)/item.amount_minor),item.application_fee_minor-already_returned);
  take:=least(residual,original_target);residual:=residual-take;
  known:=true;payment_id:=item.id;receipt_id:=item.receipt_id;batch_id:=item.batch_id;receipt_proof_id:=item.receipt_proof_id;
  amount_minor:=item.amount_minor;refunded_minor:=item.refunded_minor;original_fee_minor:=item.application_fee_minor;
  original_fee_ref:=item.original_fee_ref;actual_fee_returned_minor:=already_returned;target_retained_fee_minor:=original_target-take;principal_minor:=invoice_row.total_minor;fee_minor:=policy_row.fee_minor;RETURN NEXT;
 END LOOP;
END $$;

--> statement-breakpoint
CREATE FUNCTION freeholder_controlled_atomic_refund_fee_state(target_payment uuid)
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
 SELECT coalesce(sum(f.amount_minor) FILTER(WHERE f.status='accepted'),0) INTO returned_fee FROM merchant_fee_refunds f WHERE f.payment_id=target_payment;
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
 IF NOT EXISTS(SELECT 1 FROM merchant_fee_refunds f WHERE f.payment_id=target_payment AND f.status IN('reserved','dispatching','unknown'))
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
CREATE FUNCTION freeholder_original_line_fee_target_before_atomic_refund(target_payment uuid) RETURNS bigint LANGUAGE plpgsql STABLE AS $$
DECLARE
 parent payments%ROWTYPE; allocation invoice_merchant_allocations%ROWTYPE; collection invoice_merchant_collections%ROWTYPE;
 owner_order orders%ROWTYPE; returned return_requests%ROWTYPE; note credit_notes%ROWTYPE; ordered order_items%ROWTYPE;
 item return_items%ROWTYPE; part return_refund_allocations%ROWTYPE; original_line invoice_lines%ROWTYPE; credited credit_note_lines%ROWTYPE;
 fact refunds%ROWTYPE; intent merchant_refund_requests%ROWTYPE; charge record; frozen record;
 original_fee bigint; prior_target bigint; result bigint; selected_line uuid; selected_quantity bigint; part_allocation uuid;
 candidate_count integer; own_credit_count integer; item_count integer; part_count integer; call_count integer; budget integer;
 own_lines uuid[] := ARRAY[]::uuid[]; own_quantities bigint[] := ARRAY[]::bigint[]; seen_refunds uuid[] := ARRAY[]::uuid[];
 bound_credit_ids uuid[] := ARRAY[]::uuid[]; has_return boolean := false; own_return boolean;
 quantities jsonb := '{}'::jsonb; net_credits jsonb := '{}'::jsonb; tax_credits jsonb := '{}'::jsonb; linked_cash jsonb := '{}'::jsonb;
 credit_gross numeric; bound_gross numeric; confirmed numeric; quantity numeric; fee_credit numeric := 0; remaining numeric; capacity numeric; charged_fees numeric;
BEGIN
 SELECT * INTO parent FROM payments WHERE id=target_payment;
 IF parent.id IS NULL OR parent.amount_minor<=0 OR parent.amount_minor>9007199254740991
  OR parent.refunded_minor<0 OR parent.refunded_minor>parent.amount_minor THEN RETURN NULL; END IF;
 SELECT application_fee_minor INTO original_fee FROM(
  SELECT application_fee_minor FROM merchant_payment_routes WHERE payment_id=target_payment
  UNION ALL SELECT application_fee_minor FROM merchant_agreement_payment_routes WHERE payment_id=target_payment
  UNION ALL SELECT application_fee_minor FROM merchant_invoice_payment_routes WHERE payment_id=target_payment) routes LIMIT 1;
 SELECT count(*) INTO candidate_count FROM(
  SELECT payment_id FROM merchant_payment_routes WHERE payment_id=target_payment
  UNION ALL SELECT payment_id FROM merchant_agreement_payment_routes WHERE payment_id=target_payment
  UNION ALL SELECT payment_id FROM merchant_invoice_payment_routes WHERE payment_id=target_payment) original_routes;
 IF candidate_count<>1 THEN RETURN NULL; END IF;
 IF original_fee IS NULL OR original_fee<0 OR original_fee>parent.amount_minor THEN RETURN NULL; END IF;
 prior_target:=floor(original_fee::numeric*(parent.amount_minor-parent.refunded_minor)/parent.amount_minor)::bigint;
 SELECT a.* INTO allocation FROM merchant_payment_routes r JOIN invoice_merchant_allocations a ON a.id=r.allocation_id
  WHERE r.payment_id=target_payment AND a.invoice_id=parent.invoice_id;
 IF allocation.id IS NULL THEN
  IF EXISTS(SELECT 1 FROM merchant_payment_routes WHERE payment_id=target_payment) THEN RETURN NULL; END IF;
  RETURN prior_target;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM invoice_market_policies WHERE invoice_id=parent.invoice_id AND collection_version=1 AND model='seller_merchant') THEN RETURN NULL; END IF;
 SELECT * INTO collection FROM invoice_merchant_collections WHERE allocation_id=allocation.id;
 IF collection.allocation_id IS NULL OR allocation.fee_minor>9007199254740991 THEN RETURN NULL; END IF;
 IF NOT EXISTS(SELECT 1 FROM invoice_merchant_allocation_lines WHERE allocation_id=allocation.id)
  OR EXISTS(SELECT 1 FROM invoice_merchant_allocation_lines f JOIN invoice_lines l ON l.id=f.invoice_line_id WHERE f.allocation_id=allocation.id
   AND(l.invoice_id<>parent.invoice_id OR l.quantity_micros<=0 OR l.quantity_micros>9007199254740991 OR f.revenue_minor<>l.subtotal_minor-l.discount_minor))
  OR(SELECT sum(fee_minor) FROM invoice_merchant_allocation_lines WHERE allocation_id=allocation.id) IS DISTINCT FROM allocation.fee_minor::numeric THEN RETURN NULL; END IF;
 SELECT * INTO owner_order FROM orders WHERE invoice_id=parent.invoice_id LIMIT 1;
 IF owner_order.id IS NULL OR NOT EXISTS(SELECT 1 FROM invoices WHERE id=parent.invoice_id AND source_type='order' AND source_id=owner_order.id::text) THEN RETURN NULL; END IF;
 SELECT (SELECT count(*) FROM return_requests WHERE order_id=owner_order.id)
  +(SELECT count(*) FROM invoice_lines WHERE invoice_id=parent.invoice_id)
  +(SELECT count(*) FROM refunds f JOIN payments p ON p.id=f.payment_id WHERE p.invoice_id=parent.invoice_id)
  +(SELECT count(*) FROM credit_notes WHERE invoice_id=parent.invoice_id) INTO budget;
 IF budget>5000 OR(SELECT count(*) FROM invoice_merchant_allocation_lines f JOIN invoice_merchant_allocations a ON a.id=f.allocation_id WHERE a.invoice_id=parent.invoice_id)>5000
  OR(SELECT count(*) FROM credit_note_lines l JOIN credit_notes n ON n.id=l.credit_note_id WHERE n.invoice_id=parent.invoice_id AND n.status<>'void')>5000 THEN RETURN NULL; END IF;
 FOR returned IN SELECT * FROM return_requests WHERE order_id=owner_order.id LOOP
  IF returned.credit_note_id IS NULL THEN CONTINUE; END IF;
  SELECT * INTO note FROM credit_notes WHERE id=returned.credit_note_id AND invoice_id=parent.invoice_id;
  IF note.id IS NULL THEN RETURN NULL; END IF;
  own_lines:=ARRAY[]::uuid[]; own_quantities:=ARRAY[]::bigint[];
  SELECT count(*) INTO item_count FROM return_items WHERE return_id=returned.id;
  SELECT count(*) INTO part_count FROM return_refund_allocations WHERE return_id=returned.id;
  budget:=budget+item_count+part_count;
  IF budget>5000 OR item_count=0 OR part_count=0 THEN RETURN NULL; END IF;
  FOR item IN SELECT * FROM return_items WHERE return_id=returned.id LOOP
   SELECT * INTO ordered FROM order_items WHERE id=item.order_item_id AND order_id=owner_order.id;
   IF ordered.id IS NULL OR item.quantity<=0 OR item.quantity::numeric*1000000>9007199254740991 THEN RETURN NULL; END IF;
   IF jsonb_typeof(ordered.snapshot->'invoiceLineId')='string' THEN
    SELECT count(*),min(l.id::text)::uuid INTO candidate_count,selected_line FROM invoice_lines l
     WHERE l.invoice_id=parent.invoice_id AND l.source_type='variant' AND l.source_id=ordered.variant_id::text
      AND l.quantity_micros=ordered.quantity::numeric*1000000 AND l.unit_amount_minor=ordered.unit_amount_minor
      AND l.id::text=ordered.snapshot->>'invoiceLineId';
   ELSE
    SELECT count(*),min(l.id::text)::uuid INTO candidate_count,selected_line FROM invoice_lines l
     WHERE l.invoice_id=parent.invoice_id AND l.source_type='variant' AND l.source_id=ordered.variant_id::text
      AND l.quantity_micros=ordered.quantity::numeric*1000000 AND l.unit_amount_minor=ordered.unit_amount_minor;
   END IF;
   IF candidate_count<>1 OR selected_line IS NULL THEN RETURN NULL; END IF;
   IF EXISTS(SELECT 1 FROM invoice_merchant_allocation_lines WHERE invoice_line_id=selected_line AND allocation_id=allocation.id) THEN
    IF selected_line=ANY(own_lines) THEN RETURN NULL; END IF;
    own_lines:=array_append(own_lines,selected_line); own_quantities:=array_append(own_quantities,item.quantity::bigint*1000000);
   END IF;
  END LOOP;
  own_return:=cardinality(own_lines)>0; credit_gross:=0; bound_gross:=0;
  IF own_return THEN
   has_return:=true;
   IF returned.status<>'refunded' OR note.status<>'issued' OR note.currency<>parent.currency THEN RETURN NULL; END IF;
   SELECT count(*) INTO own_credit_count FROM credit_note_lines c JOIN invoice_merchant_allocation_lines f ON f.invoice_line_id=c.invoice_line_id
    WHERE c.credit_note_id=note.id AND f.allocation_id=allocation.id;
   IF own_credit_count<>cardinality(own_lines) THEN RETURN NULL; END IF;
   FOREACH selected_line IN ARRAY own_lines LOOP
    SELECT count(*) INTO candidate_count FROM credit_note_lines WHERE credit_note_id=note.id AND invoice_line_id=selected_line;
    IF candidate_count<>1 THEN RETURN NULL; END IF;
    SELECT * INTO credited FROM credit_note_lines WHERE credit_note_id=note.id AND invoice_line_id=selected_line;
    selected_quantity:=own_quantities[array_position(own_lines,selected_line)];
    IF credited.quantity_micros<>selected_quantity OR credited.subtotal_minor+credited.tax_minor<>credited.total_minor THEN RETURN NULL; END IF;
    quantities:=jsonb_set(quantities,ARRAY[selected_line::text],to_jsonb(coalesce((quantities->>selected_line::text)::numeric,0)+selected_quantity));
    net_credits:=jsonb_set(net_credits,ARRAY[selected_line::text],to_jsonb(coalesce((net_credits->>selected_line::text)::numeric,0)+credited.subtotal_minor));
    tax_credits:=jsonb_set(tax_credits,ARRAY[selected_line::text],to_jsonb(coalesce((tax_credits->>selected_line::text)::numeric,0)+credited.tax_minor));
    credit_gross:=credit_gross+credited.total_minor;
   END LOOP;
   bound_credit_ids:=array_append(bound_credit_ids,note.id);
  END IF;
  FOR part IN SELECT * FROM return_refund_allocations WHERE return_id=returned.id LOOP
   part_allocation:=NULL;
   IF own_return THEN
    SELECT p.*,r.allocation_id AS original_allocation INTO charge FROM payments p JOIN merchant_payment_routes r ON r.payment_id=p.id
     WHERE p.id=part.payment_id AND p.invoice_id=parent.invoice_id;
    IF charge.id IS NULL THEN RETURN NULL; END IF;
    part_allocation:=charge.original_allocation;
   END IF;
   confirmed:=0;
   FOR fact IN SELECT f.* FROM refunds f JOIN payments p ON p.id=f.payment_id
    WHERE p.invoice_id=parent.invoice_id AND f.payment_id=part.payment_id AND f.status='succeeded'
     AND(left(f.idempotency_key,length('return:'||returned.id::text||':allocation:'||part.id::text||':'))='return:'||returned.id::text||':allocation:'||part.id::text||':'
      OR f.idempotency_key='return:'||returned.id::text||':refund:'||part.payment_id::text
      OR(left(f.idempotency_key,length('return:'||returned.id::text||':provider:'))='return:'||returned.id::text||':provider:'
       AND right(f.idempotency_key,length(':'||part.payment_id::text))=':'||part.payment_id::text)) LOOP
    budget:=budget+1;
    IF budget>5000 OR fact.id=ANY(seen_refunds) THEN RETURN NULL; END IF;
    seen_refunds:=array_append(seen_refunds,fact.id);
    IF own_return AND part_allocation=allocation.id THEN
     SELECT count(*) INTO candidate_count FROM merchant_refund_requests WHERE refund_id=fact.id;
     IF candidate_count<>1 THEN RETURN NULL; END IF;
     SELECT * INTO intent FROM merchant_refund_requests WHERE refund_id=fact.id;
     IF intent.purpose<>'invoice_refund' OR intent.payment_id IS DISTINCT FROM part.payment_id OR intent.refund_id IS DISTINCT FROM fact.id
      OR intent.idempotency_key IS DISTINCT FROM fact.idempotency_key OR intent.amount_minor<>fact.amount_minor
      OR intent.original_payment_ref IS DISTINCT FROM charge.provider_ref OR intent.currency<>parent.currency OR fact.currency<>parent.currency
      OR intent.provider_platform_account_id IS DISTINCT FROM collection.provider_platform_account_id OR intent.charge_account_id IS DISTINCT FROM collection.charge_account_id
      OR freeholder_original_refund_resolved(intent.id,'succeeded',fact.provider_ref) IS DISTINCT FROM true THEN RETURN NULL; END IF;
     confirmed:=confirmed+fact.amount_minor;
    END IF;
   END LOOP;
   IF own_return AND part_allocation=allocation.id THEN
    IF confirmed<>part.amount_minor THEN RETURN NULL; END IF;
    linked_cash:=jsonb_set(linked_cash,ARRAY[part.payment_id::text],to_jsonb(coalesce((linked_cash->>part.payment_id::text)::numeric,0)+confirmed));
    bound_gross:=bound_gross+confirmed;
   END IF;
  END LOOP;
  -- This equality only conserves the exact line/refund references verified above.
  IF own_return AND bound_gross<>credit_gross THEN RETURN NULL; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM credit_note_lines l JOIN credit_notes n ON n.id=l.credit_note_id
  JOIN invoice_merchant_allocation_lines f ON f.invoice_line_id=l.invoice_line_id
  WHERE n.invoice_id=parent.invoice_id AND n.status<>'void' AND f.allocation_id=allocation.id AND NOT(n.id=ANY(bound_credit_ids))) THEN RETURN NULL; END IF;
 IF NOT has_return THEN RETURN prior_target; END IF;
 IF(SELECT count(*) FROM payments p JOIN merchant_payment_routes r ON r.payment_id=p.id WHERE p.invoice_id=parent.invoice_id)>5000 THEN RETURN NULL; END IF;
 FOR frozen IN SELECT f.*,l.quantity_micros,l.tax_minor FROM invoice_merchant_allocation_lines f JOIN invoice_lines l ON l.id=f.invoice_line_id
  WHERE f.allocation_id=allocation.id LOOP
  quantity:=coalesce((quantities->>frozen.invoice_line_id::text)::numeric,0);
  IF quantity<0 OR quantity>frozen.quantity_micros
   OR coalesce((net_credits->>frozen.invoice_line_id::text)::numeric,0)<>floor(frozen.revenue_minor::numeric*quantity/frozen.quantity_micros)
   OR coalesce((tax_credits->>frozen.invoice_line_id::text)::numeric,0)<>floor(frozen.tax_minor::numeric*quantity/frozen.quantity_micros) THEN RETURN NULL; END IF;
  fee_credit:=fee_credit+floor(frozen.fee_minor::numeric*quantity/frozen.quantity_micros);
 END LOOP;
 remaining:=fee_credit; charged_fees:=0;
 FOR charge IN SELECT p.*,r.application_fee_minor FROM payments p JOIN merchant_payment_routes r ON r.payment_id=p.id
  WHERE p.invoice_id=parent.invoice_id AND r.allocation_id=allocation.id ORDER BY p.created_at,p.id LOOP
  IF charge.currency<>parent.currency OR charge.status IN('created','processing') OR freeholder_merchant_creators_quiesced(charge.id) IS DISTINCT FROM true THEN RETURN NULL; END IF;
  IF charge.status IN('failed','cancelled') THEN
   SELECT count(*) INTO call_count FROM merchant_payment_dispatches WHERE payment_id=charge.id;
   IF NOT EXISTS(SELECT 1 FROM merchant_payment_requests WHERE payment_id=charge.id)
    OR EXISTS(SELECT 1 FROM merchant_payment_observations WHERE payment_id=charge.id AND status='succeeded')
    OR NOT(EXISTS(SELECT 1 FROM merchant_payment_terminal_receipts WHERE payment_id=charge.id)
     OR(call_count=0 AND charge.provider_ref IS NULL AND charge.provider_checkout_ref IS NULL)
     OR(call_count>0 AND call_count<=100 AND charge.provider_ref IS NULL AND charge.provider_checkout_ref IS NULL
      AND NOT EXISTS(SELECT 1 FROM merchant_payment_dispatches d LEFT JOIN merchant_payment_creation_refusals r ON r.dispatch_id=d.id WHERE d.payment_id=charge.id AND r.dispatch_id IS NULL))) THEN RETURN NULL; END IF;
   CONTINUE;
  END IF;
  IF charge.status<>'succeeded' OR charge.application_fee_minor<0 OR charge.application_fee_minor>charge.amount_minor
   OR charge.refunded_minor IS DISTINCT FROM coalesce((linked_cash->>charge.id::text)::bigint,0) THEN RETURN NULL; END IF;
  charged_fees:=charged_fees+charge.application_fee_minor;
  capacity:=least(remaining,charge.application_fee_minor); remaining:=remaining-capacity;
  IF charge.id=target_payment THEN result:=charge.application_fee_minor-capacity; END IF;
 END LOOP;
 IF remaining<>0 OR charged_fees>allocation.fee_minor OR result IS NULL THEN RETURN NULL; END IF;
 RETURN result;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION freeholder_original_line_fee_target(target_payment uuid) RETURNS bigint LANGUAGE plpgsql STABLE AS $$
DECLARE original_invoice uuid;atomic_owner boolean;current_target bigint;
BEGIN
 SELECT invoice_id INTO original_invoice FROM payments WHERE id=target_payment;
 SELECT EXISTS(SELECT 1 FROM payments p JOIN controlled_cash_application_links l ON l.payment_id=p.id
  JOIN controlled_cash_application_batches b ON b.id=l.batch_id WHERE p.invoice_id=original_invoice AND b.protocol='controlled_cash_atomic.v1' AND EXISTS(SELECT 1 FROM invoices refunded_invoice WHERE refunded_invoice.id=original_invoice AND refunded_invoice.refunded_minor>0)) INTO atomic_owner;
 IF NOT atomic_owner THEN RETURN freeholder_original_line_fee_target_before_atomic_refund(target_payment);END IF;
 SELECT target_retained_fee_minor::bigint INTO current_target FROM freeholder_controlled_atomic_refund_targets(original_invoice) WHERE payment_id=target_payment AND known;
 RETURN current_target;
END $$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION freeholder_agreement_fee_current(target uuid) RETURNS TABLE(known boolean,eligible boolean,owed bigint,recorded bigint,excess bigint) LANGUAGE plpgsql STABLE AS $$
DECLARE duty agreement_fee_duties%ROWTYPE;i invoices%ROWTYPE;cash_gross numeric;cash_returned numeric;cash_remaining numeric;cash_duty numeric;credit_remaining numeric;credit_duty numeric;target_duty numeric;
BEGIN
 SELECT * INTO duty FROM agreement_fee_duties WHERE invoice_id=target;
 SELECT * INTO i FROM invoices WHERE id=target;
 IF duty.invoice_id IS NULL OR i.id IS NULL OR i.total_minor<>duty.total_minor OR i.credited_minor<>duty.credited_minor OR i.currency<>duty.currency
  OR(SELECT count(*) FROM invoice_lines WHERE invoice_id=i.id)<>1 OR NOT EXISTS(SELECT 1 FROM invoice_lines l WHERE l.invoice_id=i.id AND l.snapshot->>'subscriptionProrationId'=duty.acceptance_id::text)
  OR NOT EXISTS(SELECT 1 FROM invoice_market_policies m WHERE m.invoice_id=i.id AND m.model='seller_merchant' AND m.fee_minor=duty.target_fee_minor)
  OR(SELECT count(*) FROM payments WHERE invoice_id=i.id)+(SELECT count(*) FROM agreement_fee_credit_assignments WHERE invoice_id=i.id)+(SELECT count(*) FROM agreement_fee_remittances WHERE invoice_id=i.id)>1000
  OR EXISTS(SELECT 1 FROM payments p WHERE p.invoice_id=i.id AND NOT freeholder_merchant_creators_quiesced(p.id))
  OR EXISTS(SELECT 1 FROM merchant_payment_observations o JOIN payments p ON p.id=o.payment_id WHERE p.invoice_id=i.id AND o.status='succeeded' AND(p.status<>'succeeded' OR o.amount_minor<>p.amount_minor OR o.currency<>p.currency OR(o.provider_ref IS DISTINCT FROM p.provider_ref AND o.provider_ref IS DISTINCT FROM p.provider_checkout_ref)))
  OR EXISTS(SELECT 1 FROM payments p WHERE p.invoice_id=i.id AND p.status IN('failed','cancelled') AND(
   EXISTS(SELECT 1 FROM commercial_payment_attestations a WHERE a.payment_id=p.id)
   OR NOT EXISTS(SELECT 1 FROM merchant_payment_requests q WHERE q.payment_id=p.id)
   OR NOT(EXISTS(SELECT 1 FROM merchant_payment_terminal_receipts q WHERE q.payment_id=p.id)
    OR(p.provider_ref IS NULL AND p.provider_checkout_ref IS NULL AND NOT EXISTS(SELECT 1 FROM merchant_payment_dispatches d LEFT JOIN merchant_payment_creation_refusals r ON r.dispatch_id=d.id WHERE d.payment_id=p.id AND r.dispatch_id IS NULL)))))
  OR EXISTS(SELECT 1 FROM payments p LEFT JOIN agreement_fee_cash_assignments a ON a.payment_id=p.id WHERE p.invoice_id=i.id AND(p.status IN('created','processing')OR(p.status='succeeded' AND(a.payment_id IS NULL OR a.invoice_id<>i.id OR a.amount_minor<>p.amount_minor OR NOT freeholder_agreement_fee_principal_safe(p.id) OR freeholder_original_payment_fee(p.id) IS DISTINCT FROM a.fee_obligation_minor))))
  OR EXISTS(SELECT 1 FROM payments atomic_payment WHERE i.refunded_minor>0 AND atomic_payment.invoice_id=i.id AND EXISTS(SELECT 1 FROM controlled_cash_application_batches atomic_epoch WHERE atomic_epoch.invoice_id=i.id AND atomic_epoch.protocol='controlled_cash_atomic.v1') AND NOT EXISTS(SELECT 1 FROM freeholder_controlled_atomic_refund_fee_state(atomic_payment.id) fee_state WHERE fee_state.known AND fee_state.reconciled)) THEN
  RETURN QUERY SELECT false,false,NULL::bigint,NULL::bigint,NULL::bigint;RETURN;END IF;
 SELECT coalesce(sum(p.amount_minor),0),coalesce(sum(p.refunded_minor),0),coalesce(sum(p.amount_minor-p.refunded_minor),0),coalesce(sum(CASE WHEN EXISTS(SELECT 1 FROM controlled_cash_application_batches atomic_epoch WHERE i.refunded_minor>0 AND atomic_epoch.invoice_id=i.id AND atomic_epoch.protocol='controlled_cash_atomic.v1') THEN (SELECT fee_state.actual_retained_fee_minor FROM freeholder_controlled_atomic_refund_fee_state(p.id) fee_state WHERE fee_state.known) ELSE floor(a.fee_obligation_minor::numeric*(p.amount_minor-p.refunded_minor)/p.amount_minor) END),0)
  INTO cash_gross,cash_returned,cash_remaining,cash_duty FROM payments p JOIN agreement_fee_cash_assignments a ON a.payment_id=p.id WHERE p.invoice_id=i.id AND p.status='succeeded';
 IF cash_gross<>i.paid_minor OR cash_returned<>i.refunded_minor OR EXISTS(SELECT 1 FROM agreement_fee_credit_assignments a
  LEFT JOIN invoice_credit_applications x ON x.reservation_id=a.application_id LEFT JOIN invoice_credit_reservations r ON r.id=x.reservation_id LEFT JOIN invoice_credit_funding f ON f.id=r.funding_id LEFT JOIN payments p ON p.id=f.source_payment_id
  WHERE a.invoice_id=i.id AND(x.invoice_id IS DISTINCT FROM i.id OR r.target_source_id IS DISTINCT FROM i.source_id OR a.amount_minor IS DISTINCT FROM r.amount_minor OR a.fee_obligation_minor IS DISTINCT FROM x.fee_obligation_minor
   OR a.proven_collected_minor IS DISTINCT FROM x.fee_proven_collected_minor OR p.id IS NULL OR p.refunded_minor<>0 OR NOT freeholder_agreement_fee_principal_safe(p.id))) THEN
  RETURN QUERY SELECT false,false,NULL::bigint,NULL::bigint,NULL::bigint;RETURN;END IF;
 SELECT coalesce(sum(amount_minor),0),coalesce(sum(fee_obligation_minor),0) INTO credit_remaining,credit_duty FROM agreement_fee_credit_assignments WHERE invoice_id=i.id;
 IF credit_remaining<>duty.credited_minor OR cash_remaining+credit_remaining>duty.total_minor THEN RETURN QUERY SELECT false,false,NULL::bigint,NULL::bigint,NULL::bigint;RETURN;END IF;
 SELECT coalesce(sum(CASE WHEN direction='returned' THEN -amount_minor ELSE amount_minor END),0) INTO recorded FROM agreement_fee_remittances WHERE invoice_id=i.id;
 eligible:=EXISTS(SELECT 1 FROM agreement_fee_eligibility WHERE invoice_id=i.id);
 target_duty:=CASE WHEN eligible THEN floor(duty.target_fee_minor::numeric*(cash_remaining+credit_remaining)/duty.total_minor) ELSE 0 END;
 known:=true;owed:=CASE WHEN eligible THEN greatest(0,target_duty-credit_duty-cash_duty) ELSE 0 END;excess:=CASE WHEN eligible THEN greatest(0,credit_duty+cash_duty-target_duty) ELSE 0 END;
 RETURN NEXT;
END $$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_merchant_fee_refund() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original refunds%ROWTYPE; parent payments%ROWTYPE; original_fee bigint; original_platform text; original_receipt uuid; prior merchant_fee_refunds%ROWTYPE; reserved numeric; accepted numeric; target_fee bigint;atomic_invoice uuid;
BEGIN
 IF TG_OP<>'DELETE' THEN
  SELECT invoice_id INTO atomic_invoice FROM payments WHERE id=NEW.payment_id;
  IF EXISTS(SELECT 1 FROM payments atomic_payment JOIN controlled_cash_application_links atomic_link ON atomic_link.payment_id=atomic_payment.id
   JOIN controlled_cash_application_batches atomic_batch ON atomic_batch.id=atomic_link.batch_id WHERE atomic_payment.invoice_id=atomic_invoice AND atomic_batch.protocol='controlled_cash_atomic.v1' AND EXISTS(SELECT 1 FROM invoices refunded_invoice WHERE refunded_invoice.id=atomic_invoice AND refunded_invoice.refunded_minor>0)) THEN
   PERFORM freeholder_merchant_fee_require_prefix(NEW.payment_id);
   IF TG_OP='UPDATE' AND OLD.status='reserved' AND NEW.status='dispatching' AND NOT freeholder_merchant_fee_post_ready(NEW.id) THEN
    RAISE EXCEPTION 'Require the genuine unique original fee POST and returned source before dispatch' USING ERRCODE='23514';END IF;
   IF TG_OP='UPDATE' AND NEW.status='accepted' AND NOT freeholder_merchant_fee_result_owned(NEW.id,NEW.provider_ref) THEN
    RAISE EXCEPTION 'Only the real original returned fee caller can apply its actual retained acknowledgement' USING ERRCODE='23514';END IF;
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Original commission refund operations are retained financial evidence.' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
  IF(to_jsonb(NEW)-ARRAY['status','provider_ref','dispatched_at','accepted_at','updated_at']) IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['status','provider_ref','dispatched_at','accepted_at','updated_at'])
   OR(OLD.provider_ref IS NOT NULL AND NEW.provider_ref IS DISTINCT FROM OLD.provider_ref)
   OR(OLD.dispatched_at IS NOT NULL AND NEW.dispatched_at IS DISTINCT FROM OLD.dispatched_at)
   OR(OLD.accepted_at IS NOT NULL AND NEW.accepted_at IS DISTINCT FROM OLD.accepted_at)
   OR(OLD.status IN('accepted','refused') AND NEW.status IS DISTINCT FROM OLD.status)
   OR(OLD.status='unknown' AND NEW.status NOT IN('unknown','accepted'))
   OR(OLD.status='dispatching' AND NEW.status='reserved') THEN
   RAISE EXCEPTION 'Original commission money, positive acknowledgements and unknown outcomes are immutable.' USING ERRCODE='23514';
  END IF;
  IF OLD.status='reserved' AND NEW.status='dispatching' AND NEW.target_retained_fee_minor IS DISTINCT FROM freeholder_original_line_fee_target(NEW.payment_id) THEN
   RAISE EXCEPTION 'Restore the original bound line commission before physical fee admission.' USING ERRCODE='23514';
  END IF;
  IF NEW.status='accepted' AND NOT EXISTS(SELECT 1 FROM merchant_fee_observations o WHERE o.operation_id=NEW.id AND o.binding_verified
    AND o.provider_ref=NEW.provider_ref AND o.application_fee_ref=NEW.application_fee_ref AND o.amount_minor=NEW.amount_minor AND o.currency=NEW.currency) THEN
   RAISE EXCEPTION 'Commit the exact physical fee acknowledgement before applying it.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO parent FROM payments WHERE id=NEW.payment_id FOR UPDATE;
 SELECT application_fee_minor,platform_id,receipt_id INTO original_fee,original_platform,original_receipt FROM(
  SELECT r.application_fee_minor,c.provider_platform_account_id platform_id,NULL::uuid receipt_id FROM merchant_payment_routes r JOIN invoice_merchant_collections c ON c.allocation_id=r.allocation_id WHERE r.payment_id=NEW.payment_id
  UNION ALL SELECT application_fee_minor,provider_platform_account_id,original_charge_receipt_id FROM merchant_agreement_payment_routes WHERE payment_id=NEW.payment_id
  UNION ALL SELECT r.application_fee_minor,c.provider_platform_account_id,NULL::uuid FROM merchant_invoice_payment_routes r JOIN invoice_merchant_scopes c ON c.invoice_id=r.invoice_id WHERE r.payment_id=NEW.payment_id) original_route LIMIT 1;
 target_fee:=freeholder_original_line_fee_target(parent.id);
 IF NEW.refund_id IS NOT NULL THEN SELECT * INTO original FROM refunds WHERE id=NEW.refund_id; END IF;
 SELECT * INTO prior FROM merchant_fee_refunds WHERE source_key=NEW.source_key ORDER BY attempt_number DESC LIMIT 1;
 SELECT COALESCE(sum(amount_minor),0),COALESCE(sum(amount_minor) FILTER(WHERE status='accepted'),0) INTO reserved,accepted
  FROM merchant_fee_refunds WHERE payment_id=NEW.payment_id AND application_fee_ref=NEW.application_fee_ref AND status<>'refused';
 IF parent.id IS NULL OR original_fee IS NULL OR NEW.provider_platform_account_id IS DISTINCT FROM original_platform OR NEW.original_charge_receipt_id IS DISTINCT FROM original_receipt
  OR(NEW.purpose='customer_refund' AND(original.id IS NULL OR original.payment_id<>NEW.payment_id OR original.status<>'succeeded'))
  OR NEW.status<>'reserved' OR NEW.provider_ref IS NOT NULL OR NEW.dispatched_at IS NOT NULL OR NEW.accepted_at IS NOT NULL
  OR NEW.currency<>parent.currency OR NEW.target_retained_fee_minor IS DISTINCT FROM target_fee
  OR NEW.source_key IS DISTINCT FROM('merchant-fee:'||parent.id::text||':'||target_fee::text)
  OR NEW.amount_minor::numeric IS DISTINCT FROM NEW.observed_original_fee_minor::numeric-target_fee-accepted
  OR reserved+NEW.amount_minor>NEW.observed_original_fee_minor
  OR EXISTS(SELECT 1 FROM merchant_fee_refunds WHERE payment_id=NEW.payment_id AND status IN('reserved','dispatching','unknown'))
  OR EXISTS(SELECT 1 FROM merchant_fee_observations o JOIN merchant_fee_refunds r ON r.id=o.operation_id WHERE r.payment_id=NEW.payment_id AND r.status<>'accepted')
  OR NOT EXISTS(SELECT 1 FROM merchant_payment_observations o WHERE o.payment_id=NEW.payment_id AND o.customer_charge_verified AND o.route_verified
   AND o.provider_charge_ref=NEW.provider_charge_ref AND o.application_fee_ref=NEW.application_fee_ref
   AND o.observed_application_fee_minor=NEW.observed_original_fee_minor AND o.application_fee_currency=NEW.currency)
  OR NEW.attempt_number<>COALESCE(prior.attempt_number,0)+1
  OR(prior.id IS NOT NULL AND(prior.status<>'refused' OR prior.amount_minor<>NEW.amount_minor OR prior.application_fee_ref<>NEW.application_fee_ref OR prior.provider_charge_ref<>NEW.provider_charge_ref)) THEN
  RAISE EXCEPTION 'Reserve only the exact remaining original fee after its cumulative customer refunds and prior fee operations.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
