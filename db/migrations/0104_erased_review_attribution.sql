-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
-- C1.12/C11.08: minimized operations may retain exact sealed re-review attribution.
DO $migration$
DECLARE source_body text; successor_body text;
BEGIN
 SELECT prosrc INTO source_body FROM pg_proc WHERE oid=to_regprocedure('freeholder_media_multipart_certificate_coverage(uuid)');
 IF source_body IS NULL OR encode(sha256(convert_to(source_body,'UTF8')),'hex')<>'14c86f512fe7ce00bab3038e5b2b487e5a66778763ca05cebb77675966f0168c' THEN
  RAISE EXCEPTION 'Unexpected certificate coverage predecessor' USING ERRCODE='23514';
 END IF;
 successor_body:=replace(source_body,$old$OR operation.actor='erased' AND (operation.provider_upload_id IS NOT NULL OR operation.observed_provider_upload_id IS NOT NULL OR operation.reviewed_by IS NOT NULL OR operation.parts<>'[]'::jsonb)$old$,$new$OR operation.actor='erased' AND (operation.provider_upload_id IS NOT NULL OR operation.observed_provider_upload_id IS NOT NULL OR operation.parts<>'[]'::jsonb OR operation.reviewed_by IS NOT NULL AND NOT EXISTS(SELECT 1 FROM review_rows review WHERE review.multipart_operation_id=operation.id AND review.reviewed_by=operation.reviewed_by AND review.provider_evidence_digest=operation.evidence_digest AND review.outcome='retired' AND NOT review.permits_retry AND EXISTS(SELECT 1 FROM jsonb_array_elements(selected.proof->'reviews') member WHERE member->>'id'=review.id::text)))$new$);
 IF successor_body=source_body OR encode(sha256(convert_to(successor_body,'UTF8')),'hex')<>'d9a189131c3954f1086820f029b64f6ce42b23c2065e47f5573565e9614d9190' THEN
  RAISE EXCEPTION 'Erased-operation review attribution composition failed' USING ERRCODE='23514';
 END IF;
 EXECUTE format('CREATE OR REPLACE FUNCTION freeholder_media_multipart_certificate_coverage(original_certificate uuid) RETURNS boolean LANGUAGE sql STABLE AS $body$%s$body$',successor_body);
END $migration$;
