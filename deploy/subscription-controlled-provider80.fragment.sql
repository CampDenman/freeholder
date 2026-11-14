-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- OWNED UNAPPLIED suffix AFTER09dd6e8d1ad6a03c84c5c000d1bab7bc9fc329b958a1c3afdf9e110120e5e170.
-- SOURCE ONLY. Root owns assembly/new hash/NEW normal database qualification.
-- Separate transport lineage: no legacy receipt.operation_id, phase DTO or epoch is changed.
CREATE TABLE subscription_controlled_resources (
 id uuid PRIMARY KEY,subscription_id uuid NOT NULL REFERENCES subscription_merchant_scopes(subscription_id) ON DELETE RESTRICT,
 terms_id uuid NOT NULL REFERENCES subscription_commercial_terms(id) ON DELETE RESTRICT,generation integer NOT NULL,
 original_scope jsonb NOT NULL,original_source_revision text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT subscription_controlled_resources_original CHECK(generation>0 AND original_source_revision ~ '^[a-f0-9]{64}$' AND jsonb_typeof(original_scope)='object')
);
--> statement-breakpoint
CREATE UNIQUE INDEX subscription_controlled_resources_generation ON subscription_controlled_resources(subscription_id,generation);
--> statement-breakpoint
CREATE INDEX subscription_controlled_resources_terms ON subscription_controlled_resources(terms_id);
--> statement-breakpoint
CREATE TABLE subscription_controlled_operations (
 id uuid PRIMARY KEY,resource_id uuid NOT NULL REFERENCES subscription_controlled_resources(id) ON DELETE RESTRICT,kind text NOT NULL,ordinal integer NOT NULL,
 original_request jsonb NOT NULL,request_digest text NOT NULL,idempotency_key text NOT NULL,previous_evidence_revision text NOT NULL,accepted_quote_digest text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT subscription_controlled_operations_original CHECK(ordinal>0 AND request_digest ~ '^[a-f0-9]{64}$' AND previous_evidence_revision ~ '^[a-f0-9]{64}$' AND accepted_quote_digest ~ '^[a-f0-9]{64}$' AND jsonb_typeof(original_request)='object'),
 CONSTRAINT subscription_controlled_operations_kind CHECK(kind IN('create_product','read_product','discover_bootstrap','bootstrap','pause_drafts','read_bootstrap','create_schedule','read_calendar','preview_proration','update_calendar','read_invoice','list_invoices','set_invoice_fee','finalize_invoice','pay_invoice','cancel_calendar','void_invoice','delete_draft'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX subscription_controlled_operations_ordinal ON subscription_controlled_operations(resource_id,ordinal);
--> statement-breakpoint
CREATE UNIQUE INDEX subscription_controlled_operations_key ON subscription_controlled_operations(idempotency_key);
--> statement-breakpoint
CREATE TABLE subscription_controlled_calls (
 id uuid PRIMARY KEY,operation_id uuid NOT NULL REFERENCES subscription_controlled_operations(id) ON DELETE RESTRICT,admission jsonb NOT NULL,admission_digest text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT subscription_controlled_calls_original CHECK(admission_digest ~ '^[a-f0-9]{64}$' AND jsonb_typeof(admission)='object')
);
--> statement-breakpoint
CREATE UNIQUE INDEX subscription_controlled_calls_operation ON subscription_controlled_calls(operation_id);
--> statement-breakpoint
CREATE TABLE subscription_controlled_facts (
 id uuid PRIMARY KEY,call_id uuid NOT NULL REFERENCES subscription_controlled_calls(id) ON DELETE RESTRICT,ordinal integer NOT NULL,actual jsonb NOT NULL,actual_digest text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT subscription_controlled_facts_original CHECK(ordinal>0 AND actual_digest ~ '^[a-f0-9]{64}$' AND jsonb_typeof(actual)='object')
);
--> statement-breakpoint
CREATE UNIQUE INDEX subscription_controlled_facts_ordinal ON subscription_controlled_facts(call_id,ordinal);
--> statement-breakpoint
CREATE TABLE subscription_controlled_finishes (
 call_id uuid PRIMARY KEY REFERENCES subscription_controlled_calls(id) ON DELETE RESTRICT,proof jsonb NOT NULL,proof_digest text NOT NULL,actual_result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT subscription_controlled_finishes_original CHECK(proof_digest ~ '^[a-f0-9]{64}$' AND jsonb_typeof(proof)='object' AND jsonb_typeof(actual_result)='object')
);
--> statement-breakpoint
CREATE TABLE subscription_controlled_stops (
 call_id uuid PRIMARY KEY REFERENCES subscription_controlled_calls(id) ON DELETE RESTRICT,proof jsonb NOT NULL,proof_digest text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT subscription_controlled_stops_original CHECK(proof_digest ~ '^[a-f0-9]{64}$' AND jsonb_typeof(proof)='object')
);
--> statement-breakpoint
CREATE TABLE subscription_controlled_verifications (
 operation_id uuid PRIMARY KEY REFERENCES subscription_controlled_operations(id) ON DELETE RESTRICT,call_id uuid NOT NULL REFERENCES subscription_controlled_calls(id) ON DELETE RESTRICT,
 actual_result jsonb NOT NULL,actual_result_digest text NOT NULL,evidence_revision text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT subscription_controlled_verifications_original CHECK(actual_result_digest ~ '^[a-f0-9]{64}$' AND evidence_revision ~ '^[a-f0-9]{64}$' AND jsonb_typeof(actual_result)='object')
);
--> statement-breakpoint
CREATE UNIQUE INDEX subscription_controlled_verifications_call ON subscription_controlled_verifications(call_id);
--> statement-breakpoint
CREATE TABLE subscription_controlled_charge_origins (
 receipt_id uuid PRIMARY KEY REFERENCES subscription_provider_charge_receipts(id) ON DELETE RESTRICT,resource_id uuid NOT NULL REFERENCES subscription_controlled_resources(id) ON DELETE RESTRICT,
 operation_id uuid NOT NULL REFERENCES subscription_controlled_operations(id) ON DELETE RESTRICT,call_id uuid NOT NULL REFERENCES subscription_controlled_calls(id) ON DELETE RESTRICT,
 fact_id uuid NOT NULL REFERENCES subscription_controlled_facts(id) ON DELETE RESTRICT,original_evidence_digest text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT subscription_controlled_charge_origins_original CHECK(original_evidence_digest ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE INDEX subscription_controlled_charge_origins_resource ON subscription_controlled_charge_origins(resource_id);
--> statement-breakpoint
CREATE INDEX subscription_controlled_charge_origins_operation ON subscription_controlled_charge_origins(operation_id);
--> statement-breakpoint
CREATE INDEX subscription_controlled_charge_origins_fact ON subscription_controlled_charge_origins(fact_id);
--> statement-breakpoint
CREATE TABLE subscription_controlled_closures (
 resource_id uuid PRIMARY KEY REFERENCES subscription_controlled_resources(id) ON DELETE RESTRICT,kind text NOT NULL,original_evidence_revision text NOT NULL,proof jsonb NOT NULL,proof_digest text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT subscription_controlled_closures_original CHECK(kind='zero_transport' AND original_evidence_revision ~ '^[a-f0-9]{64}$' AND proof_digest ~ '^[a-f0-9]{64}$' AND jsonb_typeof(proof)='object')
);
--> statement-breakpoint
CREATE FUNCTION freeholder_controlled_ref(value jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE jsonb_typeof(value) WHEN 'string' THEN value#>>'{}' WHEN 'object' THEN value->>'id' ELSE NULL END
$$;
--> statement-breakpoint
CREATE FUNCTION freeholder_controlled_callers_closed(target uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT NOT EXISTS(SELECT 1 FROM subscription_controlled_operations o JOIN subscription_controlled_calls c ON c.operation_id=o.id
  LEFT JOIN subscription_controlled_finishes f ON f.call_id=c.id LEFT JOIN subscription_controlled_stops s ON s.call_id=c.id
  WHERE o.resource_id=target AND f.call_id IS NULL AND s.call_id IS NULL)
$$;
--> statement-breakpoint
-- Only the source paths actually implemented by this checkpoint can admit a
-- caller. Positive collection kinds remain closed until their own exact quote,
-- canonical target/credit/tax/fee and current parent cash guards are implemented.
CREATE FUNCTION freeholder_controlled_operation_admissible(target uuid) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE o subscription_controlled_operations%ROWTYPE;r subscription_controlled_resources%ROWTYPE;bootstrap subscription_controlled_operations%ROWTYPE;
 payload jsonb;
BEGIN
 SELECT * INTO o FROM subscription_controlled_operations WHERE id=target;
 SELECT * INTO r FROM subscription_controlled_resources WHERE id=o.resource_id;payload=o.original_request->'payload';
 IF o.id IS NULL OR r.id IS NULL OR EXISTS(SELECT 1 FROM subscription_controlled_closures WHERE resource_id=r.id)
  OR EXISTS(SELECT 1 FROM subscription_controlled_operations WHERE resource_id=r.id AND ordinal>o.ordinal)
  OR EXISTS(SELECT 1 FROM subscription_controlled_calls WHERE operation_id=o.id)
  OR NOT freeholder_controlled_callers_closed(r.id) THEN RETURN false;END IF;
 IF o.kind='bootstrap' THEN
  RETURN o.ordinal=1 AND payload='{}'::jsonb AND NOT EXISTS(SELECT 1 FROM subscription_controlled_operations WHERE resource_id=r.id AND kind='bootstrap' AND id<>o.id)
   AND coalesce(o.original_request->>'parentFinancialRevision' ~ '^[a-f0-9]{64}$',false)
   AND EXISTS(SELECT 1 FROM subscriptions p JOIN module_settings m ON m.module='subscriptions' AND m.enabled WHERE p.id=r.subscription_id AND p.status IN('active','trialing') AND p.cancelled_at IS NULL AND NOT p.cancel_at_period_end)
   AND freeholder_subscription_resumption_callers_closed(r.subscription_id);
 END IF;
 SELECT * INTO bootstrap FROM subscription_controlled_operations WHERE resource_id=r.id AND kind='bootstrap';
 IF bootstrap.id IS NULL THEN RETURN false;END IF;
 IF o.kind='create_product' THEN
  RETURN payload->>'component'='merchant_declared_tax_collection' AND length(payload->>'name') BETWEEN 1 AND 500
   AND coalesce(o.original_request->>'parentFinancialRevision' ~ '^[a-f0-9]{64}$',false)
   AND NOT EXISTS(SELECT 1 FROM subscription_controlled_operations WHERE resource_id=r.id AND kind='create_product' AND id<>o.id)
   AND EXISTS(SELECT 1 FROM subscription_controlled_operations prior JOIN subscription_controlled_verifications v ON v.operation_id=prior.id
    WHERE prior.resource_id=r.id AND prior.kind='read_bootstrap' AND v.actual_result->>'completeZeroRecurringItem'='true' AND v.actual_result->>'collectionPausedAsDraft'='true');
 END IF;
 IF payload->>'bootstrapOperationId' IS DISTINCT FROM bootstrap.id::text OR payload->>'bootstrapRequestDigest' IS DISTINCT FROM bootstrap.request_digest THEN RETURN false;END IF;
 IF o.kind='discover_bootstrap' THEN RETURN true;END IF;
 IF o.kind='read_product' THEN
  RETURN EXISTS(SELECT 1 FROM subscription_controlled_operations creator JOIN subscription_controlled_calls c ON c.operation_id=creator.id JOIN subscription_controlled_facts f ON f.call_id=c.id
   WHERE creator.resource_id=r.id AND creator.kind='create_product' AND creator.id::text=payload->>'originalProductOperationId'
    AND creator.request_digest=payload->>'originalProductRequestDigest' AND f.actual->>'kind'='product_created'
    AND f.actual->'raw'->>'id'=payload->>'createdProductRef' AND creator.original_request->'payload'->>'name'=payload->>'name');
 END IF;
 IF NOT coalesce(payload->>'providerSubscriptionRef' ~ '^sub_[A-Za-z0-9_]{1,195}$',false) OR NOT EXISTS(
  SELECT 1 FROM subscription_controlled_operations prior JOIN subscription_controlled_calls c ON c.operation_id=prior.id JOIN subscription_controlled_facts f ON f.call_id=c.id
  WHERE prior.resource_id=r.id AND ((prior.id=bootstrap.id AND f.actual->>'kind'='bootstrap_subscription' AND f.actual->'raw'->>'id'=payload->>'providerSubscriptionRef')
   OR(prior.kind='discover_bootstrap' AND f.actual->>'kind'='subscription_list_read' AND EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(f.actual->'raw'->'data','[]'::jsonb)) item
    WHERE item->>'id'=payload->>'providerSubscriptionRef' AND item->'metadata'->>'freeholder_bootstrap_operation_id'=bootstrap.id::text AND item->'metadata'->>'freeholder_bootstrap_request_digest'=bootstrap.request_digest)))) THEN RETURN false;END IF;
 IF o.kind IN('read_bootstrap','read_calendar','list_invoices','cancel_calendar') THEN RETURN true;END IF;
 IF o.kind='pause_drafts' THEN
  RETURN EXISTS(SELECT 1 FROM subscription_controlled_operations prior JOIN subscription_controlled_verifications v ON v.operation_id=prior.id
   WHERE prior.resource_id=r.id AND prior.kind='read_bootstrap' AND v.actual_result->>'completeZeroRecurringItem'='true' AND v.actual_result->>'providerSubscriptionRef'=payload->>'providerSubscriptionRef');
 END IF;
 IF o.kind='read_invoice' THEN
  RETURN coalesce(payload->>'providerInvoiceRef' ~ '^in_[A-Za-z0-9_]{1,196}$',false) AND EXISTS(
   SELECT 1 FROM subscription_controlled_operations prior JOIN subscription_controlled_calls c ON c.operation_id=prior.id JOIN subscription_controlled_facts f ON f.call_id=c.id
   WHERE prior.resource_id=r.id AND (f.actual->'raw'->>'latest_invoice'=payload->>'providerInvoiceRef'
    OR f.actual->'raw'->'latest_invoice'->>'id'=payload->>'providerInvoiceRef'
    OR(f.actual->>'kind'='invoice_read' AND f.actual->'raw'->>'id'=payload->>'providerInvoiceRef')
    OR(f.actual->>'kind'='invoice_list_read' AND EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(f.actual->'raw'->'data','[]'::jsonb)) item WHERE item->>'id'=payload->>'providerInvoiceRef'))));
 END IF;
 RETURN false;
END $$;
--> statement-breakpoint
CREATE FUNCTION freeholder_controlled_writer() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r subscription_controlled_resources%ROWTYPE;o subscription_controlled_operations%ROWTYPE;c subscription_controlled_calls%ROWTYPE;
 parent subscriptions%ROWTYPE;t subscription_commercial_terms%ROWTYPE;scope subscription_merchant_scopes%ROWTYPE;method payment_methods%ROWTYPE;
 original jsonb;payload jsonb;body jsonb;last_ordinal integer;resource_uuid uuid;
BEGIN
 IF TG_OP<>'INSERT' OR current_setting('freeholder.controlled_provider_v1',true) IS DISTINCT FROM '1' THEN
  RAISE EXCEPTION 'Original controlled resources, operations, callers, raw facts and distinct finish/stop/verification/closure receipts are immutable' USING ERRCODE='23514';END IF;
 IF TG_TABLE_NAME='subscription_controlled_resources' THEN
  SELECT * INTO parent FROM subscriptions WHERE id=NEW.subscription_id FOR UPDATE;
  SELECT * INTO t FROM subscription_commercial_terms WHERE id=NEW.terms_id;
  SELECT * INTO scope FROM subscription_merchant_scopes WHERE subscription_id=NEW.subscription_id;
  SELECT * INTO method FROM payment_methods WHERE id=parent.payment_method_id;
  IF parent.id IS NULL OR parent.provider IS DISTINCT FROM 'stripe' OR parent.billing_mode IS DISTINCT FROM 'provider' OR parent.merchant_scope_version<>1 OR t.subscription_id IS DISTINCT FROM parent.id OR scope.subscription_id IS NULL OR NEW.generation<>1 OR parent.provider_schedule_ref_v1 IS NOT NULL
   OR NEW.original_scope->>'subscriptionId' IS DISTINCT FROM parent.id::text OR NEW.original_scope->>'termsId' IS DISTINCT FROM t.id::text OR NEW.original_scope->>'generation' IS DISTINCT FROM NEW.generation::text
   OR NEW.original_scope->>'providerApiVersion' IS DISTINCT FROM '2026-10-28.endive' OR NEW.original_scope->>'providerPlatformAccountId' IS DISTINCT FROM scope.provider_platform_account_id
   OR (scope.charge_account_id IS NULL AND (NEW.original_scope->>'destinationAccountId' IS DISTINCT FROM scope.recipient_account_id OR NEW.original_scope->>'settlementMerchantAccountId' IS DISTINCT FROM scope.settlement_merchant_account_id))
   OR (scope.charge_account_id IS NOT NULL AND (NEW.original_scope ? 'destinationAccountId' OR NEW.original_scope ? 'settlementMerchantAccountId'))
   OR coalesce(NEW.original_scope->>'providerAccountId','') IS DISTINCT FROM coalesce(scope.charge_account_id,'') OR NEW.original_scope->>'currency' IS DISTINCT FROM parent.currency
   OR method.status IS DISTINCT FROM 'active' OR method.provider IS DISTINCT FROM 'stripe' OR method.contact_id IS DISTINCT FROM parent.contact_id
   OR NEW.original_scope->>'providerMethodRef' IS DISTINCT FROM method.provider_method_ref OR NEW.original_scope->>'providerCustomerRef' IS DISTINCT FROM method.provider_customer_ref
   OR coalesce(NEW.original_scope->>'providerAccountId','') IS DISTINCT FROM method.provider_account_id OR NEW.original_scope->>'providerPlatformAccountId' IS DISTINCT FROM method.provider_platform_account_id
   OR NEW.original_scope->>'acceptedPeriodEnd' IS NULL OR (NEW.original_scope->>'acceptedPeriodEnd')::timestamptz IS DISTINCT FROM parent.current_period_end
   OR nullif(NEW.original_scope->>'acceptedTrialEnd','')::timestamptz IS DISTINCT FROM parent.trial_ends_at
   OR EXISTS(SELECT 1 FROM subscription_provider_generations WHERE subscription_id=parent.id)
   OR EXISTS(SELECT 1 FROM subscription_provider_schedule_operations WHERE subscription_id=parent.id AND original_request->>'resourceKind' IS DISTINCT FROM 'phase_product')
   OR NOT freeholder_subscription_resumption_callers_closed(parent.id) THEN
   RAISE EXCEPTION 'Retain only actual original uncreated-calendar terms, method, namespace and application calendar; no old paid generation may be replaced by a zero bootstrap' USING ERRCODE='23514';END IF;
  RETURN NEW;
 END IF;
 IF TG_TABLE_NAME='subscription_controlled_operations' THEN resource_uuid=NEW.resource_id;
 ELSIF TG_TABLE_NAME='subscription_controlled_calls' THEN SELECT resource_id INTO resource_uuid FROM subscription_controlled_operations WHERE id=NEW.operation_id;
 ELSIF TG_TABLE_NAME='subscription_controlled_facts' THEN SELECT op.resource_id INTO resource_uuid FROM subscription_controlled_calls ticket JOIN subscription_controlled_operations op ON op.id=ticket.operation_id WHERE ticket.id=NEW.call_id;
 ELSIF TG_TABLE_NAME IN('subscription_controlled_finishes','subscription_controlled_stops','subscription_controlled_verifications') THEN
  SELECT op.resource_id INTO resource_uuid FROM subscription_controlled_calls ticket JOIN subscription_controlled_operations op ON op.id=ticket.operation_id WHERE ticket.id=NEW.call_id;
 ELSE resource_uuid=NEW.resource_id;END IF;
 PERFORM pg_advisory_xact_lock(hashtext('controlled-provider:'||resource_uuid::text));
 SELECT * INTO r FROM subscription_controlled_resources WHERE id=resource_uuid FOR UPDATE;
 IF r.id IS NULL OR EXISTS(SELECT 1 FROM subscription_controlled_closures WHERE resource_id=r.id) THEN
  RAISE EXCEPTION 'A missing or genuinely closed original resource cannot acquire another operation, caller or replacement fact' USING ERRCODE='23514';END IF;
 IF TG_TABLE_NAME='subscription_controlled_operations' THEN
  SELECT coalesce(max(ordinal),0) INTO last_ordinal FROM subscription_controlled_operations WHERE resource_id=r.id;
  SELECT * INTO t FROM subscription_commercial_terms WHERE id=r.terms_id;
  IF NEW.ordinal<>last_ordinal+1 OR NEW.accepted_quote_digest IS DISTINCT FROM t.accepted_quote_digest
   OR NOT coalesce(NEW.original_request->>'scopeDigest' ~ '^[a-f0-9]{64}$',false) OR jsonb_typeof(NEW.original_request->'payload') IS DISTINCT FROM 'object'
   OR NOT freeholder_controlled_callers_closed(r.id) OR octet_length(NEW.original_request::text)>256000 THEN
   RAISE EXCEPTION 'Every exact next controlled request retains the whole original revision and all older actual callers; a newer row cannot supersede an outstanding invocation' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='subscription_controlled_calls' THEN
  SELECT * INTO o FROM subscription_controlled_operations WHERE id=NEW.operation_id;body=NEW.admission;payload=body->'payload';
  IF NOT freeholder_controlled_operation_admissible(o.id) OR body->>'version' IS DISTINCT FROM '1' OR body->>'kind' IS DISTINCT FROM 'admission'
   OR payload->>'purpose' IS DISTINCT FROM 'subscription_controlled_provider_caller.v1' OR payload->>'operationId' IS DISTINCT FROM o.id::text
   OR payload->>'callId' IS DISTINCT FROM NEW.id::text OR payload->>'resourceId' IS DISTINCT FROM r.id::text OR payload->>'kind' IS DISTINCT FROM o.kind
   OR payload->>'requestDigest' IS DISTINCT FROM o.request_digest OR payload->>'admittedSourceRevision' IS DISTINCT FROM o.previous_evidence_revision
   OR payload->'caller'->>'id' IS DISTINCT FROM payload->>'callerId' OR NOT coalesce(payload->>'callerId' ~ '^[a-f0-9-]{36}$',false)
   OR NOT coalesce(payload->'caller'->>'pid' ~ '^[1-9][0-9]*$',false) OR NOT coalesce(payload->>'completionDigest' ~ '^[a-f0-9]{64}$',false)
   OR NOT coalesce(body->>'signature' ~ '^[A-Za-z0-9_-]{86}$',false) OR NOT coalesce(length(body->>'publicKey') BETWEEN 40 AND 2000,false) THEN
   RAISE EXCEPTION 'Only this current exact operation and actual signed original process/nonce can admit one physical caller' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='subscription_controlled_facts' THEN
  SELECT * INTO c FROM subscription_controlled_calls WHERE id=NEW.call_id;
  SELECT coalesce(max(ordinal),0) INTO last_ordinal FROM subscription_controlled_facts WHERE call_id=c.id;
  IF c.id IS NULL OR NEW.ordinal<>last_ordinal+1 OR EXISTS(SELECT 1 FROM subscription_controlled_finishes WHERE call_id=c.id)
   OR EXISTS(SELECT 1 FROM subscription_controlled_stops WHERE call_id=c.id) OR octet_length(NEW.actual::text)>256000
   OR NOT coalesce(NEW.actual->>'kind' IN('bootstrap_subscription','pause_subscription','subscription_read','invoice_read','proration_preview','intent_read','cash_observed','invoice_payments_read','invoice_lines_read','price_read','product_created','product_read','subscription_list_read','calendar_updated','calendar_canceled','invoice_list_read'),false)
   OR jsonb_typeof(NEW.actual->'raw') IS DISTINCT FROM 'object' THEN
   RAISE EXCEPTION 'Only an actual unfinished, unstopped original caller can retain its next bounded raw occurrence; late callbacks remain refused' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='subscription_controlled_verifications' THEN
  SELECT * INTO c FROM subscription_controlled_calls WHERE id=NEW.call_id;
  IF c.operation_id IS DISTINCT FROM NEW.operation_id OR NOT EXISTS(SELECT 1 FROM subscription_controlled_finishes f WHERE f.call_id=c.id
   AND f.actual_result->>'outcome'='returned' AND f.actual_result->'result'=NEW.actual_result) THEN
   RAISE EXCEPTION 'A result projection must copy the exact actual returned SDK result, never operator replacement evidence or a stop review' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='subscription_controlled_closures' THEN
  IF NOT freeholder_controlled_zero_closure_valid(NEW.resource_id,NEW.proof) OR NEW.original_evidence_revision IS DISTINCT FROM NEW.proof->>'originalEvidenceRevision' THEN
   RAISE EXCEPTION 'Actual canceled zero transport requires complete terminal zero-invoice inventory; unknown callers, cash or drafts cannot be forgiven' USING ERRCODE='23514';END IF;
 ELSE
  SELECT * INTO c FROM subscription_controlled_calls WHERE id=NEW.call_id;SELECT * INTO o FROM subscription_controlled_operations WHERE id=c.operation_id;
  original=c.admission->'payload';body=NEW.proof;payload=body->'payload';
  IF c.id IS NULL OR body->>'version' IS DISTINCT FROM '1' OR payload->>'purpose' IS DISTINCT FROM 'subscription_controlled_provider_caller.v1'
   OR payload->>'callId' IS DISTINCT FROM c.id::text OR payload->>'operationId' IS DISTINCT FROM o.id::text OR payload->>'resourceId' IS DISTINCT FROM r.id::text
   OR payload->>'requestDigest' IS DISTINCT FROM o.request_digest OR payload->>'admissionDigest' IS DISTINCT FROM c.admission_digest OR payload->>'callerId' IS DISTINCT FROM original->>'callerId'
   OR NOT coalesce(body->>'signature' ~ '^[A-Za-z0-9_-]{86}$',false) OR NOT coalesce(length(body->>'publicKey') BETWEEN 40 AND 2000,false) THEN
   RAISE EXCEPTION 'Retain this exact original signed caller, request and admission without substituting another invocation' USING ERRCODE='23514';END IF;
  IF TG_TABLE_NAME='subscription_controlled_finishes' THEN
   IF body->>'kind' IS DISTINCT FROM 'finish' OR body->>'publicKey' IS DISTINCT FROM c.admission->>'publicKey'
    OR payload->>'completionDigest' IS DISTINCT FROM original->>'completionDigest' OR NOT coalesce(payload->>'outcome' IN('returned','threw'),false)
    OR payload->>'outcome' IS DISTINCT FROM NEW.actual_result->>'outcome' OR NOT coalesce(payload->>'factsDigest' ~ '^[a-f0-9]{64}$',false)
    OR EXISTS(SELECT 1 FROM subscription_controlled_stops WHERE call_id=c.id) THEN
    RAISE EXCEPTION 'Only the actual unstopped original process signs its real returned/thrown SDK finish' USING ERRCODE='23514';END IF;
  ELSE
   IF body->>'kind' IS DISTINCT FROM 'stop_review' OR payload->'originalAdmission' IS DISTINCT FROM c.admission OR NOT coalesce(payload->>'reviewedBy' ~ '^user:[a-f0-9-]{36}$',false)
    OR NOT coalesce(payload->>'mechanicalCheck' IN('original_process_absent','unobservable_host_review'),false)
    OR NOT coalesce(payload->>'hostingEvidenceDigest' ~ '^[a-f0-9]{64}$',false) OR NOT coalesce(payload->>'currentEvidenceRevision' ~ '^[a-f0-9]{64}$',false)
    OR EXISTS(SELECT 1 FROM subscription_controlled_finishes WHERE call_id=c.id) THEN
    RAISE EXCEPTION 'Independent fresh human runtime evidence releases the exact absent original caller; it never invents a bank finish' USING ERRCODE='23514';END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION freeholder_controlled_zero_closure_valid(target uuid,proof jsonb) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE r subscription_controlled_resources%ROWTYPE;calendar subscription_controlled_verifications%ROWTYPE;inventory subscription_controlled_verifications%ROWTYPE;
 calendar_op subscription_controlled_operations%ROWTYPE;list_op subscription_controlled_operations%ROWTYPE;item jsonb;actual jsonb;known_count integer;
BEGIN
 SELECT * INTO r FROM subscription_controlled_resources WHERE id=target;
 IF r.id IS NULL OR proof->>'kind' IS DISTINCT FROM 'zero_transport' OR NOT freeholder_controlled_callers_closed(target)
  OR EXISTS(SELECT 1 FROM subscription_controlled_charge_origins WHERE resource_id=target)
  OR (SELECT count(*) FROM subscription_controlled_operations WHERE resource_id=target AND kind='bootstrap')<>1
  OR EXISTS(SELECT 1 FROM subscription_controlled_operations WHERE resource_id=target AND kind NOT IN('bootstrap','discover_bootstrap','read_bootstrap','pause_drafts','read_invoice','read_calendar','list_invoices','cancel_calendar','create_product','read_product'))
  OR jsonb_typeof(proof->'invoices') IS DISTINCT FROM 'array' THEN RETURN false;END IF;
 IF (SELECT count(DISTINCT entry->>'providerInvoiceRef') FROM jsonb_array_elements(proof->'invoices') entry)<>jsonb_array_length(proof->'invoices') THEN RETURN false;END IF;
 SELECT * INTO calendar FROM subscription_controlled_verifications WHERE operation_id::text=proof->>'calendarReadOperationId';
 SELECT * INTO inventory FROM subscription_controlled_verifications WHERE operation_id::text=proof->>'invoiceListOperationId';
 SELECT * INTO calendar_op FROM subscription_controlled_operations WHERE id=calendar.operation_id;
 SELECT * INTO list_op FROM subscription_controlled_operations WHERE id=inventory.operation_id;
 IF calendar_op.resource_id IS DISTINCT FROM r.id OR list_op.resource_id IS DISTINCT FROM r.id OR calendar_op.kind IS DISTINCT FROM 'read_calendar'
  OR list_op.kind IS DISTINCT FROM 'list_invoices' OR list_op.ordinal<=calendar_op.ordinal OR calendar.actual_result->>'calendarCanceled' IS DISTINCT FROM 'true'
  OR calendar.actual_result_digest IS DISTINCT FROM proof->>'calendarResultDigest' OR inventory.actual_result_digest IS DISTINCT FROM proof->>'invoiceListResultDigest'
  OR inventory.actual_result->>'complete' IS DISTINCT FROM 'true' OR calendar.actual_result->>'providerSubscriptionRef' IS DISTINCT FROM proof->>'providerSubscriptionRef'
  OR inventory.actual_result->>'providerSubscriptionRef' IS DISTINCT FROM proof->>'providerSubscriptionRef'
  OR jsonb_typeof(inventory.actual_result->'providerInvoiceRefs') IS DISTINCT FROM 'array'
  OR jsonb_array_length(inventory.actual_result->'providerInvoiceRefs')<>jsonb_array_length(proof->'invoices') THEN RETURN false;END IF;
 -- No old actual positive occurrence can disappear just because a later list
 -- is empty or its ordinary canonical application never committed.
 IF EXISTS(SELECT 1 FROM subscription_controlled_operations o JOIN subscription_controlled_calls c ON c.operation_id=o.id JOIN subscription_controlled_facts f ON f.call_id=c.id
  WHERE o.resource_id=target AND ((f.actual->>'kind'='cash_observed') OR(f.actual->>'kind'='intent_read' AND f.actual->'raw'->>'amount_received' IS DISTINCT FROM '0')
   OR(f.actual->>'kind'='invoice_read' AND (f.actual->'raw'->>'amount_paid' IS DISTINCT FROM '0' OR f.actual->'raw'->>'total' IS DISTINCT FROM '0'))
   OR(f.actual->>'kind'='invoice_list_read' AND EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(f.actual->'raw'->'data','[]'::jsonb)) entry
    WHERE entry->>'amount_paid' IS DISTINCT FROM '0' OR entry->>'total' IS DISTINCT FROM '0')))) THEN RETURN false;END IF;
 SELECT count(DISTINCT id) INTO known_count FROM (
  SELECT freeholder_controlled_ref(f.actual->'raw'->'latest_invoice') AS id
   FROM subscription_controlled_operations o JOIN subscription_controlled_calls c ON c.operation_id=o.id JOIN subscription_controlled_facts f ON f.call_id=c.id WHERE o.resource_id=target AND f.actual->'raw'->'latest_invoice' IS NOT NULL AND f.actual->'raw'->'latest_invoice'<>'null'::jsonb
  UNION ALL SELECT f.actual->'raw'->>'id' FROM subscription_controlled_operations o JOIN subscription_controlled_calls c ON c.operation_id=o.id JOIN subscription_controlled_facts f ON f.call_id=c.id WHERE o.resource_id=target AND f.actual->>'kind'='invoice_read'
  UNION ALL SELECT entry->>'id' FROM subscription_controlled_operations o JOIN subscription_controlled_calls c ON c.operation_id=o.id JOIN subscription_controlled_facts f ON f.call_id=c.id
   CROSS JOIN LATERAL jsonb_array_elements(coalesce(f.actual->'raw'->'data','[]'::jsonb)) entry WHERE o.resource_id=target AND f.actual->>'kind'='invoice_list_read'
 ) known;
 IF known_count<>jsonb_array_length(proof->'invoices') THEN RETURN false;END IF;
 FOR item IN SELECT * FROM jsonb_array_elements(proof->'invoices') LOOP
  SELECT v.actual_result INTO actual FROM subscription_controlled_verifications v JOIN subscription_controlled_operations o ON o.id=v.operation_id
   WHERE v.operation_id::text=item->>'readOperationId' AND o.resource_id=target AND o.kind='read_invoice' AND o.ordinal>list_op.ordinal AND v.actual_result_digest=item->>'resultDigest';
  IF actual IS NULL OR actual->>'providerInvoiceRef' IS DISTINCT FROM item->>'providerInvoiceRef' OR actual->>'providerSubscriptionRef' IS DISTINCT FROM proof->>'providerSubscriptionRef'
   OR NOT inventory.actual_result->'providerInvoiceRefs' @> jsonb_build_array(item->>'providerInvoiceRef')
   OR actual->>'currency' IS DISTINCT FROM r.original_scope->>'currency' OR NOT coalesce(actual->>'status' IN('paid','void'),false)
   OR actual->>'totalMinor' IS DISTINCT FROM '0' OR actual->>'paidMinor' IS DISTINCT FROM '0' OR actual->>'remainingMinor' IS DISTINCT FROM '0' OR actual->>'autoAdvance' IS DISTINCT FROM 'false'
   OR actual->>'completePayments' IS DISTINCT FROM 'true' OR actual->>'completeLines' IS DISTINCT FROM 'true' OR actual->'actualCash' IS DISTINCT FROM '[]'::jsonb
   OR actual->'actualInvoice'->>'starting_balance' IS DISTINCT FROM '0' OR actual->'actualInvoice'->>'ending_balance' IS DISTINCT FROM '0'
   OR actual->'actualInvoice'->>'post_payment_credit_notes_amount' IS DISTINCT FROM '0' OR actual->'actualInvoice'->>'pre_payment_credit_notes_amount' IS DISTINCT FROM '0'
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(actual->'actualIntents') intent WHERE intent->>'status' IS DISTINCT FROM 'canceled' OR intent->>'amount_received' IS DISTINCT FROM '0')
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(actual->'actualLines') line WHERE line->>'amount' IS DISTINCT FROM '0') THEN RETURN false;END IF;
 END LOOP;
 RETURN true;
