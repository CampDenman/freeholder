-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
-- C1.12/C11.08: keep operation-only writer fields out of resource-row triggers.
DO $migration$
DECLARE source_body text; successor_body text;
BEGIN
 SELECT prosrc INTO source_body FROM pg_proc WHERE oid=to_regprocedure('freeholder_media_transfer_multipart_fence()');
 IF source_body IS NULL OR encode(sha256(convert_to(source_body,'UTF8')),'hex')<>'2618969f11f3ea28905579a8f70689662f65bdc5c83ef56eded206f8c946d9eb' THEN
  RAISE EXCEPTION 'Unexpected multipart resource fence predecessor' USING ERRCODE='23514';
 END IF;
 successor_body:=replace(source_body,$marker$ IF TG_TABLE_NAME='media_multipart_operations' AND TG_OP='UPDATE' AND
  (NEW.writer_runtime_id IS DISTINCT FROM OLD.writer_runtime_id OR NEW.writer_finished_at IS DISTINCT FROM OLD.writer_finished_at AND (OLD.writer_finished_at IS NOT NULL OR EXISTS(SELECT 1 FROM media_storage_transfer_reviews review WHERE review.multipart_operation_id=OLD.id AND review.outcome IN ('applied','retired') AND review.stop_drain_id IS NOT NULL))) THEN
  RAISE EXCEPTION 'Original multipart writer birth and finish cannot be rebound' USING ERRCODE='23514';
 END IF;$marker$,$replacement$ IF TG_TABLE_NAME='media_multipart_operations' AND TG_OP='UPDATE' THEN
  IF NEW.writer_runtime_id IS DISTINCT FROM OLD.writer_runtime_id OR NEW.writer_finished_at IS DISTINCT FROM OLD.writer_finished_at AND (OLD.writer_finished_at IS NOT NULL OR EXISTS(SELECT 1 FROM media_storage_transfer_reviews review WHERE review.multipart_operation_id=OLD.id AND review.outcome IN ('applied','retired') AND review.stop_drain_id IS NOT NULL)) THEN
   RAISE EXCEPTION 'Original multipart writer birth and finish cannot be rebound' USING ERRCODE='23514';
  END IF;
 END IF;$replacement$);
 IF successor_body=source_body OR encode(sha256(convert_to(successor_body,'UTF8')),'hex')<>'12ea781dfd4407795cc63df7307332a6da3197cd557d86edab8c2d6720de10c6' THEN
  RAISE EXCEPTION 'Multipart resource fence composition failed' USING ERRCODE='23514';
 END IF;
 EXECUTE format('CREATE OR REPLACE FUNCTION freeholder_media_transfer_multipart_fence() RETURNS trigger LANGUAGE plpgsql AS $body$%s$body$',successor_body);
END $migration$;
