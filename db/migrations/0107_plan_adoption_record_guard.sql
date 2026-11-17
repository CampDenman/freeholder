-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
-- C1.12/C11.08: plan-only adoption fields must not be read from object NEW rows.
DO $migration$
DECLARE source_body text; successor_body text;
BEGIN
 SELECT prosrc INTO source_body FROM pg_proc WHERE oid=to_regprocedure('freeholder_media_transfer_adoption_guard()');
 IF source_body IS NULL OR encode(sha256(convert_to(source_body,'UTF8')),'hex')<>'205b8895382f648cce1d2d187b861d2c5ac2b9c8a835313f2b8570f03a125209' THEN
  RAISE EXCEPTION 'Unexpected transfer adoption guard predecessor' USING ERRCODE='23514';
 END IF;
 successor_body:=replace(source_body,$old$ IF TG_TABLE_NAME='media_storage_transfer_plans' AND NEW.adopted_at IS NOT NULL AND OLD.adopted_at IS NULL THEN$old$,$new$ IF TG_TABLE_NAME='media_storage_transfer_plans' THEN
  IF NEW.adopted_at IS NOT NULL AND OLD.adopted_at IS NULL THEN$new$);
 successor_body:=replace(successor_body,$suffix$ END IF;
 RETURN NEW;
END $suffix$,$replacement$  END IF;
 END IF;
 RETURN NEW;
END $replacement$);
 IF successor_body=source_body OR encode(sha256(convert_to(successor_body,'UTF8')),'hex')<>'b21991698c6aa10928dff68fe5bd1b97d9be896fc82fd3938c4aca22c255b324' THEN
  RAISE EXCEPTION 'Plan adoption record-guard composition failed' USING ERRCODE='23514';
 END IF;
 EXECUTE format('CREATE OR REPLACE FUNCTION freeholder_media_transfer_adoption_guard() RETURNS trigger LANGUAGE plpgsql AS $body$%s$body$',successor_body);
END $migration$;
