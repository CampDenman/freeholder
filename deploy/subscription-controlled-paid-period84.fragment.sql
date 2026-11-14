-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
-- C9.33/C12.38/C1.08: OWNED UNAPPLIED independent POST-COMMIT money effect.
-- Follows controlled payment-route84 + genuine staged application successors.
-- No frozen journal/fragment edits. This new transaction is NOT the cash batch.
CREATE TABLE subscription_controlled_paid_period_receipts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),protocol text NOT NULL,admission_transaction_id text NOT NULL,
 collection_id uuid NOT NULL CONSTRAINT controlled_paid_period_collection_fk REFERENCES subscription_controlled_collections(id) ON DELETE RESTRICT,
 resource_id uuid NOT NULL CONSTRAINT controlled_paid_period_resource_fk REFERENCES subscription_controlled_resources(id) ON DELETE RESTRICT,
 subscription_id uuid NOT NULL CONSTRAINT controlled_paid_period_subscription_fk REFERENCES subscriptions(id) ON DELETE RESTRICT,
 invoice_id uuid NOT NULL CONSTRAINT controlled_paid_period_invoice_fk REFERENCES invoices(id) ON DELETE RESTRICT,
 terms_id uuid NOT NULL CONSTRAINT controlled_paid_period_terms_fk REFERENCES subscription_commercial_terms(id) ON DELETE RESTRICT,
 renewal_event_id uuid NOT NULL CONSTRAINT controlled_paid_period_renewal_event_fk REFERENCES subscription_events(id) ON DELETE RESTRICT,
 plan_event_id uuid CONSTRAINT controlled_paid_period_plan_event_fk REFERENCES subscription_events(id) ON DELETE RESTRICT,
 plan_id uuid NOT NULL CONSTRAINT controlled_paid_period_plan_fk REFERENCES plans(id) ON DELETE RESTRICT,
 product_variant_id uuid NOT NULL CONSTRAINT controlled_paid_period_variant_fk REFERENCES product_variants(id) ON DELETE RESTRICT,
 accepted_quote_digest text NOT NULL,canonical_target_digest text NOT NULL,parent_revision text NOT NULL,before_parent_fingerprint text NOT NULL,
 before_entries jsonb NOT NULL,before_parent_fields jsonb NOT NULL,bank_revisions jsonb NOT NULL,
 period_start timestamptz NOT NULL,period_end timestamptz NOT NULL,effect_at timestamptz NOT NULL,
 financial_review_pending boolean NOT NULL,digest text NOT NULL,authentication text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT controlled_paid_period_collection_key UNIQUE(collection_id),CONSTRAINT controlled_paid_period_invoice_key UNIQUE(invoice_id),
 CONSTRAINT controlled_paid_period_renewal_event_key UNIQUE(renewal_event_id),CONSTRAINT controlled_paid_period_plan_event_key UNIQUE(plan_event_id),
 CONSTRAINT controlled_paid_period_protocol CHECK(protocol='controlled_paid_period.v1' AND admission_transaction_id ~ '^[0-9]+$'),
 CONSTRAINT controlled_paid_period_digests CHECK(accepted_quote_digest ~ '^[a-f0-9]{64}$' AND canonical_target_digest ~ '^[a-f0-9]{64}$' AND parent_revision ~ '^[a-f0-9]{64}$' AND before_parent_fingerprint ~ '^[a-f0-9]{64}$' AND digest ~ '^[a-f0-9]{64}$' AND authentication ~ '^[a-f0-9]{64}$'),
 CONSTRAINT controlled_paid_period_calendar CHECK(period_end>period_start AND effect_at>=period_start AND effect_at<period_end),
 CONSTRAINT controlled_paid_period_evidence CHECK(jsonb_typeof(before_entries)='array' AND jsonb_array_length(before_entries) BETWEEN 1 AND 5000 AND jsonb_typeof(before_parent_fields)='object' AND jsonb_typeof(bank_revisions)='array' AND jsonb_array_length(bank_revisions) BETWEEN 1 AND 5000)
);
--> statement-breakpoint
CREATE INDEX controlled_paid_period_subscription_idx ON subscription_controlled_paid_period_receipts(subscription_id);
--> statement-breakpoint
CREATE INDEX controlled_paid_period_resource_idx ON subscription_controlled_paid_period_receipts(resource_id);
--> statement-breakpoint
-- Own complete PG-row domain, distinct from merchantTaxDigest and bank hashes.
-- Exactly one newly born own effect child may be omitted; no callback, read,
-- owner, payment, event or arbitrary other child is removed. Actual events are
-- already in the admitted preimage. Only exact managed parent fields normalize.
CREATE FUNCTION freeholder_controlled_paid_period_end(original_start timestamptz,original_snapshot jsonb) RETURNS timestamptz LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE actual_start timestamp=original_start AT TIME ZONE 'UTC'; actual_count integer=(original_snapshot->>'intervalCount')::integer;
BEGIN
 IF original_start IS NULL OR actual_count IS NULL OR actual_count<1 THEN RETURN null;END IF;
 CASE original_snapshot->>'interval'
 WHEN 'day' THEN RETURN(actual_start+make_interval(days=>actual_count)) AT TIME ZONE 'UTC';
 WHEN 'week' THEN RETURN(actual_start+make_interval(days=>7*actual_count)) AT TIME ZONE 'UTC';
 WHEN 'month' THEN RETURN(actual_start+make_interval(months=>actual_count)) AT TIME ZONE 'UTC';
 WHEN 'year' THEN
  -- Existing canonical periodEnd uses setUTCFullYear: Feb29 rolls to Mar1,
  -- while PostgreSQL +interval-year would clamp to Feb28. Preserve ORIGINAL
  -- canonical behavior; no silent calendar policy unification.
  RETURN(make_date(extract(year FROM actual_start)::integer+actual_count,extract(month FROM actual_start)::integer,1)::timestamp
   +make_interval(days=>extract(day FROM actual_start)::integer-1)+(actual_start-date_trunc('day',actual_start))) AT TIME ZONE 'UTC';
 ELSE RETURN null;
 END CASE;
