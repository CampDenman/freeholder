-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- Update policy singleton (MASTER.md §39.6, C10.08). Expand-only.
CREATE TABLE "update_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"channel" text DEFAULT 'security' NOT NULL,
	"apply_level" text DEFAULT 'security' NOT NULL,
	"window" jsonb DEFAULT '{"days":["tue","wed","thu"],"start":"03:00"}'::jsonb NOT NULL,
	"drain" boolean DEFAULT true NOT NULL,
	"notify_channels" text[] DEFAULT '{"email","sms"}' NOT NULL,
	"keep_snapshots" integer DEFAULT 5 NOT NULL,
	"last_checked_at" timestamp with time zone,
	"paused_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "update_settings_singleton" CHECK ("id" = 1),
	CONSTRAINT "update_settings_keep_snapshots" CHECK ("keep_snapshots" between 1 and 50)
);
--> statement-breakpoint
INSERT INTO "update_settings" ("id") VALUES (1);
