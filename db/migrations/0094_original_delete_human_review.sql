-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
-- C1.12/C11.08: retain the freshly verified human reviewer admitted by 0093.
DO $migration$
DECLARE source_body text; successor_body text;
BEGIN
 SELECT prosrc INTO source_body FROM pg_proc WHERE oid=to_regprocedure('freeholder_media_original_monotonic_delete_review(uuid)');
 IF source_body IS NULL OR encode(sha256(convert_to(source_body,'UTF8')),'hex')<>'12ef7defc91d33baa5efe630b579bca72d8236d1f35c2717cb59e008734d8d72' THEN
  RAISE EXCEPTION 'Unexpected original monotonic-delete review predecessor' USING ERRCODE='23514';
 END IF;
 successor_body:=replace(source_body,'review.reviewed_by=''system:media-cleanup''','(review.reviewed_by=''system:media-cleanup'' OR review.reviewed_by ~ ''^user:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'')');
 IF successor_body=source_body OR encode(sha256(convert_to(successor_body,'UTF8')),'hex')<>'12858fa9d6459ebc6a82ba0a991ca69d8e4d776a4008fe82dfc5e078c4f3a1c9' THEN
  RAISE EXCEPTION 'Original human monotonic-delete review composition failed' USING ERRCODE='23514';
 END IF;
 EXECUTE format('CREATE OR REPLACE FUNCTION freeholder_media_original_monotonic_delete_review(original_call uuid) RETURNS boolean LANGUAGE sql STABLE AS $body$%s$body$',successor_body);
END $migration$;
