-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C12.38/C1.08: OWNED UNAPPLIED suffix AFTER384439e2d2cbe6bc21faea7a59d141a757f0eb683f6c7082c0532f0d60a93485 (afterfcfe/ea555/173).
-- Root owns assembly/new hash/NEW normal DB. No preserved schema or evidence is rewritten.
CREATE TABLE subscription_provider_read_tickets (
 read_id uuid PRIMARY KEY, operation_id uuid NOT NULL REFERENCES subscription_provider_schedule_operations(id) ON DELETE RESTRICT,
 subscription_id uuid NOT NULL REFERENCES subscription_provider_schedule_resources(subscription_id) ON DELETE RESTRICT,
 admission jsonb NOT NULL, admission_digest text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT subscription_provider_read_tickets_digest CHECK(admission_digest ~ '^[a-f0-9]{64}$' AND jsonb_typeof(admission)='object')
);
--> statement-breakpoint
CREATE INDEX subscription_provider_read_tickets_parent ON subscription_provider_read_tickets(subscription_id);
--> statement-breakpoint
CREATE INDEX subscription_provider_read_tickets_operation ON subscription_provider_read_tickets(operation_id);
--> statement-breakpoint
CREATE TABLE subscription_provider_read_finishes (
 read_id uuid PRIMARY KEY REFERENCES subscription_provider_read_tickets(read_id) ON DELETE RESTRICT,
 proof jsonb NOT NULL, proof_digest text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT subscription_provider_read_finishes_digest CHECK(proof_digest ~ '^[a-f0-9]{64}$' AND jsonb_typeof(proof)='object')
);
--> statement-breakpoint
CREATE TABLE subscription_provider_read_stops (
 read_id uuid PRIMARY KEY, operation_id uuid NOT NULL REFERENCES subscription_provider_schedule_operations(id) ON DELETE RESTRICT,
 subscription_id uuid NOT NULL REFERENCES subscription_provider_schedule_resources(subscription_id) ON DELETE RESTRICT,
 proof jsonb NOT NULL, proof_digest text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT subscription_provider_read_stops_digest CHECK(proof_digest ~ '^[a-f0-9]{64}$' AND jsonb_typeof(proof)='object')
);
--> statement-breakpoint
CREATE INDEX subscription_provider_read_stops_parent ON subscription_provider_read_stops(subscription_id);
--> statement-breakpoint
CREATE INDEX subscription_provider_read_stops_operation ON subscription_provider_read_stops(operation_id);
--> statement-breakpoint
CREATE FUNCTION freeholder_subscription_provider_reader_writer() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE operation subscription_provider_schedule_operations%ROWTYPE; ticket subscription_provider_read_tickets%ROWTYPE; admission jsonb; payload jsonb; body jsonb; proof jsonb;
BEGIN
 IF TG_OP<>'INSERT' OR current_setting('freeholder.subscription_provider_read_v1',true) IS DISTINCT FROM '1' THEN
  RAISE EXCEPTION 'Original provider reader admissions, actual finishes and independent stop receipts are immutable through their guarded writers' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='subscription_provider_read_tickets' THEN
  SELECT * INTO operation FROM subscription_provider_schedule_operations WHERE id=NEW.operation_id;
  admission=NEW.admission; proof=admission->'ownership'; payload=proof->'payload';
  IF operation.id IS NULL OR NEW.subscription_id IS DISTINCT FROM operation.subscription_id OR admission->>'readId' IS DISTINCT FROM NEW.read_id::text
   OR admission->>'operationId' IS DISTINCT FROM operation.id::text OR admission->>'requestDigest' IS DISTINCT FROM operation.request_digest
   OR NOT coalesce(admission->>'source' IN('schedule_read_admitted','phase_product_read_admitted'),false)
   OR proof->>'kind' IS DISTINCT FROM 'admission' OR proof->>'version' IS DISTINCT FROM '1'
   OR payload->>'readId' IS DISTINCT FROM NEW.read_id::text OR payload->>'operationId' IS DISTINCT FROM operation.id::text OR payload->>'subscriptionId' IS DISTINCT FROM NEW.subscription_id::text
   OR payload->>'requestDigest' IS DISTINCT FROM operation.request_digest OR payload->>'callerId' IS DISTINCT FROM admission->>'callerId'
   OR payload->'caller'->>'id' IS DISTINCT FROM admission->>'callerId' OR payload->'caller'->>'pid' IS NULL
   OR payload->>'completionDigest' IS DISTINCT FROM admission->>'completionDigest' OR NOT coalesce(payload->>'completionDigest' ~ '^[a-f0-9]{64}$',false)
   OR payload->>'completionDigest' IS NOT DISTINCT FROM operation.original_request->>'callerCompletionDigest'
   OR NOT coalesce(proof->>'signature' ~ '^[A-Za-z0-9_-]{86}$',false) OR NOT coalesce(length(proof->>'publicKey') BETWEEN 40 AND 2000,false)
   OR octet_length(NEW.admission::text)>128000 THEN
   RAISE EXCEPTION 'A new reader needs its actual original signed admission and process birth' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='subscription_provider_read_finishes' THEN
  SELECT * INTO ticket FROM subscription_provider_read_tickets WHERE read_id=NEW.read_id;
  payload=NEW.proof->'payload'; admission=ticket.admission;
  IF ticket.read_id IS NULL OR EXISTS(SELECT 1 FROM subscription_provider_read_stops WHERE read_id=NEW.read_id)
   OR NEW.proof->>'kind' IS DISTINCT FROM 'finish' OR NEW.proof->>'version' IS DISTINCT FROM '1'
   OR NEW.proof->>'publicKey' IS DISTINCT FROM admission->'ownership'->>'publicKey'
   OR payload->>'readId' IS DISTINCT FROM NEW.read_id::text OR payload->>'operationId' IS DISTINCT FROM ticket.operation_id::text OR payload->>'subscriptionId' IS DISTINCT FROM ticket.subscription_id::text
   OR payload->>'admissionDigest' IS DISTINCT FROM ticket.admission_digest OR payload->>'callerId' IS DISTINCT FROM admission->>'callerId'
   OR payload->>'completionDigest' IS DISTINCT FROM admission->>'completionDigest' OR NOT coalesce(payload->>'outcome' IN('returned','threw'),false)
   OR NOT coalesce(payload->>'factsDigest' ~ '^[a-f0-9]{64}$',false) OR NOT coalesce(NEW.proof->>'signature' ~ '^[A-Za-z0-9_-]{86}$',false) THEN
   RAISE EXCEPTION 'Only the actual original signed reader may persist its returned or thrown finish before any independent stop' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT * INTO operation FROM subscription_provider_schedule_operations WHERE id=NEW.operation_id;
  SELECT value INTO admission FROM jsonb_array_elements(operation.provider_observation->'history') WHERE value->>'readId'=NEW.read_id::text AND value->>'source' IN('schedule_read_admitted','phase_product_read_admitted');
  payload=NEW.proof->'payload';
  IF operation.id IS NULL OR NEW.subscription_id IS DISTINCT FROM operation.subscription_id OR admission IS NULL
   OR NEW.proof->>'kind' IS DISTINCT FROM 'stop_review' OR NEW.proof->>'version' IS DISTINCT FROM '1'
   OR payload->>'readId' IS DISTINCT FROM NEW.read_id::text OR payload->>'operationId' IS DISTINCT FROM operation.id::text OR payload->>'subscriptionId' IS DISTINCT FROM operation.subscription_id::text
   OR payload->>'requestDigest' IS DISTINCT FROM operation.request_digest OR payload->>'callerId' IS DISTINCT FROM admission->>'callerId'
   OR payload->'originalAdmission' IS DISTINCT FROM admission OR NOT coalesce(payload->>'reviewedBy' ~ '^user:[a-f0-9-]{36}$',false)
   OR NOT coalesce(payload->>'mechanicalCheck' IN('original_process_absent','unobservable_host_review'),false)
   OR NOT coalesce(payload->>'hostingEvidenceDigest' ~ '^[a-f0-9]{64}$',false) OR NOT coalesce(payload->>'sourceRevision' ~ '^[a-f0-9]{64}$',false)
   OR NOT coalesce(NEW.proof->>'signature' ~ '^[A-Za-z0-9_-]{86}$',false) OR NOT coalesce(length(NEW.proof->>'publicKey') BETWEEN 40 AND 2000,false)
   OR EXISTS(SELECT 1 FROM subscription_provider_read_finishes WHERE read_id=NEW.read_id)
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(operation.provider_observation->'history') h(value) WHERE h.value->>'readId'=NEW.read_id::text AND h.value->>'source' IN('schedule_read_finished','phase_product_read_finished')) THEN
   RAISE EXCEPTION 'An independent stopped-runtime receipt must retain its exact original admission without inventing a finish' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER subscription_provider_read_tickets_guard BEFORE INSERT OR UPDATE OR DELETE ON subscription_provider_read_tickets FOR EACH ROW EXECUTE FUNCTION freeholder_subscription_provider_reader_writer();
