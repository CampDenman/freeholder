-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
-- C1.12/C11.08: an intact original certificate preserves creation closure after late facts.
DO $migration$
DECLARE source_body text; successor_body text;
BEGIN
 SELECT prosrc INTO source_body FROM pg_proc WHERE oid=to_regprocedure('freeholder_media_multipart_idle_creation(uuid)');
 IF source_body IS NULL OR encode(sha256(convert_to(source_body,'UTF8')),'hex')<>'688be3446d109526a83bc3d424e7b4002df76c51d5dc882c9469969c06f1f70e' THEN
  RAISE EXCEPTION 'Unexpected idle-creation predecessor' USING ERRCODE='23514';
 END IF;
 successor_body:=replace(source_body,'AND creation.state=''accepted'' AND freeholder_media_multipart_known_create_original(creation.id)','AND (creation.state=''accepted'' OR EXISTS(SELECT 1 FROM media_storage_transfer_reviews certificate JOIN media_multipart_operations retirement ON retirement.id=certificate.multipart_operation_id WHERE retirement.resource_id=resource.id AND retirement.operation_kind=''abort'' AND certificate.retirement_proof IS NOT NULL AND freeholder_media_multipart_retirement_certificate_intact(certificate.id))) AND freeholder_media_multipart_known_create_original(creation.id)');
 IF successor_body=source_body OR encode(sha256(convert_to(successor_body,'UTF8')),'hex')<>'0184633757105c16be821c6f9f95f3c732aafd4ad005d06c83f44d9a4decf6ef' THEN
  RAISE EXCEPTION 'Idle-creation certificate composition failed' USING ERRCODE='23514';
 END IF;
 EXECUTE format('CREATE OR REPLACE FUNCTION freeholder_media_multipart_idle_creation(original_resource uuid) RETURNS boolean LANGUAGE sql STABLE AS $body$%s$body$',successor_body);
END $migration$;