END $$;
--> statement-breakpoint
CREATE TRIGGER subscription_controlled_resources_guard BEFORE INSERT OR UPDATE OR DELETE ON subscription_controlled_resources FOR EACH ROW EXECUTE FUNCTION freeholder_controlled_writer();
--> statement-breakpoint
CREATE TRIGGER subscription_controlled_operations_guard BEFORE INSERT OR UPDATE OR DELETE ON subscription_controlled_operations FOR EACH ROW EXECUTE FUNCTION freeholder_controlled_writer();
--> statement-breakpoint
CREATE TRIGGER subscription_controlled_calls_guard BEFORE INSERT OR UPDATE OR DELETE ON subscription_controlled_calls FOR EACH ROW EXECUTE FUNCTION freeholder_controlled_writer();
--> statement-breakpoint
CREATE TRIGGER subscription_controlled_facts_guard BEFORE INSERT OR UPDATE OR DELETE ON subscription_controlled_facts FOR EACH ROW EXECUTE FUNCTION freeholder_controlled_writer();
--> statement-breakpoint
CREATE TRIGGER subscription_controlled_finishes_guard BEFORE INSERT OR UPDATE OR DELETE ON subscription_controlled_finishes FOR EACH ROW EXECUTE FUNCTION freeholder_controlled_writer();
--> statement-breakpoint
CREATE TRIGGER subscription_controlled_stops_guard BEFORE INSERT OR UPDATE OR DELETE ON subscription_controlled_stops FOR EACH ROW EXECUTE FUNCTION freeholder_controlled_writer();
--> statement-breakpoint
CREATE TRIGGER subscription_controlled_verifications_guard BEFORE INSERT OR UPDATE OR DELETE ON subscription_controlled_verifications FOR EACH ROW EXECUTE FUNCTION freeholder_controlled_writer();
--> statement-breakpoint
CREATE TRIGGER subscription_controlled_closures_guard BEFORE INSERT OR UPDATE OR DELETE ON subscription_controlled_closures FOR EACH ROW EXECUTE FUNCTION freeholder_controlled_writer();
--> statement-breakpoint
CREATE FUNCTION freeholder_controlled_origin_writer() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r subscription_controlled_resources%ROWTYPE;o subscription_controlled_operations%ROWTYPE;c subscription_controlled_calls%ROWTYPE;f subscription_controlled_facts%ROWTYPE;
 receipt subscription_provider_charge_receipts%ROWTYPE;cash jsonb;invoice jsonb;intent jsonb;tag jsonb;