--> statement-breakpoint
CREATE TRIGGER subscription_provider_read_finishes_guard BEFORE INSERT OR UPDATE OR DELETE ON subscription_provider_read_finishes FOR EACH ROW EXECUTE FUNCTION freeholder_subscription_provider_reader_writer();
--> statement-breakpoint
CREATE TRIGGER subscription_provider_read_stops_guard BEFORE INSERT OR UPDATE OR DELETE ON subscription_provider_read_stops FOR EACH ROW EXECUTE FUNCTION freeholder_subscription_provider_reader_writer();
--> statement-breakpoint
CREATE FUNCTION freeholder_subscription_provider_reader_history() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prior jsonb; current_history jsonb; entry jsonb; ticket subscription_provider_read_tickets%ROWTYPE;
BEGIN
 prior=coalesce(OLD.provider_observation->'history','[]'::jsonb); current_history=coalesce(NEW.provider_observation->'history','[]'::jsonb);
 IF current_history IS NOT DISTINCT FROM prior THEN RETURN NEW; END IF;
 IF jsonb_typeof(current_history)<>'array' OR jsonb_array_length(current_history)>5000 OR jsonb_array_length(current_history)<jsonb_array_length(prior)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(prior) WITH ORDINALITY h(value,position) WHERE h.value IS DISTINCT FROM current_history->(h.position::int-1)) THEN
  RAISE EXCEPTION 'Original provider reader history is append-only and bounded' USING ERRCODE='23514'; END IF;
 FOR entry IN SELECT value FROM jsonb_array_elements(current_history) WITH ORDINALITY h(value,position) WHERE position>jsonb_array_length(prior) LOOP
  IF entry->>'readId' IS NULL THEN CONTINUE; END IF;
  IF entry->>'source'='provider_read_stop_reviewed' THEN
   IF NOT EXISTS(SELECT 1 FROM subscription_provider_read_stops s WHERE s.read_id::text=entry->>'readId' AND s.operation_id=NEW.id AND s.subscription_id=NEW.subscription_id
    AND s.proof=entry->'proof' AND s.proof_digest=entry->>'receiptDigest') THEN RAISE EXCEPTION 'Reader stop history requires its separate original signed human receipt' USING ERRCODE='23514'; END IF;
  ELSE
   IF EXISTS(SELECT 1 FROM subscription_provider_read_stops s WHERE s.read_id::text=entry->>'readId') THEN RAISE EXCEPTION 'A stopped original reader cannot append late callbacks or a fictional finish' USING ERRCODE='23514'; END IF;
   IF entry->>'source' IN('schedule_read_admitted','phase_product_read_admitted') THEN
    IF NOT EXISTS(SELECT 1 FROM subscription_provider_read_tickets t WHERE t.read_id::text=entry->>'readId' AND t.operation_id=NEW.id AND t.subscription_id=NEW.subscription_id AND t.admission=entry) THEN
     RAISE EXCEPTION 'A new physical GET needs its own signed immutable original ticket' USING ERRCODE='23514'; END IF;
   ELSIF entry->>'source' IN('schedule_read_finished','phase_product_read_finished') THEN
    SELECT * INTO ticket FROM subscription_provider_read_tickets WHERE read_id::text=entry->>'readId';
    IF ticket.read_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM subscription_provider_read_finishes f WHERE f.read_id=ticket.read_id AND f.proof=entry->'ownership') THEN
     RAISE EXCEPTION 'The original signed finish receipt must precede its history projection' USING ERRCODE='23514'; END IF;
   END IF;
  END IF;
 END LOOP;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER subscription_provider_reader_history_guard BEFORE UPDATE ON subscription_provider_schedule_operations FOR EACH ROW EXECUTE FUNCTION freeholder_subscription_provider_reader_history();