END $$;
--> statement-breakpoint
CREATE FUNCTION freeholder_controlled_paid_period_parent(target_collection_uuid uuid,own_effect_uuid uuid DEFAULT null,normalize_parent boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
DECLARE base_snapshot jsonb; actual_scope jsonb; own_effect subscription_controlled_paid_period_receipts%ROWTYPE; parent_row subscriptions%ROWTYPE;
 parent_fingerprint text; entries jsonb; revision text; row_count integer; conflicting integer;
 managed_columns text[]=ARRAY['plan_id','product_variant_id','pending_plan_id','status','current_period_start','current_period_end','trial_ends_at','dunning_started_at','dunning_invoice_id','dunning_attempt','dunning_next_at','updated_at'];
BEGIN
 base_snapshot=freeholder_controlled_cash_parent_snapshot(target_collection_uuid);
 actual_scope=freeholder_controlled_cash_scope(target_collection_uuid);
 IF own_effect_uuid IS NOT NULL THEN
  SELECT * INTO own_effect FROM subscription_controlled_paid_period_receipts WHERE id=own_effect_uuid;
  IF own_effect.id IS NULL OR own_effect.collection_id IS DISTINCT FROM target_collection_uuid OR own_effect.admission_transaction_id IS DISTINCT FROM txid_current()::text THEN
   RAISE EXCEPTION 'Only this genuinely born current effect child may supply its exact own normalization' USING ERRCODE='23514';END IF;
 ELSIF normalize_parent THEN RAISE EXCEPTION 'No anonymous parent normalization' USING ERRCODE='23514';END IF;
 IF normalize_parent THEN
  SELECT * INTO parent_row FROM subscriptions WHERE id=own_effect.subscription_id;
  parent_fingerprint=encode(sha256(convert_to(((to_jsonb(parent_row)-managed_columns)||own_effect.before_parent_fields)::text,'UTF8')),'hex');
  IF parent_row.id IS NULL OR parent_fingerprint IS DISTINCT FROM own_effect.before_parent_fingerprint THEN
   RAISE EXCEPTION 'Normalize only the exact actual original parent changed columns; ownership and every other column remain current' USING ERRCODE='23514';END IF;
 END IF;
 WITH physical AS(
  SELECT e->>'table' AS family,e->>'id' AS identity,
   CASE WHEN normalize_parent AND e->>'table'='subscriptions' AND e->>'id'=own_effect.subscription_id::text THEN parent_fingerprint ELSE e->>'fingerprint' END AS fingerprint
   FROM jsonb_array_elements(base_snapshot->'entries') e
   WHERE own_effect_uuid IS NULL OR e->>'table'<>'subscription_controlled_paid_period_receipts' OR e->>'id'<>own_effect_uuid::text
  UNION ALL SELECT 'subscription_controlled_paid_period_receipts',effect_row.id::text,encode(sha256(convert_to(to_jsonb(effect_row)::text,'UTF8')),'hex')
   FROM subscription_controlled_paid_period_receipts effect_row
   WHERE(effect_row.subscription_id=ANY(freeholder_controlled_cash_scope_ids(actual_scope,'subscriptions')) OR effect_row.invoice_id=ANY(freeholder_controlled_cash_scope_ids(actual_scope,'invoices')))
    AND(own_effect_uuid IS NULL OR effect_row.id<>own_effect_uuid)
 ),grouped AS(SELECT family,identity,min(fingerprint) fingerprint,count(DISTINCT fingerprint) AS hashes FROM physical GROUP BY family,identity),bounded AS(SELECT * FROM grouped ORDER BY family,identity LIMIT 5001)
 SELECT count(*),coalesce(sum((hashes<>1 OR family IS NULL OR identity IS NULL OR fingerprint IS NULL)::integer),0),
  coalesce(jsonb_agg(jsonb_build_object('table',family,'id',identity,'fingerprint',fingerprint,'hashDomain','postgres_row') ORDER BY family,identity),'[]'::jsonb),
  encode(sha256(convert_to(coalesce(string_agg(family||':'||identity||':'||fingerprint,E'\n' ORDER BY family,identity),''),'UTF8')),'hex')
 INTO row_count,conflicting,entries,revision FROM bounded;
 IF row_count<1 OR row_count>5000 OR conflicting<>0 THEN RAISE EXCEPTION 'Retain one complete bounded actual parent/effect PG graph without conflicting row versions' USING ERRCODE='23514';END IF;
 RETURN jsonb_build_object('entries',entries,'revision',revision,'physicalRowCount',row_count);
END $$;
--> statement-breakpoint
CREATE FUNCTION freeholder_controlled_paid_period_locks(target_effect_uuid uuid) RETURNS void LANGUAGE plpgsql VOLATILE AS $$
DECLARE effect_row subscription_controlled_paid_period_receipts%ROWTYPE; actual_scope jsonb; required_key text;
BEGIN
 SELECT * INTO effect_row FROM subscription_controlled_paid_period_receipts WHERE id=target_effect_uuid;
 IF effect_row.id IS NULL OR effect_row.admission_transaction_id IS DISTINCT FROM txid_current()::text THEN
  RAISE EXCEPTION 'The original cash transaction is not a new independent paid-effect admission' USING ERRCODE='23514';END IF;
 PERFORM freeholder_controlled_cash_require_prefix(effect_row.resource_id);
 actual_scope=freeholder_controlled_cash_scope(effect_row.collection_id);
 FOR required_key IN
  SELECT 'payment:'||actual_id::text FROM unnest(freeholder_controlled_cash_scope_ids(actual_scope,'payments')) actual_id
  UNION SELECT 'invoice:'||actual_id::text FROM unnest(freeholder_controlled_cash_scope_ids(actual_scope,'invoices')) actual_id
  UNION SELECT 'credit-note:'||actual_id::text FROM unnest(freeholder_controlled_cash_scope_ids(actual_scope,'notes')) actual_id
  UNION SELECT 'subscription-cash:'||(namespace->>'platform')||':'||coalesce(namespace->>'account','')||':'||(namespace->>'intent') FROM jsonb_array_elements(actual_scope->'namespaces') namespace
 LOOP
  IF required_key IS NULL OR NOT EXISTS(SELECT 1 FROM pg_locks actual_lock WHERE actual_lock.pid=pg_backend_pid() AND actual_lock.locktype='advisory' AND actual_lock.granted
   AND actual_lock.database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND actual_lock.mode='ExclusiveLock' AND actual_lock.objsubid=1
   AND actual_lock.classid::bigint=(CASE WHEN hashtext(required_key)<0 THEN 4294967295::bigint ELSE 0::bigint END)
   AND actual_lock.objid::bigint=(hashtext(required_key)::bigint & 4294967295::bigint)) THEN
   RAISE EXCEPTION 'Hold the whole actual original effect canonical/cash prefix before rechecking, never late reverse locks' USING ERRCODE='23514';END IF;
 END LOOP;
END $$;
--> statement-breakpoint
CREATE FUNCTION freeholder_controlled_paid_period_source(target_effect_uuid uuid) RETURNS boolean LANGUAGE plpgsql VOLATILE AS $$
DECLARE effect_row subscription_controlled_paid_period_receipts%ROWTYPE; collection_row subscription_controlled_collections%ROWTYPE;
 quote_row subscription_controlled_quotes%ROWTYPE; resource_row subscription_controlled_resources%ROWTYPE; parent_row subscriptions%ROWTYPE;
 terms_row subscription_commercial_terms%ROWTYPE; invoice_row invoices%ROWTYPE; event_row subscription_events%ROWTYPE; plan_event subscription_events%ROWTYPE;
 payment_row payments%ROWTYPE; route_row merchant_agreement_payment_routes%ROWTYPE; receipt_row subscription_provider_charge_receipts%ROWTYPE;
 link_row controlled_cash_application_links%ROWTYPE; proof_row controlled_cash_application_receipts%ROWTYPE; batch_row controlled_cash_application_batches%ROWTYPE;
 bank_row record; bank_revision jsonb; manifest jsonb; current_parent jsonb; target_parent jsonb; current_snapshot jsonb; governing_terms uuid;
 paid numeric; payment_count integer; revision_count integer; completed boolean; old_fields jsonb; amendment subscription_commercial_amendments%ROWTYPE;
BEGIN
 SELECT * INTO effect_row FROM subscription_controlled_paid_period_receipts WHERE id=target_effect_uuid;
 IF effect_row.id IS NULL OR effect_row.admission_transaction_id IS DISTINCT FROM txid_current()::text THEN RETURN false;END IF;
 PERFORM freeholder_controlled_paid_period_locks(effect_row.id);
 SELECT * INTO collection_row FROM subscription_controlled_collections WHERE id=effect_row.collection_id;
 SELECT * INTO quote_row FROM subscription_controlled_quotes WHERE id=collection_row.quote_id;
 SELECT * INTO resource_row FROM subscription_controlled_resources WHERE id=effect_row.resource_id;
 SELECT * INTO parent_row FROM subscriptions WHERE id=effect_row.subscription_id;
 SELECT * INTO terms_row FROM subscription_commercial_terms WHERE id=effect_row.terms_id;
 SELECT * INTO invoice_row FROM invoices WHERE id=effect_row.invoice_id;
 SELECT * INTO event_row FROM subscription_events WHERE id=effect_row.renewal_event_id;
 old_fields=effect_row.before_parent_fields;current_parent=to_jsonb(parent_row);
 IF collection_row.id IS NULL OR quote_row.id IS NULL OR resource_row.id IS NULL OR parent_row.id IS NULL OR terms_row.id IS NULL OR invoice_row.id IS NULL OR event_row.id IS NULL
  OR effect_row.protocol IS DISTINCT FROM 'controlled_paid_period.v1' OR collection_row.kind IS DISTINCT FROM 'period' OR quote_row.kind IS DISTINCT FROM 'period'
  OR quote_row.resource_id IS DISTINCT FROM resource_row.id OR resource_row.subscription_id IS DISTINCT FROM parent_row.id
  OR collection_row.invoice_id IS DISTINCT FROM invoice_row.id OR collection_row.terms_id IS DISTINCT FROM terms_row.id OR terms_row.subscription_id IS DISTINCT FROM parent_row.id
  OR collection_row.proration_id IS NOT NULL OR collection_row.credit_note_id IS NOT NULL OR collection_row.acceptance_kind IS DISTINCT FROM 'original_period_mandate'
  OR collection_row.original_consent_digest IS DISTINCT FROM terms_row.accepted_quote_digest
  OR collection_row.accepted_quote_digest IS DISTINCT FROM effect_row.accepted_quote_digest OR quote_row.quote_digest IS DISTINCT FROM effect_row.accepted_quote_digest
  OR collection_row.canonical_target_digest IS DISTINCT FROM effect_row.canonical_target_digest
  OR quote_row.review->>'kind' IS DISTINCT FROM 'period' OR quote_row.review->'controlled'->>'originalPeriodConsentDigest' IS DISTINCT FROM terms_row.accepted_quote_digest
  OR quote_row.profile_id IS DISTINCT FROM terms_row.profile_id OR quote_row.profile_version IS DISTINCT FROM terms_row.profile_version
  OR terms_row.tax_destination IS NULL OR terms_row.snapshot->>'billingMode' IS DISTINCT FROM 'provider' OR terms_row.snapshot->>'currency' IS DISTINCT FROM parent_row.currency
  OR effect_row.product_variant_id::text IS DISTINCT FROM terms_row.snapshot->>'productVariantId'
  OR invoice_row.source_type IS DISTINCT FROM 'subscription' OR invoice_row.source_id IS DISTINCT FROM parent_row.id::text||':'||to_char(effect_row.period_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  OR invoice_row.source_id IS DISTINCT FROM quote_row.canonical_source_id OR invoice_row.contact_id IS DISTINCT FROM parent_row.contact_id OR invoice_row.currency IS DISTINCT FROM parent_row.currency
  OR invoice_row.issued_at IS NULL OR invoice_row.status IS DISTINCT FROM 'paid' OR invoice_row.total_minor<=0 OR invoice_row.paid_minor IS DISTINCT FROM invoice_row.total_minor OR invoice_row.credited_minor<>0 OR invoice_row.refunded_minor<>0
  OR quote_row.review->>'debitNetMinor' IS DISTINCT FROM (invoice_row.subtotal_minor-invoice_row.discount_minor)::text OR invoice_row.shipping_minor<>0
  OR quote_row.review->>'debitTaxMinor' IS DISTINCT FROM invoice_row.tax_minor::text OR quote_row.review->>'cashDueMinor' IS DISTINCT FROM invoice_row.total_minor::text
  OR effect_row.period_start IS DISTINCT FROM (quote_row.review->'calendar'->>'proposedPeriodStart')::timestamptz
  OR effect_row.period_end IS DISTINCT FROM (quote_row.review->'calendar'->>'proposedPeriodEnd')::timestamptz
  OR effect_row.effect_at<effect_row.period_start OR effect_row.effect_at>=effect_row.period_end OR clock_timestamp()>=effect_row.period_end OR effect_row.effect_at>clock_timestamp()
  OR parent_row.signup_pending OR parent_row.cancelled_at IS NOT NULL OR parent_row.cancel_at_period_end OR parent_row.provider IS DISTINCT FROM 'stripe' OR parent_row.billing_mode IS DISTINCT FROM 'provider' OR parent_row.merchant_scope_version<>1
  OR NOT EXISTS(SELECT 1 FROM module_settings WHERE module='subscriptions' AND enabled)
  OR freeholder_controlled_callers_closed(resource_row.id) IS DISTINCT FROM true
  OR EXISTS(SELECT 1 FROM payments original_payment WHERE original_payment.id=ANY(freeholder_controlled_cash_scope_ids(freeholder_controlled_cash_scope(collection_row.id),'payments'))
   AND freeholder_merchant_creators_quiesced(original_payment.id) IS DISTINCT FROM true)
  OR EXISTS(SELECT 1 FROM subscription_proration_card_reads original_read JOIN payments original_payment ON original_payment.id=original_read.payment_id
   LEFT JOIN subscription_proration_card_read_finishes actual_finish ON actual_finish.read_id=original_read.id LEFT JOIN subscription_proration_card_read_stops actual_stop ON actual_stop.read_id=original_read.id
   WHERE original_payment.id=ANY(freeholder_controlled_cash_scope_ids(freeholder_controlled_cash_scope(collection_row.id),'payments')) AND actual_finish.read_id IS NULL AND actual_stop.read_id IS NULL)
  OR EXISTS(SELECT 1 FROM subscription_provider_read_tickets original_read
   LEFT JOIN subscription_provider_read_finishes actual_finish ON actual_finish.read_id=original_read.read_id LEFT JOIN subscription_provider_read_stops actual_stop ON actual_stop.read_id=original_read.read_id
   WHERE original_read.subscription_id=ANY(freeholder_controlled_cash_scope_ids(freeholder_controlled_cash_scope(collection_row.id),'subscriptions')) AND actual_finish.read_id IS NULL AND actual_stop.read_id IS NULL)
  OR event_row.subscription_id IS DISTINCT FROM parent_row.id OR event_row.invoice_id IS DISTINCT FROM invoice_row.id OR event_row.kind IS DISTINCT FROM 'renewed' OR event_row.at IS DISTINCT FROM effect_row.effect_at
  OR event_row.detail IS DISTINCT FROM 'controlled-period:'||collection_row.id::text||':terms:'||terms_row.id::text||':quote:'||effect_row.accepted_quote_digest||':actual:'||to_char(effect_row.effect_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  OR NOT EXISTS(SELECT 1 FROM subscription_events actual_event WHERE actual_event.id=event_row.id AND actual_event.xmin::text::numeric=mod(txid_current()::numeric,4294967296))
  OR jsonb_typeof(old_fields) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(old_fields))<>12
  OR NOT(old_fields ?& ARRAY['plan_id','product_variant_id','pending_plan_id','status','current_period_start','current_period_end','trial_ends_at','dunning_started_at','dunning_invoice_id','dunning_attempt','dunning_next_at','updated_at'])
  OR coalesce(old_fields->>'status','') NOT IN('active','trialing','past_due')
  OR (old_fields->>'current_period_start')::timestamptz IS DISTINCT FROM (quote_row.review->>'originalPeriodStart')::timestamptz
  OR (old_fields->>'current_period_end')::timestamptz IS DISTINCT FROM (quote_row.review->>'originalPeriodEnd')::timestamptz
  OR (old_fields->>'trial_ends_at')::timestamptz IS DISTINCT FROM (quote_row.review->>'originalTrialEndsAt')::timestamptz
  OR effect_row.period_start<(old_fields->>'current_period_end')::timestamptz
  OR old_fields->>'status'='trialing' AND((old_fields->>'trial_ends_at') IS NULL OR effect_row.period_start<(old_fields->>'trial_ends_at')::timestamptz)
  THEN RETURN false;END IF;
 SELECT t.id INTO governing_terms FROM subscription_commercial_terms t WHERE t.subscription_id=parent_row.id AND t.effective_period_start<=effect_row.period_start
  AND NOT EXISTS(SELECT 1 FROM subscription_prorations p WHERE p.terms_id=t.id AND p.state<>'applied')
  AND NOT EXISTS(SELECT 1 FROM subscription_commercial_amendments a WHERE a.terms_id=t.id AND a.state<>'activated') ORDER BY t.revision DESC LIMIT 1;
 IF governing_terms IS DISTINCT FROM terms_row.id OR effect_row.period_end IS DISTINCT FROM freeholder_controlled_paid_period_end(effect_row.period_start,terms_row.snapshot) THEN RETURN false;END IF;
 IF old_fields->>'pending_plan_id' IS NOT NULL THEN
  SELECT * INTO amendment FROM subscription_commercial_amendments WHERE terms_id=terms_row.id;
  IF amendment.terms_id IS NULL OR amendment.subscription_id IS DISTINCT FROM parent_row.id OR amendment.state IS DISTINCT FROM 'activated'
   OR amendment.plan_id IS DISTINCT FROM effect_row.plan_id OR effect_row.plan_id::text IS DISTINCT FROM old_fields->>'pending_plan_id'
   OR terms_row.effective_period_start IS DISTINCT FROM effect_row.period_start THEN RETURN false;END IF;
 ELSIF effect_row.plan_id::text IS DISTINCT FROM old_fields->>'plan_id' THEN RETURN false;END IF;
 IF effect_row.plan_id::text IS DISTINCT FROM old_fields->>'plan_id' THEN
  SELECT * INTO plan_event FROM subscription_events WHERE id=effect_row.plan_event_id;
  IF plan_event.id IS NULL OR plan_event.subscription_id IS DISTINCT FROM parent_row.id OR plan_event.invoice_id IS DISTINCT FROM invoice_row.id
   OR plan_event.kind IS DISTINCT FROM 'plan_changed' OR plan_event.from_plan_id::text IS DISTINCT FROM old_fields->>'plan_id' OR plan_event.to_plan_id IS DISTINCT FROM effect_row.plan_id
   OR plan_event.at IS DISTINCT FROM effect_row.effect_at OR plan_event.detail IS DISTINCT FROM 'controlled-period:'||collection_row.id::text||':accepted-amendment:'||terms_row.id::text
   OR NOT EXISTS(SELECT 1 FROM subscription_events actual_event WHERE actual_event.id=plan_event.id AND actual_event.xmin::text::numeric=mod(txid_current()::numeric,4294967296)) THEN RETURN false;END IF;
 ELSIF effect_row.plan_event_id IS NOT NULL THEN RETURN false;END IF;
 target_parent=old_fields||jsonb_build_object('plan_id',effect_row.plan_id,'product_variant_id',effect_row.product_variant_id,'pending_plan_id',null,'status','active',
  'current_period_start',effect_row.period_start,'current_period_end',effect_row.period_end,'trial_ends_at',null,'dunning_started_at',null,'dunning_invoice_id',null,'dunning_attempt',0,'dunning_next_at',null,'updated_at',effect_row.effect_at);
 completed=parent_row.current_period_start=effect_row.period_start AND parent_row.current_period_end=effect_row.period_end;
 IF completed THEN
  IF NOT(current_parent @> target_parent) THEN RETURN false;END IF;
 ELSE IF encode(sha256(convert_to(current_parent::text,'UTF8')),'hex') IS DISTINCT FROM effect_row.before_parent_fingerprint THEN RETURN false;END IF;END IF;
 current_snapshot=freeholder_controlled_paid_period_parent(collection_row.id,effect_row.id,completed);
 IF current_snapshot->>'revision' IS DISTINCT FROM effect_row.parent_revision OR current_snapshot->'entries' IS DISTINCT FROM effect_row.before_entries THEN RETURN false;END IF;
 manifest=freeholder_controlled_cash_bank_invoice(collection_row.id);
 IF manifest->>'status' IS DISTINCT FROM 'paid' OR manifest->>'remainingMinor' IS DISTINCT FROM '0' OR manifest->>'paidMinor' IS DISTINCT FROM invoice_row.paid_minor::text
  OR manifest->>'totalMinor' IS DISTINCT FROM invoice_row.total_minor::text OR manifest->>'currency' IS DISTINCT FROM invoice_row.currency THEN RETURN false;END IF;
 SELECT count(*),coalesce(sum(amount_minor),0) INTO payment_count,paid FROM payments WHERE invoice_id=invoice_row.id AND status='succeeded';
 IF payment_count<1 OR payment_count>5000 OR paid IS DISTINCT FROM invoice_row.paid_minor::numeric OR payment_count<>jsonb_array_length(effect_row.bank_revisions)
  OR payment_count<>jsonb_array_length(manifest->'positiveReceiptIds') OR EXISTS(SELECT 1 FROM payments WHERE invoice_id=invoice_row.id AND status IN('created','processing')) THEN RETURN false;END IF;
 FOR payment_row IN SELECT * FROM payments WHERE invoice_id=invoice_row.id AND status='succeeded' ORDER BY id LOOP
  SELECT * INTO route_row FROM merchant_agreement_payment_routes WHERE payment_id=payment_row.id;
  SELECT * INTO link_row FROM controlled_cash_application_links WHERE payment_id=payment_row.id;
  SELECT * INTO proof_row FROM controlled_cash_application_receipts WHERE id=link_row.receipt_proof_id;
  SELECT * INTO batch_row FROM controlled_cash_application_batches WHERE id=link_row.batch_id;
  SELECT * INTO receipt_row FROM subscription_provider_charge_receipts WHERE id=link_row.receipt_id;
  SELECT count(*) INTO revision_count FROM jsonb_array_elements(effect_row.bank_revisions) r WHERE r->>'paymentId'=payment_row.id::text;
  SELECT r INTO bank_revision FROM jsonb_array_elements(effect_row.bank_revisions) r WHERE r->>'paymentId'=payment_row.id::text LIMIT 1;
  IF route_row.payment_id IS NULL OR link_row.payment_id IS NULL OR proof_row.id IS NULL OR batch_row.id IS NULL OR receipt_row.id IS NULL OR revision_count<>1
   OR batch_row.collection_id IS DISTINCT FROM collection_row.id OR batch_row.invoice_id IS DISTINCT FROM invoice_row.id OR batch_row.resource_id IS DISTINCT FROM resource_row.id
   OR proof_row.batch_id IS DISTINCT FROM batch_row.id OR proof_row.receipt_id IS DISTINCT FROM receipt_row.id OR route_row.original_charge_receipt_id IS DISTINCT FROM receipt_row.id
   OR route_row.origin_kind IS DISTINCT FROM 'provider_schedule' OR payment_row.provider IS DISTINCT FROM 'stripe' OR payment_row.method IS DISTINCT FROM 'provider_schedule' OR payment_row.refunded_minor<>0
   OR payment_row.amount_minor IS DISTINCT FROM receipt_row.amount_minor OR payment_row.currency IS DISTINCT FROM receipt_row.currency OR payment_row.amount_minor IS DISTINCT FROM proof_row.amount_minor
   OR payment_row.idempotency_key IS DISTINCT FROM proof_row.payment_idempotency_key OR payment_row.request_hash IS DISTINCT FROM proof_row.payment_request_hash
   OR payment_row.provider_ref IS DISTINCT FROM receipt_row.provider_payment_intent_ref OR route_row.provider_charge_ref IS DISTINCT FROM receipt_row.provider_charge_ref
   OR NOT receipt_row.customer_charge_verified OR NOT receipt_row.merchant_route_verified
   OR bank_revision->>'receiptId' IS DISTINCT FROM receipt_row.id::text OR NOT(manifest->'positiveReceiptIds' @> jsonb_build_array(receipt_row.id)) THEN RETURN false;END IF;
  SELECT * INTO bank_row FROM freeholder_controlled_receipt_bank_observation(collection_row.id,receipt_row.id);
  IF bank_row.actual_inspection_id IS NULL OR bank_row.actual_inspection_id::text IS DISTINCT FROM bank_revision->>'inspectionId'
   OR bank_row.actual_observation_id::text IS DISTINCT FROM bank_revision->>'observationId' OR bank_row.bank_fingerprint IS DISTINCT FROM bank_revision->>'revision'
   OR freeholder_controlled_paid_bank_principal(to_jsonb(receipt_row),to_jsonb(route_row),bank_row.current_evidence) IS DISTINCT FROM true THEN RETURN false;END IF;
  IF(bank_row.current_evidence->>'feeFieldObserved' IS DISTINCT FROM 'true' OR bank_row.current_evidence->>'transferFieldObserved' IS DISTINCT FROM 'true'
   OR route_row.application_fee_minor=0 AND bank_row.current_evidence->'fee' IS DISTINCT FROM 'null'::jsonb
   OR route_row.application_fee_minor>0 AND(bank_row.current_evidence->'fee' IS NULL OR bank_row.current_evidence->'fee'='null'::jsonb
    OR bank_row.current_evidence->'fee'->>'amountMinor' IS DISTINCT FROM route_row.application_fee_minor::text
    OR bank_row.current_evidence->'fee'->>'currency' IS DISTINCT FROM payment_row.currency OR bank_row.current_evidence->'fee'->>'refundedMinor' IS DISTINCT FROM '0')
   OR route_row.collection_kind='destination' AND(bank_row.current_evidence->'transfer' IS NULL OR bank_row.current_evidence->'transfer'='null'::jsonb))
   AND effect_row.financial_review_pending IS DISTINCT FROM true THEN RETURN false;END IF;
 END LOOP;
 RETURN true;
END $$;
--> statement-breakpoint
-- Exact customer principal is distinct from unknown/owed ancillary commission.
-- The actual receipt/route/inspection caller are independently authenticated by
-- the producer and original tuple; this pure policy never confers authority.
CREATE FUNCTION freeholder_controlled_paid_bank_principal(original_receipt jsonb,original_route jsonb,bank jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE item jsonb; seen text[]=ARRAY[]::text[]; transfer jsonb;
BEGIN
 IF bank IS NULL OR bank->>'providerApiVersion' IS DISTINCT FROM original_receipt->>'provider_api_version'
  OR bank->>'providerPlatformAccountId' IS DISTINCT FROM original_receipt->>'provider_platform_account_id' OR bank->>'chargeAccountId' IS DISTINCT FROM original_receipt->>'charge_account_id'
  OR bank->>'paymentProviderRef' IS DISTINCT FROM original_receipt->>'provider_payment_intent_ref' OR bank->>'chargePaymentProviderRef' IS DISTINCT FROM original_receipt->>'provider_payment_intent_ref'
  OR bank->>'providerChargeRef' IS DISTINCT FROM original_receipt->>'provider_charge_ref' OR original_receipt->>'provider_charge_ref' IS NULL
  OR bank->>'amountMinor' IS DISTINCT FROM original_receipt->>'amount_minor' OR bank->>'chargeAmountMinor' IS DISTINCT FROM original_receipt->>'amount_minor'
  OR bank->>'currency' IS DISTINCT FROM original_receipt->>'currency' OR bank->>'chargeCurrency' IS DISTINCT FROM original_receipt->>'currency'
  OR bank->>'paymentIntentStatus' IS DISTINCT FROM 'succeeded' OR bank->>'amountCapturableMinor' IS DISTINCT FROM '0'
  OR bank->>'paid' IS DISTINCT FROM 'true' OR bank->>'captured' IS DISTINCT FROM 'true' OR bank->>'refunded' IS DISTINCT FROM 'false'
  OR bank->>'refundsComplete' IS DISTINCT FROM 'true' OR bank->>'disputesComplete' IS DISTINCT FROM 'true'
  OR jsonb_typeof(bank->'refunds') IS DISTINCT FROM 'array' OR jsonb_typeof(bank->'disputes') IS DISTINCT FROM 'array' THEN RETURN false;END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(bank->'refunds') LOOP
  IF item->>'providerRef' IS NULL OR item->>'providerRef'=ANY(seen) OR item->>'paymentProviderRef' IS DISTINCT FROM original_receipt->>'provider_payment_intent_ref'
   OR item->>'chargeRef' IS DISTINCT FROM original_receipt->>'provider_charge_ref' OR item->>'currency' IS DISTINCT FROM original_receipt->>'currency'
   OR coalesce(item->>'status','') NOT IN('failed','canceled') OR coalesce(item->>'amountMinor','')!~'^[1-9][0-9]*$' THEN RETURN false;END IF;
  seen=array_append(seen,item->>'providerRef');END LOOP;
 seen=ARRAY[]::text[];
 FOR item IN SELECT value FROM jsonb_array_elements(bank->'disputes') LOOP
  IF item->>'providerRef' IS NULL OR item->>'providerRef'=ANY(seen) OR item->>'chargeRef' IS DISTINCT FROM original_receipt->>'provider_charge_ref'
   OR coalesce(item->>'status','') NOT IN('won','warning_closed') THEN RETURN false;END IF;
  seen=array_append(seen,item->>'providerRef');END LOOP;
 transfer=bank->'transfer';
 IF bank->>'transferFieldObserved'='true' AND transfer IS NOT NULL AND transfer<>'null'::jsonb THEN
  IF original_route->>'collection_kind' IS DISTINCT FROM 'destination' OR transfer->>'sourceChargeRef' IS DISTINCT FROM original_receipt->>'provider_charge_ref'
   OR transfer->>'destinationAccountId' IS DISTINCT FROM original_route->>'recipient_account_id' OR transfer->>'amountMinor' IS DISTINCT FROM original_receipt->>'amount_minor'
   OR transfer->>'currency' IS DISTINCT FROM original_receipt->>'currency' OR transfer->>'reversed' IS DISTINCT FROM 'false' OR transfer->>'reversedMinor' IS DISTINCT FROM '0' THEN RETURN false;END IF;
 END IF;
 RETURN true;
END $$;
--> statement-breakpoint
CREATE FUNCTION guard_controlled_paid_period_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'The independent original paid-effect receipt and preimage are immutable' USING ERRCODE='23514';END IF;
 IF NEW.admission_transaction_id IS DISTINCT FROM txid_current()::text OR NEW.protocol IS DISTINCT FROM 'controlled_paid_period.v1' THEN
  RAISE EXCEPTION 'A committed earlier cash batch or a copied effect cannot authorize this new transaction' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER subscription_controlled_paid_period_receipts_immutable BEFORE INSERT OR UPDATE OR DELETE ON subscription_controlled_paid_period_receipts FOR EACH ROW EXECUTE FUNCTION guard_controlled_paid_period_receipt();
--> statement-breakpoint
CREATE FUNCTION guard_controlled_paid_period_birth() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF freeholder_controlled_paid_period_source(NEW.id) IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'Require this real independent effect current bank/parent preimage and exact accepted fully paid source, not marker authority' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER subscription_controlled_paid_period_birth AFTER INSERT ON subscription_controlled_paid_period_receipts FOR EACH ROW EXECUTE FUNCTION guard_controlled_paid_period_birth();
--> statement-breakpoint
CREATE FUNCTION guard_subscription_controlled_paid_period() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE effect_row subscription_controlled_paid_period_receipts%ROWTYPE; actual_count integer; proposed jsonb; original jsonb; expected jsonb;
 managed_columns text[]=ARRAY['plan_id','product_variant_id','pending_plan_id','status','current_period_start','current_period_end','trial_ends_at','dunning_started_at','dunning_invoice_id','dunning_attempt','dunning_next_at','updated_at'];
BEGIN
 IF OLD.merchant_scope_version<>1 OR OLD.billing_mode<>'provider' OR NEW.billing_mode<>'provider'
  OR(NEW.current_period_start IS NOT DISTINCT FROM OLD.current_period_start AND NEW.current_period_end IS NOT DISTINCT FROM OLD.current_period_end)
  OR NOT EXISTS(SELECT 1 FROM subscription_controlled_collections c JOIN subscription_controlled_quotes q ON q.id=c.quote_id
   JOIN subscription_controlled_resources r ON r.id=q.resource_id WHERE r.subscription_id=OLD.id AND c.kind='period') THEN RETURN NEW;END IF;
 SELECT count(*) INTO actual_count FROM subscription_controlled_paid_period_receipts WHERE subscription_id=OLD.id AND admission_transaction_id=txid_current()::text;
 SELECT * INTO effect_row FROM subscription_controlled_paid_period_receipts WHERE subscription_id=OLD.id AND admission_transaction_id=txid_current()::text LIMIT 1;
 IF actual_count<>1 OR effect_row.id IS NULL THEN RAISE EXCEPTION 'Only one genuine new independent paid-period effect may advance this actual original parent' USING ERRCODE='23514';END IF;
 original=to_jsonb(OLD);proposed=to_jsonb(NEW);
 expected=effect_row.before_parent_fields||jsonb_build_object('plan_id',effect_row.plan_id,'product_variant_id',effect_row.product_variant_id,'pending_plan_id',null,'status','active',
  'current_period_start',effect_row.period_start,'current_period_end',effect_row.period_end,'trial_ends_at',null,'dunning_started_at',null,'dunning_invoice_id',null,'dunning_attempt',0,'dunning_next_at',null,'updated_at',effect_row.effect_at);
 IF encode(sha256(convert_to(original::text,'UTF8')),'hex') IS DISTINCT FROM effect_row.before_parent_fingerprint
  OR(proposed-managed_columns) IS DISTINCT FROM(original-managed_columns) OR NOT(proposed @> expected)
  OR freeholder_controlled_paid_period_source(effect_row.id) IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'Advance only the exact proved original paid calendar and accepted plan; preserve all other parent fields and current money evidence' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER subscription_controlled_paid_period_guard BEFORE UPDATE ON subscriptions FOR EACH ROW EXECUTE FUNCTION guard_subscription_controlled_paid_period();
--> statement-breakpoint
CREATE FUNCTION guard_controlled_paid_period_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_row subscriptions%ROWTYPE;
BEGIN
 SELECT * INTO parent_row FROM subscriptions WHERE id=NEW.subscription_id;
 IF parent_row.id IS NULL OR parent_row.current_period_start IS DISTINCT FROM NEW.period_start OR parent_row.current_period_end IS DISTINCT FROM NEW.period_end
  OR parent_row.plan_id IS DISTINCT FROM NEW.plan_id OR parent_row.product_variant_id IS DISTINCT FROM NEW.product_variant_id OR parent_row.pending_plan_id IS NOT NULL
  OR parent_row.status IS DISTINCT FROM 'active' OR freeholder_controlled_paid_period_source(NEW.id) IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'The independent real paid-period transaction must finish its exact effect and preserve the full normalized current money/caller/raw preimage through commit' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER subscription_controlled_paid_period_complete AFTER INSERT ON subscription_controlled_paid_period_receipts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_controlled_paid_period_complete();
--> statement-breakpoint
CREATE FUNCTION guard_controlled_paid_period_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM subscription_controlled_paid_period_receipts WHERE renewal_event_id=OLD.id OR plan_event_id=OLD.id) THEN
  RAISE EXCEPTION 'Keep the actual independent paid-effect original event identity and accepted detail immutable' USING ERRCODE='23514';END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER subscription_controlled_paid_period_event_guard BEFORE UPDATE OR DELETE ON subscription_events FOR EACH ROW EXECUTE FUNCTION guard_controlled_paid_period_event();

--> statement-breakpoint
CREATE FUNCTION freeholder_controlled_paid_period_ready() RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT coalesce(
  EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('freeholder_controlled_paid_period_end(timestamptz,jsonb)') AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='584fa8ee6a1ee2e72a05ecc313f8971473bed0d03c3b2b5e2dcc19ac62019824')
  AND   EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('freeholder_controlled_paid_period_parent(uuid,uuid,boolean)') AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='180efb0d5bee911502ee1d7efb03e03b39a147887bb1f964b52d0775de73bba3')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('freeholder_controlled_paid_period_locks(uuid)') AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='7754036640fd3f02b1b74210bb3ed9e2f0c70c0628595d422ce122031b514654')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('freeholder_controlled_paid_period_source(uuid)') AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='141237d07f913e05a883519797ad64b4541f3e440e42c4d51a70a873dad33c9c')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('freeholder_controlled_paid_bank_principal(jsonb,jsonb,jsonb)') AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='90ce13d539045fb686fd3f2a0da597d0304c2d969b55e70466102b3cbfcee028')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('guard_controlled_paid_period_receipt()') AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='7dc7bfec3818df05cf43c8764e7bea24bceb4559a79667f89439b60693635df3')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('guard_controlled_paid_period_birth()') AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='bfedcbb43ebc14f0785bac37fdc2e4b07a5bd53741e6e8f027c0b2273a9db422')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('guard_subscription_controlled_paid_period()') AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='6284ea5b48d816eaafcb1a1caf29d87f67a6daac53975c32105ebbf87fc34efe')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('guard_controlled_paid_period_complete()') AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='b49b017469394bd72625c46991e30eef8bc93a4170c76ba1ff727edf28927df4')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('guard_controlled_paid_period_event()') AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='bfd51b0b2a91973d9db542b9a4487babda559c54809d44d754047d00ad7a37fc')
  AND EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid='subscription_controlled_paid_period_receipts'::regclass AND t.tgname='subscription_controlled_paid_period_receipts_immutable' AND t.tgfoid=to_regprocedure('guard_controlled_paid_period_receipt()') AND t.tgenabled IN('O','A') AND t.tgtype=31 AND NOT t.tgisinternal AND NOT t.tgdeferrable)
  AND EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid='subscription_controlled_paid_period_receipts'::regclass AND t.tgname='subscription_controlled_paid_period_birth' AND t.tgfoid=to_regprocedure('guard_controlled_paid_period_birth()') AND t.tgenabled IN('O','A') AND t.tgtype=5 AND NOT t.tgisinternal AND NOT t.tgdeferrable)
  AND EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid='subscriptions'::regclass AND t.tgname='subscription_controlled_paid_period_guard' AND t.tgfoid=to_regprocedure('guard_subscription_controlled_paid_period()') AND t.tgenabled IN('O','A') AND t.tgtype=19 AND NOT t.tgisinternal AND NOT t.tgdeferrable)
  AND EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid='subscription_controlled_paid_period_receipts'::regclass AND t.tgname='subscription_controlled_paid_period_complete' AND t.tgfoid=to_regprocedure('guard_controlled_paid_period_complete()') AND t.tgenabled IN('O','A') AND t.tgtype=5 AND NOT t.tgisinternal AND t.tgdeferrable AND t.tginitdeferred)
  AND EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid='subscription_events'::regclass AND t.tgname='subscription_controlled_paid_period_event_guard' AND t.tgfoid=to_regprocedure('guard_controlled_paid_period_event()') AND t.tgenabled IN('O','A') AND t.tgtype=27 AND NOT t.tgisinternal AND NOT t.tgdeferrable),false);
$$;
