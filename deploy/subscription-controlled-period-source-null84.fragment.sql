-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
-- OWNED UNAPPLIED successor AFTER collection-orchestration84 exact42dcc2bf.
-- Complete original functions retained; UNKNOWN cannot authorize target birth.
CREATE OR REPLACE FUNCTION freeholder_controlled_original_period_source(target uuid) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
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
 RETURN coalesce((native IS NOT NULL AND updated IS NOT NULL AND calendar IS NOT NULL AND customer IS NOT NULL
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
  AND native->>'prorationAt'=request->>'prorationAt' AND updated->>'prorationAt'=request->>'prorationAt'),false);
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION freeholder_controlled_original_period_birth() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.kind='period' AND (freeholder_controlled_original_period_source(NEW.quote_id) IS DISTINCT FROM true) THEN
  RAISE EXCEPTION 'An original next-period target requires its actual started trial/paid original period, unchanged mandate and exact returned preview/calendar lineage' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
