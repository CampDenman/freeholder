-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
-- C12.38: UNAPPLIED exact controlled refund bank proof. Generic current receipts stay unchanged.
CREATE FUNCTION freeholder_controlled_atomic_refund_bank_state(target_payment uuid)
RETURNS TABLE(known boolean,payment_id uuid,receipt_id uuid,inspection_id uuid,observation_id uuid,refunded_minor float8,namespace_revision text,evidence_fingerprint text,physical_witness jsonb)
LANGUAGE plpgsql STABLE AS $$
DECLARE actual_payment payments%ROWTYPE;actual_route merchant_agreement_payment_routes%ROWTYPE;actual_receipt subscription_provider_charge_receipts%ROWTYPE;
 actual_link controlled_cash_application_links%ROWTYPE;actual_batch controlled_cash_application_batches%ROWTYPE;actual_origin subscription_controlled_charge_origins%ROWTYPE;
 bank_row record;actual_lineage subscription_controlled_cash_inspection_lineages%ROWTYPE;bank jsonb;atom jsonb;prior_lineage record;
 actual_request merchant_refund_requests%ROWTYPE;actual_refund refunds%ROWTYPE;observed merchant_refund_observations%ROWTYPE;captured merchant_refund_observation_captures%ROWTYPE;
 namespace_requests uuid[];namespace_observations uuid[];resource_refs text[]:=ARRAY[]::text[];returned numeric:=0;physical_count bigint;conflicting_physical boolean;
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
    OR NOT (freeholder_original_refund_resolved(q.id,'succeeded',f.provider_ref) OR EXISTS(SELECT 1 FROM freeholder_controlled_atomic_refund_bank_state(p.id) current_bank WHERE current_bank.known AND current_bank.refunded_minor=p.refunded_minor))))))
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
CREATE OR REPLACE FUNCTION freeholder_merchant_fee_invocations_ready() RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT coalesce(
  EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('freeholder_controlled_atomic_refund_targets(uuid)') AND p.provolatile='s' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='da88bad09a1b87c8abc12856586fe9e1debfe0b72e192e46971677f4fad92eeb')
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
--> statement-breakpoint
CREATE OR REPLACE FUNCTION freeholder_atomic_auxiliary_fee_ready() RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT coalesce(
  EXISTS(SELECT 1 FROM pg_proc installed WHERE installed.oid=to_regprocedure('freeholder_atomic_fee_return_resources(uuid)') AND encode(sha256(convert_to(installed.prosrc,'UTF8')),'hex')='91fd305274ea123483945235f43f2bfc5cf18207eb7701f590f056c08cebdb4f')
  AND EXISTS(SELECT 1 FROM pg_proc installed WHERE installed.oid=to_regprocedure('freeholder_controlled_atomic_refund_bank_state(uuid)') AND installed.provolatile='s' AND encode(sha256(convert_to(installed.prosrc,'UTF8')),'hex')='ca4cc826d361ab5c070b5c7df0dea678a988b319a415d6a457be11b2a1b68f6e')
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
