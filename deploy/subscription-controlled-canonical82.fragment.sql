-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- OWNED UNAPPLIED suffix AFTERa2b419b441a515ae3edad978d5384838c75128d6823ad94ece50dfac3cec635c.
-- SOURCE ONLY / UNQUALIFIED. Root owns assembly/hash/fresh database proof.
-- A real controlled quotation is distinct from local-calendar legacy policy.
CREATE FUNCTION freeholder_controlled_proration_source(target uuid) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE q subscription_controlled_quotes%ROWTYPE;r subscription_controlled_resources%ROWTYPE;p subscriptions%ROWTYPE;t subscription_commercial_terms%ROWTYPE;
 native jsonb;updated jsonb;calendar jsonb;customer jsonb;request jsonb;native_request jsonb;update_request jsonb;
BEGIN
 SELECT * INTO q FROM subscription_controlled_quotes WHERE planned_proration_id=target;
 SELECT * INTO r FROM subscription_controlled_resources WHERE id=q.resource_id;
 SELECT * INTO p FROM subscriptions WHERE id=r.subscription_id;
 SELECT * INTO t FROM subscription_commercial_terms WHERE id=q.previous_terms_id;
 IF q.id IS NULL OR q.kind IS DISTINCT FROM 'proration' OR r.id IS NULL OR p.id IS NULL OR t.id IS NULL OR p.billing_mode IS DISTINCT FROM 'provider'
  OR q.redacted_at IS NOT NULL OR q.input IS NULL OR q.review IS NULL OR q.effective_at<=clock_timestamp() OR NOT freeholder_controlled_callers_closed(r.id)
  OR EXISTS(SELECT 1 FROM subscription_controlled_closures WHERE resource_id=r.id)
  OR q.review->>'kind' IS DISTINCT FROM 'proration' OR q.review->>'subscriptionId' IS DISTINCT FROM p.id::text
  OR q.review->>'previousTermsId' IS DISTINCT FROM t.id::text OR q.review->>'quoteDigest' IS DISTINCT FROM q.quote_digest
  OR q.review->'controlled'->>'protocol' IS DISTINCT FROM 'controlled_net_gross.v1'
  OR q.review->'controlled'->>'plannedProrationId' IS DISTINCT FROM target::text OR q.review->'controlled'->>'quoteId' IS DISTINCT FROM q.id::text
  OR q.review->'controlled'->>'resourceId' IS DISTINCT FROM r.id::text OR q.review->'controlled'->>'plannedCollectionId' IS DISTINCT FROM q.planned_collection_id::text
  OR q.input->>'resourceId' IS DISTINCT FROM r.id::text OR q.input->>'id' IS DISTINCT FROM p.id::text
  OR q.input->>'effectiveAt' IS DISTINCT FROM q.review->>'effectiveAt' OR(q.input->>'effectiveAt')::timestamptz IS DISTINCT FROM q.effective_at
  OR q.review->'calendar'->>'originalApplicationPeriodStart' IS DISTINCT FROM to_char(p.current_period_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  OR q.review->'calendar'->>'originalApplicationPeriodEnd' IS DISTINCT FROM to_char(p.current_period_end AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  OR q.review->'calendar'->>'originalTrialEndsAt' IS DISTINCT FROM q.review->'calendar'->>'proposedTrialEndsAt'
  OR t.subscription_id IS DISTINCT FROM p.id OR t.snapshot->>'proration' IS DISTINCT FROM 'create_prorations'
  OR EXISTS(SELECT 1 FROM subscription_provider_schedule_operations legacy_op WHERE legacy_op.subscription_id=p.id AND legacy_op.original_request->>'resourceKind' IS DISTINCT FROM 'phase_product') THEN RETURN false;END IF;
 SELECT op.original_request,v.actual_result INTO native_request,native FROM subscription_controlled_operations op JOIN subscription_controlled_verifications v ON v.operation_id=op.id
  WHERE op.id=q.native_preview_operation_id AND op.resource_id=r.id AND op.kind='preview_proration';
 SELECT op.original_request,v.actual_result INTO update_request,updated FROM subscription_controlled_operations op JOIN subscription_controlled_verifications v ON v.operation_id=op.id
  WHERE op.id=q.update_preview_operation_id AND op.resource_id=r.id AND op.kind='preview_update';
 SELECT v.actual_result INTO calendar FROM subscription_controlled_operations op JOIN subscription_controlled_verifications v ON v.operation_id=op.id
  WHERE op.id=q.calendar_read_operation_id AND op.resource_id=r.id AND op.kind='read_calendar';
 SELECT v.actual_result INTO customer FROM subscription_controlled_operations op JOIN subscription_controlled_verifications v ON v.operation_id=op.id
  WHERE op.id=q.customer_financial_operation_id AND op.resource_id=r.id AND op.kind='read_customer_financials';
 request=native_request->'payload';
 RETURN coalesce(native IS NOT NULL AND updated IS NOT NULL AND calendar IS NOT NULL AND customer IS NOT NULL
  AND native_request->>'requiredProtocol'='controlled_net_gross.v1' AND update_request->>'requiredProtocol'='controlled_net_gross.v1'
  AND request=update_request->'payload' AND native_request->>'targetInputDigest'=update_request->>'targetInputDigest' AND native_request->>'economicQuoteDigest'=update_request->>'economicQuoteDigest'
  AND native_request->>'economicQuoteDigest'=q.review->'quote'->>'quoteDigest' AND request->>'prorationAt'=q.review->>'effectiveAt'
  AND request->>'currentReadDigest'=calendar->>'currentReadDigest' AND calendar->>'collectionPausedAsDraft'='true' AND calendar->>'calendarCanceled'='false'
  AND request->'target'->>'principalMinor'=q.review->'quote'->'snapshot'->>'periodAmountMinor'
  AND request->'target'->>'interval'=q.review->'quote'->'snapshot'->>'interval' AND request->'target'->>'intervalCount'=q.review->'quote'->'snapshot'->>'intervalCount'
  AND native->>'requestedProrationBehavior'='create_prorations' AND updated->>'requestedProrationBehavior'='none'
  AND native->>'suppliesPaidAuthority'='false' AND updated->>'suppliesPaidAuthority'='false'
  AND customer->>'balanceState'='known_zero' AND customer->>'completeCreditNotes'='true'
  AND customer->>'providerCustomerRef'=r.original_scope->>'providerCustomerRef' AND customer->>'inventoryDigest'=q.review->'controlled'->>'customerFinancialDigest'
  AND jsonb_typeof(native->'actualLines')='array' AND jsonb_typeof(updated->'actualLines')='array',false);
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION freeholder_subscription_proration_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent subscriptions%ROWTYPE;source invoices%ROWTYPE;line invoice_lines%ROWTYPE;scope subscription_merchant_scopes%ROWTYPE;resource subscription_provider_schedule_resources%ROWTYPE;previous subscription_commercial_terms%ROWTYPE;new_net numeric;old_net numeric;old_tax numeric;controlled boolean;q subscription_controlled_quotes%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' OR current_setting('freeholder.subscription_proration_v1',true) IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'Original gross-proration promises require their immutable guarded writer' USING ERRCODE='23514'; END IF;
 SELECT * INTO parent FROM subscriptions WHERE id=NEW.subscription_id;
 SELECT * INTO scope FROM subscription_merchant_scopes WHERE subscription_id=NEW.subscription_id;
 SELECT * INTO resource FROM subscription_provider_schedule_resources WHERE subscription_id=NEW.subscription_id;
 controlled=parent.billing_mode='provider' AND freeholder_controlled_proration_source(NEW.id);
 SELECT * INTO q FROM subscription_controlled_quotes WHERE planned_proration_id=NEW.id;
 IF TG_OP='UPDATE' THEN
  IF current_setting('freeholder.subscription_proration_privacy_v1',true)='1' AND scope.redacted_at IS NOT NULL AND NEW.tax_destination IS NULL AND NEW.redacted_at IS NOT NULL AND OLD.redacted_at IS NULL
   AND(to_jsonb(NEW)-ARRAY['tax_destination','redacted_at'])IS NOT DISTINCT FROM(to_jsonb(OLD)-ARRAY['tax_destination','redacted_at']) THEN RETURN NEW; END IF;
  IF(to_jsonb(NEW)-ARRAY['debit_invoice_id','credit_note_id','original_job_id','job_claim_digest','original_task','state','operation_revision','applied_at','cancelled_at'])IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['debit_invoice_id','credit_note_id','original_job_id','job_claim_digest','original_task','state','operation_revision','applied_at','cancelled_at'])
   OR OLD.debit_invoice_id IS NOT NULL AND NEW.debit_invoice_id IS DISTINCT FROM OLD.debit_invoice_id OR OLD.credit_note_id IS NOT NULL AND NEW.credit_note_id IS DISTINCT FROM OLD.credit_note_id
   OR OLD.original_job_id IS NOT NULL AND(NEW.original_job_id IS DISTINCT FROM OLD.original_job_id OR NEW.job_claim_digest IS DISTINCT FROM OLD.job_claim_digest OR NEW.original_task IS DISTINCT FROM OLD.original_task)
   OR OLD.state IN('applied','cancelled') AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN RAISE EXCEPTION 'Never rewrite original accepted gross money, calendar, caller or issued-credit promises' USING ERRCODE='23514'; END IF;
  IF NEW.state='applied' AND OLD.state<>'applied' AND parent.billing_mode='provider' THEN
   RAISE EXCEPTION 'Actual controlled bank/canonical settlement and effective calendar require their exact final effect authority before activation' USING ERRCODE='23514';
  END IF;
  IF NEW.state='applied' AND OLD.state<>'applied' THEN
   IF NEW.effective_at>clock_timestamp() OR NEW.original_period_end<=clock_timestamp() OR NEW.applied_at IS NULL OR NEW.applied_at<NEW.effective_at
    OR parent.plan_id<>NEW.plan_id OR parent.pending_plan_id IS NOT NULL OR parent.current_period_start<>NEW.original_period_start OR parent.current_period_end<>NEW.original_period_end
    OR NOT EXISTS(SELECT 1 FROM job_idempotency_keys c JOIN pgboss.job j ON j.id=c.job_id AND j.name=c.job_name WHERE c.job_id=NEW.original_job_id AND c.job_name='subscriptions.applyGrossProration' AND c.payload_hash=NEW.job_claim_digest AND j.data=NEW.original_task)
    OR(NEW.original_trial_ends_at IS NULL AND NOT EXISTS(SELECT 1 FROM invoices i WHERE i.id=NEW.debit_invoice_id AND i.source_type='subscription' AND i.source_id=parent.id::text||':proration:'||NEW.id::text AND i.contact_id=parent.contact_id AND i.currency=parent.currency
     AND i.status='paid' AND i.paid_minor+i.credited_minor=i.total_minor AND i.refunded_minor=0 AND i.paid_at<=NEW.effective_at AND i.total_minor=NEW.debit_net_minor+NEW.debit_tax_minor AND i.tax_minor=NEW.debit_tax_minor)) THEN
    RAISE EXCEPTION 'Only exact fully paid consideration inside the real accepted window can activate new access; late or partial money remains recovery debt' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO previous FROM subscription_commercial_terms WHERE id=NEW.previous_terms_id;
 IF parent.id IS NULL OR parent.merchant_scope_version<>1 OR parent.status NOT IN('active','trialing') OR parent.signup_pending OR parent.pending_plan_id IS NOT NULL OR parent.cancel_at_period_end OR parent.cancelled_at IS NOT NULL
  OR scope.subscription_id IS NULL OR(parent.billing_mode='provider' AND NOT controlled)
  OR(parent.billing_mode<>'provider' AND(parent.billing_mode NOT IN('manual','platform') OR resource.operation_revision<>0 OR resource.state<>'uncreated' OR resource.recovery_pending OR resource.provider_subscription_ref IS NOT NULL))
  OR previous.id IS NULL OR previous.subscription_id<>parent.id OR previous.snapshot->>'proration' IS DISTINCT FROM 'create_prorations'
  OR EXISTS(SELECT 1 FROM subscription_commercial_terms other WHERE other.subscription_id=parent.id AND other.revision>previous.revision)
  OR(previous.effective_period_start>=parent.current_period_end AND NOT EXISTS(SELECT 1 FROM subscription_prorations prior WHERE prior.terms_id=previous.id AND prior.state='applied'))
  OR NEW.original_period_start<>parent.current_period_start OR NEW.original_period_end<>parent.current_period_end OR NEW.effective_at<=clock_timestamp()
  OR NEW.proposed_period_start<>NEW.effective_at OR(NOT controlled AND NEW.proposed_period_end<>parent.current_period_end)
  OR(controlled AND(NEW.proposed_period_end IS DISTINCT FROM(q.review->'calendar'->>'proposedPeriodEnd')::timestamptz
   OR NEW.snapshot IS DISTINCT FROM q.review->'quote'->'snapshot' OR NEW.accepted_quote_digest IS DISTINCT FROM q.quote_digest
   OR NEW.debit_net_minor::text IS DISTINCT FROM q.review->>'debitNetMinor' OR NEW.debit_tax_minor::text IS DISTINCT FROM q.review->>'debitTaxMinor'
   OR NEW.credit_net_minor::text IS DISTINCT FROM q.review->>'creditNetMinor' OR NEW.credit_tax_minor::text IS DISTINCT FROM q.review->>'creditTaxMinor')) OR NEW.profile_id<>scope.tax_profile_id
  OR NEW.snapshot->>'version' IS DISTINCT FROM '1' OR NEW.snapshot->>'currency' IS DISTINCT FROM parent.currency OR NEW.snapshot->>'billingMode' IS DISTINCT FROM parent.billing_mode
  OR NEW.debit_tax_quote->>'subtotalMinor' IS DISTINCT FROM NEW.debit_net_minor::text OR NEW.debit_tax_quote->>'taxMinor' IS DISTINCT FROM NEW.debit_tax_minor::text
  OR NEW.debit_tax_quote->>'totalMinor' IS DISTINCT FROM(NEW.debit_net_minor+NEW.debit_tax_minor)::text OR NOT coalesce(NEW.debit_tax_quote->>'quoteDigest' ~ '^[a-f0-9]{64}$',false)
  OR NEW.state<>'accepted' OR NEW.original_job_id IS NOT NULL OR NEW.original_task IS NOT NULL OR NEW.credit_note_id IS NOT NULL OR NEW.debit_invoice_id IS NOT NULL
  OR EXISTS(SELECT 1 FROM subscription_prorations other WHERE other.subscription_id=parent.id AND other.state NOT IN('applied','cancelled')) THEN
  RAISE EXCEPTION 'Accept one fresh original gross proration with its actual paid period, merchant and quiescent local-calendar authority' USING ERRCODE='23514'; END IF;
 IF parent.status='trialing' THEN
  IF NEW.original_trial_ends_at IS DISTINCT FROM parent.trial_ends_at OR NEW.original_trial_ends_at IS DISTINCT FROM parent.current_period_end OR NEW.original_invoice_id IS NOT NULL OR NEW.original_invoice_line_id IS NOT NULL THEN
   RAISE EXCEPTION 'An uncharged trial preserves its accepted end and has no old paid principal or credit' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT * INTO source FROM invoices WHERE id=NEW.original_invoice_id;
  SELECT * INTO line FROM invoice_lines WHERE id=NEW.original_invoice_line_id;
  IF source.id IS NULL OR source.source_type<>'subscription' OR split_part(source.source_id,':',1)<>parent.id::text OR source.contact_id<>parent.contact_id OR source.currency<>parent.currency OR source.status<>'paid'
   OR source.paid_minor+source.credited_minor<>source.total_minor OR source.refunded_minor<>0 OR line.id IS NULL OR line.invoice_id<>source.id OR line.source_type<>'subscription' OR line.source_id<>parent.id::text OR line.discount_minor<>0 OR line.quantity_micros<>1000000
   OR NEW.basis_period_end<>parent.current_period_end OR NOT((source.source_id=parent.id::text||':'||to_char(parent.current_period_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AND NEW.basis_period_start=parent.current_period_start AND line.snapshot->>'subscriptionComponent'='period')
    OR EXISTS(SELECT 1 FROM subscription_prorations prior WHERE prior.debit_invoice_id=source.id AND prior.state='applied' AND prior.plan_id=parent.plan_id AND prior.effective_at=NEW.basis_period_start AND line.snapshot->>'subscriptionProrationId'=prior.id::text)) THEN
   RAISE EXCEPTION 'Only the exact original paid period line and its retained ancestor consideration can fund unused credit' USING ERRCODE='23514'; END IF;
  old_net:=floor(line.subtotal_minor::numeric*extract(epoch FROM(NEW.basis_period_end-NEW.effective_at))/extract(epoch FROM(NEW.basis_period_end-NEW.basis_period_start))+0.5);
  old_tax:=floor(line.tax_minor::numeric*extract(epoch FROM(NEW.basis_period_end-NEW.effective_at))/extract(epoch FROM(NEW.basis_period_end-NEW.basis_period_start))+0.5);
  IF controlled THEN
   new_net:=floor((NEW.snapshot->>'periodAmountMinor')::numeric*extract(epoch FROM((q.review->'calendar'->>'expectedProviderPeriodEnd')::timestamptz-NEW.effective_at))
    /nullif(extract(epoch FROM((q.review->'calendar'->>'expectedProviderPeriodEnd')::timestamptz-(q.review->'calendar'->>'expectedProviderPeriodStart')::timestamptz)),0)+0.5);
   IF new_net IS NULL OR new_net<0 OR NEW.debit_net_minor<>new_net THEN RAISE EXCEPTION 'Retain the exact actual provider preview calendar with the shared canonical rounding engine' USING ERRCODE='23514';END IF;
  ELSE
  new_net:=floor((NEW.snapshot->>'periodAmountMinor')::numeric*extract(epoch FROM(parent.current_period_end-NEW.effective_at))/extract(epoch FROM(parent.current_period_end-parent.current_period_start))+0.5);
  END IF;
  IF NEW.credit_net_minor<>old_net OR NEW.credit_tax_minor<>old_tax OR NEW.debit_net_minor<>new_net THEN RAISE EXCEPTION 'Preserve separately rounded actual old principal/tax and the accepted new gross unused rate exactly' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION freeholder_proration_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current subscription_prorations%ROWTYPE;terms subscription_commercial_terms%ROWTYPE;invoice invoices%ROWTYPE;note credit_notes%ROWTYPE;claim job_idempotency_keys%ROWTYPE;body jsonb;credit_amount bigint;required_application bigint;actual_application bigint;
BEGIN
 SELECT * INTO current FROM subscription_prorations WHERE id=NEW.id;
 SELECT * INTO terms FROM subscription_commercial_terms WHERE id=current.terms_id;
 SELECT * INTO claim FROM job_idempotency_keys WHERE job_name='subscriptions.applyGrossProration' AND job_id=current.original_job_id;
 SELECT data INTO body FROM pgboss.job WHERE name='subscriptions.applyGrossProration' AND id=current.original_job_id;
 IF terms.id IS NULL OR terms.subscription_id<>current.subscription_id OR terms.previous_terms_id IS DISTINCT FROM current.previous_terms_id OR terms.accepted_quote_digest<>current.accepted_quote_digest
  OR terms.snapshot IS DISTINCT FROM current.snapshot OR terms.notice_digest<>current.notice_digest OR terms.effective_period_start<>(CASE WHEN current.snapshot->>'billingMode'='provider' AND EXISTS(SELECT 1 FROM subscription_controlled_quotes q WHERE q.planned_proration_id=current.id AND q.quote_digest=current.accepted_quote_digest) THEN current.proposed_period_end ELSE current.original_period_end END)
  OR current.original_task->>'prorationId' IS DISTINCT FROM current.id::text OR current.original_task->>'subscriptionId' IS DISTINCT FROM current.subscription_id::text
  OR current.original_task->>'originalJobId' IS DISTINCT FROM current.original_job_id::text OR current.original_task->>'acceptedQuoteDigest' IS DISTINCT FROM current.accepted_quote_digest
  OR(current.state<>'applied' AND(claim.id IS NULL OR claim.payload_hash IS DISTINCT FROM current.job_claim_digest OR body IS DISTINCT FROM current.original_task)) OR current.state IN('accepted','preparing','awaiting_invoice') THEN
  RAISE EXCEPTION 'Commit the actual accepted future terms, original effect enqueue and complete canonical proration in one transaction' USING ERRCODE='23514'; END IF;
 IF current.original_trial_ends_at IS NOT NULL THEN
  IF current.debit_invoice_id IS NOT NULL OR current.credit_note_id IS NOT NULL OR EXISTS(SELECT 1 FROM subscription_proration_principal WHERE proration_id=current.id)
   OR EXISTS(SELECT 1 FROM subscription_proration_credit_uses WHERE proration_id=current.id) THEN RAISE EXCEPTION 'An uncharged trial cannot mint a paid invoice or unused principal credit' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT * INTO invoice FROM invoices WHERE id=current.debit_invoice_id;
  IF invoice.id IS NULL OR invoice.source_type<>'subscription' OR invoice.source_id<>current.subscription_id::text||':proration:'||current.id::text OR invoice.status IN('draft','void') OR invoice.issued_at IS NULL
   OR invoice.total_minor<>current.debit_net_minor+current.debit_tax_minor OR invoice.tax_minor<>current.debit_tax_minor
   OR(SELECT count(*) FROM invoice_lines l WHERE l.invoice_id=invoice.id)<>1
   OR NOT EXISTS(SELECT 1 FROM invoice_lines l WHERE l.invoice_id=invoice.id AND l.snapshot->>'subscriptionProrationId'=current.id::text AND l.snapshot->>'subscriptionTermsId'=current.terms_id::text AND l.unit_amount_minor=current.debit_net_minor AND l.tax_minor=current.debit_tax_minor)
   OR NOT EXISTS(SELECT 1 FROM invoice_market_policies m WHERE m.invoice_id=invoice.id AND m.fee_minor=current.debit_fee_obligation_minor) THEN
   RAISE EXCEPTION 'The original gross debit requires its exact one canonical issued price/tax line before commit' USING ERRCODE='23514'; END IF;
  credit_amount:=current.credit_net_minor+current.credit_tax_minor;
  IF credit_amount>0 THEN
   SELECT * INTO note FROM credit_notes WHERE id=current.credit_note_id;
   IF note.id IS NULL OR note.status<>'issued' OR note.invoice_id IS DISTINCT FROM current.original_invoice_id OR note.total_minor<>credit_amount OR note.subtotal_minor<>current.credit_net_minor OR note.tax_minor<>current.credit_tax_minor
    OR coalesce((SELECT sum(amount_minor) FROM subscription_proration_principal WHERE proration_id=current.id),0)<>credit_amount
  OR coalesce((SELECT sum(amount_minor) FROM invoice_credit_funding WHERE proration_id=current.id AND credit_note_id=note.id),0)<>credit_amount
  OR coalesce((SELECT sum(fee_obligation_minor) FROM invoice_credit_funding WHERE proration_id=current.id AND credit_note_id=note.id),0)<>current.credit_fee_obligation_minor THEN
    RAISE EXCEPTION 'Preserve the whole exact old-tax credit and all actual original principal in the same accepted transaction' USING ERRCODE='23514'; END IF;
   required_application:=least(credit_amount,invoice.total_minor);
   SELECT coalesce(sum(r.amount_minor),0) INTO actual_application FROM invoice_credit_reservations r JOIN invoice_credit_funding f ON f.id=r.funding_id JOIN invoice_credit_applications a ON a.reservation_id=r.id
    WHERE f.credit_note_id=note.id AND r.target_source_id=invoice.source_id AND a.invoice_id=invoice.id;
   IF actual_application<>required_application OR(required_application>0 AND NOT EXISTS(SELECT 1 FROM subscription_proration_credit_uses u WHERE u.proration_id=current.id AND u.credit_note_id=note.id AND u.amount_minor=required_application)) THEN
    RAISE EXCEPTION 'Atomically apply exactly the original credit portion to its accepted gross target; unspent credit remains locked until the actual access switch' USING ERRCODE='23514'; END IF;
   IF coalesce((SELECT sum(a.fee_obligation_minor) FROM invoice_credit_applications a WHERE a.invoice_id=invoice.id),0)<>current.applied_fee_obligation_minor
    OR coalesce((SELECT sum(a.fee_proven_collected_minor) FROM invoice_credit_applications a WHERE a.invoice_id=invoice.id),0)<>current.applied_fee_proven_collected_minor THEN
    RAISE EXCEPTION 'The target must retain exactly the accepted original fee obligation and separately proved collection, never a duplicated new fee' USING ERRCODE='23514'; END IF;
  ELSIF current.credit_note_id IS NOT NULL OR EXISTS(SELECT 1 FROM subscription_proration_principal WHERE proration_id=current.id) THEN
   RAISE EXCEPTION 'Zero unused original principal cannot mint a credit or fake payment' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION freeholder_subscription_commercial_terms() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent subscriptions%ROWTYPE; original subscription_merchant_scopes%ROWTYPE; prior subscription_commercial_terms%ROWTYPE; business merchant_tax_profiles%ROWTYPE; resource subscription_provider_schedule_resources%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Accepted subscription promises cannot be deleted' USING ERRCODE='23514'; END IF;
 IF current_setting('freeholder.subscription_terms_v1',true) IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'Accepted subscription promises require their guarded current writer' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
  IF current_setting('freeholder.subscription_terms_privacy_v1',true) IS DISTINCT FROM '1'
   OR(to_jsonb(NEW)-ARRAY['tax_destination','redacted_at'])IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['tax_destination','redacted_at'])
   OR OLD.redacted_at IS NOT NULL OR NEW.tax_destination IS NOT NULL OR NEW.redacted_at IS NULL THEN
   RAISE EXCEPTION 'Accepted subscription promises permit only guarded personal-destination minimization' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO parent FROM subscriptions WHERE id=NEW.subscription_id;
 SELECT * INTO original FROM subscription_merchant_scopes WHERE subscription_id=NEW.subscription_id;
 SELECT * INTO business FROM merchant_tax_profiles WHERE id=NEW.profile_id;
 SELECT * INTO resource FROM subscription_provider_schedule_resources WHERE subscription_id=NEW.subscription_id;
 IF parent.id IS NULL OR parent.merchant_scope_version<>1 OR original.subscription_id IS NULL
  OR NEW.profile_id IS DISTINCT FROM original.tax_profile_id OR NEW.tax_liability IS DISTINCT FROM original.tax_liability
  OR business.state IS DISTINCT FROM 'active' OR business.current_version IS DISTINCT FROM NEW.profile_version
  OR NEW.snapshot->>'version' IS DISTINCT FROM '1' OR NEW.snapshot->>'currency' IS DISTINCT FROM parent.currency
  OR jsonb_typeof(NEW.snapshot) IS DISTINCT FROM 'object' OR jsonb_typeof(NEW.notice_snapshot) IS DISTINCT FROM 'object'
  OR resource.subscription_id IS NULL OR NEW.redacted_at IS NOT NULL THEN
  RAISE EXCEPTION 'A new acceptance needs its actual original agreement, business and current declared policy' USING ERRCODE='23514';
 END IF;
 IF NEW.revision>1 AND current_setting('freeholder.subscription_proration_v1',true)='1' AND EXISTS(SELECT 1 FROM subscription_prorations p WHERE p.terms_id=NEW.id) THEN
  SELECT * INTO prior FROM subscription_commercial_terms WHERE id=NEW.previous_terms_id;
  IF prior.id IS NULL OR prior.subscription_id<>parent.id OR prior.revision+1<>NEW.revision OR NEW.acceptance_source<>'amendment'
   OR current_setting('freeholder.subscription_amendment_v1',true) IS DISTINCT FROM '1'
   OR NOT EXISTS(SELECT 1 FROM subscription_prorations p WHERE p.terms_id=NEW.id AND p.subscription_id=parent.id AND p.previous_terms_id=prior.id AND p.state='accepted'
    AND p.accepted_quote_digest=NEW.accepted_quote_digest AND p.snapshot=NEW.snapshot AND p.profile_id=NEW.profile_id AND p.profile_version=NEW.profile_version
    AND p.tax_destination=NEW.tax_destination AND p.notice_digest=NEW.notice_digest AND p.notice_snapshot=NEW.notice_snapshot
    AND p.original_period_start=parent.current_period_start AND p.original_period_end=parent.current_period_end AND NEW.effective_period_start=(CASE WHEN parent.billing_mode='provider' AND EXISTS(SELECT 1 FROM subscription_controlled_quotes q WHERE q.planned_proration_id=p.id AND q.quote_digest=p.accepted_quote_digest) THEN p.proposed_period_end ELSE p.original_period_end END) AND p.effective_at>clock_timestamp())
   OR EXISTS(SELECT 1 FROM subscription_commercial_terms other WHERE other.subscription_id=parent.id AND other.revision>prior.revision)
   OR EXISTS(SELECT 1 FROM invoices i WHERE i.source_type='subscription' AND i.source_id=parent.id::text||':'||to_char(NEW.effective_period_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) THEN
   RAISE EXCEPTION 'New gross terms need their exact explicit acceptance and unbilled future boundary, preserving all earlier terms' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF NEW.revision=1 THEN
  IF resource.operation_revision<>0 OR resource.provider_subscription_ref IS NOT NULL OR resource.state<>'uncreated' OR NEW.effective_period_start IS DISTINCT FROM parent.current_period_start
   OR EXISTS(SELECT 1 FROM subscription_card_setups setup WHERE setup.subscription_id=parent.id)
   OR EXISTS(SELECT 1 FROM invoices invoice WHERE invoice.source_type='subscription' AND split_part(invoice.source_id,':',1)=parent.id::text) THEN
   RAISE EXCEPTION 'Accept original commercial terms before admitting provider schedule work' USING ERRCODE='23514';
  END IF;
 ELSE
  SELECT * INTO prior FROM subscription_commercial_terms WHERE id=NEW.previous_terms_id;
  IF prior.id IS NULL OR prior.subscription_id IS DISTINCT FROM NEW.subscription_id OR prior.revision+1<>NEW.revision
   OR current_setting('freeholder.subscription_amendment_v1',true) IS DISTINCT FROM '1' OR NEW.acceptance_source<>'amendment'
   OR NEW.effective_period_start<parent.current_period_end OR NEW.effective_period_start<=prior.effective_period_start
   OR(NEW.effective_period_start>parent.current_period_end AND(current_setting('freeholder.subscription_resumption_v1',true) IS DISTINCT FROM '1' OR parent.current_period_end>clock_timestamp() OR NEW.effective_period_start<=clock_timestamp()))
   OR EXISTS(SELECT 1 FROM subscription_commercial_terms other WHERE other.subscription_id=NEW.subscription_id AND other.revision>prior.revision)
   OR EXISTS(SELECT 1 FROM invoices invoice WHERE invoice.source_type='subscription' AND invoice.source_id=parent.id::text||':'||to_char(NEW.effective_period_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) THEN
   RAISE EXCEPTION 'An amendment needs its exact previous acceptance and an unbilled next period' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION freeholder_subscription_terms_amendment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.revision>1 AND NOT EXISTS(SELECT 1 FROM subscription_commercial_amendments a WHERE a.terms_id=NEW.id AND a.subscription_id=NEW.subscription_id AND a.previous_terms_id=NEW.previous_terms_id AND a.accepted_quote_digest=NEW.accepted_quote_digest)
  AND NOT EXISTS(SELECT 1 FROM subscription_prorations p WHERE p.terms_id=NEW.id AND p.subscription_id=NEW.subscription_id AND p.previous_terms_id=NEW.previous_terms_id AND p.accepted_quote_digest=NEW.accepted_quote_digest AND (CASE WHEN p.snapshot->>'billingMode'='provider' AND EXISTS(SELECT 1 FROM subscription_controlled_quotes q WHERE q.planned_proration_id=p.id AND q.quote_digest=p.accepted_quote_digest) THEN p.proposed_period_end ELSE p.original_period_end END)=NEW.effective_period_start) THEN
  RAISE EXCEPTION 'Accepted changed terms require their exact original future-amendment or gross-proration consent receipt' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
