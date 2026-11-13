-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C9.33/C9.38/C12.38: OWNED UNAPPLIED continuation AFTER bf4a36c9 credit tail
-- cebd65035c3f9c8580a89c37c2bb794e7109e50747bc4cd1dc52319ae9e17f70.
-- Earlier SQL and source checkpoints stay frozen. Root owns assembly/new DB.
CREATE TABLE subscription_prorations (
 id uuid PRIMARY KEY,subscription_id uuid NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,plan_id uuid NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
 previous_terms_id uuid REFERENCES subscription_commercial_terms(id) ON DELETE RESTRICT,
 terms_id uuid REFERENCES subscription_commercial_terms(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
 generation_id uuid REFERENCES subscription_provider_generations(id) ON DELETE RESTRICT,
 snapshot jsonb NOT NULL,accepted_quote_digest text NOT NULL,source_revision text NOT NULL,
 profile_id uuid NOT NULL REFERENCES merchant_tax_profiles(id) ON DELETE RESTRICT,profile_version integer NOT NULL,tax_destination jsonb,redacted_at timestamptz,
 debit_tax_quote jsonb NOT NULL,notice_digest text NOT NULL,notice_snapshot jsonb NOT NULL,quote_occurred_at timestamptz NOT NULL,
 accepted_by text NOT NULL,effective_at timestamptz NOT NULL,original_period_start timestamptz NOT NULL,original_period_end timestamptz NOT NULL,
 original_trial_ends_at timestamptz,proposed_period_start timestamptz NOT NULL,proposed_period_end timestamptz NOT NULL,basis_period_start timestamptz NOT NULL,basis_period_end timestamptz NOT NULL,
 original_invoice_id uuid REFERENCES invoices(id) ON DELETE RESTRICT,original_invoice_line_id uuid REFERENCES invoice_lines(id) ON DELETE RESTRICT,
 debit_invoice_id uuid REFERENCES invoices(id) ON DELETE RESTRICT,credit_note_id uuid REFERENCES credit_notes(id) ON DELETE RESTRICT,
 debit_net_minor bigint NOT NULL,debit_tax_minor bigint NOT NULL,credit_net_minor bigint NOT NULL,credit_tax_minor bigint NOT NULL,
 debit_fee_obligation_minor bigint NOT NULL,credit_fee_obligation_minor bigint NOT NULL,applied_fee_obligation_minor bigint NOT NULL,applied_fee_proven_collected_minor bigint NOT NULL,
 original_job_id uuid,job_claim_digest text,original_task jsonb,state text NOT NULL,operation_revision integer NOT NULL DEFAULT 0,applied_at timestamptz,cancelled_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT subscription_prorations_profile_version FOREIGN KEY(profile_id,profile_version) REFERENCES merchant_tax_profile_versions(profile_id,version) ON DELETE RESTRICT,
 CONSTRAINT subscription_prorations_calendar CHECK(original_period_end>original_period_start AND effective_at>=original_period_start AND effective_at<original_period_end AND proposed_period_end>proposed_period_start AND(original_trial_ends_at IS NULL OR original_trial_ends_at=original_period_end)),
 CONSTRAINT subscription_prorations_amounts CHECK(debit_net_minor between 0 and 9007199254740991 AND debit_tax_minor between 0 and 9007199254740991 AND credit_net_minor between 0 and 9007199254740991 AND credit_tax_minor between 0 and 9007199254740991 AND(original_trial_ends_at IS NULL OR(debit_net_minor=0 AND debit_tax_minor=0 AND credit_net_minor=0 AND credit_tax_minor=0))),
 CONSTRAINT subscription_prorations_acceptance CHECK(accepted_quote_digest ~ '^[a-f0-9]{64}$' AND source_revision ~ '^[a-f0-9]{64}$' AND accepted_by ~ '^(user:|agent:|plugin:)' AND operation_revision>=0),
 CONSTRAINT subscription_prorations_tax CHECK(profile_version>0 AND notice_digest ~ '^[a-f0-9]{64}$' AND((tax_destination IS NOT NULL AND redacted_at IS NULL)OR(tax_destination IS NULL AND redacted_at IS NOT NULL)) AND basis_period_end>basis_period_start AND effective_at>=basis_period_start AND effective_at<basis_period_end),
 CONSTRAINT subscription_prorations_fee CHECK(debit_fee_obligation_minor between 0 and 9007199254740991 AND credit_fee_obligation_minor between 0 and 9007199254740991 AND applied_fee_obligation_minor between 0 and credit_fee_obligation_minor AND applied_fee_proven_collected_minor between 0 and applied_fee_obligation_minor AND(original_trial_ends_at IS NULL OR(debit_fee_obligation_minor=0 AND credit_fee_obligation_minor=0 AND applied_fee_obligation_minor=0 AND applied_fee_proven_collected_minor=0))),
 CONSTRAINT subscription_prorations_state CHECK(state IN('accepted','preparing','awaiting_invoice','awaiting_payment','awaiting_effective','applied','cancelled','review')AND(state<>'applied'OR applied_at IS NOT NULL)AND(state<>'cancelled'OR cancelled_at IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX subscription_prorations_parent ON subscription_prorations(subscription_id);
--> statement-breakpoint
CREATE INDEX subscription_prorations_terms ON subscription_prorations(terms_id);
--> statement-breakpoint
CREATE INDEX subscription_prorations_credit ON subscription_prorations(credit_note_id);
--> statement-breakpoint
CREATE UNIQUE INDEX subscription_prorations_job ON subscription_prorations(original_job_id);
--> statement-breakpoint
CREATE TABLE subscription_proration_principal (
 id uuid PRIMARY KEY,proration_id uuid NOT NULL REFERENCES subscription_prorations(id) ON DELETE RESTRICT,source_payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
 source_application_id uuid REFERENCES invoice_credit_applications(reservation_id) ON DELETE RESTRICT,amount_minor bigint NOT NULL,original_evidence_digest text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 fee_obligation_minor bigint NOT NULL,fee_proven_collected_minor bigint NOT NULL,fee_collection_state text NOT NULL,fee_evidence_digest text NOT NULL,fee_unexpected boolean NOT NULL DEFAULT false,
 CONSTRAINT subscription_proration_principal_amount CHECK(amount_minor between 1 and 9007199254740991 AND original_evidence_digest ~ '^[a-f0-9]{64}$'),
 CONSTRAINT subscription_proration_principal_fee CHECK(fee_obligation_minor between 0 and amount_minor AND fee_proven_collected_minor between 0 and fee_obligation_minor AND fee_collection_state IN('not_due','owed','recorded_remitted','verified_collected','review')AND fee_evidence_digest ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX subscription_proration_principal_payment ON subscription_proration_principal(proration_id,source_payment_id,source_application_id);
--> statement-breakpoint
CREATE UNIQUE INDEX subscription_proration_principal_root ON subscription_proration_principal(proration_id,source_payment_id) WHERE source_application_id IS NULL;
--> statement-breakpoint
CREATE TABLE subscription_proration_credit_uses (
 id uuid PRIMARY KEY,proration_id uuid NOT NULL REFERENCES subscription_prorations(id) ON DELETE RESTRICT,credit_note_id uuid NOT NULL REFERENCES credit_notes(id) ON DELETE RESTRICT,
 amount_minor bigint NOT NULL,expected_revision text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT subscription_proration_credit_uses_amount CHECK(amount_minor between 1 and 9007199254740991 AND expected_revision ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX subscription_proration_credit_uses_note ON subscription_proration_credit_uses(proration_id,credit_note_id);
--> statement-breakpoint
CREATE FUNCTION freeholder_proration_principal_capacity(target uuid,parent_application uuid) RETURNS bigint LANGUAGE sql STABLE AS $$
 SELECT CASE WHEN parent_application IS NULL THEN greatest(0,coalesce((SELECT p.amount_minor
   -coalesce((SELECT sum(r.amount_minor) FROM refunds r WHERE r.payment_id=p.id AND r.status IN('created','processing','succeeded')),0)
   -coalesce((SELECT sum(greatest(a.amount_minor-coalesce((SELECT sum(r.amount_minor) FROM refunds r WHERE r.payment_id=p.id AND r.status IN('created','processing','succeeded')
     AND(r.idempotency_key LIKE 'return:'||a.return_id::text||':allocation:'||a.id::text||':%' OR r.idempotency_key='return:'||a.return_id::text||':refund:'||p.id::text OR r.idempotency_key LIKE 'return:'||a.return_id::text||':provider:%:'||p.id::text)),0),0)) FROM return_refund_allocations a WHERE a.payment_id=p.id),0)
   -freeholder_credit_principal_reserved(p.id) FROM payments p WHERE p.id=target AND p.status='succeeded'),0))::bigint
 ELSE greatest(0,coalesce((SELECT r.amount_minor-coalesce((SELECT sum(child.amount_minor) FROM invoice_credit_funding child JOIN credit_notes n ON n.id=child.credit_note_id WHERE child.source_application_id=a.reservation_id AND n.status='issued'),0)
  FROM invoice_credit_applications a JOIN invoice_credit_reservations r ON r.id=a.reservation_id JOIN invoice_credit_funding f ON f.id=r.funding_id
  WHERE a.reservation_id=parent_application AND f.source_payment_id=target),0))::bigint END
$$;
--> statement-breakpoint
CREATE FUNCTION freeholder_subscription_proration_credit_owner(target uuid,note uuid,line uuid,payment uuid,amount bigint,evidence text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM subscription_prorations p JOIN credit_notes n ON n.id=p.credit_note_id JOIN credit_note_lines l ON l.credit_note_id=n.id
  JOIN subscription_proration_principal s ON s.proration_id=p.id WHERE p.id=target AND n.id=note AND l.id=line AND n.status='issued' AND n.invoice_id=p.original_invoice_id
  AND l.invoice_line_id=p.original_invoice_line_id AND l.subtotal_minor=p.credit_net_minor AND l.tax_minor=p.credit_tax_minor AND n.total_minor=p.credit_net_minor+p.credit_tax_minor
  AND n.idempotency_key='subscription-proration:'||p.id::text||':credit' AND s.source_payment_id=payment AND s.amount_minor=amount AND s.original_evidence_digest=evidence AND evidence=p.source_revision AND p.state<>'cancelled')
$$;
--> statement-breakpoint
CREATE FUNCTION freeholder_subscription_proration_credit_target(source uuid,target_source text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM subscription_prorations original JOIN subscription_proration_credit_uses use ON use.credit_note_id=original.credit_note_id
  JOIN subscription_prorations target ON target.id=use.proration_id
  WHERE original.id=source AND target_source=target.subscription_id::text||':proration:'||target.id::text AND target.state IN('accepted','preparing','awaiting_invoice','awaiting_payment','awaiting_effective')
   AND(target.id=original.id OR original.state='applied'))
$$;
--> statement-breakpoint
CREATE FUNCTION freeholder_subscription_proration_credit_release(source uuid,target_reservation uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 -- No current recovery route waives a new issued promise. A later separately
 -- reviewed recovery receipt must mechanically represent actual cash/fees and
 -- original access before this function can permit any release/rebinding.
 SELECT false
$$;
--> statement-breakpoint
CREATE FUNCTION freeholder_subscription_proration_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent subscriptions%ROWTYPE;source invoices%ROWTYPE;line invoice_lines%ROWTYPE;scope subscription_merchant_scopes%ROWTYPE;resource subscription_provider_schedule_resources%ROWTYPE;previous subscription_commercial_terms%ROWTYPE;new_net numeric;old_net numeric;old_tax numeric;
BEGIN
 IF TG_OP='DELETE' OR current_setting('freeholder.subscription_proration_v1',true) IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'Original gross-proration promises require their immutable guarded writer' USING ERRCODE='23514'; END IF;
 SELECT * INTO parent FROM subscriptions WHERE id=NEW.subscription_id;
 SELECT * INTO scope FROM subscription_merchant_scopes WHERE subscription_id=NEW.subscription_id;
 SELECT * INTO resource FROM subscription_provider_schedule_resources WHERE subscription_id=NEW.subscription_id;
 IF TG_OP='UPDATE' THEN
  IF current_setting('freeholder.subscription_proration_privacy_v1',true)='1' AND scope.redacted_at IS NOT NULL AND NEW.tax_destination IS NULL AND NEW.redacted_at IS NOT NULL AND OLD.redacted_at IS NULL
   AND(to_jsonb(NEW)-ARRAY['tax_destination','redacted_at'])IS NOT DISTINCT FROM(to_jsonb(OLD)-ARRAY['tax_destination','redacted_at']) THEN RETURN NEW; END IF;
  IF(to_jsonb(NEW)-ARRAY['debit_invoice_id','credit_note_id','original_job_id','job_claim_digest','original_task','state','operation_revision','applied_at','cancelled_at'])IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['debit_invoice_id','credit_note_id','original_job_id','job_claim_digest','original_task','state','operation_revision','applied_at','cancelled_at'])
   OR OLD.debit_invoice_id IS NOT NULL AND NEW.debit_invoice_id IS DISTINCT FROM OLD.debit_invoice_id OR OLD.credit_note_id IS NOT NULL AND NEW.credit_note_id IS DISTINCT FROM OLD.credit_note_id
   OR OLD.original_job_id IS NOT NULL AND(NEW.original_job_id IS DISTINCT FROM OLD.original_job_id OR NEW.job_claim_digest IS DISTINCT FROM OLD.job_claim_digest OR NEW.original_task IS DISTINCT FROM OLD.original_task)
   OR OLD.state IN('applied','cancelled') AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN RAISE EXCEPTION 'Never rewrite original accepted gross money, calendar, caller or issued-credit promises' USING ERRCODE='23514'; END IF;
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
  OR parent.billing_mode NOT IN('manual','platform') OR scope.subscription_id IS NULL OR resource.operation_revision<>0 OR resource.state<>'uncreated' OR resource.recovery_pending OR resource.provider_subscription_ref IS NOT NULL
  OR previous.id IS NULL OR previous.subscription_id<>parent.id OR previous.snapshot->>'proration' IS DISTINCT FROM 'create_prorations'
  OR EXISTS(SELECT 1 FROM subscription_commercial_terms other WHERE other.subscription_id=parent.id AND other.revision>previous.revision)
  OR(previous.effective_period_start>=parent.current_period_end AND NOT EXISTS(SELECT 1 FROM subscription_prorations prior WHERE prior.terms_id=previous.id AND prior.state='applied'))
  OR NEW.original_period_start<>parent.current_period_start OR NEW.original_period_end<>parent.current_period_end OR NEW.effective_at<=clock_timestamp()
  OR NEW.proposed_period_start<>NEW.effective_at OR NEW.proposed_period_end<>parent.current_period_end OR NEW.profile_id<>scope.tax_profile_id
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
  new_net:=floor((NEW.snapshot->>'periodAmountMinor')::numeric*extract(epoch FROM(parent.current_period_end-NEW.effective_at))/extract(epoch FROM(parent.current_period_end-parent.current_period_start))+0.5);
  IF NEW.credit_net_minor<>old_net OR NEW.credit_tax_minor<>old_tax OR NEW.debit_net_minor<>new_net THEN RAISE EXCEPTION 'Preserve separately rounded actual old principal/tax and the accepted new gross unused rate exactly' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER subscription_prorations_guard BEFORE INSERT OR UPDATE OR DELETE ON subscription_prorations FOR EACH ROW EXECUTE FUNCTION freeholder_subscription_proration_receipt();
--> statement-breakpoint
CREATE FUNCTION freeholder_subscription_proration_child() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original subscription_prorations%ROWTYPE;payment payments%ROWTYPE;note credit_notes%ROWTYPE;parent invoice_credit_applications%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' OR current_setting('freeholder.subscription_proration_v1',true) IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'Original accepted credit principal and use are immutable' USING ERRCODE='23514'; END IF;
 SELECT * INTO original FROM subscription_prorations WHERE id=NEW.proration_id;
 IF original.id IS NULL OR original.state<>'accepted' THEN RAISE EXCEPTION 'Retain the exact original acceptance before its credit principal and explicit use' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='subscription_proration_principal' THEN
  SELECT * INTO payment FROM payments WHERE id=NEW.source_payment_id;
  IF NEW.source_application_id IS NOT NULL THEN SELECT * INTO parent FROM invoice_credit_applications WHERE reservation_id=NEW.source_application_id; END IF;
  IF payment.id IS NULL OR payment.status<>'succeeded' OR payment.refunded_minor<>0 OR payment.currency<>original.snapshot->>'currency' OR NEW.original_evidence_digest<>original.source_revision
   OR(NEW.source_application_id IS NULL AND payment.invoice_id IS DISTINCT FROM original.original_invoice_id)
   OR(NEW.source_application_id IS NOT NULL AND(parent.invoice_id IS DISTINCT FROM original.original_invoice_id OR NOT EXISTS(SELECT 1 FROM invoice_credit_reservations r JOIN invoice_credit_funding f ON f.id=r.funding_id WHERE r.id=parent.reservation_id AND f.source_payment_id=payment.id)))
   OR NEW.amount_minor>freeholder_proration_principal_capacity(payment.id,NEW.source_application_id) THEN
   RAISE EXCEPTION 'Accepted unused credit must bind actual available original cash or its exact immutable applied-credit ancestor' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT * INTO note FROM credit_notes WHERE id=NEW.credit_note_id;
  IF note.id IS NULL OR note.status<>'issued' OR note.id IS DISTINCT FROM original.credit_note_id
   OR NEW.amount_minor>least(original.debit_net_minor+original.debit_tax_minor,original.credit_net_minor+original.credit_tax_minor) THEN
   RAISE EXCEPTION 'Accept only the exact old-credit application to this gross target; its remaining promise stays exclusively locked until access actually switches' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER subscription_proration_principal_guard BEFORE INSERT OR UPDATE OR DELETE ON subscription_proration_principal FOR EACH ROW EXECUTE FUNCTION freeholder_subscription_proration_child();
--> statement-breakpoint
CREATE TRIGGER subscription_proration_credit_uses_guard BEFORE INSERT OR UPDATE OR DELETE ON subscription_proration_credit_uses FOR EACH ROW EXECUTE FUNCTION freeholder_subscription_proration_child();
--> statement-breakpoint
CREATE FUNCTION freeholder_proration_exact_credit_lineage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM subscription_proration_principal s JOIN subscription_prorations p ON p.id=s.proration_id
  WHERE s.proration_id=NEW.proration_id AND p.credit_note_id=NEW.credit_note_id AND s.source_payment_id=NEW.source_payment_id
   AND s.source_application_id IS NOT DISTINCT FROM NEW.source_application_id AND s.amount_minor=NEW.amount_minor AND s.original_evidence_digest=NEW.original_evidence_digest) THEN
  RAISE EXCEPTION 'Credit funding must reproduce the exact original cash or applied-credit principal receipt; equal amounts cannot choose an ancestor' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER invoice_credit_proration_lineage_guard BEFORE INSERT ON invoice_credit_funding FOR EACH ROW EXECUTE FUNCTION freeholder_proration_exact_credit_lineage();
--> statement-breakpoint
CREATE FUNCTION freeholder_proration_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current subscription_prorations%ROWTYPE;terms subscription_commercial_terms%ROWTYPE;invoice invoices%ROWTYPE;note credit_notes%ROWTYPE;claim job_idempotency_keys%ROWTYPE;body jsonb;credit_amount bigint;required_application bigint;actual_application bigint;
BEGIN
 SELECT * INTO current FROM subscription_prorations WHERE id=NEW.id;
 SELECT * INTO terms FROM subscription_commercial_terms WHERE id=current.terms_id;
 SELECT * INTO claim FROM job_idempotency_keys WHERE job_name='subscriptions.applyGrossProration' AND job_id=current.original_job_id;
 SELECT data INTO body FROM pgboss.job WHERE name='subscriptions.applyGrossProration' AND id=current.original_job_id;
 IF terms.id IS NULL OR terms.subscription_id<>current.subscription_id OR terms.previous_terms_id IS DISTINCT FROM current.previous_terms_id OR terms.accepted_quote_digest<>current.accepted_quote_digest
  OR terms.snapshot IS DISTINCT FROM current.snapshot OR terms.notice_digest<>current.notice_digest OR terms.effective_period_start<>current.original_period_end
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
CREATE CONSTRAINT TRIGGER subscription_proration_complete AFTER INSERT OR UPDATE ON subscription_prorations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION freeholder_proration_complete();
--> statement-breakpoint
CREATE FUNCTION freeholder_credit_invoice_void_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status='void' AND NEW.credited_minor>0 THEN RAISE EXCEPTION 'Applied real credit is consideration, not erasable unpaid debt; preserve its actual promise through explicit recovery' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER credit_invoice_void_guard BEFORE UPDATE OF status ON invoices FOR EACH ROW EXECUTE FUNCTION freeholder_credit_invoice_void_guard();
--> statement-breakpoint
-- Defaults mark an unqualified older prototype as missing fee evidence; they
-- never manufacture a zero-fee proof. Every new admission requires a digest.
ALTER TABLE invoice_credit_funding ADD COLUMN fee_obligation_minor bigint NOT NULL DEFAULT 0,ADD COLUMN fee_proven_collected_minor bigint NOT NULL DEFAULT 0,
 ADD COLUMN fee_collection_state text NOT NULL DEFAULT 'review',ADD COLUMN fee_evidence_digest text,ADD COLUMN fee_unexpected boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE invoice_credit_reservations ADD COLUMN fee_obligation_minor bigint NOT NULL DEFAULT 0,ADD COLUMN fee_proven_collected_minor bigint NOT NULL DEFAULT 0,
 ADD COLUMN fee_collection_state text NOT NULL DEFAULT 'review',ADD COLUMN fee_evidence_digest text,ADD COLUMN fee_unexpected boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE invoice_credit_applications ADD COLUMN fee_obligation_minor bigint NOT NULL DEFAULT 0,ADD COLUMN fee_proven_collected_minor bigint NOT NULL DEFAULT 0,
 ADD COLUMN fee_collection_state text NOT NULL DEFAULT 'review',ADD COLUMN fee_evidence_digest text,ADD COLUMN fee_unexpected boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE invoice_credit_funding ADD CONSTRAINT invoice_credit_funding_fee CHECK(fee_obligation_minor between 0 and amount_minor AND fee_proven_collected_minor between 0 and fee_obligation_minor AND fee_collection_state IN('not_due','owed','recorded_remitted','verified_collected','review')AND(fee_evidence_digest IS NULL OR fee_evidence_digest ~ '^[a-f0-9]{64}$'));
--> statement-breakpoint
ALTER TABLE invoice_credit_reservations ADD CONSTRAINT invoice_credit_reservations_fee CHECK(fee_obligation_minor between 0 and amount_minor AND fee_proven_collected_minor between 0 and fee_obligation_minor AND fee_collection_state IN('not_due','owed','recorded_remitted','verified_collected','review')AND(fee_evidence_digest IS NULL OR fee_evidence_digest ~ '^[a-f0-9]{64}$'));
--> statement-breakpoint
ALTER TABLE invoice_credit_applications ADD CONSTRAINT invoice_credit_applications_fee CHECK(fee_obligation_minor between 0 and 9007199254740991 AND fee_proven_collected_minor between 0 and fee_obligation_minor AND fee_collection_state IN('not_due','owed','recorded_remitted','verified_collected','review')AND(fee_evidence_digest IS NULL OR fee_evidence_digest ~ '^[a-f0-9]{64}$'));
--> statement-breakpoint
CREATE FUNCTION freeholder_original_payment_fee(target uuid) RETURNS bigint LANGUAGE sql STABLE AS $$
 WITH owners AS(SELECT a.fee_owed_minor fee FROM commercial_payment_attestations a WHERE a.payment_id=target
  UNION ALL SELECT a.application_fee_minor FROM merchant_agreement_payment_routes a WHERE a.payment_id=target
  UNION ALL SELECT a.application_fee_minor FROM payment_merchant_routes a WHERE a.payment_id=target)
 SELECT CASE WHEN count(*)=1 THEN min(fee) ELSE NULL END FROM owners
$$;
--> statement-breakpoint
CREATE FUNCTION freeholder_credit_fee_is_collected(target uuid,kind text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT CASE WHEN kind='recorded_remitted' THEN EXISTS(SELECT 1 FROM commercial_payment_attestations a JOIN payments p ON p.id=a.payment_id WHERE a.payment_id=target AND p.status='succeeded' AND p.refunded_minor=0
  AND coalesce((SELECT sum(CASE WHEN f.direction='returned' THEN -f.amount_minor ELSE f.amount_minor END)FROM commercial_fee_attestations f WHERE f.payment_id=p.id),0)=a.fee_owed_minor)
 WHEN kind IN('verified_collected','not_due') THEN EXISTS(SELECT 1 FROM payments p JOIN LATERAL(SELECT * FROM merchant_payment_observations o WHERE o.payment_id=p.id AND o.provider_ref=p.provider_ref AND o.status='succeeded' ORDER BY o.observed_at DESC,o.id DESC LIMIT 1)o ON true
  WHERE p.id=target AND p.status='succeeded' AND p.refunded_minor=0 AND o.customer_charge_verified AND o.route_verified AND o.amount_minor=p.amount_minor AND o.currency=p.currency
  AND o.application_fee_currency=p.currency AND o.observed_application_fee_minor=freeholder_original_payment_fee(p.id)AND o.observed_fee_refunded_minor=0
  AND(kind='not_due' AND freeholder_original_payment_fee(p.id)=0 AND o.application_fee_ref IS NULL OR kind='verified_collected' AND o.application_fee_ref IS NOT NULL)
  AND NOT EXISTS(SELECT 1 FROM merchant_fee_refunds f WHERE f.payment_id=p.id AND f.status IN('reserved','dispatching','unknown')))
  OR(kind='not_due'AND EXISTS(SELECT 1 FROM commercial_payment_attestations a WHERE a.payment_id=target AND a.fee_owed_minor=0)) ELSE false END
$$;
--> statement-breakpoint
CREATE FUNCTION freeholder_credit_fee_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE funding invoice_credit_funding%ROWTYPE;reservation invoice_credit_reservations%ROWTYPE;payment payments%ROWTYPE;parent invoice_credit_applications%ROWTYPE;parent_r invoice_credit_reservations%ROWTYPE;
 total_principal numeric;total_fee numeric;prior_principal numeric;prior_fee numeric;prior_proven numeric;expected_fee numeric;expected_proven numeric;
BEGIN
 IF current_setting('freeholder.invoice_credit_v1',true)IS DISTINCT FROM '1' OR NEW.fee_evidence_digest IS NULL OR NEW.fee_evidence_digest !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Retain the exact original fee obligation and actual collection evidence before new credit disposition' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='invoice_credit_funding' THEN
  SELECT * INTO payment FROM payments WHERE id=NEW.source_payment_id;
  IF NEW.source_application_id IS NULL THEN total_principal:=payment.amount_minor;total_fee:=freeholder_original_payment_fee(payment.id);
  ELSE SELECT * INTO parent FROM invoice_credit_applications WHERE reservation_id=NEW.source_application_id;SELECT * INTO parent_r FROM invoice_credit_reservations WHERE id=parent.reservation_id;
   total_principal:=parent_r.amount_minor;total_fee:=parent.fee_obligation_minor;
   IF parent.fee_evidence_digest IS NULL THEN RAISE EXCEPTION 'An inherited applied credit requires its real original fee disposition' USING ERRCODE='23514';END IF;
  END IF;
  SELECT coalesce(sum(f.amount_minor),0),coalesce(sum(f.fee_obligation_minor),0) INTO prior_principal,prior_fee FROM invoice_credit_funding f JOIN credit_notes n ON n.id=f.credit_note_id
   WHERE f.source_payment_id=payment.id AND f.source_application_id IS NOT DISTINCT FROM NEW.source_application_id AND n.status='issued';
  IF payment.id IS NULL OR payment.refunded_minor<>0 OR total_principal IS NULL OR total_principal<=0 OR total_fee IS NULL OR prior_fee<>floor(total_fee*prior_principal/total_principal) THEN
   RAISE EXCEPTION 'Restore the complete original fee epoch and cumulative allocation; never reprice it at a later bps' USING ERRCODE='23514';END IF;
  expected_fee:=floor(total_fee*(prior_principal+NEW.amount_minor)/total_principal)-prior_fee;
  IF NEW.fee_obligation_minor<>expected_fee OR NOT EXISTS(SELECT 1 FROM subscription_proration_principal s WHERE s.proration_id=NEW.proration_id AND s.source_payment_id=NEW.source_payment_id AND s.source_application_id IS NOT DISTINCT FROM NEW.source_application_id
   AND s.amount_minor=NEW.amount_minor AND s.fee_obligation_minor=NEW.fee_obligation_minor AND s.fee_proven_collected_minor=NEW.fee_proven_collected_minor AND s.fee_collection_state=NEW.fee_collection_state AND s.fee_evidence_digest=NEW.fee_evidence_digest AND s.fee_unexpected=NEW.fee_unexpected) THEN
   RAISE EXCEPTION 'The issued credit must reproduce its exact accepted principal/fee source receipt' USING ERRCODE='23514';END IF;
  IF NEW.fee_collection_state IN('recorded_remitted','verified_collected','not_due') AND NOT freeholder_credit_fee_is_collected(payment.id,NEW.fee_collection_state)
   OR NEW.fee_proven_collected_minor<>CASE WHEN NEW.fee_collection_state IN('recorded_remitted','verified_collected') THEN NEW.fee_obligation_minor ELSE 0 END THEN
   RAISE EXCEPTION 'An expected carried fee is not a collected commission; preserve owed or review until actual original proof exists' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='invoice_credit_reservations' THEN
  SELECT * INTO funding FROM invoice_credit_funding WHERE id=NEW.funding_id;
  SELECT coalesce(sum(r.amount_minor),0),coalesce(sum(r.fee_obligation_minor),0),coalesce(sum(r.fee_proven_collected_minor),0) INTO prior_principal,prior_fee,prior_proven
   FROM invoice_credit_reservations r LEFT JOIN invoice_credit_applications a ON a.reservation_id=r.id LEFT JOIN invoice_credit_releases l ON l.reservation_id=r.id WHERE r.funding_id=funding.id AND(a.reservation_id IS NOT NULL OR l.reservation_id IS NULL);
  expected_fee:=floor(funding.fee_obligation_minor::numeric*(prior_principal+NEW.amount_minor)/funding.amount_minor)-prior_fee;
  expected_proven:=floor(funding.fee_proven_collected_minor::numeric*(prior_principal+NEW.amount_minor)/funding.amount_minor)-prior_proven;
  IF funding.fee_evidence_digest IS NULL OR NEW.fee_obligation_minor<>expected_fee OR NEW.fee_proven_collected_minor<>expected_proven OR NEW.fee_collection_state<>funding.fee_collection_state OR NEW.fee_unexpected<>funding.fee_unexpected THEN
   RAISE EXCEPTION 'Reserve the same original fee epoch with deterministic residual ownership, separately from proven collection' USING ERRCODE='23514';END IF;
 ELSE SELECT * INTO reservation FROM invoice_credit_reservations WHERE id=NEW.reservation_id;
  IF reservation.fee_evidence_digest IS NULL OR NEW.fee_obligation_minor<>reservation.fee_obligation_minor OR NEW.fee_proven_collected_minor<>reservation.fee_proven_collected_minor OR NEW.fee_collection_state<>reservation.fee_collection_state OR NEW.fee_unexpected<>reservation.fee_unexpected THEN
   RAISE EXCEPTION 'An actual credit application cannot invent or lose its original fee obligation or collection state' USING ERRCODE='23514';END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER invoice_credit_fee_funding_guard BEFORE INSERT ON invoice_credit_funding FOR EACH ROW EXECUTE FUNCTION freeholder_credit_fee_receipt();
--> statement-breakpoint
CREATE TRIGGER invoice_credit_fee_reservations_guard BEFORE INSERT ON invoice_credit_reservations FOR EACH ROW EXECUTE FUNCTION freeholder_credit_fee_receipt();
--> statement-breakpoint
CREATE TRIGGER invoice_credit_fee_applications_guard BEFORE INSERT ON invoice_credit_applications FOR EACH ROW EXECUTE FUNCTION freeholder_credit_fee_receipt();
--> statement-breakpoint
CREATE FUNCTION freeholder_credit_note_fee_promise() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status='void'AND EXISTS(SELECT 1 FROM subscription_prorations p WHERE p.credit_note_id=NEW.id) THEN RAISE EXCEPTION 'An issued original proration credit remains a whole customer promise; use explicit genuine recovery, never void it to free cash or fee capacity' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER credit_fee_note_promise_guard BEFORE UPDATE OF status ON credit_notes FOR EACH ROW EXECUTE FUNCTION freeholder_credit_note_fee_promise();

--> statement-breakpoint
-- Exact previous late-resumption authority retained; the distinct gross receipt
-- branch alone admits its own future terms, never a full-period provider DTO.
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
    AND p.original_period_start=parent.current_period_start AND p.original_period_end=parent.current_period_end AND NEW.effective_period_start=p.original_period_end AND p.effective_at>clock_timestamp())
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
  AND NOT EXISTS(SELECT 1 FROM subscription_prorations p WHERE p.terms_id=NEW.id AND p.subscription_id=NEW.subscription_id AND p.previous_terms_id=NEW.previous_terms_id AND p.accepted_quote_digest=NEW.accepted_quote_digest AND p.original_period_end=NEW.effective_period_start) THEN
  RAISE EXCEPTION 'Accepted changed terms require their exact original future-amendment or gross-proration consent receipt' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;

--> statement-breakpoint
-- Preserve the original attested writer; only subtract exact carried fee duty
-- before allocating NEW cash commission. No order-v1 path is changed.
CREATE OR REPLACE FUNCTION guard_commercial_attestation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p payments%ROWTYPE;i invoices%ROWTYPE;policy invoice_market_policies%ROWTYPE;r refunds%ROWTYPE;party invoice_merchant_tax_quotes%ROWTYPE;original commercial_payment_attestations%ROWTYPE;
 previous_cash numeric;previous_fee numeric;actual_fee numeric;scopes integer;carried_fee numeric;cash_fee numeric;cash_principal numeric;
BEGIN
 IF TG_OP<>'INSERT' OR current_setting('freeholder.commercial_attestation_v1',true) IS DISTINCT FROM '1' THEN
  RAISE EXCEPTION 'Preserve the first recorded commercial money evidence and use its authorized shared action' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('payment:'||NEW.payment_id::text));
 SELECT * INTO p FROM payments WHERE id=NEW.payment_id FOR UPDATE;
 PERFORM pg_advisory_xact_lock(hashtext('invoice:'||p.invoice_id::text));
 SELECT * INTO i FROM invoices WHERE id=p.invoice_id;
 SELECT * INTO policy FROM invoice_market_policies WHERE invoice_id=i.id;
 IF p.id IS NULL OR p.provider<>'manual' OR policy.model IS DISTINCT FROM 'seller_merchant' OR policy.collection_version<>0 OR i.source_type<>'subscription' OR i.issued_at IS NULL THEN
  RAISE EXCEPTION 'An external commercial attestation must name its real original manual subscription payment and merchant invoice' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='commercial_payment_attestations' THEN
  SELECT count(*) INTO scopes FROM invoice_merchant_tax_quotes WHERE invoice_id=i.id;
  SELECT * INTO party FROM invoice_merchant_tax_quotes WHERE invoice_id=i.id;
  IF scopes<>1 OR party.seller_user_id IS DISTINCT FROM policy.seller_user_id OR party.profile_id<>NEW.merchant_profile_id OR party.profile_version<>NEW.profile_version
   OR NEW.invoice_id<>i.id OR NEW.currency<>i.currency OR NEW.currency<>p.currency OR NEW.amount_minor<>p.amount_minor OR p.status<>'created' OR p.provider_ref IS NOT NULL
   OR p.method NOT IN('cash','bank_transfer','cheque','external_card','other')
   OR EXISTS(SELECT 1 FROM merchant_agreement_payment_routes WHERE payment_id=p.id) OR EXISTS(SELECT 1 FROM merchant_payment_routes WHERE payment_id=p.id)
   OR EXISTS(SELECT 1 FROM merchant_invoice_payment_routes WHERE payment_id=p.id) OR EXISTS(SELECT 1 FROM payment_merchant_routes WHERE payment_id=p.id)
   OR EXISTS(SELECT 1 FROM payments other WHERE other.invoice_id=i.id AND other.id<>p.id AND other.status IN('created','processing'))
   OR EXISTS(SELECT 1 FROM merchant_payment_observations o JOIN payments old ON old.id=o.payment_id WHERE old.invoice_id=i.id AND o.status='succeeded'
    AND(old.status<>'succeeded' OR o.amount_minor<>old.amount_minor OR o.currency<>old.currency OR(o.provider_ref IS DISTINCT FROM old.provider_ref AND o.provider_ref IS DISTINCT FROM old.provider_checkout_ref)))
   OR EXISTS(SELECT 1 FROM merchant_payment_dispatches d JOIN payments old ON old.id=d.payment_id
      WHERE old.invoice_id=i.id AND NOT EXISTS(SELECT 1 FROM merchant_payment_dispatch_finishes f WHERE f.dispatch_id=d.id) AND NOT EXISTS(SELECT 1 FROM merchant_payment_dispatch_stops s WHERE s.dispatch_id=d.id)) THEN
   RAISE EXCEPTION 'Retain exactly one real external origin with its original declared merchant, amount, evidence and quiesced competing callers' USING ERRCODE='23514'; END IF;
  SELECT coalesce(sum(old.amount_minor),0),coalesce(sum(coalesce(a.fee_owed_minor,g.application_fee_minor,l.application_fee_minor)),0)
   INTO previous_cash,previous_fee FROM payments old
   LEFT JOIN commercial_payment_attestations a ON a.payment_id=old.id LEFT JOIN merchant_agreement_payment_routes g ON g.payment_id=old.id LEFT JOIN payment_merchant_routes l ON l.payment_id=old.id
   WHERE old.invoice_id=i.id AND old.id<>p.id AND old.status='succeeded';
  IF i.total_minor<=0 OR previous_cash<>i.paid_minor OR EXISTS(SELECT 1 FROM payments old
   LEFT JOIN commercial_payment_attestations a ON a.payment_id=old.id LEFT JOIN merchant_agreement_payment_routes g ON g.payment_id=old.id LEFT JOIN payment_merchant_routes l ON l.payment_id=old.id
   WHERE old.invoice_id=i.id AND old.id<>p.id AND old.status='succeeded' AND ((a.payment_id IS NOT NULL)::integer+(g.payment_id IS NOT NULL)::integer+(l.payment_id IS NOT NULL)::integer<>1 OR old.refunded_minor<>0)) THEN
   RAISE EXCEPTION 'Restore the complete original cash and exactly one fee owner before a new external record' USING ERRCODE='23514'; END IF;
  SELECT coalesce(sum(a.fee_obligation_minor),0) INTO carried_fee FROM invoice_credit_applications a WHERE a.invoice_id=i.id;
  IF EXISTS(SELECT 1 FROM invoice_credit_applications a WHERE a.invoice_id=i.id AND a.fee_evidence_digest IS NULL)
   OR coalesce((SELECT sum(r.amount_minor)FROM invoice_credit_applications a JOIN invoice_credit_reservations r ON r.id=a.reservation_id WHERE a.invoice_id=i.id),0)<>i.credited_minor THEN
   RAISE EXCEPTION 'Restore exact noncash consideration and original fee ownership before recording another commission' USING ERRCODE='23514';END IF;
  cash_principal:=i.total_minor-i.credited_minor;cash_fee:=greatest(0,policy.fee_minor-carried_fee);
  IF cash_principal<=0 OR cash_fee>cash_principal THEN RAISE EXCEPTION 'The new fee duty requires its separate bounded merchant receivable; never invent a collected fee or oversized customer charge' USING ERRCODE='23514';END IF;
  actual_fee:=floor(cash_fee*(previous_cash+p.amount_minor)/cash_principal)-previous_fee;
  IF NEW.fee_owed_minor<>actual_fee THEN RAISE EXCEPTION 'The recorded fee owed must use the frozen shared invoice policy, never a fabricated collected fee' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT * INTO original FROM commercial_payment_attestations WHERE payment_id=p.id;
  IF original.payment_id IS NULL OR p.status<>'succeeded' OR original.amount_minor<>p.amount_minor OR original.currency<>p.currency THEN
   RAISE EXCEPTION 'Restore the exact original successful recorded external principal' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME='commercial_refund_attestations' THEN
   SELECT * INTO r FROM refunds WHERE id=NEW.refund_id;
   IF r.id IS NULL OR r.payment_id<>p.id OR r.provider<>'manual' OR r.status<>'created' OR r.provider_ref IS NOT NULL OR NEW.amount_minor<>r.amount_minor OR NEW.currency<>r.currency THEN
    RAISE EXCEPTION 'Record only this actual original manual refund attempt before its balance settles' USING ERRCODE='23514'; END IF;
  ELSIF TG_TABLE_NAME='commercial_fee_attestations' THEN
   IF NEW.direction='remitted' AND coalesce((SELECT sum(CASE WHEN direction='returned' THEN -amount_minor ELSE amount_minor END) FROM commercial_fee_attestations WHERE payment_id=p.id),0)+NEW.amount_minor>floor(original.fee_owed_minor::numeric*(p.amount_minor-p.refunded_minor)/p.amount_minor) THEN
    RAISE EXCEPTION 'Recorded external remittances cannot exceed the original bounded current fee obligation' USING ERRCODE='23514'; END IF;
   IF NEW.direction='returned' AND NOT EXISTS(SELECT 1 FROM commercial_fee_attestations first WHERE first.id=NEW.original_remittance_id AND first.direction='remitted' AND first.payment_id=p.id
    AND coalesce((SELECT sum(a.amount_minor) FROM commercial_fee_attestations a WHERE a.original_remittance_id=first.id),0)+NEW.amount_minor<=first.amount_minor) THEN
    RAISE EXCEPTION 'An external fee return must retain its exact original remittance and remaining actual amount' USING ERRCODE='23514'; END IF;
  ELSE RAISE EXCEPTION 'Unknown recorded commercial money family' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
