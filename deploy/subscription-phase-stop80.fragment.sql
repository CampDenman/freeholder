-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C12.38/C1.08: UNAPPLIED owned tail AFTER full80 predecessor
-- 3a6862457f9342fe7ad109bc83c7a270ef5ac535a9b1639a459c23bc8a9c997f.
-- Never apply to preserved prototypes/goldens; root assembles a NEW80 hash/DB.
CREATE FUNCTION freeholder_phase_schedule_stop_covers(target uuid, proof jsonb) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE item jsonb; operation subscription_provider_schedule_operations%ROWTYPE; actual jsonb; schedule_count integer; seen text[]='{}'; linked jsonb; creator subscription_provider_schedule_operations%ROWTYPE;
BEGIN
 IF proof IS NULL OR jsonb_typeof(proof->'phaseSchedules') IS DISTINCT FROM 'array' OR jsonb_array_length(proof->'phaseSchedules')=0
  OR jsonb_typeof(proof->'resources') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM subscription_provider_schedule_operations o WHERE o.subscription_id=target AND o.original_request->>'resourceKind'='phase_schedule'
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(o.provider_observation->'history','[]'::jsonb)) h(value)
   WHERE h.value->>'operationId'=o.id::text AND h.value->>'requestDigest'=o.request_digest
    AND h.value->>'source' IN('phase_schedule_ack','phase_schedule_read_verified','phase_schedule_read_stale')
    AND coalesce(h.value->>'providerScheduleRef' ~ '^sub_sched_[A-Za-z0-9]{1,195}$',false))) THEN RETURN false; END IF;
 SELECT count(DISTINCT h.value->>'providerScheduleRef') INTO schedule_count
 FROM subscription_provider_schedule_operations o CROSS JOIN LATERAL jsonb_array_elements(coalesce(o.provider_observation->'history','[]'::jsonb)) h(value)
 WHERE o.subscription_id=target AND o.original_request->>'resourceKind' IN('phase_schedule','phase_schedule_stop')
  AND h.value->>'operationId'=o.id::text AND h.value->>'requestDigest'=o.request_digest
  AND h.value->>'source' IN('phase_schedule_ack','phase_schedule_read_verified','phase_schedule_read_stale','phase_schedule_stop_ack');
 IF schedule_count<>jsonb_array_length(proof->'phaseSchedules') THEN RETURN false; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(proof->'phaseSchedules') LOOP
  IF NOT coalesce(item->>'providerScheduleRef' ~ '^sub_sched_[A-Za-z0-9]{1,195}$',false)
   OR item->>'providerScheduleRef'=ANY(seen) OR NOT coalesce(item->>'stopOperationId' ~ '^[a-f0-9-]{36}$',false)
   OR NOT coalesce(item->>'stopEvidenceDigest' ~ '^[a-f0-9]{64}$',false) OR jsonb_typeof(item->'linkedSubscriptionRefs') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  seen=array_append(seen,item->>'providerScheduleRef');
  SELECT * INTO operation FROM subscription_provider_schedule_operations WHERE id=(item->>'stopOperationId')::uuid AND subscription_id=target;
  IF operation.id IS NULL OR operation.kind<>'cancel' OR operation.state<>'confirmed' OR operation.original_request->>'resourceKind'<>'phase_schedule_stop'
   OR operation.original_request->>'providerScheduleRef' IS DISTINCT FROM item->>'providerScheduleRef'
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(operation.provider_observation->'history','[]'::jsonb)) h(value)
    WHERE h.value->>'source'='physical_caller_finished' AND h.value->>'operationId'=operation.id::text AND h.value->>'requestDigest'=operation.request_digest
     AND h.value->>'completionDigest'=operation.original_request->>'callerCompletionDigest' AND h.value->>'outcome'='returned') THEN RETURN false; END IF;
  SELECT h.value->'actual' INTO actual FROM jsonb_array_elements(coalesce(operation.provider_observation->'history','[]'::jsonb)) WITH ORDINALITY h(value,position)
   WHERE h.value->>'source'='phase_schedule_stop_ack' AND h.value->>'operationId'=operation.id::text AND h.value->>'requestDigest'=operation.request_digest
    AND h.value->>'actualDigest'=item->>'stopEvidenceDigest' ORDER BY h.position DESC LIMIT 1;
  IF actual IS NULL OR actual->>'providerScheduleRef' IS DISTINCT FROM item->>'providerScheduleRef' OR actual->>'linkedInventoryComplete' IS DISTINCT FROM 'true'
   OR actual->>'state' IS DISTINCT FROM item->>'state' OR NOT coalesce(actual->>'state' IN('canceled','completed','released'),false)
   OR jsonb_typeof(actual->'providerSubscriptionRefs') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(source.ref) ORDER BY source.ref COLLATE "C"),'[]'::jsonb) INTO linked FROM (
   SELECT h.value->>'providerSubscriptionRef' ref FROM subscription_provider_schedule_operations o
    CROSS JOIN LATERAL jsonb_array_elements(coalesce(o.provider_observation->'history','[]'::jsonb)) h(value)
    WHERE o.subscription_id=target AND h.value->>'providerScheduleRef'=item->>'providerScheduleRef'
     AND h.value->>'operationId'=o.id::text AND h.value->>'requestDigest'=o.request_digest
     AND h.value->>'source' IN('phase_schedule_ack','phase_schedule_read_verified','phase_schedule_read_stale') AND h.value->>'providerSubscriptionRef' IS NOT NULL
   UNION
   SELECT h.value->>'providerSubscriptionRef' ref FROM subscription_provider_schedule_operations o
    CROSS JOIN LATERAL jsonb_array_elements(coalesce(o.provider_observation->'history','[]'::jsonb)) h(value)
    WHERE o.subscription_id=target AND o.original_request->>'resourceKind'='phase_schedule' AND h.value->>'source'='authenticated_invoice_payment'
     AND h.value->>'providerSubscriptionRef' IS NOT NULL
     AND EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(o.provider_observation->'history','[]'::jsonb)) primary_fact(value)
      WHERE primary_fact.value->>'providerScheduleRef'=item->>'providerScheduleRef' AND primary_fact.value->>'operationId'=o.id::text
       AND primary_fact.value->>'requestDigest'=o.request_digest AND primary_fact.value->>'source' IN('phase_schedule_ack','phase_schedule_read_verified','phase_schedule_read_stale'))
   UNION
   SELECT r.ref FROM subscription_provider_schedule_operations o
    CROSS JOIN LATERAL jsonb_array_elements(coalesce(o.provider_observation->'history','[]'::jsonb)) h(value)
    CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(h.value->'actual'->'providerSubscriptionRefs','[]'::jsonb)) r(ref)
    WHERE o.subscription_id=target AND h.value->>'providerScheduleRef'=item->>'providerScheduleRef'
     AND h.value->>'operationId'=o.id::text AND h.value->>'requestDigest'=o.request_digest AND h.value->>'source'='phase_schedule_stop_ack'
  ) source;
  IF linked IS DISTINCT FROM item->'linkedSubscriptionRefs' THEN RETURN false; END IF;
  FOR creator IN SELECT o.* FROM subscription_provider_schedule_operations o WHERE o.subscription_id=target AND o.original_request->>'resourceKind'='phase_schedule'
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(o.provider_observation->'history','[]'::jsonb)) h(value) WHERE h.value->>'providerScheduleRef'=item->>'providerScheduleRef'
    AND h.value->>'operationId'=o.id::text AND h.value->>'requestDigest'=o.request_digest AND h.value->>'source' IN('phase_schedule_ack','phase_schedule_read_verified','phase_schedule_read_stale')) LOOP
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(creator.provider_observation->'history','[]'::jsonb)) h(value)
    WHERE h.value->>'source'='physical_caller_finished' AND h.value->>'operationId'=creator.id::text AND h.value->>'requestDigest'=creator.request_digest
     AND h.value->>'completionDigest'=creator.original_request->>'callerCompletionDigest' AND h.value->>'outcome' IN('returned','threw')) THEN RETURN false; END IF;
  END LOOP;
  IF NOT EXISTS(SELECT 1 FROM subscription_provider_schedule_operations o WHERE o.subscription_id=target AND o.original_request->>'resourceKind'='phase_schedule'
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(o.provider_observation->'history','[]'::jsonb)) h(value) WHERE h.value->>'providerScheduleRef'=item->>'providerScheduleRef'
    AND h.value->>'operationId'=o.id::text AND h.value->>'requestDigest'=o.request_digest AND h.value->>'source' IN('phase_schedule_ack','phase_schedule_read_verified','phase_schedule_read_stale'))) THEN RETURN false; END IF;
  IF jsonb_array_length(linked)=0 THEN
   IF actual->>'state' IS DISTINCT FROM 'canceled' OR jsonb_typeof(actual->'neverStartedProof') IS DISTINCT FROM 'object'
    OR actual->'neverStartedProof' IS DISTINCT FROM item->'neverStartedProof'
    OR actual->'neverStartedProof'->>'originalFirstPhaseStart' IS DISTINCT FROM operation.original_request->>'originalFirstPhaseStart'
    OR actual->'neverStartedProof'->>'providerCanceledAt' IS NULL OR actual->'neverStartedProof'->>'originalFirstPhaseStart' IS NULL OR actual->'neverStartedProof'->>'providerCreatedAt' IS NULL
    OR (actual->'neverStartedProof'->>'providerCanceledAt')::timestamptz < (actual->'neverStartedProof'->>'providerCreatedAt')::timestamptz
    OR extract(epoch FROM (actual->'neverStartedProof'->>'providerCreatedAt')::timestamptz)<0
    OR extract(epoch FROM (actual->'neverStartedProof'->>'providerCanceledAt')::timestamptz)<0
    OR (actual->'neverStartedProof'->>'providerCanceledAt')::timestamptz >= (actual->'neverStartedProof'->>'originalFirstPhaseStart')::timestamptz THEN RETURN false; END IF;
  ELSE
   IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(linked) r(ref) WHERE NOT coalesce(r.ref ~ '^sub_[A-Za-z0-9]{1,195}$',false)
    OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(proof->'resources') resource(value) WHERE resource.value->>'providerSubscriptionRef'=r.ref)) THEN RETURN false; END IF;
  END IF;
 END LOOP;
 RETURN true;
EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR invalid_datetime_format OR invalid_parameter_value THEN RETURN false;
END $$;
--> statement-breakpoint
ALTER TABLE subscription_provider_schedule_resources DROP CONSTRAINT subscription_schedule_resource_stop;
--> statement-breakpoint
ALTER TABLE subscription_provider_schedule_resources ADD CONSTRAINT subscription_schedule_resource_stop CHECK(state<>'quiesced' OR(stopped_proof IS NOT NULL
 AND(provider_subscription_ref IS NOT NULL OR freeholder_phase_schedule_stop_covers(subscription_id,stopped_proof)) AND provider_customer_ref IS NOT NULL AND recovery_pending=false));
--> statement-breakpoint
CREATE FUNCTION freeholder_phase_schedule_quiescence_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.state='quiesced' AND EXISTS(SELECT 1 FROM subscription_provider_schedule_operations o WHERE o.subscription_id=NEW.subscription_id AND o.original_request->>'resourceKind'='phase_schedule')
  AND NOT freeholder_phase_schedule_stop_covers(NEW.subscription_id,NEW.stopped_proof) THEN
  RAISE EXCEPTION 'Original primary schedules require actual caller, stop and linked-resource coverage' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER subscription_schedule_phase_stopped_facts BEFORE INSERT OR UPDATE ON subscription_provider_schedule_resources FOR EACH ROW EXECUTE FUNCTION freeholder_phase_schedule_quiescence_guard();
