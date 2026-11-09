-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C10.33. No expiry releases a hold: unknown ownership/work remains held.
CREATE TABLE deployment_admission_holds (
 operation_id uuid PRIMARY KEY,
 token_sha256 text NOT NULL CHECK(token_sha256 ~ '^[a-f0-9]{64}$'),
 source_revision text NOT NULL CHECK(source_revision ~ '^[a-f0-9]{40}$'),
 phase text NOT NULL DEFAULT 'draining' CHECK(phase IN ('draining','sealed','resuming','released')),
 held_at timestamptz NOT NULL DEFAULT now(),
 sealed_at timestamptz,
 released_at timestamptz,
 resume_proof text CHECK(resume_proof IN ('published','private_restored')),
 release_proof text CHECK(release_proof IN ('published','private_restored')),
 CHECK((phase='released')=(released_at IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX deployment_admission_one_active ON deployment_admission_holds((true)) WHERE released_at IS NULL;
--> statement-breakpoint
CREATE TABLE deployment_admission_runtimes (
 instance_id uuid PRIMARY KEY,
 hold_operation_id uuid REFERENCES deployment_admission_holds(operation_id),
 state text NOT NULL CHECK(state IN ('running','draining','drained','stopped')),
 updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE FUNCTION fh_deployment_inventory() RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE calls_n bigint; pending_n bigint; active_n bigint;
BEGIN
 SELECT (SELECT count(*) FROM member_calls WHERE state IN ('ringing','active'))
       +(SELECT count(*) FROM member_group_calls WHERE state='active') INTO calls_n;
 SELECT count(*) FILTER(WHERE state IN ('created','retry') AND start_after<=now()),
        count(*) FILTER(WHERE state='active') INTO pending_n,active_n FROM pgboss.job;
 RETURN jsonb_build_object('calls',calls_n,'pendingJobs',pending_n,'activeJobs',active_n);
END $$;
--> statement-breakpoint
CREATE FUNCTION fh_deployment_hold_status(op uuid, token_hash text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE held deployment_admission_holds; inventory jsonb; pending_runtimes bigint; unknown_runtimes bigint;
BEGIN
 PERFORM pg_advisory_xact_lock_shared(1691709,33);
 SELECT * INTO held FROM deployment_admission_holds WHERE operation_id=op AND token_sha256=token_hash AND released_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'deployment_hold_owner_mismatch' USING ERRCODE='55000'; END IF;
 inventory:=fh_deployment_inventory();
 SELECT count(*) INTO pending_runtimes FROM deployment_admission_runtimes WHERE hold_operation_id=op AND state NOT IN ('drained','stopped');
 SELECT count(*) INTO unknown_runtimes FROM deployment_admission_runtimes WHERE state NOT IN ('drained','stopped') AND hold_operation_id IS DISTINCT FROM op;
 RETURN jsonb_build_object('version','freeholder-deployment-admission-v1','operationId',op,'sourceRevision',held.source_revision,'phase',held.phase,
   'held',true,'calls',inventory->'calls','pendingJobs',inventory->'pendingJobs','activeJobs',inventory->'activeJobs',
   'pendingRuntimes',pending_runtimes,'unknownRuntimes',unknown_runtimes,
   'readyToStop',held.phase IN ('draining','sealed') AND (inventory->>'calls')::bigint=0 AND (inventory->>'pendingJobs')::bigint=0 AND (inventory->>'activeJobs')::bigint=0 AND pending_runtimes=0 AND unknown_runtimes=0
      AND EXISTS(SELECT 1 FROM deployment_admission_runtimes WHERE hold_operation_id=op));
END $$;
--> statement-breakpoint
CREATE FUNCTION fh_deployment_hold_begin(op uuid, token_hash text, revision text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE prior deployment_admission_holds;
BEGIN
 PERFORM pg_advisory_xact_lock(1691709,33);
 SELECT * INTO prior FROM deployment_admission_holds WHERE operation_id=op;
 IF FOUND THEN
   IF prior.token_sha256<>token_hash OR prior.source_revision<>revision OR prior.released_at IS NOT NULL THEN
     RAISE EXCEPTION 'deployment_hold_owner_mismatch' USING ERRCODE='55000';
   END IF;
   RETURN fh_deployment_hold_status(op,token_hash);
 END IF;
 IF EXISTS(SELECT 1 FROM deployment_admission_holds WHERE released_at IS NULL) THEN RAISE EXCEPTION 'deployment_hold_busy' USING ERRCODE='55000'; END IF;
 INSERT INTO deployment_admission_holds(operation_id,token_sha256,source_revision)VALUES(op,token_hash,revision);
 UPDATE deployment_admission_runtimes SET hold_operation_id=op,state='draining',updated_at=now() WHERE state IN ('running','draining');
 RETURN fh_deployment_hold_status(op,token_hash);
END $$;
--> statement-breakpoint
CREATE FUNCTION fh_deployment_hold_seal(op uuid, token_hash text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE current_status jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(1691709,33);
 current_status:=fh_deployment_hold_status(op,token_hash);
 IF current_status->>'readyToStop'<>'true' THEN RAISE EXCEPTION 'deployment_work_not_drained' USING ERRCODE='55000'; END IF;
 UPDATE deployment_admission_holds SET phase='sealed',sealed_at=coalesce(sealed_at,now()) WHERE operation_id=op;
 RETURN fh_deployment_hold_status(op,token_hash);
END $$;
--> statement-breakpoint
CREATE FUNCTION fh_deployment_hold_release(op uuid, token_hash text, proof text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE held deployment_admission_holds;
BEGIN
 PERFORM pg_advisory_xact_lock(1691709,33);
 SELECT * INTO held FROM deployment_admission_holds WHERE operation_id=op AND token_sha256=token_hash FOR UPDATE;
 IF NOT FOUND OR proof NOT IN ('published','private_restored') OR (proof='published' AND held.resume_proof IS DISTINCT FROM 'published') THEN RAISE EXCEPTION 'deployment_hold_owner_mismatch' USING ERRCODE='55000'; END IF;
 IF held.released_at IS NOT NULL THEN
   IF held.release_proof<>proof THEN RAISE EXCEPTION 'deployment_hold_owner_mismatch' USING ERRCODE='55000'; END IF;
 ELSE
   UPDATE deployment_admission_holds SET phase='released',released_at=now(),release_proof=proof WHERE operation_id=op;
 END IF;
 RETURN jsonb_build_object('version','freeholder-deployment-admission-v1','operationId',op,'sourceRevision',held.source_revision,'held',false,'phase','released','releaseProof',proof);
END $$;
--> statement-breakpoint
CREATE FUNCTION fh_deployment_hold_resume(op uuid, token_hash text, proof text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE held deployment_admission_holds;
BEGIN
 PERFORM pg_advisory_xact_lock(1691709,33);
 SELECT * INTO held FROM deployment_admission_holds WHERE operation_id=op AND token_sha256=token_hash AND released_at IS NULL FOR UPDATE;
 IF NOT FOUND OR proof NOT IN ('published','private_restored') OR held.phase NOT IN ('sealed','resuming')
    OR (held.phase='resuming' AND held.resume_proof<>proof) THEN RAISE EXCEPTION 'deployment_hold_owner_mismatch' USING ERRCODE='55000'; END IF;
 UPDATE deployment_admission_holds SET phase='resuming',resume_proof=proof WHERE operation_id=op;
 RETURN fh_deployment_hold_status(op,token_hash);
END $$;
--> statement-breakpoint
-- Installed on the normal pg-boss parent only after its canonical startup has
-- created that schema. Reject a new recurrence trigger; never cancel an old job.
CREATE FUNCTION fh_deployment_cron_admission() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.name='__pgboss__send-it' THEN
   PERFORM pg_advisory_xact_lock_shared(1691709,33);
   IF EXISTS(SELECT 1 FROM deployment_admission_holds WHERE released_at IS NULL AND phase IN ('draining','sealed')) THEN
     RAISE EXCEPTION 'deployment_new_cron_held' USING ERRCODE='55000';
   END IF;
 END IF;
 RETURN NEW;
END $$;
