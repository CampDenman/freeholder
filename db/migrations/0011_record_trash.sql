-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C11.14: reversible removal keeps the original record and its relations.
ALTER TABLE "pages" ADD COLUMN "trashed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "forms" ADD COLUMN "trashed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "popups" ADD COLUMN "trashed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "segments" ADD COLUMN "trashed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "saved_views" ADD COLUMN "trashed_at" timestamp with time zone;
--> statement-breakpoint
CREATE INDEX "pages_trash_idx" ON "pages" ("trashed_at") WHERE "pages"."trashed_at" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "forms_trash_idx" ON "forms" ("trashed_at") WHERE "forms"."trashed_at" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "popups_trash_idx" ON "popups" ("trashed_at") WHERE "popups"."trashed_at" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "segments_trash_idx" ON "segments" ("trashed_at") WHERE "segments"."trashed_at" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "saved_views_trash_idx" ON "saved_views" ("trashed_at") WHERE "saved_views"."trashed_at" IS NOT NULL;
