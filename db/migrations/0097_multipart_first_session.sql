-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
-- C1.12/C11.08: first session assignment is not clearing an existing session.
DO $migration$
DECLARE source_body text; successor_body text;
BEGIN
 SELECT prosrc INTO source_body FROM pg_proc WHERE oid=to_regprocedure('freeholder_media_upload_admission()');
 IF source_body IS NULL OR encode(sha256(convert_to(source_body,'UTF8')),'hex')<>'bfcd9d1ee582f35b7a3c38ae4d92ca23ab02c4469130824ac0af0583cb2b9675' THEN
  RAISE EXCEPTION 'Unexpected multipart first-session predecessor' USING ERRCODE='23514';
 END IF;
 successor_body:=replace(source_body,'IF TG_OP=''UPDATE'' AND EXISTS(SELECT 1 FROM media_multipart_resources resource WHERE resource.upload_id=OLD.id) AND NEW.provider_upload_id IS DISTINCT FROM OLD.provider_upload_id THEN','IF TG_OP=''UPDATE'' AND OLD.provider_upload_id IS NOT NULL AND EXISTS(SELECT 1 FROM media_multipart_resources resource WHERE resource.upload_id=OLD.id) AND NEW.provider_upload_id IS DISTINCT FROM OLD.provider_upload_id THEN');
 IF successor_body=source_body OR encode(sha256(convert_to(successor_body,'UTF8')),'hex')<>'f1cad8d1e18101809cf1dc469dd005cf022512578d4a4ab85e67fac171491ce5' THEN
  RAISE EXCEPTION 'Multipart first-session composition failed' USING ERRCODE='23514';
 END IF;
 EXECUTE format('CREATE OR REPLACE FUNCTION freeholder_media_upload_admission() RETURNS trigger LANGUAGE plpgsql AS $body$%s$body$',successor_body);
END $migration$;
