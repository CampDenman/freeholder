-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C8.03/C8.04/C8.07: client files must not escape via generic media URLs.
UPDATE "assets" SET "is_private" = true
WHERE EXISTS (
  SELECT 1 FROM "gallery_items"
  INNER JOIN "galleries" ON "galleries"."id" = "gallery_items"."gallery_id"
  WHERE "gallery_items"."asset_id" = "assets"."id"
    AND "galleries"."kind" = 'client_delivery'
);
--> statement-breakpoint
-- Old ZIPs have no trustworthy policy snapshot and stay unavailable until rebuilt.
ALTER TABLE "gallery_archives" ADD COLUMN "delivery_hash" text;
