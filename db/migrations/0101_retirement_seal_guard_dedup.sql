-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
-- C1.12/C11.08: the dedicated immutable-certificate trigger remains mandatory.
DO $migration$
DECLARE item record; source_body text; successor_body text;
BEGIN
 FOR item IN SELECT * FROM (VALUES
  ('freeholder_media_multipart_applied_review_guard()','c77e3a2af314cce598a3ad1546208de10523df4d46269bbc80cbd3be2dc0a320','349fe088a830244ebc07f4d048211b64060a9698bd3cb4546304ca938f285c60'),
  ('freeholder_media_original_review_context_guard()','a312191e19473e63d131dacbf12dbba6ecbeae0c5a3af693dd3c3c469cb0b66c','9b6dd77993fba5368f9db6cb9306e99b8419a65ca222653b430cb21a7f6e1924')
 ) AS specifications(signature,predecessor,successor)
 LOOP
  SELECT prosrc INTO source_body FROM pg_proc WHERE oid=to_regprocedure(item.signature);
  IF source_body IS NULL OR encode(sha256(convert_to(source_body,'UTF8')),'hex')<>item.predecessor THEN RAISE EXCEPTION 'Unexpected retirement review guard predecessor: %',item.signature USING ERRCODE='23514'; END IF;
  successor_body:=replace(source_body,$marker$IF TG_OP<>'INSERT' OR NOT freeholder_media_multipart_retirement_seal_admissible(NEW) THEN RAISE EXCEPTION 'The complete independent system retirement seal is required; no human marker or bare parent exemption supplies authority' USING ERRCODE='23514'; END IF;RETURN NEW;$marker$,$replacement$IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'The complete independent system retirement seal is required; no human marker or bare parent exemption supplies authority' USING ERRCODE='23514'; END IF;RETURN NEW;$replacement$);
  IF successor_body=source_body OR encode(sha256(convert_to(successor_body,'UTF8')),'hex')<>item.successor THEN RAISE EXCEPTION 'Retirement review guard dedup failed: %',item.signature USING ERRCODE='23514'; END IF;
  EXECUTE format('CREATE OR REPLACE FUNCTION %s RETURNS trigger LANGUAGE plpgsql AS $body$%s$body$',item.signature,successor_body);
 END LOOP;
END $migration$;
