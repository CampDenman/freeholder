-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
-- C1.12/C11.08: distinguish the actual caller alias from the guard's row variable.
DO $migration$
DECLARE source_body text; successor_body text;
BEGIN
 SELECT prosrc INTO source_body FROM pg_proc WHERE oid=to_regprocedure('freeholder_media_provider_inventory_evidence_guard()');
 IF source_body IS NULL OR encode(sha256(convert_to(source_body,'UTF8')),'hex')<>'0cff1f1417c6ddcbedba5240464a433c021f761b0f96c63cb560c0c4636e3d8c' THEN
  RAISE EXCEPTION 'Unexpected provider inventory guard predecessor' USING ERRCODE='23514';
 END IF;
 successor_body:=replace(source_body,'JOIN media_storage_transfer_calls caller ON caller.id=request.call_id WHERE caller.object_id','JOIN media_storage_transfer_calls actual_caller ON actual_caller.id=request.call_id WHERE actual_caller.object_id');
 IF successor_body=source_body OR encode(sha256(convert_to(successor_body,'UTF8')),'hex')<>'c7ffc1dfc37ca9ffd7268d1d2478288caef3f0f4889ca901fd3c51cbac1116aa' THEN
  RAISE EXCEPTION 'Provider inventory caller-alias composition failed' USING ERRCODE='23514';
 END IF;
 EXECUTE format('CREATE OR REPLACE FUNCTION freeholder_media_provider_inventory_evidence_guard() RETURNS trigger LANGUAGE plpgsql AS $body$%s$body$',successor_body);
END $migration$;
