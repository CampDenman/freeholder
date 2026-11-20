-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
-- C1.12/C11.08: resolve operation columns, not the same-named local variable.
DO $migration$
DECLARE source_body text; successor_body text;
BEGIN
 SELECT prosrc INTO source_body FROM pg_proc WHERE oid=to_regprocedure('freeholder_media_multipart_idle_guard()');
 IF source_body IS NULL OR encode(sha256(convert_to(source_body,'UTF8')),'hex')<>'71344c3b5a5df0f6d192e6fba34fc512840b4561057b408a213377fd55f7dfb5' THEN
  RAISE EXCEPTION 'Unexpected multipart idle-guard predecessor' USING ERRCODE='23514';
 END IF;
 successor_body:=replace(source_body,'DECLARE','#variable_conflict use_column
DECLARE');
 IF successor_body=source_body OR encode(sha256(convert_to(successor_body,'UTF8')),'hex')<>'cd2a81e1ec5c762b886314723110c3cf1cc29bd024feebdc5b5e14b483133f92' THEN
  RAISE EXCEPTION 'Multipart idle-guard column composition failed' USING ERRCODE='23514';
 END IF;
 EXECUTE format('CREATE OR REPLACE FUNCTION freeholder_media_multipart_idle_guard() RETURNS trigger LANGUAGE plpgsql AS $body$%s$body$',successor_body);
END $migration$;
