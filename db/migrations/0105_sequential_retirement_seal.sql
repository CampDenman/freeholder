-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
-- C1.12/C11.08: evaluate one exact certificate proof without pathological SQL inlining.
DO $migration$
DECLARE source_body text; successor_body text;
BEGIN
 SELECT prosrc INTO source_body FROM pg_proc WHERE oid=to_regprocedure('freeholder_media_multipart_retirement_seal_admissible(media_storage_transfer_reviews)');
 IF source_body IS NULL OR encode(sha256(convert_to(source_body,'UTF8')),'hex')<>'eb10dc6241ca765655067da885979b90888224a8a23d9131743a9faff3c47a28' THEN
  RAISE EXCEPTION 'Unexpected retirement seal predecessor' USING ERRCODE='23514';
 END IF;
 successor_body:=$new$
DECLARE expected jsonb; identity jsonb;
BEGIN
 expected:=freeholder_media_multipart_retirement_payload(candidate.multipart_operation_id,candidate.inventory_id);
 identity:=jsonb_build_object('format','freeholder.original-multipart-first-identity/v1','resource',(candidate.retirement_proof->'resource')-'retiredAtEpoch','creation',candidate.retirement_proof->'creation','retirement',(candidate.retirement_proof->'retirement')-ARRAY['readCallId','inventoryId'],
  'operations',(SELECT jsonb_agg(member ORDER BY member->>'id') FROM jsonb_array_elements(candidate.retirement_proof->'operations') member WHERE member->>'id' IN (candidate.retirement_proof->'creation'->>'operationId',candidate.retirement_proof->'retirement'->>'operationId')),
  'callers',(SELECT jsonb_agg(member ORDER BY member->>'id') FROM jsonb_array_elements(candidate.retirement_proof->'callers') member WHERE member->>'id' IN (candidate.retirement_proof->'creation'->>'callerId',candidate.retirement_proof->'retirement'->>'callerId')),
  'requests',(SELECT jsonb_agg(member-ARRAY['observationCount','factMembershipDigest'] ORDER BY member->>'id') FROM jsonb_array_elements(candidate.retirement_proof->'requests') member WHERE member->>'id' IN (candidate.retirement_proof->'creation'->>'requestId',candidate.retirement_proof->'retirement'->>'requestId')));
 RETURN coalesce(current_setting('freeholder.media_retirement_certificate_v1',true)='derived-idle-retirement-v1'
  AND candidate.retirement_proof IS NOT NULL AND expected IS NOT NULL AND candidate.retirement_proof=expected
  AND (NOT EXISTS(SELECT 1 FROM media_storage_transfer_reviews earlier JOIN media_multipart_operations parent ON parent.id=earlier.multipart_operation_id JOIN media_multipart_operations current_parent ON current_parent.resource_id=parent.resource_id WHERE current_parent.id=candidate.multipart_operation_id AND earlier.retirement_proof IS NOT NULL) OR identity=freeholder_media_multipart_first_identity((SELECT resource_id FROM media_multipart_operations WHERE id=candidate.multipart_operation_id)))
  AND candidate.object_id IS NULL AND candidate.object_receipt_id IS NULL AND candidate.outcome='retired' AND NOT candidate.permits_retry AND candidate.reviewed_by='system:media-retirement'
  AND candidate.created_at=transaction_timestamp() AND candidate.multipart_operation_id::text=expected->'retirement'->>'operationId'
  AND candidate.call_id::text=expected->'retirement'->>'callerId' AND candidate.read_call_id::text=expected->'retirement'->>'readCallId' AND candidate.inventory_id::text=expected->'retirement'->>'inventoryId'
  AND candidate.stop_drain_id::text IS NOT DISTINCT FROM expected->'retirement'->>'stopDrainId'
  AND candidate.provider_evidence_digest=freeholder_media_transfer_fact_digest(expected)
  AND candidate.original_call_witness=freeholder_media_transfer_fact_digest((SELECT caller FROM jsonb_array_elements(expected->'callers') caller WHERE caller->>'id'=expected->'retirement'->>'callerId')),false);
END 
$new$;
 IF encode(sha256(convert_to(successor_body,'UTF8')),'hex')<>'1aeeb19b9537d639c059f4261591746c9efbbd5e8502a3d99ae968bec71c51ba' THEN
  RAISE EXCEPTION 'Sequential retirement seal composition failed' USING ERRCODE='23514';
 END IF;
 EXECUTE format('CREATE OR REPLACE FUNCTION freeholder_media_multipart_retirement_seal_admissible(candidate media_storage_transfer_reviews) RETURNS boolean LANGUAGE plpgsql AS $body$%s$body$',successor_body);
END $migration$;
