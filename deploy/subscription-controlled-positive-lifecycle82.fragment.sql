-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- OWNED UNAPPLIED suffix AFTER7a0d620a8dac8acb102e4801d545f5dfcfc089ebabb2a11e3d7c347d60482423.
-- SOURCE ONLY / WIP / UNQUALIFIED. Root owns assembly/hash/new qualification DB.
-- Exact-target observation is recovery, never permission to repeat a POST or
-- reinterpret partial/refunded/expired/stopped principal as settled/access.
CREATE OR REPLACE FUNCTION freeholder_controlled_target_operation_admissible(target uuid) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE o subscription_controlled_operations%ROWTYPE;r subscription_controlled_resources%ROWTYPE;q subscription_controlled_quotes%ROWTYPE;c subscription_controlled_collections%ROWTYPE;
 payload jsonb;target_id uuid;latest_read jsonb;manifest jsonb;proof jsonb;bound subscription_controlled_invoice_bindings%ROWTYPE;
BEGIN
 SELECT * INTO o FROM subscription_controlled_operations WHERE id=target;SELECT * INTO r FROM subscription_controlled_resources WHERE id=o.resource_id;
 payload=o.original_request->'payload';manifest=payload->'manifest';
 IF o.id IS NULL OR r.id IS NULL OR o.original_request->>'requiredProtocol' IS DISTINCT FROM 'controlled_net_gross.v1'
  OR NOT coalesce(o.original_request->>'parentFinancialRevision' ~ '^[a-f0-9]{64}$',false)
  OR EXISTS(SELECT 1 FROM subscription_controlled_closures WHERE resource_id=r.id)
  OR NOT freeholder_controlled_callers_closed(r.id) OR EXISTS(SELECT 1 FROM subscription_controlled_calls WHERE operation_id=o.id)
  OR EXISTS(SELECT 1 FROM subscription_controlled_operations WHERE resource_id=r.id AND ordinal>o.ordinal) THEN RETURN false;END IF;
 SELECT v.actual_result INTO latest_read FROM subscription_controlled_operations original JOIN subscription_controlled_verifications v ON v.operation_id=original.id
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
 IF o.kind='update_calendar' THEN
  RETURN payload->>'currentReadDigest'=latest_read->>'currentReadDigest' AND payload->>'acceptedQuoteDigest'=c.accepted_quote_digest
   AND payload->'target'->>'principalMinor'=q.review->'quote'->'snapshot'->>'periodAmountMinor'
   AND payload->'target'->>'interval'=q.review->'quote'->'snapshot'->>'interval' AND payload->'target'->>'intervalCount'=q.review->'quote'->'snapshot'->>'intervalCount'
   AND NOT EXISTS(SELECT 1 FROM subscription_controlled_operations old WHERE old.resource_id=r.id AND old.id<>o.id AND old.kind='update_calendar' AND old.original_request->'payload'->>'collectionId'=c.id::text);
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
   AND NOT EXISTS(SELECT 1 FROM subscription_controlled_operations old WHERE old.resource_id=r.id AND old.id<>o.id AND old.kind='create_draft' AND old.original_request->'payload'->'manifest'->>'collectionId'=c.id::text)
   AND EXISTS(SELECT 1 FROM subscription_controlled_operations old JOIN subscription_controlled_verifications v ON v.operation_id=old.id WHERE old.resource_id=r.id AND old.kind='update_calendar'
     AND old.original_request->'payload'->>'collectionId'=c.id::text AND v.actual_result->>'providerInvoiceRef' IS NULL);
 END IF;
 IF bound.collection_id IS NULL OR payload->>'providerInvoiceRef' IS DISTINCT FROM bound.provider_invoice_ref
  OR payload->'invoiceOrigin'->>'creatorOperationId' IS DISTINCT FROM bound.creator_operation_id::text
  OR NOT EXISTS(SELECT 1 FROM subscription_controlled_operations creator WHERE creator.id=bound.creator_operation_id AND creator.request_digest=payload->'invoiceOrigin'->>'creatorRequestDigest'
   AND(bound.origin_kind='created_draft' OR(creator.original_request->'payload'->>'collectionId'=payload->'invoiceOrigin'->>'priceEpochCollectionId'
    AND creator.original_request->'payload'->>'acceptedQuoteDigest'=payload->'invoiceOrigin'->>'priceEpochAcceptedQuoteDigest'))) THEN RETURN false;END IF;
 IF o.kind='add_invoice_component' THEN
  RETURN EXISTS(SELECT 1 FROM subscription_controlled_components component WHERE component.id::text=payload->>'componentId' AND component.collection_id=c.id
    AND NOT EXISTS(SELECT 1 FROM subscription_controlled_item_receipts item WHERE item.component_id=component.id))
   AND NOT EXISTS(SELECT 1 FROM subscription_controlled_operations old WHERE old.resource_id=r.id AND old.id<>o.id AND old.kind='add_invoice_component'
    AND old.original_request->'payload'->>'componentId'=payload->>'componentId');
 END IF;
 IF(SELECT count(*) FROM subscription_controlled_item_receipts item JOIN subscription_controlled_components component ON component.id=item.component_id WHERE component.collection_id=c.id)
   <>(SELECT count(*) FROM subscription_controlled_components WHERE collection_id=c.id) THEN RETURN false;END IF;
 IF o.kind IN('read_manifest','set_invoice_fee') THEN RETURN true;END IF;
 SELECT v.actual_result INTO proof FROM subscription_controlled_invoice_proofs retained JOIN subscription_controlled_operations original ON original.id=retained.operation_id
  JOIN subscription_controlled_verifications v ON v.operation_id=original.id WHERE retained.collection_id=c.id ORDER BY original.ordinal DESC LIMIT 1;
 IF proof IS NULL OR proof->>'exactManifest' IS DISTINCT FROM 'true' OR proof->>'providerInvoiceRef' IS DISTINCT FROM bound.provider_invoice_ref
  OR EXISTS(SELECT 1 FROM subscription_controlled_operations old WHERE old.resource_id=r.id AND old.id<>o.id AND old.kind=o.kind AND old.original_request->'payload'->'manifest'->>'collectionId'=c.id::text) THEN RETURN false;END IF;
 IF c.kind='period' AND o.kind IN('finalize_invoice','pay_invoice')
  AND(clock_timestamp()<(q.review->'calendar'->>'proposedPeriodStart')::timestamptz
   OR(q.review->>'originalTrialEndsAt' IS NOT NULL AND clock_timestamp()<(q.review->>'originalTrialEndsAt')::timestamptz)) THEN RETURN false;END IF;
 IF o.kind='finalize_invoice' THEN RETURN proof->'inventory'->>'status'='draft' AND proof->'inventory'->>'paidMinor'='0';END IF;
 IF o.kind='pay_invoice' THEN RETURN proof->'inventory'->>'status'='open' AND proof->'inventory'->>'paidMinor'='0'
  AND(q.review->>'cashDueMinor')::bigint>0 AND proof->'inventory'->>'remainingMinor'=q.review->>'cashDueMinor';END IF;
 RETURN false;
END $$;

