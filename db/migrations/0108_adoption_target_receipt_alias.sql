-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
-- C1.12/C11.08: distinguish the target receipt alias from the guard's caller variable.
DO $migration$
DECLARE source_body text; successor_body text;
BEGIN
 SELECT prosrc INTO source_body FROM pg_proc WHERE oid=to_regprocedure('freeholder_media_transfer_adoption_guard()');
 IF source_body IS NULL OR encode(sha256(convert_to(source_body,'UTF8')),'hex')<>'b21991698c6aa10928dff68fe5bd1b97d9be896fc82fd3938c4aca22c255b324' THEN
  RAISE EXCEPTION 'Unexpected plan-target adoption predecessor' USING ERRCODE='23514';
 END IF;
 successor_body:=replace(source_body,'EXISTS(SELECT 1 FROM media_object_writes target WHERE target.id=member.target_receipt_id AND target.original_reservation_id=physical.reservation_id AND target.object_key=physical.key)','EXISTS(SELECT 1 FROM media_object_writes target_receipt WHERE target_receipt.id=member.target_receipt_id AND target_receipt.original_reservation_id=physical.reservation_id AND target_receipt.object_key=physical.key)');
 IF successor_body=source_body OR encode(sha256(convert_to(successor_body,'UTF8')),'hex')<>'d5c3f1556f9eb63a449a76d85327072434a80a84c5276258e8c56d8bd40aa4e0' THEN
  RAISE EXCEPTION 'Adoption target-receipt alias composition failed' USING ERRCODE='23514';
 END IF;
 EXECUTE format('CREATE OR REPLACE FUNCTION freeholder_media_transfer_adoption_guard() RETURNS trigger LANGUAGE plpgsql AS $body$%s$body$',successor_body);
END $migration$;
