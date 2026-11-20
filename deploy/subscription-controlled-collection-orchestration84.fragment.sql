-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
-- OWNED UNAPPLIED successor after original-period84; no old SQL/model edits.
-- Complete genuine list/read inventory after the last actual bank writer.
CREATE FUNCTION freeholder_controlled_collection_inventory(target uuid) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE o subscription_controlled_operations%ROWTYPE;r subscription_controlled_resources%ROWTYPE;listed subscription_controlled_operations%ROWTYPE;
 proof jsonb;listing jsonb;read_id jsonb;reader subscription_controlled_operations%ROWTYPE;actual jsonb;invoice_ref text;boundary bigint;
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
  SELECT actual_result INTO actual FROM subscription_controlled_verifications WHERE operation_id=reader.id;
  invoice_ref=reader.original_request->'payload'->>'providerInvoiceRef';
  IF reader.id IS NULL OR reader.id::text=ANY(read_ids) OR invoice_ref=ANY(seen) OR actual->>'providerInvoiceRef' IS DISTINCT FROM invoice_ref
   OR actual->>'providerSubscriptionRef' IS DISTINCT FROM listing->>'providerSubscriptionRef' OR actual->>'providerCustomerRef' IS DISTINCT FROM r.original_scope->>'providerCustomerRef'
   OR actual->>'currency' IS DISTINCT FROM r.original_scope->>'currency' OR actual->>'completePayments' IS DISTINCT FROM 'true' OR actual->>'completeLines' IS DISTINCT FROM 'true'
   OR actual->'actualInvoice'->>'id' IS DISTINCT FROM invoice_ref OR actual->'actualInvoice'->>'total' IS DISTINCT FROM actual->>'totalMinor'
   OR actual->'actualInvoice'->>'amount_paid' IS DISTINCT FROM actual->>'paidMinor' OR actual->'actualInvoice'->>'amount_remaining' IS DISTINCT FROM actual->>'remainingMinor'
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(listing->'providerInvoiceRefs') ref WHERE ref=invoice_ref)
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(listing->'actualInvoices') item WHERE item->>'id'=invoice_ref)
   OR EXISTS(SELECT 1 FROM subscription_controlled_operations later WHERE later.resource_id=r.id AND later.kind='read_invoice' AND later.ordinal>reader.ordinal AND later.ordinal<o.ordinal AND later.original_request->'payload'->>'providerInvoiceRef'=invoice_ref)
   OR NOT EXISTS(SELECT 1 FROM subscription_controlled_facts fact JOIN subscription_controlled_calls caller ON caller.id=fact.call_id WHERE caller.operation_id=reader.id AND fact.actual->>'kind'='invoice_read' AND fact.actual->'raw'=actual->'actualInvoice') THEN RETURN false;END IF;
  read_ids=array_append(read_ids,reader.id::text);seen=array_append(seen,invoice_ref);
  IF EXISTS(SELECT 1 FROM(VALUES('actualCash'),('actualPayments'),('actualIntents'),('actualLines'),('actualPrices')) family(name) WHERE jsonb_typeof(actual->family.name) IS DISTINCT FROM 'array') THEN RETURN false;END IF;
  items=items+1+jsonb_array_length(actual->'actualCash')+jsonb_array_length(actual->'actualPayments')+jsonb_array_length(actual->'actualIntents')+jsonb_array_length(actual->'actualLines')+jsonb_array_length(actual->'actualPrices');
  IF items>5000 THEN RETURN false;END IF;
  IF EXISTS(SELECT 1 FROM subscription_controlled_invoice_bindings b WHERE b.collection_id=parent_collection AND b.resource_id=r.id AND b.provider_invoice_ref=invoice_ref) THEN CONTINUE;END IF;
  owned=actual->>'status'='paid' AND actual->>'autoAdvance'='false' AND actual->>'totalMinor'='0' AND actual->>'paidMinor'='0' AND actual->>'remainingMinor'='0'
   AND actual->'actualInvoice'->>'amount_due'='0' AND actual->'actualInvoice'->>'starting_balance'='0' AND actual->'actualInvoice'->>'ending_balance'='0'
   AND actual->'actualInvoice'->>'pre_payment_credit_notes_amount'='0' AND actual->'actualInvoice'->>'post_payment_credit_notes_amount'='0'
   AND actual->'actualCash'='[]'::jsonb AND actual->'actualPayments'='[]'::jsonb AND actual->'actualIntents'='[]'::jsonb
   AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(actual->'actualLines') line WHERE line->>'amount' IS DISTINCT FROM '0')
   AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(actual->'actualPrices') price WHERE price->>'unit_amount' IS DISTINCT FROM '0')
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
   OR canonical.paid_minor+canonical.credited_minor<>canonical.total_minor OR canonical.refunded_minor<>0 OR actual->>'status' IS DISTINCT FROM 'paid'
   OR actual->>'autoAdvance' IS DISTINCT FROM 'false' OR actual->>'remainingMinor' IS DISTINCT FROM '0'
   OR actual->>'totalMinor' IS DISTINCT FROM known_quote.review->>'cashDueMinor' OR actual->>'paidMinor' IS DISTINCT FROM actual->>'totalMinor' THEN RETURN false;END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM subscription_controlled_operations calendar_read JOIN subscription_controlled_verifications v ON v.operation_id=calendar_read.id
  WHERE calendar_read.resource_id=r.id AND calendar_read.kind='read_calendar' AND calendar_read.ordinal=(SELECT max(latest.ordinal) FROM subscription_controlled_operations latest WHERE latest.resource_id=r.id AND latest.kind='read_calendar' AND latest.ordinal<o.ordinal)
   AND v.actual_result->>'providerInvoiceRef' IS NOT NULL AND NOT(v.actual_result->>'providerInvoiceRef'=ANY(seen))) THEN RETURN false;END IF;
 RETURN cardinality(seen)=jsonb_array_length(listing->'providerInvoiceRefs');
