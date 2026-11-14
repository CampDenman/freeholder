-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
-- C12.38/C1.08: UNAPPLIED after controlled-atomic-refund-residual84.
CREATE TABLE merchant_fee_refund_invocations(
 id uuid PRIMARY KEY,payment_id uuid NOT NULL,original_charge_receipt_id uuid NOT NULL,namespace_key text NOT NULL,
 fee_operation_id uuid,ordinal integer NOT NULL,kind text NOT NULL,fee_operation_fingerprint text,request jsonb NOT NULL,caller jsonb NOT NULL,nonce_hash text NOT NULL,
 digest text NOT NULL,authentication text NOT NULL,first_result jsonb,finish jsonb,stop jsonb,created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT merchant_fee_invocations_operation_fk FOREIGN KEY(fee_operation_id) REFERENCES merchant_fee_refunds(id) ON DELETE RESTRICT,
 CONSTRAINT merchant_fee_invocations_payment_fk FOREIGN KEY(payment_id) REFERENCES payments(id) ON DELETE RESTRICT,
 CONSTRAINT merchant_fee_invocations_receipt_fk FOREIGN KEY(original_charge_receipt_id) REFERENCES subscription_provider_charge_receipts(id) ON DELETE RESTRICT,
 CONSTRAINT merchant_fee_invocations_kind CHECK(kind in ('source_inspect','post','recover_get') and ordinal>0),
 CONSTRAINT merchant_fee_invocations_owner CHECK(((kind='source_inspect' and fee_operation_id is null and fee_operation_fingerprint is null) or (kind in ('post','recover_get') and fee_operation_id is not null and fee_operation_fingerprint ~ '^[a-f0-9]{64}$')) is true),
 CONSTRAINT merchant_fee_invocations_source CHECK(((kind='source_inspect' and ((request->>'readKind'='payment_source' and request->>'parentFeeInvocationId' is null) or (request->>'readKind'='fee_preflight' and request->>'parentFeeInvocationId' ~ '^[0-9a-f-]{36}$'))) or (kind<>'source_inspect' and request->>'readKind' is null and request->>'parentFeeInvocationId' is null)) is true),
 CONSTRAINT merchant_fee_invocations_header CHECK(length(namespace_key) between 3 and 1502 and nonce_hash ~ '^[a-f0-9]{64}$' and digest ~ '^[a-f0-9]{64}$' and authentication ~ '^[a-f0-9]{64}$' and jsonb_typeof(request)='object' and jsonb_typeof(caller)='object'),
 CONSTRAINT merchant_fee_invocations_proofs CHECK((first_result is null or jsonb_typeof(first_result)='object') and (finish is null or jsonb_typeof(finish)='object') and (stop is null or jsonb_typeof(stop)='object') and (finish is null or stop is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX merchant_fee_invocations_ordinal ON merchant_fee_refund_invocations(payment_id,namespace_key,ordinal);
--> statement-breakpoint
CREATE UNIQUE INDEX merchant_fee_invocations_post ON merchant_fee_refund_invocations(fee_operation_id) WHERE kind='post';
--> statement-breakpoint
CREATE INDEX merchant_fee_invocations_operation ON merchant_fee_refund_invocations(fee_operation_id,created_at);
--> statement-breakpoint
CREATE INDEX merchant_fee_invocations_receipt ON merchant_fee_refund_invocations(original_charge_receipt_id,ordinal);
--> statement-breakpoint
CREATE UNIQUE INDEX merchant_fee_invocations_preflight ON merchant_fee_refund_invocations((request->>'parentFeeInvocationId')) WHERE kind='source_inspect' and request->>'readKind'='fee_preflight';
--> statement-breakpoint
-- This verifier NEVER acquires a resource in reverse from a fee/invocation
-- row. Ordinary callers acquired the complete prefix through real coverage.
CREATE FUNCTION freeholder_merchant_fee_require_prefix(actual_payment uuid) RETURNS void LANGUAGE plpgsql STABLE AS $$
DECLARE owner_row record;scope jsonb;required_key text;
BEGIN
 SELECT b.resource_id,b.collection_id INTO owner_row FROM controlled_cash_application_links l JOIN controlled_cash_application_batches b ON b.id=l.batch_id WHERE l.payment_id=actual_payment;
 IF owner_row.resource_id IS NULL THEN RAISE EXCEPTION 'Restore exact original applied controlled fee owner' USING ERRCODE='23514';END IF;
 PERFORM freeholder_controlled_cash_require_prefix(owner_row.resource_id);
 scope:=freeholder_controlled_cash_scope(owner_row.collection_id);
 FOR required_key IN
  SELECT 'payment:'||actual_id::text FROM unnest(freeholder_controlled_cash_scope_ids(scope,'payments')) actual_id
  UNION SELECT 'invoice:'||actual_id::text FROM unnest(freeholder_controlled_cash_scope_ids(scope,'invoices')) actual_id
  UNION SELECT 'credit-note:'||actual_id::text FROM unnest(freeholder_controlled_cash_scope_ids(scope,'notes')) actual_id
  UNION SELECT 'subscription-cash:'||(actual_namespace->>'platform')||':'||coalesce(actual_namespace->>'account','')||':'||(actual_namespace->>'intent') FROM jsonb_array_elements(scope->'namespaces') actual_namespace
 LOOP
  IF required_key IS NULL OR NOT EXISTS(SELECT 1 FROM pg_locks actual_lock WHERE actual_lock.pid=pg_backend_pid() AND actual_lock.locktype='advisory' AND actual_lock.granted
   AND actual_lock.database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND actual_lock.mode='ExclusiveLock' AND actual_lock.objsubid=1
   AND actual_lock.classid::bigint=(CASE WHEN hashtext(required_key)<0 THEN 4294967295::bigint ELSE 0::bigint END)
   AND actual_lock.objid::bigint=(hashtext(required_key)::bigint & 4294967295::bigint)) THEN
   RAISE EXCEPTION 'Original fee caller requires already held contact/resource/parent/canonical/cash locks' USING ERRCODE='23514';END IF;
 END LOOP;
END $$;
--> statement-breakpoint
CREATE FUNCTION freeholder_merchant_fee_invocation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE fee_row merchant_fee_refunds%ROWTYPE;payment_row payments%ROWTYPE;route_row merchant_agreement_payment_routes%ROWTYPE;receipt_row subscription_provider_charge_receipts%ROWTYPE;
 current_fingerprint text;current_count bigint;last_row merchant_fee_refund_invocations%ROWTYPE;source_row merchant_fee_refund_invocations%ROWTYPE;parent_call merchant_fee_refund_invocations%ROWTYPE;proof jsonb;
BEGIN
 IF TG_OP='DELETE' OR current_setting('freeholder.merchant_fee_invocation_v1',true) IS DISTINCT FROM '1' THEN
  RAISE EXCEPTION 'Original fee caller admission and actual results are retained guarded evidence' USING ERRCODE='23514';END IF;
 -- Actual late first-result/FIN persistence authenticates the immutable header;
 -- changed policy, target, alias or another callback cannot erase real money.
 IF TG_OP='UPDATE' THEN
  IF NOT EXISTS(SELECT 1 FROM pg_locks identity_lock WHERE identity_lock.pid=pg_backend_pid() AND identity_lock.locktype='advisory' AND identity_lock.granted
   AND identity_lock.database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND identity_lock.mode IN('ShareLock','ExclusiveLock') AND identity_lock.objsubid=1
   AND identity_lock.classid::bigint=(CASE WHEN hashtext('contact-identity-privacy')<0 THEN 4294967295::bigint ELSE 0::bigint END)
   AND identity_lock.objid::bigint=(hashtext('contact-identity-privacy')::bigint & 4294967295::bigint)) THEN
   RAISE EXCEPTION 'Actual fee callback evidence waits for the shared identity fence before its original caller latch' USING ERRCODE='23514';END IF;
  PERFORM pg_advisory_xact_lock(hashtext('merchant-fee-invocation:'||NEW.payment_id::text));
  IF (to_jsonb(NEW)-array['first_result','finish','stop']) IS DISTINCT FROM (to_jsonb(OLD)-array['first_result','finish','stop'])
   OR OLD.first_result IS NOT NULL AND NEW.first_result IS DISTINCT FROM OLD.first_result
   OR OLD.finish IS NOT NULL AND NEW.finish IS DISTINCT FROM OLD.finish OR OLD.stop IS NOT NULL AND NEW.stop IS DISTINCT FROM OLD.stop
   OR OLD.finish IS NOT NULL OR OLD.stop IS NOT NULL THEN
   RAISE EXCEPTION 'The original fee admission, first result, actual finish and independent stop cannot be rewritten' USING ERRCODE='23514';END IF;
  IF NEW.stop IS NULL AND NEW.nonce_hash IS DISTINCT FROM encode(sha256(convert_to(coalesce(current_setting('freeholder.merchant_fee_invocation_nonce',true),''),'UTF8')),'hex') THEN
   RAISE EXCEPTION 'Only the original private fee holder may retain an SDK result or finish' USING ERRCODE='23514';END IF;
  IF NEW.stop IS NOT NULL AND(NEW.stop->'body'->>'mechanicalCheck' IS DISTINCT FROM 'absent' OR coalesce(NEW.stop->'body'->>'reviewedBy','') !~ '^user:[0-9a-f-]{36}$'
    OR NEW.stop->'body'->>'admissionFingerprint' IS DISTINCT FROM encode(sha256(convert_to(to_jsonb(OLD)::text,'UTF8')),'hex')) THEN
   RAISE EXCEPTION 'An independent local hosting stop is an exact fresh-human review, never bank evidence or a finish' USING ERRCODE='23514';END IF;
  IF NEW.finish IS NOT NULL AND(coalesce(NEW.finish->'body'->>'outcome','') NOT IN('returned','threw') OR NEW.finish->'body'->>'firstResultDigest' IS DISTINCT FROM NEW.first_result->>'digest') THEN
   RAISE EXCEPTION 'The actual wrapper finish must preserve its first real result' USING ERRCODE='23514';END IF;
  IF NEW.finish IS NOT NULL AND((NEW.kind='post' AND(jsonb_typeof(NEW.finish->'body'->'postDispatchReleased') IS DISTINCT FROM 'boolean'
    OR(NEW.finish->'body'->>'outcome'='returned' AND NEW.finish->'body'->'postDispatchReleased' IS DISTINCT FROM 'true'::jsonb)))
   OR(NEW.kind<>'post' AND NEW.finish->'body'->'postDispatchReleased' IS DISTINCT FROM 'null'::jsonb)) THEN
   RAISE EXCEPTION 'Retain only the actual server-held fee dispatch phase; a local flag is never bank absence or replay authority' USING ERRCODE='23514';END IF;
  FOR proof IN SELECT value FROM jsonb_each(jsonb_build_object('first_result',NEW.first_result,'finish',NEW.finish,'stop',NEW.stop)) WHERE value<>'null'::jsonb LOOP
   IF coalesce(proof->>'digest','') !~ '^[a-f0-9]{64}$' OR coalesce(proof->>'authentication','') !~ '^[a-f0-9]{64}$' OR proof->'body'->>'invocationId' IS DISTINCT FROM NEW.id::text
    OR proof->'body'->>'admissionDigest' IS DISTINCT FROM NEW.digest OR proof->'body'->>'callerInstanceId' IS DISTINCT FROM NEW.caller->>'id' THEN
    RAISE EXCEPTION 'Retain only exact original signed fee invocation evidence' USING ERRCODE='23514';END IF;
  END LOOP;
  RETURN NEW;
 END IF;
 PERFORM freeholder_merchant_fee_require_prefix(NEW.payment_id);
 PERFORM pg_advisory_xact_lock(hashtext('merchant-fee-invocation:'||NEW.payment_id::text));
 SELECT * INTO payment_row FROM payments WHERE id=NEW.payment_id;
 SELECT * INTO route_row FROM merchant_agreement_payment_routes WHERE payment_id=payment_row.id;
 SELECT * INTO receipt_row FROM subscription_provider_charge_receipts WHERE id=NEW.original_charge_receipt_id;
 IF payment_row.id IS NULL OR route_row.original_charge_receipt_id IS DISTINCT FROM receipt_row.id OR receipt_row.id IS NULL
  OR NEW.namespace_key IS DISTINCT FROM receipt_row.provider_platform_account_id||':'||coalesce(receipt_row.charge_account_id,'')||':'||receipt_row.provider_payment_intent_ref
  OR payment_row.provider_ref IS DISTINCT FROM receipt_row.provider_payment_intent_ref OR payment_row.currency<>receipt_row.currency OR payment_row.amount_minor<>receipt_row.amount_minor
  OR NEW.request->>'paymentId' IS DISTINCT FROM payment_row.id::text OR NEW.request->>'invoiceId' IS DISTINCT FROM payment_row.invoice_id::text
  OR NEW.request->>'originalChargeReceiptId' IS DISTINCT FROM receipt_row.id::text OR NEW.request->>'providerRef' IS DISTINCT FROM payment_row.provider_ref
  OR NEW.request->>'providerChargeRef' IS DISTINCT FROM receipt_row.provider_charge_ref OR NEW.request->>'providerPlatformAccountId' IS DISTINCT FROM receipt_row.provider_platform_account_id
  OR NEW.request->>'providerAccountId' IS DISTINCT FROM receipt_row.charge_account_id OR NEW.request->>'currency' IS DISTINCT FROM payment_row.currency
  OR NEW.request->>'originalPrincipalMinor' IS DISTINCT FROM payment_row.amount_minor::text OR NEW.request->>'originalApplicationFeeMinor' IS DISTINCT FROM route_row.application_fee_minor::text
  OR NEW.request->>'providerApiVersion' IS DISTINCT FROM receipt_row.provider_api_version
  OR NEW.request->'subscriptionOrigin'->>'providerSubscriptionRef' IS DISTINCT FROM route_row.provider_subscription_ref
  OR NEW.request->'subscriptionOrigin'->>'providerInvoiceRef' IS DISTINCT FROM route_row.provider_invoice_ref
  OR NEW.request->'subscriptionOrigin'->>'providerPaymentIntentRef' IS DISTINCT FROM route_row.provider_payment_intent_ref
  OR NOT EXISTS(SELECT 1 FROM controlled_cash_application_links l JOIN controlled_cash_application_batches b ON b.id=l.batch_id JOIN controlled_cash_application_receipts rp ON rp.id=l.receipt_proof_id
   JOIN merchant_cash_return_observations initial_bank ON initial_bank.id=rp.bank_observation_id AND initial_bank.inspection_id=rp.bank_inspection_id
   JOIN merchant_cash_return_inspections initial_inspection ON initial_inspection.id=rp.bank_inspection_id
   JOIN merchant_cash_return_inspection_finishes initial_finish ON initial_finish.inspection_id=initial_inspection.id
   WHERE l.payment_id=payment_row.id AND l.receipt_id=receipt_row.id AND b.protocol IN('controlled_net_gross.v1','controlled_cash_atomic.v1') AND EXISTS(SELECT 1 FROM controlled_cash_application_batches atomic_epoch WHERE atomic_epoch.invoice_id=payment_row.invoice_id AND atomic_epoch.protocol='controlled_cash_atomic.v1') AND b.invoice_id=payment_row.invoice_id AND b.admission_transaction_id<>txid_current()::text
    AND rp.amount_minor=payment_row.amount_minor AND rp.currency=payment_row.currency AND rp.fee_minor=route_row.application_fee_minor
    AND EXISTS(SELECT 1 FROM jsonb_array_elements(b.before_entries) frozen WHERE frozen->>'table'='merchant_cash_return_observations' AND frozen->>'id'=initial_bank.id::text AND frozen->>'hashDomain'='postgres_row'
     AND frozen->>'fingerprint'=encode(sha256(convert_to(to_jsonb(initial_bank)::text,'UTF8')),'hex'))
    AND initial_finish.outcome='returned' AND initial_finish.caller_instance_id=rp.bank_finish_caller_id AND initial_finish.caller_instance_id::text=initial_inspection.caller->>'id'
    AND initial_bank.evidence->>'paymentProviderRef'=receipt_row.provider_payment_intent_ref AND initial_bank.evidence->>'providerChargeRef'=receipt_row.provider_charge_ref
    AND initial_bank.evidence->>'providerPlatformAccountId'=receipt_row.provider_platform_account_id AND initial_bank.evidence->>'chargeAccountId' IS NOT DISTINCT FROM receipt_row.charge_account_id
    AND(NEW.request->>'applicationFeeRef') IS NOT DISTINCT FROM coalesce(receipt_row.application_fee_ref,initial_bank.evidence->'fee'->>'providerRef')) THEN
  RAISE EXCEPTION 'Restore exact committed original payment/receipt/core3/initial bank resource ancestry before a real fee caller' USING ERRCODE='23514';END IF;
 IF NEW.first_result IS NOT NULL OR NEW.finish IS NOT NULL OR NEW.stop IS NOT NULL
  OR NEW.nonce_hash IS DISTINCT FROM encode(sha256(convert_to(coalesce(current_setting('freeholder.merchant_fee_invocation_nonce',true),''),'UTF8')),'hex')
  OR coalesce(NEW.caller->>'id','') !~ '^[0-9a-f-]{36}$' OR coalesce(NEW.request->>'sourceRevision','') !~ '^[a-f0-9]{64}$' THEN
  RAISE EXCEPTION 'Retain an actual original holder before any fee SDK call' USING ERRCODE='23514';END IF;
 IF NEW.kind='source_inspect' AND NEW.request->>'readKind'='fee_preflight' THEN
  IF coalesce(NEW.request->>'parentFeeInvocationId','') !~ '^[0-9a-f-]{36}$' THEN RAISE EXCEPTION 'An actual fee preparation read requires its original parent UUID' USING ERRCODE='23514';END IF;
  SELECT * INTO parent_call FROM merchant_fee_refund_invocations WHERE id=(NEW.request->>'parentFeeInvocationId')::uuid;
  IF parent_call.id IS NULL OR parent_call.kind NOT IN('post','recover_get') OR parent_call.fee_operation_id IS NULL OR parent_call.payment_id<>NEW.payment_id OR parent_call.original_charge_receipt_id<>NEW.original_charge_receipt_id
   OR parent_call.namespace_key<>NEW.namespace_key OR parent_call.first_result IS NOT NULL OR parent_call.finish IS NOT NULL OR parent_call.stop IS NOT NULL
   OR parent_call.caller->>'id' IS DISTINCT FROM NEW.caller->>'id' OR parent_call.nonce_hash=NEW.nonce_hash
   OR parent_call.nonce_hash IS DISTINCT FROM encode(sha256(convert_to(coalesce(current_setting('freeholder.merchant_fee_parent_nonce',true),''),'UTF8')),'hex')
   OR NEW.request->>'parentAdmissionDigest' IS DISTINCT FROM parent_call.digest
   OR NEW.request->>'parentAdmissionFingerprint' IS DISTINCT FROM encode(sha256(convert_to(to_jsonb(parent_call)::text,'UTF8')),'hex')
   OR EXISTS(SELECT 1 FROM merchant_fee_refund_invocations prior_child WHERE prior_child.request->>'parentFeeInvocationId'=parent_call.id::text) THEN
   RAISE EXCEPTION 'Only this exact actually running original fee POST/GET holder may admit its one real preparation read; no recursion, substitute or old birth' USING ERRCODE='23514';END IF;
 END IF;
 SELECT count(*) INTO current_count FROM merchant_fee_refund_invocations WHERE payment_id=payment_row.id AND namespace_key=NEW.namespace_key;
 IF current_count>=4998 OR NEW.ordinal<>current_count+1 OR EXISTS(SELECT 1 FROM merchant_fee_refund_invocations prior_call WHERE prior_call.payment_id=payment_row.id AND prior_call.finish IS NULL AND prior_call.stop IS NULL AND prior_call.id IS DISTINCT FROM parent_call.id) THEN
  RAISE EXCEPTION 'Every original local fee caller must genuinely finish or be independently reviewed stopped before another call' USING ERRCODE='23514';END IF;
 IF NEW.kind='source_inspect' THEN
  IF NEW.fee_operation_id IS NOT NULL OR NEW.fee_operation_fingerprint IS NOT NULL OR NEW.request->>'amountMinor' IS NOT NULL OR NEW.request->>'frozenBody' IS NOT NULL
   OR NEW.request->>'idempotencyKey' IS NOT NULL OR NEW.request->>'sourceInvocationId' IS NOT NULL THEN
   RAISE EXCEPTION 'A readonly source probe cannot invent a zero fee operation or physical request' USING ERRCODE='23514';END IF;
 ELSE
  SELECT * INTO fee_row FROM merchant_fee_refunds WHERE id=NEW.fee_operation_id;
  current_fingerprint:=encode(sha256(convert_to((to_jsonb(fee_row)-array['status','provider_ref','dispatched_at','accepted_at','updated_at'])::text,'UTF8')),'hex');
  IF fee_row.id IS NULL OR fee_row.payment_id<>payment_row.id OR fee_row.original_charge_receipt_id IS DISTINCT FROM receipt_row.id OR NEW.fee_operation_fingerprint IS DISTINCT FROM current_fingerprint
   OR NEW.request->>'applicationFeeRef' IS DISTINCT FROM fee_row.application_fee_ref OR NEW.request->>'providerChargeRef' IS DISTINCT FROM fee_row.provider_charge_ref
   OR NEW.request->>'amountMinor' IS DISTINCT FROM fee_row.amount_minor::text OR NEW.request->>'idempotencyKey' IS DISTINCT FROM fee_row.idempotency_key
   OR NEW.request->>'targetRetainedFeeMinor' IS DISTINCT FROM fee_row.target_retained_fee_minor::text
   OR NEW.request->>'observedOriginalFeeMinor' IS DISTINCT FROM fee_row.observed_original_fee_minor::text
   OR NEW.request->>'frozenBody' IS DISTINCT FROM ('amount='||fee_row.amount_minor::text||'&metadata%5Bfreeholder_fee_refund_id%5D='||fee_row.id::text) THEN
   RAISE EXCEPTION 'Keep the exact real fee operation, original fee/PI/account/body and current target' USING ERRCODE='23514';END IF;
  IF NEW.kind='post' THEN
   SELECT * INTO source_row FROM merchant_fee_refund_invocations WHERE payment_id=payment_row.id AND kind='source_inspect' AND request->>'readKind'='payment_source' ORDER BY ordinal DESC LIMIT 1;
   IF fee_row.status<>'reserved' OR EXISTS(SELECT 1 FROM merchant_fee_refund_invocations prior_post WHERE prior_post.fee_operation_id=fee_row.id AND prior_post.kind='post')
    OR source_row.kind IS DISTINCT FROM 'source_inspect' OR source_row.finish->'body'->>'outcome' IS DISTINCT FROM 'returned' OR source_row.stop IS NOT NULL
    OR NEW.request->>'sourceInvocationId' IS DISTINCT FROM source_row.id::text
    OR NEW.request->'expectedOriginalFeeMinor' IS DISTINCT FROM source_row.finish->'body'->'returnedResult'->'observedApplicationFeeMinor'
    OR NEW.request->'expectedFeeRefundedMinor' IS DISTINCT FROM source_row.finish->'body'->'returnedResult'->'observedFeeRefundedMinor'
    OR NOT freeholder_merchant_fee_source_ready(fee_row.id,NULL::uuid) THEN
    RAISE EXCEPTION 'A stop or later GET cannot grant another original fee POST' USING ERRCODE='23514';END IF;
  ELSIF NEW.kind='recover_get' AND(fee_row.status NOT IN('dispatching','unknown') OR NOT EXISTS(SELECT 1 FROM merchant_fee_refund_invocations prior_post WHERE prior_post.fee_operation_id=fee_row.id AND prior_post.kind='post')) THEN
   RAISE EXCEPTION 'Recover only the real original admitted fee request; never invent its creator' USING ERRCODE='23514';END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER merchant_fee_invocation_guard BEFORE INSERT OR UPDATE OR DELETE ON merchant_fee_refund_invocations FOR EACH ROW EXECUTE FUNCTION freeholder_merchant_fee_invocation_guard();
--> statement-breakpoint
CREATE FUNCTION freeholder_merchant_fee_source_ready(target_fee uuid,own_post uuid DEFAULT NULL) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE fee_row merchant_fee_refunds%ROWTYPE;payment_row payments%ROWTYPE;route_row merchant_agreement_payment_routes%ROWTYPE;
 source_read merchant_fee_refund_invocations%ROWTYPE;current_target bigint;actual_result jsonb;accepted_returns numeric;bank_row record;refund_atom jsonb;dispute_atom jsonb;initial_evidence jsonb;
BEGIN
 SELECT * INTO fee_row FROM merchant_fee_refunds WHERE id=target_fee;
 SELECT * INTO payment_row FROM payments WHERE id=fee_row.payment_id;
 SELECT * INTO route_row FROM merchant_agreement_payment_routes WHERE payment_id=payment_row.id;
 current_target:=freeholder_original_line_fee_target(payment_row.id);
 IF fee_row.id IS NULL OR payment_row.id IS NULL OR route_row.payment_id IS NULL OR current_target IS NULL OR current_target<>fee_row.target_retained_fee_minor
  OR EXISTS(SELECT 1 FROM merchant_fee_refund_invocations caller_row WHERE caller_row.payment_id=payment_row.id AND caller_row.finish IS NULL AND caller_row.stop IS NULL
   AND(caller_row.id IS DISTINCT FROM own_post OR caller_row.kind<>'post'))
  OR(own_post IS NOT NULL AND NOT EXISTS(SELECT 1 FROM merchant_fee_refund_invocations caller_row WHERE caller_row.id=own_post AND caller_row.fee_operation_id=fee_row.id AND caller_row.kind='post'
    AND caller_row.finish IS NULL AND caller_row.stop IS NULL AND caller_row.nonce_hash=encode(sha256(convert_to(coalesce(current_setting('freeholder.merchant_fee_invocation_nonce',true),''),'UTF8')),'hex'))) THEN RETURN false;END IF;
 SELECT * INTO source_read FROM merchant_fee_refund_invocations WHERE payment_id=payment_row.id AND kind='source_inspect' AND request->>'readKind'='payment_source' ORDER BY ordinal DESC LIMIT 1;
 IF source_read.id IS NULL OR source_read.finish IS NULL OR source_read.stop IS NOT NULL OR source_read.finish->'body'->>'outcome' IS DISTINCT FROM 'returned'
  OR source_read.original_charge_receipt_id IS DISTINCT FROM fee_row.original_charge_receipt_id
  OR(own_post IS NOT NULL AND NOT EXISTS(SELECT 1 FROM merchant_fee_refund_invocations own_row WHERE own_row.id=own_post AND own_row.request->>'sourceInvocationId'=source_read.id::text)) THEN RETURN false;END IF;
 SELECT * INTO bank_row FROM freeholder_controlled_receipt_bank_observation(
  (SELECT b.collection_id FROM controlled_cash_application_links l JOIN controlled_cash_application_batches b ON b.id=l.batch_id WHERE l.payment_id=payment_row.id),route_row.original_charge_receipt_id);
 IF bank_row.actual_inspection_id IS NULL OR bank_row.current_evidence->>'amountRefundedMinor' IS DISTINCT FROM payment_row.refunded_minor::text
  OR bank_row.current_evidence->>'paymentProviderRef' IS DISTINCT FROM payment_row.provider_ref OR bank_row.current_evidence->>'providerChargeRef' IS DISTINCT FROM fee_row.provider_charge_ref
  OR bank_row.current_evidence->>'providerPlatformAccountId' IS DISTINCT FROM fee_row.provider_platform_account_id
  OR bank_row.current_evidence->>'chargeAccountId' IS DISTINCT FROM route_row.charge_account_id OR bank_row.current_evidence->>'currency' IS DISTINCT FROM fee_row.currency
  OR bank_row.current_evidence->>'refundsComplete' IS DISTINCT FROM 'true' OR bank_row.current_evidence->>'disputesComplete' IS DISTINCT FROM 'true'
  OR jsonb_typeof(bank_row.current_evidence->'refunds') IS DISTINCT FROM 'array' OR jsonb_typeof(bank_row.current_evidence->'disputes') IS DISTINCT FROM 'array'
  OR jsonb_array_length(bank_row.current_evidence->'refunds')>1000 OR jsonb_array_length(bank_row.current_evidence->'disputes')>1000 THEN RETURN false;END IF;
 SELECT original_bank.evidence INTO initial_evidence FROM controlled_cash_application_links original_link JOIN controlled_cash_application_receipts original_proof ON original_proof.id=original_link.receipt_proof_id
  JOIN merchant_cash_return_observations original_bank ON original_bank.id=original_proof.bank_observation_id WHERE original_link.payment_id=payment_row.id;
 IF initial_evidence IS NULL OR bank_row.current_evidence->>'transferFieldObserved' IS DISTINCT FROM 'true' THEN RETURN false;END IF;
 IF route_row.collection_kind='destination' THEN
  IF initial_evidence->'transfer'->>'providerRef' IS NULL OR bank_row.current_evidence->'transfer'->>'providerRef' IS DISTINCT FROM initial_evidence->'transfer'->>'providerRef'
   OR bank_row.current_evidence->'transfer'->>'sourceChargeRef' IS DISTINCT FROM fee_row.provider_charge_ref
   OR bank_row.current_evidence->'transfer'->>'destinationAccountId' IS DISTINCT FROM route_row.recipient_account_id
   OR bank_row.current_evidence->'transfer'->>'amountMinor' IS DISTINCT FROM initial_evidence->'transfer'->>'amountMinor'
   OR bank_row.current_evidence->'transfer'->>'currency' IS DISTINCT FROM fee_row.currency THEN RETURN false;END IF;
 ELSIF bank_row.current_evidence->'transfer' IS DISTINCT FROM 'null'::jsonb THEN RETURN false;END IF;
 FOR refund_atom IN SELECT value FROM jsonb_array_elements(bank_row.current_evidence->'refunds') LOOP
  IF refund_atom->>'paymentProviderRef' IS DISTINCT FROM payment_row.provider_ref OR refund_atom->>'chargeRef' IS DISTINCT FROM fee_row.provider_charge_ref
   OR refund_atom->>'currency' IS DISTINCT FROM fee_row.currency OR coalesce(refund_atom->>'status','') NOT IN('succeeded','failed','canceled') THEN RETURN false;END IF;
  IF refund_atom->>'status'='succeeded' AND NOT EXISTS(SELECT 1 FROM refunds actual_refund JOIN merchant_refund_requests actual_request ON actual_request.refund_id=actual_refund.id
   WHERE actual_refund.payment_id=payment_row.id AND actual_refund.status='succeeded' AND actual_refund.provider_ref=refund_atom->>'providerRef'
    AND actual_refund.amount_minor::text=refund_atom->>'amountMinor' AND actual_refund.currency=refund_atom->>'currency'
    AND freeholder_original_refund_resolved(actual_request.id,'succeeded',actual_refund.provider_ref)) THEN RETURN false;END IF;
 END LOOP;
 FOR dispute_atom IN SELECT value FROM jsonb_array_elements(bank_row.current_evidence->'disputes') LOOP
  IF dispute_atom->>'chargeRef' IS DISTINCT FROM fee_row.provider_charge_ref OR coalesce(dispute_atom->>'status','') NOT IN('won','warning_closed') THEN RETURN false;END IF;
 END LOOP;
 actual_result:=source_read.finish->'body'->'returnedResult';
 SELECT coalesce(sum(prior_fee.amount_minor),0) INTO accepted_returns FROM merchant_fee_refunds prior_fee WHERE prior_fee.payment_id=payment_row.id AND prior_fee.application_fee_ref=fee_row.application_fee_ref AND prior_fee.status='accepted';
 IF actual_result->>'providerApiVersion' IS DISTINCT FROM source_read.request->>'providerApiVersion' OR actual_result->>'status' IS DISTINCT FROM 'succeeded' OR actual_result->>'providerRef' IS DISTINCT FROM payment_row.provider_ref
  OR actual_result->>'providerChargeRef' IS DISTINCT FROM fee_row.provider_charge_ref OR actual_result->>'providerPlatformAccountId' IS DISTINCT FROM fee_row.provider_platform_account_id
  OR actual_result->>'providerAccountId' IS DISTINCT FROM route_row.charge_account_id
  OR actual_result->>'destinationAccountId' IS DISTINCT FROM (CASE WHEN route_row.collection_kind='destination' THEN route_row.recipient_account_id ELSE NULL END)
  OR actual_result->>'settlementMerchantAccountId' IS DISTINCT FROM route_row.settlement_merchant_account_id
  OR actual_result->>'amountMinor' IS DISTINCT FROM payment_row.amount_minor::text OR actual_result->>'currency' IS DISTINCT FROM fee_row.currency
  OR actual_result->>'customerChargeVerified' IS DISTINCT FROM 'true' OR actual_result->>'merchantRouteVerified' IS DISTINCT FROM 'true'
  OR actual_result->>'applicationFeeRef' IS DISTINCT FROM fee_row.application_fee_ref OR actual_result->>'applicationFeeCurrency' IS DISTINCT FROM fee_row.currency
  OR actual_result->>'observedApplicationFeeMinor' IS DISTINCT FROM fee_row.observed_original_fee_minor::text
  OR actual_result->>'observedFeeRefundedMinor' IS DISTINCT FROM accepted_returns::text
  OR bank_row.current_evidence->'fee'->>'providerRef' IS DISTINCT FROM fee_row.application_fee_ref
  OR bank_row.current_evidence->'fee'->>'amountMinor' IS DISTINCT FROM fee_row.observed_original_fee_minor::text
  OR bank_row.current_evidence->'fee'->>'refundedMinor' IS DISTINCT FROM accepted_returns::text
  OR bank_row.current_evidence->'fee'->>'currency' IS DISTINCT FROM fee_row.currency
  OR bank_row.current_evidence->'fee'->>'accountId' IS DISTINCT FROM route_row.recipient_account_id
  OR bank_row.current_evidence->'fee'->>'originatingChargeRef' IS DISTINCT FROM fee_row.provider_charge_ref
  OR NOT EXISTS(SELECT 1 FROM merchant_payment_observations original_read WHERE original_read.payment_id=payment_row.id AND original_read.status='succeeded'
   AND original_read.provider_ref=actual_result->>'providerRef' AND original_read.provider_charge_ref=actual_result->>'providerChargeRef'
   AND original_read.provider_platform_account_id=actual_result->>'providerPlatformAccountId' AND original_read.charge_account_id IS NOT DISTINCT FROM actual_result->>'providerAccountId'
   AND original_read.recipient_account_id=coalesce(actual_result->>'destinationAccountId',actual_result->>'providerAccountId')
   AND original_read.settlement_merchant_account_id=coalesce(actual_result->>'settlementMerchantAccountId',actual_result->>'providerAccountId')
   AND original_read.provider_api_version=actual_result->>'providerApiVersion' AND original_read.customer_charge_verified AND original_read.route_verified
   AND original_read.amount_minor::text=actual_result->>'amountMinor' AND original_read.currency=actual_result->>'currency'
   AND original_read.application_fee_ref=actual_result->>'applicationFeeRef' AND original_read.application_fee_currency=actual_result->>'applicationFeeCurrency'
   AND original_read.observed_application_fee_minor::text=actual_result->>'observedApplicationFeeMinor' AND original_read.observed_fee_refunded_minor::text=actual_result->>'observedFeeRefundedMinor')
  OR EXISTS(SELECT 1 FROM merchant_fee_refund_invocations raw_source WHERE raw_source.payment_id=payment_row.id AND raw_source.kind='source_inspect' AND raw_source.request->>'readKind'='fee_preflight' AND raw_source.first_result IS NOT NULL AND(
   raw_source.first_result->'body'->'result'->>'source' IS DISTINCT FROM 'fee_preflight'
   OR raw_source.first_result->'body'->'result'->>'applicationFeeRef' IS DISTINCT FROM fee_row.application_fee_ref
   OR raw_source.first_result->'body'->'result'->>'accountId' IS DISTINCT FROM route_row.recipient_account_id
   OR (CASE WHEN route_row.collection_kind='destination' THEN raw_source.first_result->'body'->'result'->>'originatingChargeRef' ELSE raw_source.first_result->'body'->'result'->>'chargeRef' END) IS DISTINCT FROM fee_row.provider_charge_ref
   OR upper(raw_source.first_result->'body'->'result'->>'currency') IS DISTINCT FROM fee_row.currency
   OR raw_source.first_result->'body'->'result'->'amountMinor' IS DISTINCT FROM to_jsonb(route_row.application_fee_minor)
   OR(CASE WHEN freeholder_controlled_bank_minor(raw_source.first_result->'body'->'result'->'returnedMinor') THEN (raw_source.first_result->'body'->'result'->>'returnedMinor')::numeric>accepted_returns ELSE true END)))
  OR fee_row.observed_original_fee_minor-current_target-accepted_returns<>fee_row.amount_minor
  OR EXISTS(SELECT 1 FROM merchant_fee_observations ack JOIN merchant_fee_refunds other_fee ON other_fee.id=ack.operation_id WHERE other_fee.payment_id=payment_row.id AND(other_fee.status<>'accepted' OR NOT ack.binding_verified
   OR ack.provider_ref IS DISTINCT FROM other_fee.provider_ref OR ack.application_fee_ref IS DISTINCT FROM other_fee.application_fee_ref OR ack.amount_minor<>other_fee.amount_minor OR ack.currency<>other_fee.currency))
  OR EXISTS(SELECT 1 FROM merchant_payment_observations raw_fee WHERE raw_fee.payment_id=payment_row.id AND raw_fee.status='succeeded' AND(
   (raw_fee.observed_fee_refunded_minor IS NOT NULL AND raw_fee.observed_fee_refunded_minor>accepted_returns)
   OR(raw_fee.observed_application_fee_minor IS NOT NULL AND raw_fee.observed_application_fee_minor<>route_row.application_fee_minor)
   OR(raw_fee.application_fee_ref IS NOT NULL AND raw_fee.application_fee_ref IS DISTINCT FROM fee_row.application_fee_ref))) THEN RETURN false;END IF;
 RETURN true;
END $$;

--> statement-breakpoint
CREATE FUNCTION freeholder_merchant_fee_post_ready(target_fee uuid) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE actual_call merchant_fee_refund_invocations%ROWTYPE;
BEGIN
 SELECT * INTO actual_call FROM merchant_fee_refund_invocations WHERE fee_operation_id=target_fee AND kind='post';
 RETURN actual_call.id IS NOT NULL AND actual_call.finish IS NULL AND actual_call.stop IS NULL
  AND actual_call.nonce_hash=encode(sha256(convert_to(coalesce(current_setting('freeholder.merchant_fee_invocation_nonce',true),''),'UTF8')),'hex')
  AND freeholder_merchant_fee_source_ready(target_fee,actual_call.id);
END $$;

--> statement-breakpoint
CREATE FUNCTION freeholder_merchant_fee_preflight_owned(actual_parent uuid) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE parent_call merchant_fee_refund_invocations%ROWTYPE;child_call merchant_fee_refund_invocations%ROWTYPE;fee_row merchant_fee_refunds%ROWTYPE;route_row merchant_agreement_payment_routes%ROWTYPE;observed jsonb;
BEGIN
 SELECT * INTO parent_call FROM merchant_fee_refund_invocations WHERE id=actual_parent AND kind IN('post','recover_get');
 IF parent_call.id IS NULL OR parent_call.fee_operation_id IS NULL THEN RETURN false;END IF;
 SELECT * INTO fee_row FROM merchant_fee_refunds WHERE id=parent_call.fee_operation_id;
 SELECT * INTO route_row FROM merchant_agreement_payment_routes WHERE payment_id=parent_call.payment_id;
 SELECT * INTO child_call FROM merchant_fee_refund_invocations WHERE kind='source_inspect' AND request->>'readKind'='fee_preflight' AND request->>'parentFeeInvocationId'=parent_call.id::text;
 IF child_call.id IS NULL OR child_call.payment_id<>parent_call.payment_id OR child_call.original_charge_receipt_id<>parent_call.original_charge_receipt_id OR child_call.namespace_key<>parent_call.namespace_key
  OR child_call.ordinal<=parent_call.ordinal OR child_call.nonce_hash=parent_call.nonce_hash OR child_call.caller->>'id' IS DISTINCT FROM parent_call.caller->>'id'
  OR child_call.request->>'parentAdmissionDigest' IS DISTINCT FROM parent_call.digest
  OR child_call.request->>'parentAdmissionFingerprint' IS DISTINCT FROM encode(sha256(convert_to((to_jsonb(parent_call)||jsonb_build_object('first_result',null,'finish',null,'stop',null))::text,'UTF8')),'hex')
  OR child_call.stop IS NOT NULL OR child_call.finish->'body'->>'outcome' IS DISTINCT FROM 'returned' OR child_call.first_result IS NULL
  OR child_call.first_result->'body'->'result' IS DISTINCT FROM child_call.finish->'body'->'returnedResult' THEN RETURN false;END IF;
 observed:=child_call.first_result->'body'->'result';
 RETURN observed->>'source'='fee_preflight' AND observed->>'applicationFeeRef'=fee_row.application_fee_ref AND observed->>'accountId'=route_row.recipient_account_id
  AND (CASE WHEN route_row.collection_kind='destination' THEN observed->>'originatingChargeRef' ELSE observed->>'chargeRef' END)=fee_row.provider_charge_ref
  AND upper(observed->>'currency')=fee_row.currency
  AND observed->'amountMinor'=to_jsonb(fee_row.observed_original_fee_minor)
  AND(parent_call.kind='recover_get' OR(freeholder_controlled_bank_minor(parent_call.request->'expectedOriginalFeeMinor',true) AND freeholder_controlled_bank_minor(parent_call.request->'expectedFeeRefundedMinor')
   AND observed->'amountMinor'=parent_call.request->'expectedOriginalFeeMinor' AND observed->'returnedMinor'=parent_call.request->'expectedFeeRefundedMinor'));
END $$;
--> statement-breakpoint
CREATE FUNCTION freeholder_merchant_fee_preflight_ready(actual_parent uuid) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE parent_call merchant_fee_refund_invocations%ROWTYPE;
BEGIN
 SELECT * INTO parent_call FROM merchant_fee_refund_invocations WHERE id=actual_parent AND kind='post';
 RETURN parent_call.id IS NOT NULL AND parent_call.first_result IS NULL AND parent_call.finish IS NULL AND parent_call.stop IS NULL
  AND parent_call.nonce_hash=encode(sha256(convert_to(coalesce(current_setting('freeholder.merchant_fee_invocation_nonce',true),''),'UTF8')),'hex')
  AND freeholder_merchant_fee_preflight_owned(parent_call.id) AND freeholder_merchant_fee_source_ready(parent_call.fee_operation_id,parent_call.id);
END $$;
--> statement-breakpoint
CREATE FUNCTION freeholder_merchant_fee_result_owned(target_fee uuid,actual_ref text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM merchant_fee_refund_invocations invocation JOIN merchant_fee_refunds fee_row ON fee_row.id=invocation.fee_operation_id
  WHERE fee_row.id=target_fee AND invocation.kind IN('post','recover_get')
   AND freeholder_merchant_fee_preflight_owned(invocation.id) AND invocation.finish IS NOT NULL AND invocation.stop IS NULL
   AND invocation.finish->'body'->>'outcome'='returned' AND(invocation.kind<>'post' OR invocation.finish->'body'->'postDispatchReleased'='true'::jsonb) AND invocation.finish->'body'->'returnedResult'->>'providerRef'=actual_ref
   AND invocation.finish->'body'->'returnedResult'->>'applicationFeeRef'=fee_row.application_fee_ref
   AND invocation.finish->'body'->'returnedResult'->>'amountMinor'=fee_row.amount_minor::text
   AND invocation.finish->'body'->'returnedResult'->>'currency'=fee_row.currency
   AND invocation.fee_operation_fingerprint=encode(sha256(convert_to((to_jsonb(fee_row)-array['status','provider_ref','dispatched_at','accepted_at','updated_at'])::text,'UTF8')),'hex'))
$$;

--> statement-breakpoint
-- No old fee row is backfilled. A new atomic reservation and its unique real
-- physical POST admission commit together, after an actually returned source
-- inspection; SDK I/O occurs only AFTER that transaction commits.
CREATE FUNCTION freeholder_merchant_fee_birth_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE fee_row merchant_fee_refunds%ROWTYPE;post_row merchant_fee_refund_invocations%ROWTYPE;source_row merchant_fee_refund_invocations%ROWTYPE;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM controlled_cash_application_links l JOIN controlled_cash_application_batches b ON b.id=l.batch_id JOIN payments p ON p.id=l.payment_id JOIN invoices i ON i.id=p.invoice_id
  WHERE l.payment_id=NEW.payment_id AND EXISTS(SELECT 1 FROM controlled_cash_application_batches atomic_epoch WHERE atomic_epoch.invoice_id=p.invoice_id AND atomic_epoch.protocol='controlled_cash_atomic.v1') AND i.refunded_minor>0) THEN RETURN NULL;END IF;
 SELECT * INTO fee_row FROM merchant_fee_refunds WHERE id=NEW.id;
 SELECT * INTO post_row FROM merchant_fee_refund_invocations WHERE fee_operation_id=fee_row.id AND kind='post';
 IF post_row.id IS NULL OR NOT EXISTS(SELECT 1 FROM merchant_fee_refunds born_fee WHERE born_fee.id=fee_row.id AND born_fee.xmin::text=txid_current()::text)
  OR NOT EXISTS(SELECT 1 FROM merchant_fee_refund_invocations born_post WHERE born_post.id=post_row.id AND born_post.xmin::text=txid_current()::text)
  OR post_row.payment_id<>fee_row.payment_id OR post_row.original_charge_receipt_id IS DISTINCT FROM fee_row.original_charge_receipt_id
  OR post_row.finish IS NOT NULL OR post_row.stop IS NOT NULL OR fee_row.status<>'dispatching'
  OR coalesce(post_row.request->>'sourceInvocationId','') !~ '^[0-9a-f-]{36}$' THEN
  RAISE EXCEPTION 'Commit the real newborn fee reservation and exact unique POST caller together; never invent an old process birth' USING ERRCODE='23514';END IF;
 SELECT * INTO source_row FROM merchant_fee_refund_invocations WHERE id=(post_row.request->>'sourceInvocationId')::uuid;
 IF source_row.id IS NULL OR source_row.payment_id<>post_row.payment_id OR source_row.original_charge_receipt_id<>post_row.original_charge_receipt_id OR source_row.namespace_key<>post_row.namespace_key
  OR source_row.kind<>'source_inspect' OR source_row.request->>'readKind' IS DISTINCT FROM 'payment_source' OR source_row.fee_operation_id IS NOT NULL OR source_row.ordinal>=post_row.ordinal OR source_row.stop IS NOT NULL
  OR source_row.finish->'body'->>'outcome' IS DISTINCT FROM 'returned' OR NOT freeholder_merchant_fee_post_ready(fee_row.id) THEN
  RAISE EXCEPTION 'Only the exact genuine completed original source read can admit new fee money' USING ERRCODE='23514';END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER merchant_fee_birth_guard AFTER INSERT ON merchant_fee_refunds DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION freeholder_merchant_fee_birth_guard();

--> statement-breakpoint
-- Compose the REAL current route/bank capability; never replace its newest
-- scalar validator/bank pins or reinterpret a source probe as paid authority.
CREATE FUNCTION freeholder_merchant_fee_invocations_ready() RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT coalesce(
  EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('freeholder_controlled_atomic_refund_targets(uuid)') AND p.provolatile='s' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='95d51ff17ef45231f6a8e02e7bbfa439d7e44d4df19daf3f01763127c4a37328')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('freeholder_controlled_atomic_refund_fee_state(uuid)') AND p.provolatile='s' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='892452a4eef08256f57f2d1d0c7bb492be539a87e34dd932022269c967cfd750')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('freeholder_original_line_fee_target_before_atomic_refund(uuid)') AND p.provolatile='s' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='af210d88b54994b428c1753d77b0a08433c1bbf99b981cb6e8a667fbf3eeecf2')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('freeholder_original_line_fee_target(uuid)') AND p.provolatile='s' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='483772f438020df8859f9f8902d9c7446b371a206faf8321b2a2cbdc0ce45eeb')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('freeholder_agreement_fee_current(uuid)') AND p.provolatile='s' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='20a4424932e49d6c5b2dd57357f04850d2a5d183360a3f3499c4dc57b0c5752e')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('guard_merchant_fee_refund()') AND p.provolatile='v' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='4d4d92c8fd172c9a46418a7ef7315118e09251324e5ffaa40b89ac4be1ff9fb9')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('freeholder_merchant_fee_require_prefix(uuid)') AND p.provolatile='s' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='0f301ca4e56a7c2437bc71e4ada88363192a9a6d7c622c703b030a5a8ca5f93c')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('freeholder_merchant_fee_invocation_guard()') AND p.provolatile='v' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='f3b31e8db5cf6858a21fa0b30cf2c9beb7b6497b33ebcbaf6fdd61583c99b54d')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('freeholder_merchant_fee_source_ready(uuid,uuid)') AND p.provolatile='s' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='87eb65b5cfb2bc7ef5db85e79d4c3e7d4b6ca9ea1eac9fc6a0d243316e6a7b56')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('freeholder_merchant_fee_post_ready(uuid)') AND p.provolatile='s' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='2f5dc99c4ca929929a9467ecbbb221f2787b7c91be430fed6f642c77cb28f6c1')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('freeholder_merchant_fee_preflight_owned(uuid)') AND p.provolatile='s' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='fc0bc6c1e344d085337315b4abf966ab2d03663577ca8e98253bc63895233abd')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('freeholder_merchant_fee_preflight_ready(uuid)') AND p.provolatile='s' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='bde7a25cccf486aa012ba744415cb0015b8266e34aa060955e36ff534166461f')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('freeholder_merchant_fee_result_owned(uuid,text)') AND p.provolatile='s' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='95fbbd9f094622245740e4a437e31a79c3a8934a5fe215972ee3c72260149699')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('freeholder_merchant_fee_birth_guard()') AND p.provolatile='v' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='32d551973c0a224908af2ea21bce08a7ad961c7a1bfb5020788d35fa632ee54f')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('freeholder_guard_original_cash_old_fee_dispatch()') AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='360ceca348dd283873a08ab37e9b4a56e178946900c35aa1fb7b5738256423b2')
  AND freeholder_controlled_subscription_route_ready()
  AND EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid='merchant_fee_refund_invocations'::regclass AND t.tgname='merchant_fee_invocation_guard' AND t.tgfoid=to_regprocedure('freeholder_merchant_fee_invocation_guard()') AND t.tgenabled IN('O','A') AND t.tgtype=31 AND NOT t.tgisinternal)
  AND EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid='merchant_fee_refunds'::regclass AND t.tgname='merchant_fee_birth_guard' AND t.tgfoid=to_regprocedure('freeholder_merchant_fee_birth_guard()') AND t.tgenabled IN('O','A') AND t.tgtype=5 AND t.tgdeferrable AND t.tginitdeferred AND NOT t.tgisinternal)
  AND EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid='merchant_fee_refunds'::regclass AND t.tgname='merchant_fee_refund_guard' AND t.tgfoid=to_regprocedure('guard_merchant_fee_refund()') AND t.tgenabled IN('O','A') AND t.tgtype=31 AND NOT t.tgisinternal)
  AND EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid='merchant_fee_refunds'::regclass AND t.tgname='original_cash_old_fee_dispatch' AND t.tgfoid=to_regprocedure('freeholder_guard_original_cash_old_fee_dispatch()') AND t.tgenabled IN('O','A') AND t.tgtype=23 AND NOT t.tgisinternal)
  AND (SELECT count(*) FROM pg_constraint c WHERE c.conrelid='merchant_fee_refund_invocations'::regclass AND c.convalidated AND c.conname IN('merchant_fee_refund_invocations_pkey','merchant_fee_invocations_operation_fk','merchant_fee_invocations_payment_fk','merchant_fee_invocations_receipt_fk','merchant_fee_invocations_kind','merchant_fee_invocations_owner','merchant_fee_invocations_source','merchant_fee_invocations_header','merchant_fee_invocations_proofs'))=9
  AND EXISTS(SELECT 1 FROM pg_index i JOIN pg_class idx ON idx.oid=i.indexrelid WHERE i.indrelid='merchant_fee_refund_invocations'::regclass AND idx.relname='merchant_fee_invocations_ordinal' AND i.indisvalid AND i.indisready AND i.indisunique=true AND i.indkey::text='2 4 6' AND i.indexprs IS NULL AND i.indpred IS NULL)
  AND EXISTS(SELECT 1 FROM pg_index i JOIN pg_class idx ON idx.oid=i.indexrelid WHERE i.indrelid='merchant_fee_refund_invocations'::regclass AND idx.relname='merchant_fee_invocations_post' AND i.indisvalid AND i.indisready AND i.indisunique=true AND i.indkey::text='5' AND i.indexprs IS NULL AND pg_get_expr(i.indpred,i.indrelid)='(kind = ''post''::text)')
  AND EXISTS(SELECT 1 FROM pg_index i JOIN pg_class idx ON idx.oid=i.indexrelid WHERE i.indrelid='merchant_fee_refund_invocations'::regclass AND idx.relname='merchant_fee_invocations_operation' AND i.indisvalid AND i.indisready AND i.indisunique=false AND i.indkey::text='5 17' AND i.indexprs IS NULL AND i.indpred IS NULL)
  AND EXISTS(SELECT 1 FROM pg_index i JOIN pg_class idx ON idx.oid=i.indexrelid WHERE i.indrelid='merchant_fee_refund_invocations'::regclass AND idx.relname='merchant_fee_invocations_receipt' AND i.indisvalid AND i.indisready AND i.indisunique=false AND i.indkey::text='3 6' AND i.indexprs IS NULL AND i.indpred IS NULL)
  AND EXISTS(SELECT 1 FROM pg_index i JOIN pg_class idx ON idx.oid=i.indexrelid WHERE i.indrelid='merchant_fee_refund_invocations'::regclass AND idx.relname='merchant_fee_invocations_preflight' AND i.indisvalid AND i.indisready AND i.indisunique=true AND i.indkey::text='0' AND pg_get_expr(i.indexprs,i.indrelid)='(request ->> ''parentFeeInvocationId''::text)' AND pg_get_expr(i.indpred,i.indrelid)='((kind = ''source_inspect''::text) AND ((request ->> ''readKind''::text) = ''fee_preflight''::text))'),false);
$$;
