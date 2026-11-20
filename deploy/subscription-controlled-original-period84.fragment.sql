-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
-- OWNED UNAPPLIED successor AFTER subscription-controlled-canonical82.fragment.sql.
-- Original mandate only. No new models, phase fabrication, bank/payment/access grant.
CREATE FUNCTION freeholder_controlled_original_period_source(target uuid) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE q subscription_controlled_quotes%ROWTYPE;r subscription_controlled_resources%ROWTYPE;p subscriptions%ROWTYPE;t subscription_commercial_terms%ROWTYPE;
 native_request jsonb;update_request jsonb;native jsonb;updated jsonb;calendar jsonb;customer jsonb;start_at timestamptz;end_at timestamptz;request jsonb;
BEGIN
 SELECT * INTO q FROM subscription_controlled_quotes WHERE id=target;
 SELECT * INTO r FROM subscription_controlled_resources WHERE id=q.resource_id;
 SELECT * INTO p FROM subscriptions WHERE id=r.subscription_id;
 SELECT * INTO t FROM subscription_commercial_terms WHERE id=q.previous_terms_id;
 IF q.id IS NULL OR q.kind IS DISTINCT FROM 'period' OR r.id IS NULL OR p.id IS NULL OR t.id IS NULL OR q.redacted_at IS NOT NULL
  OR p.billing_mode IS DISTINCT FROM 'provider' OR p.provider IS DISTINCT FROM 'stripe' OR p.merchant_scope_version IS DISTINCT FROM 1
  OR p.signup_pending OR p.status NOT IN('active','trialing') OR p.cancel_at_period_end OR p.cancelled_at IS NOT NULL
  OR t.subscription_id IS DISTINCT FROM p.id OR t.snapshot->>'billingMode' IS DISTINCT FROM 'provider'
  OR t.tax_destination IS NULL OR q.profile_id IS DISTINCT FROM t.profile_id OR q.profile_version IS DISTINCT FROM t.profile_version
  OR EXISTS(SELECT 1 FROM subscription_controlled_closures WHERE resource_id=r.id)
  OR q.review->>'kind' IS DISTINCT FROM 'period' OR q.review->>'subscriptionId' IS DISTINCT FROM p.id::text
  OR q.review->>'previousTermsId' IS DISTINCT FROM t.id::text OR q.review->'quote'->'snapshot' IS DISTINCT FROM t.snapshot
  OR q.review->'quote'->>'quoteDigest' IS DISTINCT FROM t.accepted_quote_digest
  OR q.review->'controlled'->>'originalPeriodConsentDigest' IS DISTINCT FROM t.accepted_quote_digest
  OR q.review->>'originalPeriodStart' IS DISTINCT FROM to_char(p.current_period_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  OR q.review->>'originalPeriodEnd' IS DISTINCT FROM to_char(p.current_period_end AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  OR q.review->>'creditNetMinor' IS DISTINCT FROM '0' OR q.review->>'creditTaxMinor' IS DISTINCT FROM '0'
  OR q.review->>'creditAppliedMinor' IS DISTINCT FROM '0' OR q.review->>'residualCreditMinor' IS DISTINCT FROM '0' THEN RETURN false;END IF;
 start_at=(q.review->'calendar'->>'proposedPeriodStart')::timestamptz;end_at=(q.review->'calendar'->>'proposedPeriodEnd')::timestamptz;
 IF start_at IS DISTINCT FROM q.effective_at OR start_at<p.current_period_end OR end_at<=start_at OR end_at<=clock_timestamp()
  OR q.canonical_source_id IS DISTINCT FROM p.id::text||':'||to_char(start_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  OR(start_at<>p.current_period_end AND NOT EXISTS(SELECT 1 FROM subscription_commercial_amendments a JOIN subscription_commercial_terms accepted ON accepted.id=a.terms_id
    WHERE a.subscription_id=p.id AND a.state='activated' AND accepted.id=t.id AND accepted.effective_period_start=start_at)) THEN RETURN false;END IF;
 IF p.status='trialing' THEN
  IF p.trial_ends_at IS NULL OR p.trial_ends_at IS DISTINCT FROM p.current_period_end OR (t.snapshot->>'trialDays')::integer<=0
   OR r.original_scope->>'acceptedTrialEnd' IS DISTINCT FROM to_char(p.trial_ends_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') THEN RETURN false;END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM invoices original_invoice WHERE original_invoice.contact_id=p.contact_id AND original_invoice.currency=p.currency
   AND original_invoice.status='paid' AND original_invoice.paid_minor+original_invoice.credited_minor=original_invoice.total_minor AND original_invoice.refunded_minor=0
   AND(original_invoice.source_type='subscription' AND original_invoice.source_id=p.id::text||':'||to_char(p.current_period_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    OR EXISTS(SELECT 1 FROM subscription_prorations prior WHERE prior.subscription_id=p.id AND prior.state='applied' AND prior.plan_id=p.plan_id
     AND prior.proposed_period_end=p.current_period_end AND prior.debit_invoice_id=original_invoice.id))) THEN RETURN false;END IF;
 END IF;
 SELECT op.original_request,v.actual_result INTO native_request,native FROM subscription_controlled_operations op JOIN subscription_controlled_verifications v ON v.operation_id=op.id
  WHERE op.id=q.native_preview_operation_id AND op.resource_id=r.id AND op.kind='preview_proration';
 SELECT op.original_request,v.actual_result INTO update_request,updated FROM subscription_controlled_operations op JOIN subscription_controlled_verifications v ON v.operation_id=op.id
  WHERE op.id=q.update_preview_operation_id AND op.resource_id=r.id AND op.kind='preview_update';
 SELECT v.actual_result INTO calendar FROM subscription_controlled_operations op JOIN subscription_controlled_verifications v ON v.operation_id=op.id
  WHERE op.id=q.calendar_read_operation_id AND op.resource_id=r.id AND op.kind='read_calendar';
 SELECT v.actual_result INTO customer FROM subscription_controlled_operations op JOIN subscription_controlled_verifications v ON v.operation_id=op.id
  WHERE op.id=q.customer_financial_operation_id AND op.resource_id=r.id AND op.kind='read_customer_financials';
 request=native_request->'payload';
 RETURN native IS NOT NULL AND updated IS NOT NULL AND calendar IS NOT NULL AND customer IS NOT NULL
  AND request IS NOT DISTINCT FROM update_request->'payload' AND native_request->>'targetInputDigest'=q.input_digest AND update_request->>'targetInputDigest'=q.input_digest
  AND native_request->>'periodSourceId'=q.canonical_source_id AND update_request->>'periodSourceId'=q.canonical_source_id
  AND native_request->>'originalPeriodConsentDigest'=t.accepted_quote_digest AND update_request->>'originalPeriodConsentDigest'=t.accepted_quote_digest
  AND native_request->>'economicQuoteDigest'=t.accepted_quote_digest AND update_request->>'economicQuoteDigest'=t.accepted_quote_digest
  AND request->>'prorationAt'=q.input->>'previewAt' AND request->>'prorationAt'=q.review->'calendar'->>'prorationAt'
  AND request->'target'->>'principalMinor'=t.snapshot->>'periodAmountMinor' AND request->'target'->>'interval'=t.snapshot->>'interval'
  AND request->'target'->>'intervalCount'=t.snapshot->>'intervalCount' AND request->>'currentReadDigest'=calendar->>'currentReadDigest'
  AND calendar->>'collectionPausedAsDraft'='true' AND calendar->>'calendarCanceled'='false'
  AND customer->>'balanceState'='known_zero' AND customer->>'completeCreditNotes'='true'
  AND native->>'requestedProrationBehavior'='create_prorations' AND updated->>'requestedProrationBehavior'='none'
  AND native->>'prorationAt'=request->>'prorationAt' AND updated->>'prorationAt'=request->>'prorationAt';
END $$;
--> statement-breakpoint
CREATE FUNCTION freeholder_controlled_original_period_birth() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.kind='period' AND NOT freeholder_controlled_original_period_source(NEW.quote_id) THEN
  RAISE EXCEPTION 'An original next-period target requires its actual started trial/paid original period, unchanged mandate and exact returned preview/calendar lineage' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER subscription_controlled_collections_period_birth BEFORE INSERT ON subscription_controlled_collections
 FOR EACH ROW EXECUTE FUNCTION freeholder_controlled_original_period_birth();
--> statement-breakpoint

-- Complete original body preserved except distinct mandate-kind consent and
-- additive exact normal-period canonical line/date ownership.
CREATE OR REPLACE FUNCTION freeholder_controlled_collection_valid(target uuid) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE c subscription_controlled_collections%ROWTYPE;q subscription_controlled_quotes%ROWTYPE;r subscription_controlled_resources%ROWTYPE;
 p subscriptions%ROWTYPE;t subscription_commercial_terms%ROWTYPE;i invoices%ROWTYPE;
BEGIN
 SELECT * INTO c FROM subscription_controlled_collections WHERE id=target;
 SELECT * INTO q FROM subscription_controlled_quotes WHERE id=c.quote_id;
 SELECT * INTO r FROM subscription_controlled_resources WHERE id=q.resource_id;
 SELECT * INTO p FROM subscriptions WHERE id=r.subscription_id;
 SELECT * INTO t FROM subscription_commercial_terms WHERE id=c.terms_id;
 IF c.id IS NULL OR q.id IS NULL OR r.id IS NULL OR p.id IS NULL OR t.subscription_id IS DISTINCT FROM p.id OR q.redacted_at IS NOT NULL
  OR c.kind IS DISTINCT FROM q.kind OR c.id IS DISTINCT FROM q.planned_collection_id OR c.proration_id IS DISTINCT FROM q.planned_proration_id
  OR c.accepted_quote_digest IS DISTINCT FROM q.quote_digest
  OR (c.kind='period' AND(c.acceptance_kind IS DISTINCT FROM 'original_period_mandate' OR c.proration_id IS NOT NULL OR c.credit_note_id IS NOT NULL
   OR c.terms_id IS DISTINCT FROM q.previous_terms_id OR c.original_consent_digest IS DISTINCT FROM t.accepted_quote_digest
   OR q.review->'controlled'->>'originalPeriodConsentDigest' IS DISTINCT FROM t.accepted_quote_digest OR q.review->'quote'->>'quoteDigest' IS DISTINCT FROM t.accepted_quote_digest))
  OR (c.kind='proration' AND(c.acceptance_kind IS DISTINCT FROM 'explicit_change' OR c.original_consent_digest IS DISTINCT FROM q.quote_digest OR t.accepted_quote_digest IS DISTINCT FROM q.quote_digest))
  OR t.snapshot IS DISTINCT FROM q.review->'quote'->'snapshot' THEN RETURN false;END IF;
 IF c.kind='proration' AND NOT EXISTS(SELECT 1 FROM subscription_prorations a WHERE a.id=c.proration_id AND a.subscription_id=p.id
  AND a.previous_terms_id=q.previous_terms_id AND a.terms_id=c.terms_id AND a.debit_invoice_id IS NOT DISTINCT FROM c.invoice_id AND a.credit_note_id IS NOT DISTINCT FROM c.credit_note_id
  AND a.accepted_quote_digest=c.accepted_quote_digest AND a.effective_at=q.effective_at) THEN RETURN false;END IF;
 IF c.invoice_id IS NULL THEN
  RETURN c.kind='proration' AND (q.review->>'debitNetMinor')::bigint=0 AND(q.review->>'debitTaxMinor')::bigint=0
   AND(q.review->>'creditAppliedMinor')::bigint=0 AND c.credit_note_id IS NULL AND NOT EXISTS(SELECT 1 FROM subscription_controlled_components WHERE collection_id=c.id);
 END IF;
 SELECT * INTO i FROM invoices WHERE id=c.invoice_id;
 IF i.id IS NULL OR i.source_type IS DISTINCT FROM 'subscription' OR i.source_id IS DISTINCT FROM q.canonical_source_id OR i.contact_id IS DISTINCT FROM p.contact_id
  OR i.currency IS DISTINCT FROM p.currency OR i.issued_at IS NULL OR i.shipping_minor<>0
  OR i.subtotal_minor-i.discount_minor IS DISTINCT FROM (q.review->>'debitNetMinor')::bigint OR i.tax_minor IS DISTINCT FROM(q.review->>'debitTaxMinor')::bigint
  OR i.total_minor IS DISTINCT FROM(q.review->>'debitNetMinor')::bigint+(q.review->>'debitTaxMinor')::bigint
  OR i.credited_minor IS DISTINCT FROM(q.review->>'creditAppliedMinor')::bigint
  OR NOT EXISTS(SELECT 1 FROM invoice_merchant_tax_quotes tax WHERE tax.invoice_id=i.id AND tax.profile_id=q.profile_id AND tax.profile_version=q.profile_version)
  OR (c.credit_note_id IS NOT NULL AND EXISTS(SELECT 1 FROM return_requests WHERE credit_note_id=c.credit_note_id)) THEN RETURN false;END IF;
 IF coalesce((SELECT sum(amount_minor) FROM subscription_controlled_components WHERE collection_id=c.id AND kind='net'),0) IS DISTINCT FROM(q.review->>'debitNetMinor')::bigint
  OR coalesce((SELECT sum(amount_minor) FROM subscription_controlled_components WHERE collection_id=c.id AND kind='merchant_declared_tax_collection'),0) IS DISTINCT FROM(q.review->>'debitTaxMinor')::bigint
  OR coalesce((SELECT sum(amount_minor) FROM subscription_controlled_components WHERE collection_id=c.id AND kind='locked_canonical_credit'),0) IS DISTINCT FROM -(q.review->>'creditAppliedMinor')::bigint
  OR EXISTS(SELECT 1 FROM subscription_controlled_components x WHERE x.collection_id=c.id AND(x.currency<>i.currency OR x.kind IS DISTINCT FROM x.provenance->>'kind'
   OR(x.kind='merchant_declared_tax_collection' AND(x.provenance->>'profileId' IS DISTINCT FROM q.profile_id::text OR x.provenance->>'profileVersion' IS DISTINCT FROM q.profile_version::text))
   OR(x.kind='locked_canonical_credit' AND(x.provenance->>'creditNoteId' IS DISTINCT FROM c.credit_note_id::text OR jsonb_typeof(x.provenance->'applicationIds') IS DISTINCT FROM 'array'
    OR (SELECT coalesce(sum(res.amount_minor),0) FROM invoice_credit_applications app JOIN invoice_credit_reservations res ON res.id=app.reservation_id JOIN invoice_credit_funding fund ON fund.id=res.funding_id
      WHERE app.invoice_id=i.id AND fund.credit_note_id=c.credit_note_id AND res.target_source_id=i.source_id AND res.id::text IN(SELECT jsonb_array_elements_text(x.provenance->'applicationIds')))
       IS DISTINCT FROM -x.amount_minor)))) THEN RETURN false;END IF;
 IF c.kind='period' AND(
  (q.review->>'creditAppliedMinor')::bigint<>0 OR (q.review->>'creditNetMinor')::bigint<>0 OR(q.review->>'creditTaxMinor')::bigint<>0
  OR q.canonical_source_id IS DISTINCT FROM p.id::text||':'||(q.review->'calendar'->>'proposedPeriodStart')
  OR q.review->>'effectiveAt' IS DISTINCT FROM q.review->'calendar'->>'proposedPeriodStart'
  OR NOT EXISTS(SELECT 1 FROM invoice_merchant_tax_quotes tax WHERE tax.invoice_id=i.id AND tax.occurred_at=(q.review->'calendar'->>'proposedPeriodStart')::timestamptz)
  OR EXISTS(SELECT 1 FROM subscription_controlled_components x WHERE x.collection_id=c.id AND(x.kind='locked_canonical_credit'
   OR x.period_start IS DISTINCT FROM(q.review->'calendar'->>'proposedPeriodStart')::timestamptz OR x.period_end IS DISTINCT FROM(q.review->'calendar'->>'proposedPeriodEnd')::timestamptz
   OR(x.kind='net' AND NOT EXISTS(SELECT 1 FROM invoice_lines line WHERE line.id::text=x.provenance->>'canonicalInvoiceLineId' AND line.invoice_id=i.id
    AND line.source_type='subscription' AND line.source_id=p.id::text AND line.quantity_micros=1000000 AND line.discount_minor=0 AND line.unit_amount_minor=x.amount_minor
    AND line.snapshot->>'subscriptionTermsId'=t.id::text AND line.snapshot->>'subscriptionComponent'=x.provenance->>'canonicalComponent'
    AND x.provenance->>'canonicalComponent' IN('period','setup') AND line.snapshot->>'subscriptionPeriodStart'=q.review->'calendar'->>'proposedPeriodStart'
    AND line.snapshot->>'subscriptionPeriodEnd'=q.review->'calendar'->>'proposedPeriodEnd'))))
  OR EXISTS(SELECT 1 FROM invoice_lines line WHERE line.invoice_id=i.id AND(SELECT count(*) FROM subscription_controlled_components x WHERE x.collection_id=c.id AND x.kind='net' AND x.provenance->>'canonicalInvoiceLineId'=line.id::text)<>1)
 ) THEN RETURN false;END IF;
 RETURN true;
END $$;
--> statement-breakpoint
