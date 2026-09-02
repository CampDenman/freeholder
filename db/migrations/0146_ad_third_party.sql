-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
--
-- Consent-gated third-party tags and generated ads.txt (MASTER.md §4.16, C9.20).
--
-- C9.18 stored only image and native creatives because html_tag and provider
-- carry somebody else's script. This is that subject: the columns the tag
-- lives in, and the authorized-seller list /ads.txt and /app-ads.txt are
-- generated from. Serving still refuses the tag unless the slot allows it
-- and the visitor has granted fh_tc.
ALTER TABLE "ad_creatives" ADD COLUMN "tag_html" text;--> statement-breakpoint
ALTER TABLE "ad_creatives" ADD COLUMN "provider" jsonb;--> statement-breakpoint

CREATE TABLE "ad_txt_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain" text NOT NULL,
	"account_id" text NOT NULL,
	"relationship" text NOT NULL,
	"certification_authority_id" text,
	"surface" text DEFAULT 'both' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ad_txt_entries_line_idx" ON "ad_txt_entries" USING btree ("domain","account_id","relationship","surface");