END $$;
--> statement-breakpoint

-- Preserve full prior positive lifecycle guards; add exact inventory/current
-- calendar and make zero-child stale intents inert, never actual callers.
CREATE OR REPLACE FUNCTION freeholder_controlled_target_operation_admissible(target uuid) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE o subscription_controlled_operations%ROWTYPE;r subscription_controlled_resources%ROWTYPE;q subscription_controlled_quotes%ROWTYPE;c subscription_controlled_collections%ROWTYPE;
 payload jsonb;target_id uuid;latest_read jsonb;read_ordinal bigint;original_update subscription_controlled_operations%ROWTYPE;manifest jsonb;proof jsonb;bound subscription_controlled_invoice_bindings%ROWTYPE;
BEGIN
 SELECT * INTO o FROM subscription_controlled_operations WHERE id=target;SELECT * INTO r FROM subscription_controlled_resources WHERE id=o.resource_id;
 payload=o.original_request->'payload';manifest=payload->'manifest';
 IF o.id IS NULL OR r.id IS NULL OR o.original_request->>'requiredProtocol' IS DISTINCT FROM 'controlled_net_gross.v1'
  OR NOT coalesce(o.original_request->>'parentFinancialRevision' ~ '^[a-f0-9]{64}$',false)
  OR EXISTS(SELECT 1 FROM subscription_controlled_closures WHERE resource_id=r.id)
  OR NOT freeholder_controlled_callers_closed(r.id) OR EXISTS(SELECT 1 FROM subscription_controlled_calls WHERE operation_id=o.id)
  OR EXISTS(SELECT 1 FROM subscription_controlled_operations WHERE resource_id=r.id AND ordinal>o.ordinal) THEN RETURN false;END IF;
 SELECT v.actual_result,original.ordinal INTO latest_read,read_ordinal FROM subscription_controlled_operations original JOIN subscription_controlled_verifications v ON v.operation_id=original.id
  WHERE original.resource_id=r.id AND original.kind='read_calendar' AND original.ordinal<o.ordinal ORDER BY original.ordinal DESC LIMIT 1;
 IF latest_read IS NULL OR (o.kind<>'read_manifest' AND(latest_read->>'collectionPausedAsDraft' IS DISTINCT FROM 'true' OR latest_read->>'calendarCanceled' IS DISTINCT FROM 'false'))
  OR latest_read->>'providerSubscriptionRef' IS DISTINCT FROM payload->>'providerSubscriptionRef' THEN RETURN false;END IF;
 IF o.kind IN('preview_proration','preview_update') THEN
  RETURN payload->>'currentReadDigest'=latest_read->>'currentReadDigest' AND payload->>'prorationAt' IS NOT NULL
   AND NOT EXISTS(SELECT 1 FROM subscription_controlled_operations later WHERE later.resource_id=r.id AND later.ordinal<o.ordinal
    AND later.ordinal>(SELECT max(original.ordinal) FROM subscription_controlled_operations original JOIN subscription_controlled_verifications v ON v.operation_id=original.id WHERE original.resource_id=r.id AND original.kind='read_calendar')
    AND later.kind IN('update_calendar','cancel_calendar'));
 END IF;
 IF NOT coalesce(o.original_request->>'targetFinancialRevision' ~ '^[a-f0-9]{64}$',false) THEN RETURN false;END IF;
 target_id=CASE WHEN o.kind='update_calendar' THEN(payload->>'collectionId')::uuid ELSE(manifest->>'collectionId')::uuid END;
 SELECT * INTO c FROM subscription_controlled_collections WHERE id=target_id;SELECT * INTO q FROM subscription_controlled_quotes WHERE id=c.quote_id;
 IF c.id IS NULL OR q.resource_id IS DISTINCT FROM r.id OR NOT freeholder_controlled_collection_valid(c.id)
  OR(o.kind<>'read_manifest' AND((c.kind='proration' AND q.effective_at<=clock_timestamp())
  OR NOT EXISTS(SELECT 1 FROM subscriptions p JOIN module_settings m ON m.module='subscriptions' AND m.enabled WHERE p.id=r.subscription_id
    AND p.status IN('active','trialing') AND p.cancelled_at IS NULL AND NOT p.cancel_at_period_end)
  OR EXISTS(SELECT 1 FROM invoices i WHERE i.id=c.invoice_id AND(i.paid_minor<>0 OR i.refunded_minor<>0 OR i.status IN('draft','void','refunded'))))) THEN RETURN false;END IF;
 IF o.kind<>'read_manifest' AND c.invoice_id IS NOT NULL AND NOT freeholder_controlled_collection_inventory(o.id) THEN RETURN false;END IF;
 IF o.kind NOT IN('update_calendar','read_manifest') THEN
  IF(SELECT count(*) FROM subscription_controlled_operations creator WHERE creator.resource_id=r.id AND creator.kind='update_calendar'
    AND creator.original_request->'payload'->>'collectionId'=c.id::text AND EXISTS(SELECT 1 FROM subscription_controlled_calls physical WHERE physical.operation_id=creator.id))<>1 THEN RETURN false;END IF;
  SELECT * INTO original_update FROM subscription_controlled_operations creator WHERE creator.resource_id=r.id AND creator.kind='update_calendar'
   AND creator.original_request->'payload'->>'collectionId'=c.id::text AND EXISTS(SELECT 1 FROM subscription_controlled_calls physical WHERE physical.operation_id=creator.id);
  IF original_update.id IS NULL OR read_ordinal<=original_update.ordinal
   OR latest_read->'actualRaw'->'metadata'->>'freeholder_controlled_price_epoch_id' IS DISTINCT FROM c.id::text
   OR latest_read->'actualRaw'->'metadata'->>'freeholder_controlled_update_operation_id' IS DISTINCT FROM original_update.id::text
   OR latest_read->'actualRaw'->'metadata'->>'freeholder_controlled_update_request_digest' IS DISTINCT FROM original_update.request_digest
   OR latest_read->'actualRaw'->'metadata'->>'freeholder_controlled_accepted_quote_digest' IS DISTINCT FROM c.accepted_quote_digest
   OR latest_read->'actualRaw'->'metadata'->>'freeholder_controlled_collection_policy' IS DISTINCT FROM c.collection_policy THEN RETURN false;END IF;
 END IF;
 IF o.kind NOT IN('update_calendar','read_manifest') AND(
  payload->'calendar'->'originalComponents'->0->>'amountMinor' IS DISTINCT FROM q.review->'quote'->'snapshot'->>'periodAmountMinor'
  OR payload->'calendar'->'originalComponents'->0->>'providerProductRef' IS DISTINCT FROM r.original_scope->>'providerProductRef'
  OR payload->'calendar'->>'originalAnchor' IS DISTINCT FROM q.review->'calendar'->>'expectedProviderBillingAnchor'
  OR payload->'calendar'->>'originalProviderTrialEnd' IS DISTINCT FROM q.review->'calendar'->>'expectedProviderTrialEndsAt'
  OR NOT((payload->'calendar'->>'originalPeriodStart'=q.review->'calendar'->>'expectedProviderPeriodStart' AND payload->'calendar'->>'originalPeriodEnd'=q.review->'calendar'->>'expectedProviderPeriodEnd')
    OR(c.kind='period' AND EXISTS(SELECT 1 FROM jsonb_array_elements(q.review->'calendar'->'nativeForecasts') forecast WHERE forecast->>'proration'='false'
      AND forecast->>'amountMinor'=q.review->'quote'->'snapshot'->>'periodAmountMinor' AND forecast->>'periodStart'=payload->'calendar'->>'originalPeriodStart' AND forecast->>'periodEnd'=payload->'calendar'->>'originalPeriodEnd')))
 ) THEN RETURN false;END IF;
 IF o.kind='update_calendar' THEN
  RETURN payload->>'currentReadDigest'=latest_read->>'currentReadDigest' AND payload->>'acceptedQuoteDigest'=c.accepted_quote_digest
   AND payload->'target'->>'principalMinor'=q.review->'quote'->'snapshot'->>'periodAmountMinor'
   AND payload->'target'->>'interval'=q.review->'quote'->'snapshot'->>'interval' AND payload->'target'->>'intervalCount'=q.review->'quote'->'snapshot'->>'intervalCount'
   AND NOT EXISTS(SELECT 1 FROM subscription_controlled_operations old WHERE old.resource_id=r.id AND old.id<>o.id AND EXISTS(SELECT 1 FROM subscription_controlled_calls actual_caller WHERE actual_caller.operation_id=old.id) AND old.kind='update_calendar' AND old.original_request->'payload'->>'collectionId'=c.id::text);
 END IF;
 IF manifest->>'protocol' IS DISTINCT FROM 'controlled_net_gross.v1' OR manifest->>'quoteId' IS DISTINCT FROM q.id::text OR manifest->>'canonicalInvoiceId' IS DISTINCT FROM c.invoice_id::text
  OR manifest->>'canonicalTargetDigest' IS DISTINCT FROM c.canonical_target_digest OR manifest->>'acceptedQuoteDigest' IS DISTINCT FROM c.accepted_quote_digest
  OR manifest->>'termsId' IS DISTINCT FROM c.terms_id::text OR manifest->>'grossMinor' IS DISTINCT FROM((q.review->>'debitNetMinor')::bigint+(q.review->>'debitTaxMinor')::bigint)::text
  OR manifest->>'creditedMinor' IS DISTINCT FROM q.review->>'creditAppliedMinor' OR manifest->>'cashDueMinor' IS DISTINCT FROM q.review->>'cashDueMinor'
  OR payload->'calendar'->>'currentReadDigest' IS DISTINCT FROM latest_read->>'currentReadDigest'
  OR jsonb_typeof(manifest->'components') IS DISTINCT FROM 'array' OR jsonb_array_length(manifest->'components')<>(SELECT count(*) FROM subscription_controlled_components WHERE collection_id=c.id)
  OR EXISTS(SELECT 1 FROM subscription_controlled_components actual WHERE actual.collection_id=c.id AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(manifest->'components') component
    WHERE component->>'id'=actual.id::text AND component->>'kind'=actual.kind AND component->>'amountMinor'=actual.amount_minor::text AND component->>'provenanceDigest'=actual.provenance_digest)) THEN RETURN false;END IF;
 SELECT * INTO bound FROM subscription_controlled_invoice_bindings WHERE collection_id=c.id;
 IF o.kind='create_draft' THEN
  RETURN bound.collection_id IS NULL AND payload->>'mode'='create' AND payload->'invoiceOrigin'->>'kind'='created_draft'
   AND payload->'invoiceOrigin'->>'creatorOperationId' IS NULL AND payload->'invoiceOrigin'->>'creatorRequestDigest' IS NULL
   AND NOT EXISTS(SELECT 1 FROM subscription_controlled_operations old WHERE old.resource_id=r.id AND old.id<>o.id AND EXISTS(SELECT 1 FROM subscription_controlled_calls actual_caller WHERE actual_caller.operation_id=old.id) AND old.kind='create_draft' AND old.original_request->'payload'->'manifest'->>'collectionId'=c.id::text);
 END IF;
 IF bound.collection_id IS NULL OR payload->>'providerInvoiceRef' IS DISTINCT FROM bound.provider_invoice_ref
  OR payload->'invoiceOrigin'->>'creatorOperationId' IS DISTINCT FROM bound.creator_operation_id::text
  OR NOT EXISTS(SELECT 1 FROM subscription_controlled_operations creator WHERE creator.id=bound.creator_operation_id AND creator.request_digest=payload->'invoiceOrigin'->>'creatorRequestDigest'
   AND(bound.origin_kind='created_draft' OR(creator.original_request->'payload'->>'collectionId'=payload->'invoiceOrigin'->>'priceEpochCollectionId'
    AND creator.original_request->'payload'->>'acceptedQuoteDigest'=payload->'invoiceOrigin'->>'priceEpochAcceptedQuoteDigest'))) THEN RETURN false;END IF;
 IF o.kind='add_invoice_component' THEN
  RETURN EXISTS(SELECT 1 FROM subscription_controlled_components component WHERE component.id::text=payload->>'componentId' AND component.collection_id=c.id
    AND NOT EXISTS(SELECT 1 FROM subscription_controlled_item_receipts item WHERE item.component_id=component.id))
   AND NOT EXISTS(SELECT 1 FROM subscription_controlled_operations old WHERE old.resource_id=r.id AND old.id<>o.id AND EXISTS(SELECT 1 FROM subscription_controlled_calls actual_caller WHERE actual_caller.operation_id=old.id) AND old.kind='add_invoice_component'
    AND old.original_request->'payload'->>'componentId'=payload->>'componentId');
 END IF;
 IF(SELECT count(*) FROM subscription_controlled_item_receipts item JOIN subscription_controlled_components component ON component.id=item.component_id WHERE component.collection_id=c.id)
   <>(SELECT count(*) FROM subscription_controlled_components WHERE collection_id=c.id) THEN RETURN false;END IF;
 IF o.kind IN('read_manifest','set_invoice_fee') THEN RETURN true;END IF;
 SELECT v.actual_result INTO proof FROM subscription_controlled_invoice_proofs retained JOIN subscription_controlled_operations original ON original.id=retained.operation_id
  JOIN subscription_controlled_verifications v ON v.operation_id=original.id WHERE retained.collection_id=c.id ORDER BY original.ordinal DESC LIMIT 1;
 IF proof IS NULL OR proof->>'exactManifest' IS DISTINCT FROM 'true' OR proof->>'providerInvoiceRef' IS DISTINCT FROM bound.provider_invoice_ref
  OR EXISTS(SELECT 1 FROM subscription_controlled_operations old WHERE old.resource_id=r.id AND old.id<>o.id AND EXISTS(SELECT 1 FROM subscription_controlled_calls actual_caller WHERE actual_caller.operation_id=old.id) AND old.kind=o.kind AND old.original_request->'payload'->'manifest'->>'collectionId'=c.id::text) THEN RETURN false;END IF;
 IF c.kind='period' AND o.kind IN('finalize_invoice','pay_invoice')
  AND(clock_timestamp()<(q.review->'calendar'->>'proposedPeriodStart')::timestamptz
   OR(q.review->>'originalTrialEndsAt' IS NOT NULL AND clock_timestamp()<(q.review->>'originalTrialEndsAt')::timestamptz)) THEN RETURN false;END IF;
 IF o.kind='finalize_invoice' THEN RETURN proof->'inventory'->>'status'='draft' AND proof->'inventory'->>'paidMinor'='0';END IF;
 IF o.kind='pay_invoice' THEN RETURN proof->'inventory'->>'status'='open' AND proof->'inventory'->>'paidMinor'='0'
  AND(q.review->>'cashDueMinor')::bigint>0 AND proof->'inventory'->>'remainingMinor'=q.review->>'cashDueMinor';END IF;
 RETURN false;
END $$;


--> statement-breakpoint
