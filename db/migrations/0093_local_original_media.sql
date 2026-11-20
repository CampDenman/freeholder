-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
-- C1.12/C11.08: admit the local adapter's content-bound request/inventory proof.
DO $migration$
DECLARE item record; source_body text; successor_body text;
BEGIN
 FOR item IN SELECT * FROM (VALUES
  ('freeholder_media_original_applied_review(uuid)','freeholder_media_original_applied_review(original_call uuid)','binding->>''kind'' IN (''s3'',''replit'')','binding->>''kind'' IN (''s3'',''replit'',''local'')','80a748a80313c65a1210a9816015a1bb7b7d12682e9c29062d95c3cb2b29f59c','1940df0492fdbf0a92cc48c032ae5e89efd2f3a0bc408b9a563bcb805fbe4f33'),
  ('freeholder_media_original_absence_inventory_complete(uuid)','freeholder_media_original_absence_inventory_complete(original_inventory uuid)','binding->>''kind'' IN (''s3'',''replit'')','binding->>''kind'' IN (''s3'',''replit'',''local'')','144cefee8f7175de09cd82aa8d7225138cfb5619e3c91e02cbd70c0fa125873e','6f3d4eab6f7d919d7cbe5a0d1aa7ac2887c6186b123dc7a5dbd164e4c259f9d8'),
  ('freeholder_media_original_positive_inventory_complete(uuid)','freeholder_media_original_positive_inventory_complete(original_inventory uuid)','binding->>''kind'' IN (''s3'',''replit'')','binding->>''kind'' IN (''s3'',''replit'',''local'')','43da47f6d26e44cb66dcff841cea0ecd989d1d576eef5bfd1d92bd4233eaac92','58685505f5612255a16c1761aafd43bf8edaff77892447d312d067ca8bb40fcd'),
  ('freeholder_media_ordinary_retirement_proven(uuid)','freeholder_media_ordinary_retirement_proven(reservation uuid)','storage_kind NOT IN (''s3'',''replit'')','storage_kind NOT IN (''s3'',''replit'',''local'')','8d314f184b15dbdef87a55d3ba6ec653cde227caeb639c7257d3c2c42158b3cb','1811c96a8a407fe42be88dbd63b1ca3a588f58dfc73e0642ccb72b5a3aa6c690')
 ) AS specifications(signature,declaration,needle,replacement,predecessor,successor)
 LOOP
  SELECT prosrc INTO source_body FROM pg_proc WHERE oid=to_regprocedure(item.signature);
  IF source_body IS NULL OR encode(sha256(convert_to(source_body,'UTF8')),'hex')<>item.predecessor THEN
   RAISE EXCEPTION 'Unexpected original media proof predecessor: %',item.signature USING ERRCODE='23514';
  END IF;
  successor_body:=replace(source_body,item.needle,item.replacement);
  IF successor_body=source_body OR position(item.needle in successor_body)<>0 OR encode(sha256(convert_to(successor_body,'UTF8')),'hex')<>item.successor THEN
   RAISE EXCEPTION 'Original local media proof composition failed: %',item.signature USING ERRCODE='23514';
  END IF;
  EXECUTE format('CREATE OR REPLACE FUNCTION %s RETURNS boolean LANGUAGE sql STABLE AS $body$%s$body$',item.declaration,successor_body);
 END LOOP;
