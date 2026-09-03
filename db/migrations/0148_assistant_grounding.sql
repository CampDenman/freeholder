-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
--
-- Assistant grounding (MASTER.md §31, C9.22).
--
-- Two tables. `knowledge_entries` is what an owner writes by hand — a Q&A,
-- a fact, a policy — locale-aware and toggleable. `assistant_chunks` is the
-- retrieval index: published pages, help articles, catalog, locations/hours
-- and those knowledge rows, each with a 256-d embedding stored as real[].
--
-- Cosine ranking happens in the service. At the scale this module is for
-- (tens of pages, not millions of rows) a table scan is the honest index,
-- the same trade the help-centre body search already made. The vectors live
-- in the one sacred database, not a bolt-on store.
CREATE TABLE "knowledge_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "knowledge_entries_locale_idx" ON "knowledge_entries" USING btree ("locale","enabled");--> statement-breakpoint

CREATE TABLE "assistant_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"locale" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"embedding" real[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "assistant_chunks_source_idx" ON "assistant_chunks" USING btree ("source_type","source_id","locale");--> statement-breakpoint
CREATE INDEX "assistant_chunks_locale_idx" ON "assistant_chunks" USING btree ("locale");
