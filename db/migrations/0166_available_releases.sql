-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- The cached signed feed (MASTER.md §39.10, C10.11). Expand-only.
--
-- Cached rather than fetched per read: an owner asking "am I exposed?" must
-- get an answer when the feed is unreachable, and "I could not reach the feed"
-- is a different sentence from "you are up to date".
CREATE TABLE "available_releases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" text NOT NULL,
	"channel" text NOT NULL,
	"digest" text NOT NULL,
	"severity" text DEFAULT 'none' NOT NULL,
	"cvss" numeric(3, 1),
	"schema_breaking" boolean DEFAULT false NOT NULL,
	"min_from_version" text NOT NULL,
	"plugin_api" text NOT NULL,
	"notes_url" text NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "available_releases_version_not_blank" CHECK (length(trim("version")) > 0),
	CONSTRAINT "available_releases_digest_shape" CHECK ("digest" ~ '^sha256:[a-f0-9]{64}$'),
	CONSTRAINT "available_releases_cvss_range" CHECK ("cvss" is null or ("cvss" >= 0 and "cvss" <= 10)),
	-- A scored release must say how bad, and an unscored one must not claim a
	-- band. C10.02 refuses this at the feed; the database refuses it too,
	-- because a cache that can hold what the parser rejects is not a cache.
	CONSTRAINT "available_releases_severity_matches_score" CHECK (("cvss" is null and "severity" = 'none') or ("cvss" is not null and "severity" <> 'none'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "available_releases_version_key" ON "available_releases" ("version");--> statement-breakpoint
CREATE INDEX "available_releases_published_idx" ON "available_releases" ("published_at");
