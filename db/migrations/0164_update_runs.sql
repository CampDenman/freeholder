-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- Update runs, snapshots and instance release notes (MASTER.md §39.5, C10.06).
-- Expand-only: new tables the previous release never reads.
CREATE TABLE "update_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"fingerprint" text NOT NULL,
	"version" text NOT NULL,
	"bytes" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	CONSTRAINT "update_snapshots_fingerprint_not_blank" CHECK (length(trim("fingerprint")) > 0),
	CONSTRAINT "update_snapshots_version_not_blank" CHECK (length(trim("version")) > 0)
);
--> statement-breakpoint
CREATE TABLE "update_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_version" text NOT NULL,
	"to_version" text NOT NULL,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'started' NOT NULL,
	"preflight" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"snapshot_id" uuid,
	"rolled_back_from_run_id" uuid,
	"log" text DEFAULT '' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "update_runs_from_not_blank" CHECK (length(trim("from_version")) > 0),
	CONSTRAINT "update_runs_to_not_blank" CHECK (length(trim("to_version")) > 0)
);
--> statement-breakpoint
ALTER TABLE "update_runs" ADD CONSTRAINT "update_runs_snapshot_fk" FOREIGN KEY ("snapshot_id") REFERENCES "update_snapshots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE TABLE "release_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"actor" text NOT NULL,
	"source_ref" text,
	"visibility" text DEFAULT 'internal' NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "release_notes_title_not_blank" CHECK (length(trim("title")) > 0),
	CONSTRAINT "release_notes_visibility" CHECK ("visibility" in ('internal', 'public'))
);
