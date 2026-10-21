-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- Per-kind TTL policies for user-owned stores (MASTER.md C11.14). Expand-only.
CREATE TABLE "retention_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"ttl_days" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "retention_policies_kind_length" CHECK (char_length("kind") between 1 and 80),
	CONSTRAINT "retention_policies_ttl_days_positive" CHECK ("ttl_days" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "retention_policies_kind_idx" ON "retention_policies" ("kind");
