-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- OWNED UNAPPLIED suffix AFTER30dde7ff494d1d2ea81d1561e73c0ffba15721f215a3fd16bf13c73036002bb9.
-- SOURCE ONLY: root owns assembly, a new migration hash and NEW normal database qualification.
CREATE TABLE subscription_proration_payment_protocols (
 payment_id uuid PRIMARY KEY REFERENCES merchant_payment_requests(payment_id) ON DELETE RESTRICT,
 proration_id uuid NOT NULL REFERENCES subscription_prorations(id) ON DELETE RESTRICT,invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
 provider_api_version text NOT NULL CHECK(provider_api_version IN('2026-02-25.clover','2026-10-28.endive')),created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX subscription_proration_payment_protocols_parent ON subscription_proration_payment_protocols(proration_id);
--> statement-breakpoint
CREATE TABLE subscription_proration_card_mandates (
 proration_id uuid PRIMARY KEY REFERENCES subscription_prorations(id) ON DELETE RESTRICT,invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
 payment_method_id uuid NOT NULL REFERENCES payment_methods(id) ON DELETE RESTRICT,method jsonb NOT NULL,method_digest text NOT NULL,accepted_quote_digest text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT subscription_proration_card_mandates_digest CHECK(method_digest ~ '^[a-f0-9]{64}$' AND accepted_quote_digest ~ '^[a-f0-9]{64}$' AND jsonb_typeof(method)='object')
);
--> statement-breakpoint
CREATE UNIQUE INDEX subscription_proration_card_mandates_invoice ON subscription_proration_card_mandates(invoice_id);
--> statement-breakpoint
CREATE TABLE subscription_proration_card_attempts (
 payment_id uuid PRIMARY KEY REFERENCES payments(id) ON DELETE RESTRICT,proration_id uuid NOT NULL REFERENCES subscription_proration_card_mandates(proration_id) ON DELETE RESTRICT,
 invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,provider_request jsonb NOT NULL,request_digest text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT subscription_proration_card_attempts_digest CHECK(request_digest ~ '^[a-f0-9]{64}$' AND jsonb_typeof(provider_request)='object')
);
--> statement-breakpoint
CREATE UNIQUE INDEX subscription_proration_card_attempts_original ON subscription_proration_card_attempts(proration_id);
--> statement-breakpoint
CREATE INDEX subscription_proration_card_attempts_invoice ON subscription_proration_card_attempts(invoice_id);
--> statement-breakpoint
CREATE TABLE subscription_proration_card_jobs (
 proration_id uuid PRIMARY KEY REFERENCES subscription_proration_card_mandates(proration_id) ON DELETE RESTRICT,job_id uuid NOT NULL,
 original_task jsonb NOT NULL,claim_digest text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT subscription_proration_card_jobs_digest CHECK(claim_digest ~ '^[a-f0-9]{64}$' AND jsonb_typeof(original_task)='object')
);
--> statement-breakpoint
CREATE UNIQUE INDEX subscription_proration_card_jobs_job ON subscription_proration_card_jobs(job_id);
--> statement-breakpoint
CREATE TABLE subscription_proration_card_reads (
 id uuid PRIMARY KEY,payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,admission jsonb NOT NULL,admission_digest text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT subscription_proration_card_reads_digest CHECK(admission_digest ~ '^[a-f0-9]{64}$' AND jsonb_typeof(admission)='object')
);
--> statement-breakpoint
CREATE INDEX subscription_proration_card_reads_payment ON subscription_proration_card_reads(payment_id);
--> statement-breakpoint
CREATE TABLE subscription_proration_card_read_finishes (
 read_id uuid PRIMARY KEY REFERENCES subscription_proration_card_reads(id) ON DELETE RESTRICT,proof jsonb NOT NULL,proof_digest text NOT NULL,actual_result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT subscription_proration_card_read_finishes_digest CHECK(proof_digest ~ '^[a-f0-9]{64}$' AND jsonb_typeof(proof)='object' AND jsonb_typeof(actual_result)='object')
);
--> statement-breakpoint
CREATE TABLE subscription_proration_card_read_stops (
 read_id uuid PRIMARY KEY REFERENCES subscription_proration_card_reads(id) ON DELETE RESTRICT,proof jsonb NOT NULL,proof_digest text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT subscription_proration_card_read_stops_digest CHECK(proof_digest ~ '^[a-f0-9]{64}$' AND jsonb_typeof(proof)='object')
);
--> statement-breakpoint
CREATE FUNCTION freeholder_subscription_proration_card_writer() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p subscription_prorations%ROWTYPE;i invoices%ROWTYPE;cash payments%ROWTYPE;m subscription_proration_card_mandates%ROWTYPE;
 ticket subscription_proration_card_reads%ROWTYPE;payload jsonb;original jsonb;body jsonb;parent subscriptions%ROWTYPE;method payment_methods%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' OR current_setting('freeholder.proration_card_v1',true) IS DISTINCT FROM '1' THEN
  RAISE EXCEPTION 'Original card mandates, attempts, protocols, jobs and distinct actual read receipts are immutable' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='subscription_proration_payment_protocols' THEN
  SELECT * INTO p FROM subscription_prorations WHERE id=NEW.proration_id;
  SELECT * INTO i FROM invoices WHERE id=NEW.invoice_id;SELECT * INTO cash FROM payments WHERE id=NEW.payment_id;
  IF p.id IS NULL OR p.debit_invoice_id IS DISTINCT FROM i.id OR cash.invoice_id IS DISTINCT FROM i.id OR i.source_type<>'subscription'
   OR i.source_id IS DISTINCT FROM p.subscription_id::text||':proration:'||p.id::text OR cash.provider<>'stripe' OR cash.method NOT IN('saved_method','hosted_checkout')
   OR cash.status<>'created' OR cash.provider_ref IS NOT NULL OR cash.provider_checkout_ref IS NOT NULL
   OR EXISTS(SELECT 1 FROM merchant_payment_dispatches WHERE payment_id=cash.id) THEN
   RAISE EXCEPTION 'Only an actual new original gross-proration request can select its first provider protocol before any caller' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='subscription_proration_card_mandates' THEN
  SELECT * INTO p FROM subscription_prorations WHERE id=NEW.proration_id;SELECT * INTO parent FROM subscriptions WHERE id=p.subscription_id;
  SELECT * INTO i FROM invoices WHERE id=NEW.invoice_id;SELECT * INTO method FROM payment_methods WHERE id=NEW.payment_method_id;
  IF p.id IS NULL OR p.debit_invoice_id IS DISTINCT FROM i.id OR p.snapshot->>'billingMode' IS DISTINCT FROM 'platform' OR p.original_trial_ends_at IS NOT NULL
   OR NEW.accepted_quote_digest IS DISTINCT FROM p.accepted_quote_digest OR i.total_minor-i.credited_minor<=0 OR method.status IS DISTINCT FROM 'active'
   OR parent.payment_method_id IS DISTINCT FROM method.id OR method.contact_id IS DISTINCT FROM parent.contact_id
   OR NEW.method->>'id' IS DISTINCT FROM method.id::text OR NEW.method->>'provider' IS DISTINCT FROM 'stripe'
   OR NEW.method->>'providerMethodRef' IS DISTINCT FROM method.provider_method_ref OR NEW.method->>'providerCustomerRef' IS DISTINCT FROM method.provider_customer_ref
   OR NEW.method->>'providerPlatformAccountId' IS DISTINCT FROM method.provider_platform_account_id OR NEW.method->>'providerAccountId' IS DISTINCT FROM method.provider_account_id
   OR NEW.method->>'providerApiVersion' IS DISTINCT FROM '2026-02-25.clover' OR NEW.method->>'kind' IS DISTINCT FROM method.kind THEN
   RAISE EXCEPTION 'Retain only the explicitly reviewed original-account active method and exact positive accepted target' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='subscription_proration_card_attempts' THEN
  SELECT * INTO m FROM subscription_proration_card_mandates WHERE proration_id=NEW.proration_id;SELECT * INTO p FROM subscription_prorations WHERE id=m.proration_id;
  SELECT * INTO cash FROM payments WHERE id=NEW.payment_id;body=NEW.provider_request;
  IF m.proration_id IS NULL OR NEW.invoice_id IS DISTINCT FROM m.invoice_id OR cash.invoice_id IS DISTINCT FROM m.invoice_id OR cash.status<>'created' OR cash.method<>'saved_method' OR cash.provider<>'stripe'
   OR cash.provider_ref IS NOT NULL OR cash.provider_checkout_ref IS NOT NULL OR p.state<>'awaiting_payment' OR p.effective_at<=clock_timestamp()
   OR body->>'paymentAttemptId' IS DISTINCT FROM cash.id::text OR body->>'invoiceId' IS DISTINCT FROM m.invoice_id::text
   OR body->>'agreementSubscriptionId' IS DISTINCT FROM p.subscription_id::text OR body->>'amountMinor' IS DISTINCT FROM cash.amount_minor::text
   OR body->>'currency' IS DISTINCT FROM cash.currency OR body->>'idempotencyKey' IS DISTINCT FROM cash.idempotency_key
   OR body->>'methodRef' IS DISTINCT FROM m.method->>'providerMethodRef' OR body->>'customerRef' IS DISTINCT FROM m.method->>'providerCustomerRef'
   OR body->>'providerApiVersion' IS DISTINCT FROM m.method->>'providerApiVersion' OR body->>'providerPlatformAccountId' IS DISTINCT FROM m.method->>'providerPlatformAccountId'
   OR coalesce(body->>'providerAccountId','') IS DISTINCT FROM m.method->>'providerAccountId'
   OR NOT EXISTS(SELECT 1 FROM subscription_proration_payment_protocols v WHERE v.payment_id=cash.id AND v.proration_id=p.id AND v.provider_api_version=body->>'providerApiVersion')
   OR NOT EXISTS(SELECT 1 FROM merchant_payment_requests r WHERE r.payment_id=cash.id AND r.provider_contact_ref::text=body->>'contactId' AND r.provider_invoice_ref=m.invoice_id)
   OR EXISTS(SELECT 1 FROM merchant_payment_dispatches WHERE payment_id=cash.id) THEN
   RAISE EXCEPTION 'The original fixed-key card attempt must retain its actual payment, protocol, method and accepted changed-price request before POST' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='subscription_proration_card_jobs' THEN
  SELECT * INTO m FROM subscription_proration_card_mandates WHERE proration_id=NEW.proration_id;
  IF m.proration_id IS NULL OR NEW.original_task->>'prorationId' IS DISTINCT FROM NEW.proration_id::text OR NEW.original_task->>'originalJobId' IS DISTINCT FROM NEW.job_id::text
   OR NEW.original_task->>'acceptedQuoteDigest' IS DISTINCT FROM m.accepted_quote_digest
   OR NOT EXISTS(SELECT 1 FROM job_idempotency_keys c JOIN pgboss.job j ON j.id=c.job_id WHERE c.job_name='subscriptions.collectProrationCard' AND c.job_id=NEW.job_id AND c.payload_hash=NEW.claim_digest AND j.name=c.job_name AND j.data=NEW.original_task) THEN
   RAISE EXCEPTION 'Retain the actual original card collection worker body and immutable enqueue claim in the accepted transaction' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='subscription_proration_card_reads' THEN
  SELECT * INTO cash FROM payments WHERE id=NEW.payment_id;SELECT * INTO p FROM subscription_prorations WHERE debit_invoice_id=cash.invoice_id;
  body=NEW.admission;payload=body->'payload';
  IF p.id IS NULL OR cash.provider<>'stripe' OR cash.method NOT IN('saved_method','hosted_checkout') OR body->>'kind' IS DISTINCT FROM 'admission' OR body->>'version' IS DISTINCT FROM '1'
   OR payload->>'purpose' IS DISTINCT FROM 'gross_proration_payment_read.v1' OR payload->>'readId' IS DISTINCT FROM NEW.id::text
   OR payload->>'paymentId' IS DISTINCT FROM cash.id::text OR payload->>'prorationId' IS DISTINCT FROM p.id::text
   OR payload->'caller'->>'id' IS DISTINCT FROM payload->>'callerId' OR NOT coalesce(payload->'caller'->>'id' ~ '^[a-f0-9-]{36}$',false)
   OR NOT coalesce(payload->'caller'->>'pid' ~ '^[1-9][0-9]*$',false) OR NOT coalesce(payload->>'requestDigest' ~ '^[a-f0-9]{64}$',false)
   OR NOT coalesce(payload->>'sourceRevision' ~ '^[a-f0-9]{64}$',false) OR NOT coalesce(payload->>'completionDigest' ~ '^[a-f0-9]{64}$',false)
   OR NOT coalesce(payload->'request'->>'action' IN('inspect','retire'),false)
   OR NOT coalesce(body->>'signature' ~ '^[A-Za-z0-9_-]{86}$',false) OR NOT coalesce(length(body->>'publicKey') BETWEEN 40 AND 2000,false) OR octet_length(body::text)>128000
   OR NOT freeholder_merchant_creators_quiesced(cash.id) THEN
   RAISE EXCEPTION 'A real independent bank GET needs its own actual signed birth/nonce and every original POST/GET finished or genuinely stopped' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT * INTO ticket FROM subscription_proration_card_reads WHERE id=NEW.read_id;original=ticket.admission->'payload';payload=NEW.proof->'payload';
  IF ticket.id IS NULL OR NEW.proof->>'version' IS DISTINCT FROM '1' OR payload->>'purpose' IS DISTINCT FROM 'gross_proration_payment_read.v1'
   OR payload->>'readId' IS DISTINCT FROM ticket.id::text OR payload->>'paymentId' IS DISTINCT FROM ticket.payment_id::text
   OR payload->>'prorationId' IS DISTINCT FROM original->>'prorationId' OR payload->>'callerId' IS DISTINCT FROM original->>'callerId'
   OR payload->>'requestDigest' IS DISTINCT FROM original->>'requestDigest' OR payload->>'admissionDigest' IS DISTINCT FROM ticket.admission_digest
   OR NOT coalesce(NEW.proof->>'signature' ~ '^[A-Za-z0-9_-]{86}$',false) OR NOT coalesce(length(NEW.proof->>'publicKey') BETWEEN 40 AND 2000,false) THEN
   RAISE EXCEPTION 'Retain the exact original signed read identity and request without substituting another process or resource' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME='subscription_proration_card_read_finishes' THEN
   IF NEW.proof->>'kind' IS DISTINCT FROM 'finish' OR NEW.proof->>'publicKey' IS DISTINCT FROM ticket.admission->>'publicKey'
    OR payload->>'completionDigest' IS DISTINCT FROM original->>'completionDigest' OR NOT coalesce(payload->>'outcome' IN('returned','threw'),false)
    OR payload->>'outcome' IS DISTINCT FROM NEW.actual_result->>'outcome' OR NOT coalesce(payload->>'factsDigest' ~ '^[a-f0-9]{64}$',false)
    OR EXISTS(SELECT 1 FROM subscription_proration_card_read_stops WHERE read_id=ticket.id) THEN
    RAISE EXCEPTION 'Only the actual unstopped original caller can finish its real bank return/throw' USING ERRCODE='23514'; END IF;
  ELSE
   IF NEW.proof->>'kind' IS DISTINCT FROM 'stop_review' OR payload->'originalAdmission' IS DISTINCT FROM ticket.admission
    OR NOT coalesce(payload->>'reviewedBy' ~ '^user:[a-f0-9-]{36}$',false) OR NOT coalesce(payload->>'mechanicalCheck' IN('original_process_absent','unobservable_host_review'),false)
    OR payload->>'sourceRevision' IS DISTINCT FROM original->>'sourceRevision' OR NOT coalesce(payload->>'hostingEvidenceDigest' ~ '^[a-f0-9]{64}$',false)
    OR EXISTS(SELECT 1 FROM subscription_proration_card_read_finishes WHERE read_id=ticket.id) THEN
    RAISE EXCEPTION 'A distinct actual hosting stop must retain the original admission and never invent its finish' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER subscription_proration_payment_protocols_guard BEFORE INSERT OR UPDATE OR DELETE ON subscription_proration_payment_protocols FOR EACH ROW EXECUTE FUNCTION freeholder_subscription_proration_card_writer();
--> statement-breakpoint
CREATE TRIGGER subscription_proration_card_mandates_guard BEFORE INSERT OR UPDATE OR DELETE ON subscription_proration_card_mandates FOR EACH ROW EXECUTE FUNCTION freeholder_subscription_proration_card_writer();
--> statement-breakpoint
CREATE TRIGGER subscription_proration_card_attempts_guard BEFORE INSERT OR UPDATE OR DELETE ON subscription_proration_card_attempts FOR EACH ROW EXECUTE FUNCTION freeholder_subscription_proration_card_writer();
--> statement-breakpoint
CREATE TRIGGER subscription_proration_card_jobs_guard BEFORE INSERT OR UPDATE OR DELETE ON subscription_proration_card_jobs FOR EACH ROW EXECUTE FUNCTION freeholder_subscription_proration_card_writer();
--> statement-breakpoint
CREATE TRIGGER subscription_proration_card_reads_guard BEFORE INSERT OR UPDATE OR DELETE ON subscription_proration_card_reads FOR EACH ROW EXECUTE FUNCTION freeholder_subscription_proration_card_writer();
--> statement-breakpoint
CREATE TRIGGER subscription_proration_card_read_finishes_guard BEFORE INSERT OR UPDATE OR DELETE ON subscription_proration_card_read_finishes FOR EACH ROW EXECUTE FUNCTION freeholder_subscription_proration_card_writer();
--> statement-breakpoint
CREATE TRIGGER subscription_proration_card_read_stops_guard BEFORE INSERT OR UPDATE OR DELETE ON subscription_proration_card_read_stops FOR EACH ROW EXECUTE FUNCTION freeholder_subscription_proration_card_writer();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION freeholder_merchant_creators_quiesced(target uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT NOT EXISTS(SELECT 1 FROM merchant_payment_dispatches d
  LEFT JOIN merchant_payment_dispatch_finishes f ON f.dispatch_id=d.id LEFT JOIN merchant_payment_dispatch_stops r ON r.dispatch_id=d.id
  WHERE d.payment_id=target AND f.dispatch_id IS NULL AND r.dispatch_id IS NULL)
 AND NOT EXISTS(SELECT 1 FROM subscription_proration_card_reads d
  LEFT JOIN subscription_proration_card_read_finishes f ON f.read_id=d.id LEFT JOIN subscription_proration_card_read_stops s ON s.read_id=d.id
  WHERE d.payment_id=target AND f.read_id IS NULL AND s.read_id IS NULL)
$$;
--> statement-breakpoint
CREATE FUNCTION freeholder_subscription_proration_card_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p subscription_prorations%ROWTYPE;cash payments%ROWTYPE;i invoices%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='merchant_payment_requests' THEN
  SELECT * INTO cash FROM payments WHERE id=NEW.payment_id;SELECT * INTO i FROM invoices WHERE id=cash.invoice_id;
  SELECT * INTO p FROM subscription_prorations WHERE debit_invoice_id=i.id;
  IF p.id IS NOT NULL AND cash.provider='stripe' AND cash.method IN('saved_method','hosted_checkout') AND NOT EXISTS(
   SELECT 1 FROM subscription_proration_payment_protocols v WHERE v.payment_id=cash.id AND v.proration_id=p.id AND v.invoice_id=i.id) THEN
   RAISE EXCEPTION 'A new gross-proration payment must retain its original protocol with its immutable request before commit' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT * INTO p FROM subscription_prorations WHERE id=NEW.id;SELECT * INTO i FROM invoices WHERE id=p.debit_invoice_id;
  IF p.snapshot->>'billingMode'='platform' AND p.original_trial_ends_at IS NULL AND i.total_minor-i.credited_minor>0 AND NOT EXISTS(
   SELECT 1 FROM subscription_proration_card_mandates m JOIN subscription_proration_card_jobs j ON j.proration_id=m.proration_id
   WHERE m.proration_id=p.id AND m.invoice_id=i.id AND m.accepted_quote_digest=p.accepted_quote_digest) THEN
   RAISE EXCEPTION 'The accepted automatic changed-price mandate needs its exact original collection task before commit' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER subscription_proration_payment_protocol_complete AFTER INSERT ON merchant_payment_requests DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION freeholder_subscription_proration_card_complete();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER subscription_proration_card_mandate_complete AFTER INSERT OR UPDATE ON subscription_prorations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION freeholder_subscription_proration_card_complete();
--> statement-breakpoint
CREATE FUNCTION freeholder_subscription_proration_card_dispatch() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cash payments%ROWTYPE;p subscription_prorations%ROWTYPE;parent subscriptions%ROWTYPE;a subscription_proration_card_attempts%ROWTYPE;m subscription_proration_card_mandates%ROWTYPE;method payment_methods%ROWTYPE;
BEGIN
 SELECT * INTO cash FROM payments WHERE id=NEW.payment_id;SELECT * INTO p FROM subscription_prorations WHERE debit_invoice_id=cash.invoice_id;
 IF p.id IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO parent FROM subscriptions WHERE id=p.subscription_id;
 IF NOT EXISTS(SELECT 1 FROM module_settings WHERE module='subscriptions' AND enabled) OR p.effective_at<=clock_timestamp() OR p.state<>'awaiting_payment'
  OR parent.status<>'active' OR parent.pending_plan_id IS DISTINCT FROM p.plan_id OR parent.cancelled_at IS NOT NULL OR parent.cancel_at_period_end
  OR NOT EXISTS(SELECT 1 FROM subscription_proration_payment_protocols v WHERE v.payment_id=cash.id AND v.proration_id=p.id)
  OR EXISTS(SELECT 1 FROM merchant_payment_dispatches d WHERE d.payment_id=cash.id) THEN
  RAISE EXCEPTION 'Only the actual first admitted unexpired target can create a charge; stale jobs cannot charge successors' USING ERRCODE='23514'; END IF;
 IF cash.method='saved_method' THEN
  SELECT * INTO a FROM subscription_proration_card_attempts WHERE payment_id=cash.id;SELECT * INTO m FROM subscription_proration_card_mandates WHERE proration_id=p.id;
  SELECT * INTO method FROM payment_methods WHERE id=m.payment_method_id;
  IF a.payment_id IS NULL OR NEW.request_digest IS DISTINCT FROM a.request_digest OR method.status IS DISTINCT FROM 'active' OR method.contact_id IS DISTINCT FROM parent.contact_id
   OR method.provider_method_ref IS DISTINCT FROM m.method->>'providerMethodRef' OR method.provider_customer_ref IS DISTINCT FROM m.method->>'providerCustomerRef'
   OR method.provider_platform_account_id IS DISTINCT FROM m.method->>'providerPlatformAccountId' OR method.provider_account_id IS DISTINCT FROM m.method->>'providerAccountId' THEN
   RAISE EXCEPTION 'The physical charge needs its original accepted mandate, actual immutable request and still-active exact method' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER subscription_proration_card_dispatch_guard BEFORE INSERT ON merchant_payment_dispatches FOR EACH ROW EXECUTE FUNCTION freeholder_subscription_proration_card_dispatch();
