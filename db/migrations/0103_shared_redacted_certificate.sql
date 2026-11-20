-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
-- C1.12/C11.08: verify each intact redacted certificate once per retirement payload.
DO $migration$
DECLARE source_body text; successor_body text;
BEGIN
 SELECT prosrc INTO source_body FROM pg_proc WHERE oid=to_regprocedure('freeholder_media_multipart_retirement_payload(uuid,uuid)');
 IF source_body IS NULL OR encode(sha256(convert_to(source_body,'UTF8')),'hex')<>'16322858946e2935bda2db2416905d935a7d0eca237b0e78a1c54497a00edd71' THEN
  RAISE EXCEPTION 'Unexpected retirement payload predecessor' USING ERRCODE='23514';
 END IF;
 successor_body:=replace(source_body,$anchor$ body AS (SELECT jsonb_build_object('format','freeholder.original-multipart-retirement/v1',
 'resource',(selected.first->'resource')$anchor$,$replacement$ redacted_certificate AS MATERIALIZED (SELECT old.id,old.retirement_proof FROM media_storage_transfer_reviews old JOIN media_multipart_operations old_operation ON old_operation.id=old.multipart_operation_id JOIN selected ON selected.resource_id=old_operation.resource_id WHERE old.retirement_proof IS NOT NULL AND freeholder_media_multipart_retirement_certificate_intact(old.id)), body AS (SELECT jsonb_build_object('format','freeholder.original-multipart-retirement/v1',
 'resource',(selected.first->'resource')$replacement$);
 successor_body:=replace(successor_body,$old$SELECT 1 FROM media_storage_transfer_reviews old WHERE old.retirement_proof IS NOT NULL AND freeholder_media_multipart_retirement_certificate_intact(old.id) AND EXISTS($old$,$new$SELECT 1 FROM redacted_certificate old WHERE EXISTS($new$);
 IF successor_body=source_body OR encode(sha256(convert_to(successor_body,'UTF8')),'hex')<>'152bbe1d6ec8ef1239dc09271b064588ea1842ec165b82eb810292231d521b80' THEN
  RAISE EXCEPTION 'Shared redacted-certificate composition failed' USING ERRCODE='23514';
 END IF;
 EXECUTE format('CREATE OR REPLACE FUNCTION freeholder_media_multipart_retirement_payload(original_operation uuid,original_inventory uuid) RETURNS jsonb LANGUAGE sql STABLE AS $body$%s$body$',successor_body);
END $migration$;