BEGIN
 IF TG_OP<>'INSERT' OR current_setting('freeholder.controlled_provider_v1',true) IS DISTINCT FROM '1' THEN
  RAISE EXCEPTION 'Canonical controlled cash origin is immutable; it cannot replace an older original receipt owner' USING ERRCODE='23514';END IF;
 PERFORM pg_advisory_xact_lock(hashtext('controlled-provider:'||NEW.resource_id::text));
 SELECT * INTO r FROM subscription_controlled_resources WHERE id=NEW.resource_id FOR UPDATE;
 SELECT * INTO o FROM subscription_controlled_operations WHERE id=NEW.operation_id;SELECT * INTO c FROM subscription_controlled_calls WHERE id=NEW.call_id;
 SELECT * INTO f FROM subscription_controlled_facts WHERE id=NEW.fact_id;SELECT * INTO receipt FROM subscription_provider_charge_receipts WHERE id=NEW.receipt_id;
 cash=f.actual->'raw'->'cash';invoice=f.actual->'raw'->'invoice';intent=f.actual->'raw'->'intent';
 tag=coalesce(invoice->'parent'->'subscription_details'->'metadata',invoice->'subscription_details'->'metadata');
 IF r.id IS NULL OR o.resource_id IS DISTINCT FROM r.id OR c.operation_id IS DISTINCT FROM o.id OR f.call_id IS DISTINCT FROM c.id OR f.actual->>'kind' IS DISTINCT FROM 'cash_observed'
  OR receipt.subscription_id IS DISTINCT FROM r.subscription_id OR receipt.provider_platform_account_id IS DISTINCT FROM r.original_scope->>'providerPlatformAccountId'
  OR coalesce(receipt.charge_account_id,'') IS DISTINCT FROM coalesce(r.original_scope->>'providerAccountId','') OR receipt.created_at<r.created_at
  OR cash->>'subscriptionId' IS DISTINCT FROM receipt.subscription_id::text OR cash->>'providerSubscriptionRef' IS DISTINCT FROM receipt.provider_subscription_ref
  OR cash->>'providerInvoiceRef' IS DISTINCT FROM receipt.provider_invoice_ref OR cash->>'providerPaymentIntentRef' IS DISTINCT FROM receipt.provider_payment_intent_ref
  OR cash->>'amountMinor' IS DISTINCT FROM receipt.amount_minor::text OR cash->>'currency' IS DISTINCT FROM receipt.currency
  OR cash->>'providerCustomerRef' IS DISTINCT FROM r.original_scope->>'providerCustomerRef' OR cash->>'providerPlatformAccountId' IS DISTINCT FROM receipt.provider_platform_account_id
  OR coalesce(cash->>'providerAccountId','') IS DISTINCT FROM coalesce(receipt.charge_account_id,'')
  OR invoice->>'id' IS DISTINCT FROM receipt.provider_invoice_ref OR intent->>'id' IS DISTINCT FROM receipt.provider_payment_intent_ref
  OR intent->>'amount_received' IS DISTINCT FROM receipt.amount_minor::text OR upper(intent->>'currency') IS DISTINCT FROM receipt.currency
  OR freeholder_controlled_ref(invoice->'customer') IS DISTINCT FROM r.original_scope->>'providerCustomerRef'
  OR freeholder_controlled_ref(intent->'customer') IS DISTINCT FROM r.original_scope->>'providerCustomerRef'
  OR coalesce(freeholder_controlled_ref(invoice->'subscription'),freeholder_controlled_ref(invoice->'parent'->'subscription_details'->'subscription')) IS DISTINCT FROM receipt.provider_subscription_ref
  OR tag->>'freeholder_controlled_subscription_version' IS DISTINCT FROM '1' OR tag->>'freeholder_subscription_id' IS DISTINCT FROM r.subscription_id::text
  OR tag->>'freeholder_subscription_terms_id' IS DISTINCT FROM r.terms_id::text OR tag->>'freeholder_controlled_generation' IS DISTINCT FROM r.generation::text
  OR tag->>'freeholder_platform_account_id' IS DISTINCT FROM receipt.provider_platform_account_id
  OR NOT EXISTS(SELECT 1 FROM subscription_controlled_operations bootstrap WHERE bootstrap.resource_id=r.id AND bootstrap.kind='bootstrap'
   AND bootstrap.id::text=tag->>'freeholder_bootstrap_operation_id' AND bootstrap.request_digest=tag->>'freeholder_bootstrap_request_digest')
  OR EXISTS(SELECT 1 FROM subscription_provider_generations g WHERE g.subscription_id=r.subscription_id AND g.provider_subscription_ref=receipt.provider_subscription_ref)
  OR EXISTS(SELECT 1 FROM subscription_provider_invoice_observations v WHERE v.subscription_id=r.subscription_id AND v.provider_subscription_ref=receipt.provider_subscription_ref
   AND v.provider_invoice_ref=receipt.provider_invoice_ref AND v.provider_operation_id IS NOT NULL)
  OR EXISTS(SELECT 1 FROM subscription_provider_schedule_operations prior_schedule CROSS JOIN LATERAL jsonb_array_elements(coalesce(prior_schedule.provider_observation->'history','[]'::jsonb)) h
   WHERE prior_schedule.subscription_id=r.subscription_id AND h->>'providerSubscriptionRef'=receipt.provider_subscription_ref AND h->>'source'='authenticated_invoice_payment') THEN
  RAISE EXCEPTION 'Only the exact actual original controlled caller/fact can bind the SAME canonical cash receipt; pre-existing old phase/generation ownership is never adopted' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER subscription_controlled_origins_guard BEFORE INSERT OR UPDATE OR DELETE ON subscription_controlled_charge_origins FOR EACH ROW EXECUTE FUNCTION freeholder_controlled_origin_writer();
