-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
-- C12.38/C9.33: complete local-binding successor; frozen source stays unchanged.
-- Only the local actual variable is renamed; qualified fact.actual columns remain.
CREATE OR REPLACE FUNCTION freeholder_controlled_collection_inventory(target uuid) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE o subscription_controlled_operations%ROWTYPE;r subscription_controlled_resources%ROWTYPE;listed subscription_controlled_operations%ROWTYPE;
 proof jsonb;listing jsonb;read_id jsonb;reader subscription_controlled_operations%ROWTYPE;observed_invoice jsonb;invoice_ref text;boundary bigint;
 parent_collection uuid;known subscription_controlled_collections%ROWTYPE;known_quote subscription_controlled_quotes%ROWTYPE;canonical invoices%ROWTYPE;
 first_update bigint;owned boolean;seen text[]='{}';read_ids text[]='{}';items bigint=0;
BEGIN
 SELECT * INTO o FROM subscription_controlled_operations WHERE id=target;SELECT * INTO r FROM subscription_controlled_resources WHERE id=o.resource_id;
 proof=o.original_request->'collectionInventory';
 IF o.id IS NULL OR r.id IS NULL OR jsonb_typeof(proof) IS DISTINCT FROM 'object' OR NOT coalesce(proof->>'revision' ~ '^[a-f0-9]{64}$',false)
  OR jsonb_typeof(proof->'invoiceReadOperationIds') IS DISTINCT FROM 'array' OR jsonb_array_length(proof->'invoiceReadOperationIds')>5000
  OR NOT freeholder_controlled_callers_closed(r.id) THEN RETURN false;END IF;
 parent_collection=coalesce(o.original_request->'payload'->>'collectionId',o.original_request->'payload'->'manifest'->>'collectionId')::uuid;
 IF parent_collection IS NULL OR NOT EXISTS(SELECT 1 FROM subscription_controlled_collections collection JOIN subscription_controlled_quotes q ON q.id=collection.quote_id WHERE collection.id=parent_collection AND q.resource_id=r.id) THEN RETURN false;END IF;
 SELECT coalesce(max(prior.ordinal),0) INTO boundary FROM subscription_controlled_operations prior WHERE prior.resource_id=r.id
  AND prior.kind IN('update_calendar','create_draft','add_invoice_component','set_invoice_fee','finalize_invoice','pay_invoice','cancel_calendar','pause_drafts')
  AND EXISTS(SELECT 1 FROM subscription_controlled_calls admitted WHERE admitted.operation_id=prior.id);
 IF proof->>'afterOrdinal' IS DISTINCT FROM boundary::text THEN RETURN false;END IF;
 SELECT * INTO listed FROM subscription_controlled_operations WHERE id::text=proof->>'listOperationId' AND resource_id=r.id AND kind='list_invoices' AND ordinal>boundary AND ordinal<o.ordinal;
 SELECT actual_result INTO listing FROM subscription_controlled_verifications WHERE operation_id=listed.id;
 IF listed.id IS NULL OR listing->>'complete' IS DISTINCT FROM 'true' OR jsonb_typeof(listing->'providerInvoiceRefs') IS DISTINCT FROM 'array'
  OR jsonb_typeof(listing->'actualInvoices') IS DISTINCT FROM 'array' OR jsonb_array_length(listing->'providerInvoiceRefs')<>jsonb_array_length(listing->'actualInvoices')
  OR jsonb_array_length(listing->'providerInvoiceRefs')<>jsonb_array_length(proof->'invoiceReadOperationIds')
  OR EXISTS(SELECT 1 FROM subscription_controlled_operations later WHERE later.resource_id=r.id AND later.kind='list_invoices' AND later.ordinal>listed.ordinal AND later.ordinal<o.ordinal) THEN RETURN false;END IF;
 SELECT min(prior.ordinal) INTO first_update FROM subscription_controlled_operations prior WHERE prior.resource_id=r.id AND prior.kind='update_calendar'
  AND EXISTS(SELECT 1 FROM subscription_controlled_calls admitted WHERE admitted.operation_id=prior.id);
 FOR read_id IN SELECT value FROM jsonb_array_elements(proof->'invoiceReadOperationIds') LOOP
  SELECT * INTO reader FROM subscription_controlled_operations WHERE id::text=(read_id#>>'{}') AND resource_id=r.id AND kind='read_invoice' AND ordinal>listed.ordinal AND ordinal<o.ordinal;
  SELECT actual_result INTO observed_invoice FROM subscription_controlled_verifications WHERE operation_id=reader.id;
  invoice_ref=reader.original_request->'payload'->>'providerInvoiceRef';
  IF reader.id IS NULL OR reader.id::text=ANY(read_ids) OR invoice_ref=ANY(seen) OR observed_invoice->>'providerInvoiceRef' IS DISTINCT FROM invoice_ref
   OR observed_invoice->>'providerSubscriptionRef' IS DISTINCT FROM listing->>'providerSubscriptionRef' OR observed_invoice->>'providerCustomerRef' IS DISTINCT FROM r.original_scope->>'providerCustomerRef'
   OR observed_invoice->>'currency' IS DISTINCT FROM r.original_scope->>'currency' OR observed_invoice->>'completePayments' IS DISTINCT FROM 'true' OR observed_invoice->>'completeLines' IS DISTINCT FROM 'true'
   OR observed_invoice->'actualInvoice'->>'id' IS DISTINCT FROM invoice_ref OR observed_invoice->'actualInvoice'->>'total' IS DISTINCT FROM observed_invoice->>'totalMinor'
   OR observed_invoice->'actualInvoice'->>'amount_paid' IS DISTINCT FROM observed_invoice->>'paidMinor' OR observed_invoice->'actualInvoice'->>'amount_remaining' IS DISTINCT FROM observed_invoice->>'remainingMinor'
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(listing->'providerInvoiceRefs') ref WHERE ref=invoice_ref)
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(listing->'actualInvoices') item WHERE item->>'id'=invoice_ref)
   OR EXISTS(SELECT 1 FROM subscription_controlled_operations later WHERE later.resource_id=r.id AND later.kind='read_invoice' AND later.ordinal>reader.ordinal AND later.ordinal<o.ordinal AND later.original_request->'payload'->>'providerInvoiceRef'=invoice_ref)
   OR NOT EXISTS(SELECT 1 FROM subscription_controlled_facts fact JOIN subscription_controlled_calls caller ON caller.id=fact.call_id WHERE caller.operation_id=reader.id AND fact.actual->>'kind'='invoice_read' AND fact.actual->'raw'=observed_invoice->'actualInvoice') THEN RETURN false;END IF;
  read_ids=array_append(read_ids,reader.id::text);seen=array_append(seen,invoice_ref);
  IF EXISTS(SELECT 1 FROM(VALUES('actualCash'),('actualPayments'),('actualIntents'),('actualLines'),('actualPrices')) family(name) WHERE jsonb_typeof(observed_invoice->family.name) IS DISTINCT FROM 'array') THEN RETURN false;END IF;
  items=items+1+jsonb_array_length(observed_invoice->'actualCash')+jsonb_array_length(observed_invoice->'actualPayments')+jsonb_array_length(observed_invoice->'actualIntents')+jsonb_array_length(observed_invoice->'actualLines')+jsonb_array_length(observed_invoice->'actualPrices');
  IF items>5000 THEN RETURN false;END IF;
  IF EXISTS(SELECT 1 FROM subscription_controlled_invoice_bindings b WHERE b.collection_id=parent_collection AND b.resource_id=r.id AND b.provider_invoice_ref=invoice_ref) THEN CONTINUE;END IF;
  owned=observed_invoice->>'status'='paid' AND observed_invoice->>'autoAdvance'='false' AND observed_invoice->>'totalMinor'='0' AND observed_invoice->>'paidMinor'='0' AND observed_invoice->>'remainingMinor'='0'
   AND observed_invoice->'actualInvoice'->>'amount_due'='0' AND observed_invoice->'actualInvoice'->>'starting_balance'='0' AND observed_invoice->'actualInvoice'->>'ending_balance'='0'
   AND observed_invoice->'actualInvoice'->>'pre_payment_credit_notes_amount'='0' AND observed_invoice->'actualInvoice'->>'post_payment_credit_notes_amount'='0'
   AND observed_invoice->'actualCash'='[]'::jsonb AND observed_invoice->'actualPayments'='[]'::jsonb AND observed_invoice->'actualIntents'='[]'::jsonb
   AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(observed_invoice->'actualLines') line WHERE line->>'amount' IS DISTINCT FROM '0')
   AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(observed_invoice->'actualPrices') price WHERE price->>'unit_amount' IS DISTINCT FROM '0')
   AND(SELECT count(DISTINCT v.actual_result->>'providerInvoiceRef') FROM subscription_controlled_operations bootstrap_read JOIN subscription_controlled_verifications v ON v.operation_id=bootstrap_read.id
    WHERE bootstrap_read.resource_id=r.id AND bootstrap_read.kind='read_bootstrap' AND(first_update IS NULL OR bootstrap_read.ordinal<first_update)
     AND v.actual_result->>'completeZeroRecurringItem'='true' AND v.actual_result->>'providerSubscriptionRef'=listing->>'providerSubscriptionRef')=1
   AND EXISTS(SELECT 1 FROM subscription_controlled_operations bootstrap_read JOIN subscription_controlled_verifications v ON v.operation_id=bootstrap_read.id
    WHERE bootstrap_read.resource_id=r.id AND bootstrap_read.kind='read_bootstrap' AND(first_update IS NULL OR bootstrap_read.ordinal<first_update)
     AND v.actual_result->>'completeZeroRecurringItem'='true' AND v.actual_result->>'providerSubscriptionRef'=listing->>'providerSubscriptionRef' AND v.actual_result->>'providerInvoiceRef'=invoice_ref);
  IF owned IS TRUE THEN CONTINUE;END IF;
  SELECT collection.* INTO known FROM subscription_controlled_invoice_bindings b JOIN subscription_controlled_collections collection ON collection.id=b.collection_id
   JOIN subscription_controlled_quotes q ON q.id=collection.quote_id WHERE b.resource_id=r.id AND b.provider_invoice_ref=invoice_ref AND q.resource_id=r.id;
  SELECT * INTO known_quote FROM subscription_controlled_quotes WHERE id=known.quote_id;SELECT * INTO canonical FROM invoices WHERE id=known.invoice_id;
  IF known.id IS NULL OR known.id=parent_collection OR NOT freeholder_controlled_collection_valid(known.id) OR canonical.status IS DISTINCT FROM 'paid'
   OR canonical.paid_minor+canonical.credited_minor<>canonical.total_minor OR canonical.refunded_minor<>0 OR observed_invoice->>'status' IS DISTINCT FROM 'paid'
   OR observed_invoice->>'autoAdvance' IS DISTINCT FROM 'false' OR observed_invoice->>'remainingMinor' IS DISTINCT FROM '0'
   OR observed_invoice->>'totalMinor' IS DISTINCT FROM known_quote.review->>'cashDueMinor' OR observed_invoice->>'paidMinor' IS DISTINCT FROM observed_invoice->>'totalMinor' THEN RETURN false;END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM subscription_controlled_operations calendar_read JOIN subscription_controlled_verifications v ON v.operation_id=calendar_read.id
  WHERE calendar_read.resource_id=r.id AND calendar_read.kind='read_calendar' AND calendar_read.ordinal=(SELECT max(latest.ordinal) FROM subscription_controlled_operations latest WHERE latest.resource_id=r.id AND latest.kind='read_calendar' AND latest.ordinal<o.ordinal)
   AND v.actual_result->>'providerInvoiceRef' IS NOT NULL AND NOT(v.actual_result->>'providerInvoiceRef'=ANY(seen))) THEN RETURN false;END IF;
 RETURN cardinality(seen)=jsonb_array_length(listing->'providerInvoiceRefs');
END $$;
