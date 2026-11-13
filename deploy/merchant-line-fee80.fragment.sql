-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C5.19/C12.38: append after refund guards. No old operation is rewritten.
-- Canonical integrity verification, not a scalar/GUC declaration of entitlement.
CREATE FUNCTION freeholder_original_line_fee_target(target_payment uuid) RETURNS bigint LANGUAGE plpgsql STABLE AS $$
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
CREATE OR REPLACE FUNCTION guard_merchant_fee_refund() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original refunds%ROWTYPE; parent payments%ROWTYPE; original_fee bigint; original_platform text; original_receipt uuid; prior merchant_fee_refunds%ROWTYPE; reserved numeric; accepted numeric; target_fee bigint;
BEGIN
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