--> statement-breakpoint
CREATE FUNCTION freeholder_controlled_receipt_complete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM subscription_controlled_resources r JOIN subscription_controlled_operations o ON o.resource_id=r.id JOIN subscription_controlled_calls c ON c.operation_id=o.id
  JOIN subscription_controlled_facts f ON f.call_id=c.id WHERE r.subscription_id=NEW.subscription_id AND r.original_scope->>'providerPlatformAccountId'=NEW.provider_platform_account_id
   AND coalesce(r.original_scope->>'providerAccountId','')=coalesce(NEW.charge_account_id,'') AND (
    (f.actual->>'kind'='bootstrap_subscription' AND f.actual->'raw'->>'id'=NEW.provider_subscription_ref)
    OR(f.actual->>'kind'='cash_observed' AND f.actual->'raw'->'cash'->>'providerPaymentIntentRef'=NEW.provider_payment_intent_ref)
    OR(f.actual->>'kind'='subscription_list_read' AND EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(f.actual->'raw'->'data','[]'::jsonb)) entry
     WHERE entry->>'id'=NEW.provider_subscription_ref AND freeholder_controlled_ref(entry->'customer')=r.original_scope->>'providerCustomerRef'
      AND entry->'metadata'->>'freeholder_controlled_subscription_version'='1' AND entry->'metadata'->>'freeholder_subscription_id'=r.subscription_id::text
      AND entry->'metadata'->>'freeholder_subscription_terms_id'=r.terms_id::text AND entry->'metadata'->>'freeholder_controlled_generation'=r.generation::text
      AND entry->'metadata'->>'freeholder_platform_account_id'=r.original_scope->>'providerPlatformAccountId'
      AND EXISTS(SELECT 1 FROM subscription_controlled_operations bootstrap WHERE bootstrap.resource_id=r.id AND bootstrap.kind='bootstrap'
       AND bootstrap.id::text=entry->'metadata'->>'freeholder_bootstrap_operation_id' AND bootstrap.request_digest=entry->'metadata'->>'freeholder_bootstrap_request_digest')))))
  AND NOT EXISTS(SELECT 1 FROM subscription_controlled_charge_origins origin WHERE origin.receipt_id=NEW.id) THEN
  RAISE EXCEPTION 'Actual controlled money retains its exact signed original origin child in the SAME transaction as its canonical receipt, including NULL-payment first capture' USING ERRCODE='23514';END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER subscription_controlled_charge_origin_guard AFTER INSERT OR UPDATE ON subscription_provider_charge_receipts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION freeholder_controlled_receipt_complete();
