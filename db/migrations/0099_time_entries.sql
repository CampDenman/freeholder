-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- Hours worked (C6.16, §4.13).
--
-- §4.13: a time entry is "a small table and the difference between an owner
-- billing what they worked and billing what they remember."

CREATE TABLE IF NOT EXISTS "time_rates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "scope" text NOT NULL,
  -- Null for the business-wide rate; the user or project id otherwise.
  "scope_id" uuid,
  "rate_minor" bigint NOT NULL,
  "currency" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "time_rates_scope" CHECK ("scope" in ('business', 'user', 'project')),
  CONSTRAINT "time_rates_amount" CHECK ("rate_minor" >= 0),
  CONSTRAINT "time_rates_scope_id" CHECK (
    ("scope" = 'business') = ("scope_id" is null)
  )
);

-- One rate per scope. A second would be a second answer to what an hour costs,
-- and nothing could say which was meant.
--
-- NULLS NOT DISTINCT is load-bearing: Postgres treats two NULLs as different
-- by default, so without it the business-wide rate (whose scope_id is null)
-- would insert a second row every time somebody changed it and the upsert
-- would never fire.
DROP INDEX IF EXISTS "time_rates_scope_idx";
CREATE UNIQUE INDEX "time_rates_scope_idx"
  ON "time_rates" ("scope", "scope_id") NULLS NOT DISTINCT;

CREATE TABLE IF NOT EXISTS "time_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  -- Carried on the row rather than only reachable through the project, because
  -- an entry can hang off a booking instead — and "how many hours on the
  -- Hendersons" must not depend on which end somebody attached it to.
  "contact_id" uuid REFERENCES "contacts"("id") ON DELETE set null,
  "project_id" uuid REFERENCES "projects"("id") ON DELETE set null,
  "booking_id" uuid REFERENCES "bookings"("id") ON DELETE set null,
  "description" text NOT NULL,
  "started_at" timestamp with time zone NOT NULL,
  "ended_at" timestamp with time zone,
  -- Stored rather than derived from the timestamps: an owner rounding a
  -- 47-minute call to an hour is doing something legitimate that recomputing
  -- would overwrite.
  "minutes" integer DEFAULT 0 NOT NULL,
  "billable" boolean DEFAULT true NOT NULL,
  -- Frozen at the entry. Putting a rate up in March must not re-price
  -- February's work, and reading it at billing time would do exactly that.
  "rate_minor" bigint DEFAULT 0 NOT NULL,
  "currency" text,
  -- Set when this became an invoice line. Never cleared.
  "invoice_id" uuid,
  "invoiced_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "time_entries_minutes" CHECK ("minutes" >= 0),
  CONSTRAINT "time_entries_rate" CHECK ("rate_minor" >= 0),
  CONSTRAINT "time_entries_order" CHECK (
    "ended_at" is null or "ended_at" >= "started_at"
  ),
  CONSTRAINT "time_entries_description" CHECK (
    char_length("description") between 1 and 500
  ),
  -- A running timer on an invoice is an hour nobody has worked yet.
  CONSTRAINT "time_entries_invoiced_is_finished" CHECK (
    "invoice_id" is null or "ended_at" is not null
  )
);

CREATE INDEX IF NOT EXISTS "time_entries_project_idx"
  ON "time_entries" ("project_id", "started_at");
CREATE INDEX IF NOT EXISTS "time_entries_booking_idx" ON "time_entries" ("booking_id");
CREATE INDEX IF NOT EXISTS "time_entries_contact_idx" ON "time_entries" ("contact_id");
CREATE INDEX IF NOT EXISTS "time_entries_user_idx"
  ON "time_entries" ("user_id", "started_at");
-- The review list, and the reason it is fast: billable work nobody has
-- invoiced yet.
CREATE INDEX IF NOT EXISTS "time_entries_unbilled_idx"
  ON "time_entries" ("billable", "started_at") WHERE "invoice_id" is null;
-- One running timer per person. Two would mean the same hour counted twice
-- against two jobs, which is worse than losing it.
CREATE UNIQUE INDEX IF NOT EXISTS "time_entries_one_timer_idx"
  ON "time_entries" ("user_id") WHERE "ended_at" is null;
