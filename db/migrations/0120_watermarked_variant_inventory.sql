-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
--
-- `Asset.variants` gained a `watermarked` key (§4.5, C8.04), and its value is
-- an object of format ladders rather than a ladder itself. The legacy-insert
-- inventory trigger walked every top-level value with jsonb_array_elements,
-- so the first watermarked asset inserted outside the service failed with
-- "cannot extract elements from an object".
--
-- The fix is not to special-case one key. The trigger now takes only values
-- that are arrays, and descends into `watermarked` for the marked ladder, so
-- a future non-array key is inert here instead of fatal.
CREATE OR REPLACE FUNCTION freeholder_inventory_legacy_asset()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO "media_objects" (
    "key", "asset_id", "role", "state", "bytes", "content_type"
  ) VALUES (
    NEW."storage_key", NEW."id", 'original', 'attached', NEW."byte_size", NEW."mime"
  ) ON CONFLICT ("key") DO NOTHING;

  INSERT INTO "media_objects" (
    "key", "asset_id", "role", "state", "bytes", "content_type"
  )
  SELECT
    rendition.value->>'key',
    NEW."id",
    'variant',
    'attached',
    NULLIF(rendition.value->>'bytes', '')::bigint,
    'image/' || ladder.key
  FROM (
    SELECT key, value
    FROM jsonb_each(COALESCE(NEW."variants", '{}'::jsonb))
    WHERE jsonb_typeof(value) = 'array'
    UNION ALL
    SELECT key, value
    FROM jsonb_each(COALESCE(NEW."variants"->'watermarked', '{}'::jsonb))
    WHERE jsonb_typeof(value) = 'array'
  ) ladder
  CROSS JOIN LATERAL jsonb_array_elements(ladder.value) rendition
  WHERE rendition.value ? 'key'
  ON CONFLICT ("key") DO NOTHING;
  RETURN NEW;
END;
$$;