--> statement-breakpoint
CREATE FUNCTION freeholder_controlled_legacy_writer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='subscription_provider_schedule_operations' THEN
  PERFORM id FROM subscriptions WHERE id=NEW.subscription_id FOR UPDATE;
  IF NEW.kind IN('create','update','resume') AND EXISTS(SELECT 1 FROM subscription_controlled_resources WHERE subscription_id=NEW.subscription_id) THEN
   RAISE EXCEPTION 'A controlled original resource cannot also admit a legacy positive schedule; use its exact current consent and collection lifecycle' USING ERRCODE='23514';END IF;
 ELSE
  IF NEW.state='quiesced' AND EXISTS(SELECT 1 FROM subscription_controlled_resources r LEFT JOIN subscription_controlled_closures closed ON closed.resource_id=r.id
   WHERE r.subscription_id=NEW.subscription_id AND closed.resource_id IS NULL) THEN
   RAISE EXCEPTION 'Draft collection pause is an ACTIVE calendar. Actual complete controlled financial closure is required before an old schedule flag can claim quiescence' USING ERRCODE='23514';END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER subscription_controlled_legacy_charge_guard BEFORE INSERT ON subscription_provider_schedule_operations FOR EACH ROW EXECUTE FUNCTION freeholder_controlled_legacy_writer();
--> statement-breakpoint
CREATE TRIGGER subscription_controlled_financial_stop_guard BEFORE UPDATE ON subscription_provider_schedule_resources FOR EACH ROW EXECUTE FUNCTION freeholder_controlled_legacy_writer();
