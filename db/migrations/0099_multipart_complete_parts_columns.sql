-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
-- C1.12/C11.08: resolve physical request columns, not the local caller variable.
DO $migration$
DECLARE source_body text; successor_body text;
BEGIN
 SELECT prosrc INTO source_body FROM pg_proc WHERE oid=to_regprocedure('freeholder_media_multipart_complete_parts_guard()');
 IF source_body IS NULL OR encode(sha256(convert_to(source_body,'UTF8')),'hex')<>'76cf1ac784392da968d14e6b612a40ab058b903d47f748f8c1c7a20c7a1d115f' THEN
  RAISE EXCEPTION 'Unexpected multipart complete-parts predecessor' USING ERRCODE='23514';
 END IF;
 successor_body:=replace(source_body,'DECLARE','#variable_conflict use_column
DECLARE');
 IF successor_body=source_body OR encode(sha256(convert_to(successor_body,'UTF8')),'hex')<>'c49a8c2388baaea12cb8bbf702853d881cc00c05c5d46d3a51e552cc5bb88444' THEN
  RAISE EXCEPTION 'Multipart complete-parts column composition failed' USING ERRCODE='23514';
 END IF;
 EXECUTE format('CREATE OR REPLACE FUNCTION freeholder_media_multipart_complete_parts_guard() RETURNS trigger LANGUAGE plpgsql AS $body$%s$body$',successor_body);
END $migration$;