--> statement-breakpoint
CREATE FUNCTION freeholder_subscription_provider_reader_projection() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid; operation subscription_provider_schedule_operations%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='subscription_provider_read_finishes' THEN SELECT operation_id INTO target FROM subscription_provider_read_tickets WHERE read_id=NEW.read_id; ELSE target=NEW.operation_id; END IF;
 SELECT * INTO operation FROM subscription_provider_schedule_operations WHERE id=target;
 IF operation.id IS NULL OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(operation.provider_observation->'history') h(value) WHERE h.value->>'readId'=NEW.read_id::text AND(
  (TG_TABLE_NAME='subscription_provider_read_tickets' AND h.value->>'source' IN('schedule_read_admitted','phase_product_read_admitted') AND h.value=to_jsonb(NEW)->'admission')
  OR(TG_TABLE_NAME='subscription_provider_read_finishes' AND h.value->>'source' IN('schedule_read_finished','phase_product_read_finished') AND h.value->'ownership'=to_jsonb(NEW)->'proof')
  OR(TG_TABLE_NAME='subscription_provider_read_stops' AND h.value->>'source'='provider_read_stop_reviewed' AND h.value->'proof'=to_jsonb(NEW)->'proof' AND h.value->>'receiptDigest'=to_jsonb(NEW)->>'proof_digest'))) THEN
  RAISE EXCEPTION 'Every original signed reader receipt requires its exact immutable journal projection in the same transaction' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER subscription_provider_read_tickets_projection AFTER INSERT ON subscription_provider_read_tickets DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION freeholder_subscription_provider_reader_projection();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER subscription_provider_read_finishes_projection AFTER INSERT ON subscription_provider_read_finishes DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION freeholder_subscription_provider_reader_projection();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER subscription_provider_read_stops_projection AFTER INSERT ON subscription_provider_read_stops DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION freeholder_subscription_provider_reader_projection();
