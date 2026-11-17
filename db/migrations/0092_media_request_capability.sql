-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
-- C1.12/C11.08: publish the existing guarded original-request inventory capability.
CREATE FUNCTION freeholder_media_transfer_request_capability_v1() RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT 'verified-original-request-inventory-v1'::text $$;
--> statement-breakpoint
DO $migration$
DECLARE scope_body text;
BEGIN
 SELECT prosrc INTO scope_body FROM pg_proc WHERE oid=to_regprocedure('freeholder_media_original_scope_guard()');
 IF scope_body IS NULL OR encode(sha256(convert_to(scope_body,'UTF8')),'hex')<>'3c661d9c318021381919df5c1de26274276385a3b8176cc3ef719038a502c47b' THEN
  RAISE EXCEPTION 'Unexpected original media scope predecessor' USING ERRCODE='23514';
 END IF;
 scope_body:=replace(scope_body,$marker$
DECLARE$marker$,$replacement$
#variable_conflict use_column
DECLARE$replacement$);
 IF encode(sha256(convert_to(scope_body,'UTF8')),'hex')<>'e61f01a7689e86fd2f3d184d861cf55c8a90aead5f32fb298dceab773cec7963' THEN
  RAISE EXCEPTION 'Original media scope conflict composition failed' USING ERRCODE='23514';
 END IF;
 EXECUTE format('CREATE OR REPLACE FUNCTION freeholder_media_original_scope_guard() RETURNS trigger LANGUAGE plpgsql AS $body$%s$body$',scope_body);
END $migration$;
