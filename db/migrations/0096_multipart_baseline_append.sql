-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
-- C1.12/C11.08: remove the last JSON page only after selecting the pages array.
DO $migration$
DECLARE source_body text; successor_body text;
BEGIN
 SELECT prosrc INTO source_body FROM pg_proc WHERE oid=to_regprocedure('freeholder_media_multipart_baseline_guard()');
 IF source_body IS NULL OR encode(sha256(convert_to(source_body,'UTF8')),'hex')<>'d617c4fee5ac63784b1dc9e97aa632796f57e46bae10afae17523780ffe92fb4' THEN
  RAISE EXCEPTION 'Unexpected multipart baseline predecessor' USING ERRCODE='23514';
 END IF;
 successor_body:=replace(source_body,'(baseline->''pages''-(new_count-1))','((baseline->''pages'')-(new_count-1))');
 IF successor_body=source_body OR encode(sha256(convert_to(successor_body,'UTF8')),'hex')<>'767728e6859b52e6b9942fe956cc9273e21d5567d1a9c1fc789c09892609f554' THEN
  RAISE EXCEPTION 'Multipart baseline append composition failed' USING ERRCODE='23514';
 END IF;
 EXECUTE format('CREATE OR REPLACE FUNCTION freeholder_media_multipart_baseline_guard() RETURNS trigger LANGUAGE plpgsql AS $body$%s$body$',successor_body);
END $migration$;
