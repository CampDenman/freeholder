-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- freeholder:schema-breaking Legacy reader-erasure quarantine requires the guarded commit/publish path. Previous images can read the run but must refuse its cutover. A full rollback requires the pre-upgrade database and objects, with acknowledged erasures respected before publishing again.
-- C2.29/C3.22: older erasure receipts did not cover import reader caches.
-- A legacy source overlapping an acknowledged erasure cannot reconstruct the
-- erased identity safely. Remove only its cached reader inputs, preserve all
-- page/media/rollback ownership, and require explicit source review/re-import.
UPDATE import_runs AS run
SET preview = CASE WHEN jsonb_typeof(run.preview->'pages') = 'array' THEN
      jsonb_set(run.preview, '{pages}', COALESCE((
        SELECT jsonb_agg(page.value - 'readerComments' ORDER BY page.ordinality)
        FROM jsonb_array_elements(run.preview->'pages') WITH ORDINALITY AS page(value, ordinality)
      ), '[]'::jsonb)) ELSE run.preview END,
    checkpoint = COALESCE(run.checkpoint, '{}'::jsonb) || jsonb_build_object(
      'readerPrivacyReviewRequired', true,
      'pendingBlogPosts', COALESCE((
        SELECT jsonb_agg(post.value || '{"comments":[]}'::jsonb ORDER BY post.ordinality)
        FROM jsonb_array_elements(CASE WHEN jsonb_typeof(run.checkpoint->'pendingBlogPosts') = 'array'
          THEN run.checkpoint->'pendingBlogPosts' ELSE '[]'::jsonb END) WITH ORDINALITY AS post(value, ordinality)
      ), '[]'::jsonb)
    ),
    error = 'This older import needs reader-erasure review. Roll it back, review the source for erased readers, and start a new import before publishing comments.'
WHERE run.status NOT IN ('published', 'rolled_back')
  AND (
    (run.preview->>'readerPrivacyVersion' IS DISTINCT FROM '1'
      AND jsonb_path_exists(run.preview, '$.pages[*].readerComments[*]'))
    OR (run.checkpoint->>'readerPrivacyVersion' IS DISTINCT FROM '1'
      AND jsonb_path_exists(run.checkpoint, '$.pendingBlogPosts[*].comments[*]'))
  )
  AND EXISTS (SELECT 1 FROM data_requests AS request
    WHERE request.kind = 'erasure' AND request.status IN ('completed', 'partially_completed')
      AND request.fulfilled_at >= run.created_at
      AND NOT EXISTS (SELECT 1 FROM privacy_retention_exceptions AS hold
        WHERE hold.data_request_id = request.id AND hold.scope IN ('imports.readerSources', 'cms.readerComments')
          AND (hold.expires_at IS NULL OR hold.expires_at > now())));
--> statement-breakpoint
-- Committed comments live in the CMS or in the pending cutover checkpoint.
-- Redundant preview copies and terminal pending inputs are not recovery data.
UPDATE import_runs AS run
SET preview = CASE WHEN jsonb_typeof(run.preview->'pages') = 'array' THEN
      jsonb_set(run.preview, '{pages}', COALESCE((
        SELECT jsonb_agg(page.value - 'readerComments' ORDER BY page.ordinality)
        FROM jsonb_array_elements(run.preview->'pages') WITH ORDINALITY AS page(value, ordinality)
      ), '[]'::jsonb)) ELSE run.preview END,
    checkpoint = CASE WHEN run.status IN ('published', 'rolled_back')
      THEN COALESCE(run.checkpoint, '{}'::jsonb) || '{"pendingBlogPosts":[]}'::jsonb
      ELSE run.checkpoint END
WHERE run.status IN ('committed', 'reconciled', 'published', 'rolled_back');
--> statement-breakpoint
-- The immediately previous application must not silently publish a quarantined
-- source after its cached reader inputs were removed by the upgrade.
CREATE OR REPLACE FUNCTION guard_import_reader_privacy_review() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.checkpoint->>'readerPrivacyReviewRequired' = 'true'
    AND NEW.status IS DISTINCT FROM OLD.status
    AND NEW.status IN ('committed', 'published') THEN
    RAISE EXCEPTION 'Review this legacy reader source before commit or publication.'
      USING ERRCODE = '23514', CONSTRAINT = 'import_reader_privacy_review';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS import_reader_privacy_review ON import_runs;
--> statement-breakpoint
CREATE TRIGGER import_reader_privacy_review BEFORE UPDATE ON import_runs
  FOR EACH ROW EXECUTE FUNCTION guard_import_reader_privacy_review();
