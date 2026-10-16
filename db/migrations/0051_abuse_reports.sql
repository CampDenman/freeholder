-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C12.30 (MASTER.md §44.9): uploads that matched known abuse imagery, kept
-- for the legal report. No image is stored here.
CREATE TABLE "abuse_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"match_id" text,
	"match_source" text,
	"sha256" text NOT NULL,
	"content_type" text NOT NULL,
	"bytes" integer NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"asset_id" uuid,
	"uploaded_by" text,
	"state" text DEFAULT 'to_report' NOT NULL,
	"reported_to" text,
	"report_reference" text,
	"reported_at" timestamp with time zone,
	"reported_by" uuid,
	CONSTRAINT "abuse_reports_state_valid" CHECK ("abuse_reports"."state" in ('to_report','reported'))
);
--> statement-breakpoint
CREATE INDEX "abuse_reports_state_idx" ON "abuse_reports" USING btree ("state","detected_at");
--> statement-breakpoint
CREATE INDEX "abuse_reports_sha256_idx" ON "abuse_reports" USING btree ("sha256");
