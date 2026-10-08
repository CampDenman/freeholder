-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C2.26: create an editable blog index on existing installations, preserving owner pages.
INSERT INTO "pages" ("slug", "locale", "title", "blocks", "status", "published_at")
SELECT 'blog', "default_locale", 'Blog', '[{"id":"blog-title","type":"heading","props":{"text":"Blog","level":1}},{"id":"blog-index","type":"blogIndex","props":{}}]'::jsonb, 'published', now()
FROM "business_profile"
ON CONFLICT ("slug", "locale") DO NOTHING;
--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "public_request_key" uuid;
--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_public_request_idx" ON "bookings" ("contact_id", "public_request_key") WHERE "public_request_key" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "signup_pending" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "signup_invoice_id" uuid REFERENCES "invoices"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "public_request_key" uuid;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "public_terms_hash" text;
--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_public_request_idx" ON "subscriptions" ("contact_id", "public_request_key") WHERE "public_request_key" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "subscriptions_signup_idx" ON "subscriptions" ("signup_pending", "signup_invoice_id");
--> statement-breakpoint
INSERT INTO "pages" ("slug", "locale", "title", "blocks", "status", "published_at")
SELECT 'newsletters', "default_locale", 'Newsletters', '[{"id":"newsletters-title","type":"heading","props":{"text":"Newsletters","level":1}},{"id":"newsletters-archive","type":"newsletterArchive","props":{}},{"id":"newsletters-subscribe","type":"newsletterSubscribe","props":{}}]'::jsonb, 'published', now()
FROM "business_profile" ON CONFLICT ("slug", "locale") DO NOTHING;
--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "is_private" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
UPDATE "assets" SET "is_private" = true WHERE EXISTS (SELECT 1 FROM "document_versions" WHERE "document_versions"."asset_id" = "assets"."id");