--> statement-breakpoint
CREATE FUNCTION freeholder_subscription_provider_reader_closed(target uuid, admission jsonb) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM subscription_provider_schedule_operations o CROSS JOIN LATERAL jsonb_array_elements(o.provider_observation->'history') finish(value)
  WHERE o.id=target AND finish.value->>'source'=CASE admission->>'source' WHEN 'schedule_read_admitted' THEN 'schedule_read_finished' ELSE 'phase_product_read_finished' END
   AND finish.value->>'readId'=admission->>'readId' AND finish.value->>'operationId'=o.id::text AND finish.value->>'requestDigest'=o.request_digest
   AND finish.value->>'completionDigest'=admission->>'completionDigest' AND finish.value->>'outcome' IN('returned','threw')
   AND(admission->'ownership' IS NULL OR EXISTS(SELECT 1 FROM subscription_provider_read_finishes f WHERE f.read_id::text=admission->>'readId' AND f.proof=finish.value->'ownership')))
 OR EXISTS(SELECT 1 FROM subscription_provider_read_stops s JOIN subscription_provider_schedule_operations o ON o.id=s.operation_id
  WHERE s.operation_id=target AND s.read_id::text=admission->>'readId' AND s.proof->'payload'->'originalAdmission'=admission
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(o.provider_observation->'history') h(value) WHERE h.value->>'source'='provider_read_stop_reviewed'
    AND h.value->>'readId'=s.read_id::text AND h.value->'proof'=s.proof AND h.value->>'receiptDigest'=s.proof_digest))
$$;
--> statement-breakpoint
CREATE FUNCTION freeholder_subscription_provider_readers_quiescent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.state='quiesced' AND EXISTS(SELECT 1 FROM subscription_provider_schedule_operations o CROSS JOIN LATERAL jsonb_array_elements(o.provider_observation->'history') admission(value)
  WHERE o.subscription_id=NEW.subscription_id AND admission.value->>'source' IN('schedule_read_admitted','phase_product_read_admitted') AND NOT freeholder_subscription_provider_reader_closed(o.id,admission.value)) THEN
  RAISE EXCEPTION 'Every original reader needs its actual finish or independent runtime stop before provider quiescence' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER subscription_provider_readers_quiescence_guard BEFORE INSERT OR UPDATE ON subscription_provider_schedule_resources FOR EACH ROW EXECUTE FUNCTION freeholder_subscription_provider_readers_quiescent();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION freeholder_subscription_resumption_callers_closed(target uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT NOT EXISTS(SELECT 1 FROM subscription_provider_schedule_operations o WHERE o.subscription_id=target AND(
  o.state NOT IN('confirmed','refused') OR jsonb_typeof(o.provider_observation->'history') IS DISTINCT FROM 'array' OR jsonb_array_length(o.provider_observation->'history')>5000
  OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(o.provider_observation->'history') h(value)
   WHERE h.value->>'operationId'=o.id::text AND h.value->>'requestDigest'=o.request_digest AND(
    (h.value->>'source'='physical_caller_finished' AND h.value->>'completionDigest'=o.original_request->>'callerCompletionDigest' AND h.value->>'outcome' IN('returned','threw'))
    OR(h.value->>'source'='human_stopped_caller' AND h.value->>'actor' ~ '^user:[a-f0-9-]{36}$' AND h.value->>'stoppedCallerEvidenceDigest' ~ '^[a-f0-9]{64}$' AND h.value->>'providerFinalEvidenceDigest' ~ '^[a-f0-9]{64}$')))
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(o.provider_observation->'history') admission(value) WHERE admission.value->>'source' IN('schedule_read_admitted','phase_product_read_admitted')
   AND(admission.value->>'operationId' IS DISTINCT FROM o.id::text OR admission.value->>'requestDigest' IS DISTINCT FROM o.request_digest
    OR admission.value->>'completionDigest' IS NOT DISTINCT FROM o.original_request->>'callerCompletionDigest'
    OR NOT freeholder_subscription_provider_reader_closed(o.id,admission.value)))))
$$;
