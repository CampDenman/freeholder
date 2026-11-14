-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
-- OWNED, UNAPPLIED successor. Append AFTER the complete 624213-byte SQL85
-- prefix (9b6144a71e1a898406f048a441df6178c89a8de0f8073fa3557191525a57f901).
-- No money/GET authority: new access only; all historical/default branches stay.
CREATE FUNCTION freeholder_identity_privacy_exclusive() RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM pg_locks l WHERE l.locktype='advisory' AND l.pid=pg_backend_pid() AND l.granted
  AND l.database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND l.mode='ExclusiveLock' AND l.objsubid=1
  AND l.classid::bigint=(CASE WHEN hashtext('contact-identity-privacy')<0 THEN 4294967295::bigint ELSE 0::bigint END)
  AND l.objid::bigint=(hashtext('contact-identity-privacy')::bigint & 4294967295::bigint))
$$;
CREATE FUNCTION freeholder_controlled_target_privacy_ready(target_collection_uuid uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT coalesce((SELECT
  NOT EXISTS(SELECT 1 FROM contacts owner WHERE owner.id IN(parent.contact_id,profile.contact_id) AND owner.source='privacy-erasure')
  AND NOT EXISTS(SELECT 1 FROM data_requests request WHERE request.contact_id IN(parent.contact_id,profile.contact_id)
   AND request.kind='erasure' AND request.verified_at IS NOT NULL AND request.status IN('verified','in_progress','completed','partially_completed'))
  AND NOT EXISTS(SELECT 1 FROM privacy_retention_exceptions hold JOIN data_requests request ON request.id=hold.data_request_id
   WHERE request.contact_id IN(parent.contact_id,profile.contact_id)
   AND hold.scope IN('commerce.money','commerce.merchantTax','subscriptions.agreements','privacy.records')
   AND(hold.expires_at IS NULL OR hold.expires_at>clock_timestamp()))
  FROM subscription_controlled_collections collection
  JOIN subscription_controlled_quotes quote ON quote.id=collection.quote_id
  JOIN subscription_controlled_resources resource ON resource.id=quote.resource_id
  JOIN subscriptions parent ON parent.id=resource.subscription_id
  JOIN subscription_commercial_terms terms ON terms.id=collection.terms_id AND terms.subscription_id=parent.id
   AND terms.profile_id=quote.profile_id AND terms.profile_version=quote.profile_version
  JOIN merchant_tax_profiles profile ON profile.id=quote.profile_id AND profile.state='active'
  JOIN contacts merchant ON merchant.id=profile.contact_id
  JOIN contacts buyer ON buyer.id=parent.contact_id
  LEFT JOIN invoices invoice ON invoice.id=collection.invoice_id
  WHERE collection.id=target_collection_uuid AND collection.kind=quote.kind
   AND(collection.invoice_id IS NULL AND collection.kind='proration' OR invoice.contact_id=parent.contact_id)
 ),false)
$$;
CREATE FUNCTION guard_controlled_privacy_request_identity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE newly_blocked boolean; rebound_hold boolean;
BEGIN
 newly_blocked=NEW.kind='erasure' AND NEW.verified_at IS NOT NULL AND NEW.status IN('verified','in_progress','completed','partially_completed');
 IF TG_OP='UPDATE' THEN
  newly_blocked=newly_blocked AND(OLD.kind IS DISTINCT FROM NEW.kind OR OLD.verified_at IS NULL
   OR OLD.status NOT IN('verified','in_progress','completed','partially_completed') OR OLD.contact_id IS DISTINCT FROM NEW.contact_id);
  rebound_hold=OLD.contact_id IS DISTINCT FROM NEW.contact_id AND EXISTS(SELECT 1 FROM privacy_retention_exceptions hold
   WHERE hold.data_request_id=NEW.id AND hold.scope IN('commerce.money','commerce.merchantTax','subscriptions.agreements','privacy.records')
   AND(hold.expires_at IS NULL OR hold.expires_at>clock_timestamp()));
 ELSE rebound_hold=false;END IF;
 IF(newly_blocked OR rebound_hold) AND NOT freeholder_identity_privacy_exclusive() THEN
  RAISE EXCEPTION 'New original-owner privacy restriction requires the exclusive contact identity prefix' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER controlled_privacy_request_identity BEFORE INSERT OR UPDATE ON data_requests
 FOR EACH ROW EXECUTE FUNCTION guard_controlled_privacy_request_identity();
CREATE FUNCTION guard_controlled_privacy_hold_identity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE newly_active boolean;
BEGIN
 newly_active=NEW.scope IN('commerce.money','commerce.merchantTax','subscriptions.agreements','privacy.records')
  AND(NEW.expires_at IS NULL OR NEW.expires_at>clock_timestamp());
 IF TG_OP='UPDATE' THEN
  newly_active=newly_active AND(OLD.data_request_id IS DISTINCT FROM NEW.data_request_id OR OLD.scope IS DISTINCT FROM NEW.scope
   OR OLD.expires_at IS DISTINCT FROM NEW.expires_at);
 END IF;
 IF newly_active AND NOT freeholder_identity_privacy_exclusive() THEN
  RAISE EXCEPTION 'New original-owner retention restriction requires the exclusive contact identity prefix' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER controlled_privacy_hold_identity BEFORE INSERT OR UPDATE ON privacy_retention_exceptions
 FOR EACH ROW EXECUTE FUNCTION guard_controlled_privacy_hold_identity();
CREATE FUNCTION guard_controlled_privacy_contact_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.source='privacy-erasure' AND OLD.source IS DISTINCT FROM NEW.source AND NOT freeholder_identity_privacy_exclusive() THEN
  RAISE EXCEPTION 'Original-owner erasure marker requires the exclusive contact identity prefix' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER controlled_privacy_contact_identity BEFORE UPDATE ON contacts
 FOR EACH ROW EXECUTE FUNCTION guard_controlled_privacy_contact_identity();
CREATE OR REPLACE FUNCTION freeholder_controlled_paid_period_source(target_effect_uuid uuid) RETURNS boolean LANGUAGE plpgsql VOLATILE AS $$
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
 IF NOT freeholder_controlled_target_privacy_ready(effect_row.collection_id) THEN RETURN false;END IF;
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
CREATE OR REPLACE FUNCTION freeholder_controlled_paid_period_ready() RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT coalesce(
  EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('freeholder_controlled_paid_period_end(timestamptz,jsonb)') AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='584fa8ee6a1ee2e72a05ecc313f8971473bed0d03c3b2b5e2dcc19ac62019824')
  AND   EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('freeholder_controlled_paid_period_parent(uuid,uuid,boolean)') AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='180efb0d5bee911502ee1d7efb03e03b39a147887bb1f964b52d0775de73bba3')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('freeholder_controlled_paid_period_locks(uuid)') AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='7754036640fd3f02b1b74210bb3ed9e2f0c70c0628595d422ce122031b514654')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('freeholder_controlled_paid_period_source(uuid)') AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='79e38fd129088bc9bbbdc67c0e163b02a9297c51a0104434c8c4af21477d9916')
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
  AND EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid='subscription_events'::regclass AND t.tgname='subscription_controlled_paid_period_event_guard' AND t.tgfoid=to_regprocedure('guard_controlled_paid_period_event()') AND t.tgenabled IN('O','A') AND t.tgtype=27 AND NOT t.tgisinternal AND NOT t.tgdeferrable)
 AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('freeholder_identity_privacy_exclusive()') AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='c394daf1829aeae00529cc9ffdb1a4c95a7c70f05894b630ff1a844be062d6d9')
 AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('freeholder_controlled_target_privacy_ready(uuid)') AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='d0711747f403327e5c0b1773783fbe857458439803e77d286b7e817f78caa4b0')
 AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('guard_controlled_privacy_request_identity()') AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='504a6709bcb8867231a7b0e10d07dcca179e4e5e19a1d3ef1336f7d220a83887')
 AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('guard_controlled_privacy_hold_identity()') AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='b130e239f2293983bf3128d0b40730a67bebafb3c8e030cdbdc28c6d47bc25b0')
 AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('guard_controlled_privacy_contact_identity()') AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='28e135a1e082559ef33e35bdbe798c53402a2b503e788131fdbc7968c8ea4919')
 AND EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid='data_requests'::regclass AND t.tgname='controlled_privacy_request_identity' AND t.tgfoid=to_regprocedure('guard_controlled_privacy_request_identity()') AND t.tgtype=23 AND NOT t.tgisinternal AND NOT t.tgdeferrable AND NOT t.tginitdeferred AND t.tgenabled IN('O','A'))
 AND EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid='privacy_retention_exceptions'::regclass AND t.tgname='controlled_privacy_hold_identity' AND t.tgfoid=to_regprocedure('guard_controlled_privacy_hold_identity()') AND t.tgtype=23 AND NOT t.tgisinternal AND NOT t.tgdeferrable AND NOT t.tginitdeferred AND t.tgenabled IN('O','A'))
 AND EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid='contacts'::regclass AND t.tgname='controlled_privacy_contact_identity' AND t.tgfoid=to_regprocedure('guard_controlled_privacy_contact_identity()') AND t.tgtype=19 AND NOT t.tgisinternal AND NOT t.tgdeferrable AND NOT t.tginitdeferred AND t.tgenabled IN('O','A')),false);
$$;