END $migration$;
--> statement-breakpoint
DO $migration$
DECLARE source_body text; successor_body text;
BEGIN
 SELECT prosrc INTO source_body FROM pg_proc WHERE oid=to_regprocedure('freeholder_media_original_review_context_guard()');
 IF source_body IS NULL OR encode(sha256(convert_to(source_body,'UTF8')),'hex')<>'daefe7235fee6daa693ce189b1b4b034376887fedddda55d4e7a30b3a86d132d' THEN
  RAISE EXCEPTION 'Unexpected original PUT review predecessor' USING ERRCODE='23514';
 END IF;
 successor_body:=replace(source_body,$marker$
 IF NEW.multipart_operation_id IS NOT NULL OR caller.id IS NULL OR caller.kind<>'ordinary_put' OR caller.object_receipt_id IS DISTINCT FROM NEW.object_receipt_id OR NEW.permits_retry OR NEW.outcome<>'applied' THEN RAISE EXCEPTION 'Original review closes only affirmative exact applied PUT proof, never absence/retry/multipart' USING ERRCODE='23514'; END IF;$marker$,$replacement$
 IF NEW.multipart_operation_id IS NULL AND NEW.object_id IS NULL AND NEW.object_receipt_id IS NOT NULL AND caller.kind='ordinary_put' AND NEW.outcome='not_applied' THEN
  SELECT * INTO original FROM media_object_writes WHERE id=NEW.object_receipt_id;
  IF TG_OP<>'INSERT' OR NEW.permits_retry OR NEW.created_at<>transaction_timestamp() OR caller.stop_receipt_id IS NOT NULL OR caller.stopped_at IS NOT NULL
   OR original.id IS NULL OR original.operation_kind<>'put' OR original.original_reservation_id IS NULL OR original.state NOT IN ('started','unknown') OR original.observed_accepted_at IS NOT NULL
   OR proof.id IS NULL OR proof.object_receipt_id IS DISTINCT FROM original.id OR proof.kind<>'ordinary_recovery_read' OR proof.state<>'returned' OR proof.returned_at IS NULL OR proof.result_absent IS NULL
   OR NOT ((original.provider_revision IS NOT NULL AND original.provider_revision_digest=freeholder_media_transfer_fact_digest(original.provider_revision) AND proof.expected_revision=original.provider_revision) OR (original.provider_revision IS NULL AND original.storage_kind='local' AND original.sha256 IS NOT NULL AND proof.expected_revision=jsonb_build_object('kind','generation','key',original.object_key,'namespace',original.storage_namespace,'value',original.sha256)))
   OR inventory.id IS NULL OR inventory.object_receipt_id IS DISTINCT FROM original.id OR inventory.anchor_call_id IS DISTINCT FROM caller.id OR inventory.proof_call_id IS DISTINCT FROM proof.id OR inventory.purpose<>'retirement' OR NOT freeholder_media_original_absence_inventory_complete(inventory.id)
   OR (SELECT count(*) FROM media_storage_transfer_requests request WHERE request.call_id=caller.id AND request.descriptor->>'kind'='object.put')<>1
   OR EXISTS(SELECT 1 FROM media_storage_transfer_requests request WHERE request.call_id=caller.id AND (request.returned_at IS NULL OR request.descriptor->>'kind' IN ('object.delete','multipart.create','multipart.complete','multipart.abort','multipart.sign')))
   OR (NEW.stop_drain_id IS NULL AND (caller.returned_at IS NULL OR caller.result_digest IS NULL OR original.writer_finished_at IS NULL) OR NEW.stop_drain_id IS NOT NULL AND NOT freeholder_media_original_executor_stopped(caller.id,NEW.stop_drain_id))
  THEN RAISE EXCEPTION 'Original PUT absence review needs its exact finished unacknowledged caller, fresh pinned absence and complete physical inventory' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF NEW.multipart_operation_id IS NOT NULL OR caller.id IS NULL OR caller.kind<>'ordinary_put' OR caller.object_receipt_id IS DISTINCT FROM NEW.object_receipt_id OR NEW.permits_retry OR NEW.outcome<>'applied' THEN RAISE EXCEPTION 'Original review closes only affirmative exact applied PUT proof, never absence/retry/multipart' USING ERRCODE='23514'; END IF;$replacement$);
 successor_body:=replace(successor_body,$reviewer$NEW.outcome<>'retired' OR NEW.reviewed_by<>'system:media-cleanup' OR caller.state NOT IN('admitted','unknown')$reviewer$,$reviewer_replacement$NEW.outcome<>'retired' OR (NEW.reviewed_by<>'system:media-cleanup' AND NEW.reviewed_by !~ '^user:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') OR caller.state NOT IN('admitted','unknown')$reviewer_replacement$);
 IF successor_body=source_body OR encode(sha256(convert_to(successor_body,'UTF8')),'hex')<>'a312191e19473e63d131dacbf12dbba6ecbeae0c5a3af693dd3c3c469cb0b66c' THEN
  RAISE EXCEPTION 'Original PUT absence review composition failed' USING ERRCODE='23514';
 END IF;
 EXECUTE format('CREATE OR REPLACE FUNCTION freeholder_media_original_review_context_guard() RETURNS trigger LANGUAGE plpgsql AS $body$%s$body$',successor_body);
END $migration$;
--> statement-breakpoint
DO $migration$
DECLARE source_body text; successor_body text;
BEGIN
 SELECT prosrc INTO source_body FROM pg_proc WHERE oid=to_regprocedure('freeholder_media_ordinary_retirement_guard()');
 IF source_body IS NULL OR encode(sha256(convert_to(source_body,'UTF8')),'hex')<>'ac8c88644ce7f314cf609ee585b2ef688287a2e16235dc32307e7d329a186f04' THEN
  RAISE EXCEPTION 'Unexpected original PUT retirement predecessor' USING ERRCODE='23514';
 END IF;
 successor_body:=replace(source_body,$marker$  IF NOT freeholder_media_ordinary_retirement_proven(OLD.original_reservation_id) THEN RAISE EXCEPTION 'Retain all original caller, pinned absence and complete physical-version/session evidence before standalone retirement' USING ERRCODE='23514'; END IF;$marker$,$replacement$  IF NOT freeholder_media_ordinary_retirement_proven(OLD.original_reservation_id) AND NOT (
   OLD.operation_kind='put' AND OLD.state IN ('started','unknown') AND NEW.state='confirmed_absent' AND EXISTS(
    SELECT 1 FROM media_storage_transfer_reviews review JOIN media_storage_transfer_calls caller ON caller.id=review.call_id JOIN media_storage_provider_inventories inventory ON inventory.id=review.inventory_id
    WHERE review.object_receipt_id=OLD.id AND review.outcome='not_applied' AND NOT review.permits_retry AND review.id=caller.stop_receipt_id AND caller.kind='ordinary_put' AND caller.state='stopped' AND caller.stopped_at IS NOT NULL
     AND inventory.object_receipt_id=OLD.id AND inventory.anchor_call_id=caller.id AND inventory.proof_call_id=review.read_call_id AND inventory.purpose='retirement' AND freeholder_media_original_absence_inventory_complete(inventory.id)
   )
  ) THEN RAISE EXCEPTION 'Retain all original caller, pinned absence and complete physical-version/session evidence before standalone retirement' USING ERRCODE='23514'; END IF;$replacement$);
 IF successor_body=source_body OR encode(sha256(convert_to(successor_body,'UTF8')),'hex')<>'a5851d4e1defb4af5f32aa5c290d07cdc3a2b183c64a32276588967993bb5a3b' THEN
  RAISE EXCEPTION 'Original PUT absence retirement composition failed' USING ERRCODE='23514';
 END IF;
 EXECUTE format('CREATE OR REPLACE FUNCTION freeholder_media_ordinary_retirement_guard() RETURNS trigger LANGUAGE plpgsql AS $body$%s$body$',successor_body);
