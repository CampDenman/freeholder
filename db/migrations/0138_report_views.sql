-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
--
-- Saved report views (MASTER.md §4.7, §2535, §43 C9.08).
--
-- Additive: one new table, nothing renamed or dropped.
--
-- A saved view holds a *question* — "revenue by service, last quarter" — and
-- deliberately no answers. Caching the figures would give the business a
-- second revenue number that disagrees with its own invoices the moment a
-- payment lands, and a business cannot use two.
CREATE TABLE "report_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"key" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "report_views" ADD CONSTRAINT "report_views_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- One deploy is one business (§2), so a view belongs to the business rather
-- than to whoever saved it: two people saving "Last quarter" mean the same
-- report, and the second should edit the first rather than leave a list with
-- two entries nobody can tell apart.
CREATE UNIQUE INDEX "report_views_name_idx" ON "report_views" USING btree ("name");--> statement-breakpoint
CREATE INDEX "report_views_key_idx" ON "report_views" USING btree ("key");