END $migration$;
--> statement-breakpoint
DO $migration$
DECLARE source_body text; successor_body text;
BEGIN
 SELECT prosrc INTO source_body FROM pg_proc WHERE oid=to_regprocedure('freeholder_media_original_inventory_evidence_guard()');
 IF source_body IS NULL OR encode(sha256(convert_to(source_body,'UTF8')),'hex')<>'234cb382c2b35995b53bf01f05932095d94051f107fe0ec8f31994c7c881d470' THEN
  RAISE EXCEPTION 'Unexpected original absence inventory predecessor' USING ERRCODE='23514';
 END IF;
 successor_body:=replace(source_body,$marker$   IF receipt.provider_revision IS NULL OR receipt.provider_revision_digest IS DISTINCT FROM freeholder_media_transfer_fact_digest(receipt.provider_revision) OR proof.expected_revision IS DISTINCT FROM receipt.provider_revision OR proof.result_absent IS NULL OR NOT EXISTS(SELECT 1 FROM media_storage_transfer_requests request JOIN media_storage_transfer_request_observations fact ON fact.request_id=request.id WHERE request.call_id=proof.id AND request.state='returned' AND request.returned_at IS NOT NULL AND fact.facts->>'stage'='absence') OR EXISTS(SELECT 1 FROM media_storage_transfer_requests request WHERE request.call_id=proof.id AND (request.state<>'returned' OR request.returned_at IS NULL OR request.descriptor->>'kind' NOT IN ('object.metadata','object.read','object.body') OR request.descriptor->'expectedRevision' IS DISTINCT FROM receipt.provider_revision)) THEN RAISE EXCEPTION 'Retirement inventory requires a finished actual pinned absence read, never logical404 alone' USING ERRCODE='23514'; END IF;$marker$,$replacement$   IF NOT ((receipt.provider_revision IS NOT NULL AND receipt.provider_revision_digest=freeholder_media_transfer_fact_digest(receipt.provider_revision) AND proof.expected_revision=receipt.provider_revision) OR (receipt.provider_revision IS NULL AND receipt.storage_kind='local' AND receipt.sha256 IS NOT NULL AND proof.expected_revision=jsonb_build_object('kind','generation','key',receipt.object_key,'namespace',receipt.storage_namespace,'value',receipt.sha256))) OR proof.result_absent IS NULL OR NOT EXISTS(SELECT 1 FROM media_storage_transfer_requests request JOIN media_storage_transfer_request_observations fact ON fact.request_id=request.id WHERE request.call_id=proof.id AND request.state='returned' AND request.returned_at IS NOT NULL AND fact.facts->>'stage'='absence') OR EXISTS(SELECT 1 FROM media_storage_transfer_requests request WHERE request.call_id=proof.id AND (request.state<>'returned' OR request.returned_at IS NULL OR request.descriptor->>'kind' NOT IN ('object.metadata','object.read','object.body') OR request.descriptor->'expectedRevision' IS DISTINCT FROM proof.expected_revision)) THEN RAISE EXCEPTION 'Retirement inventory requires a finished actual pinned absence read, never logical404 alone' USING ERRCODE='23514'; END IF;$replacement$);
 IF successor_body=source_body OR encode(sha256(convert_to(successor_body,'UTF8')),'hex')<>'798753b6496a23ea291acf44525c987cd686e8fb1a4bf91f87416def7113f48f' THEN
  RAISE EXCEPTION 'Original local absence inventory composition failed' USING ERRCODE='23514';
 END IF;
 EXECUTE format('CREATE OR REPLACE FUNCTION freeholder_media_original_inventory_evidence_guard() RETURNS trigger LANGUAGE plpgsql AS $body$%s$body$',successor_body);
END $migration$;
