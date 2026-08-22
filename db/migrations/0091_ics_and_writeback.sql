-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- ICS in and out, and the bookings Freeholder wrote upstream (C6.06, §4.4).
ALTER TABLE "calendars" ADD COLUMN IF NOT EXISTS "ics_token" text;
ALTER TABLE "calendars" ADD COLUMN IF NOT EXISTS "ics_import_url" text;
CREATE UNIQUE INDEX IF NOT EXISTS "calendars_ics_token_idx"
  ON "calendars" ("ics_token") WHERE "ics_token" is not null;

-- §41 keeps general two-way sync out of v1: Freeholder writes the bookings it
-- made and reads busy time. This column is the whole of "the ones it made".
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "provider_event_ref" text;

CREATE TABLE IF NOT EXISTS "external_busy_blocks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "calendar_id" uuid NOT NULL REFERENCES "calendars"("id") ON DELETE cascade,
  "source_ref" text NOT NULL,
  "source" text DEFAULT 'ics' NOT NULL,
  "starts_at" timestamp with time zone NOT NULL,
  "ends_at" timestamp with time zone NOT NULL,
  "busy" boolean DEFAULT true NOT NULL,
  -- Set when this block is the shadow of a booking Freeholder itself wrote
  -- upstream. Without it the appointment blocks twice — once as the booking
  -- and once as its own reflection — and rescheduling collides with its ghost.
  "booking_id" uuid REFERENCES "bookings"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "external_busy_blocks_order" CHECK ("ends_at" > "starts_at")
);

CREATE UNIQUE INDEX IF NOT EXISTS "external_busy_blocks_ref_idx"
  ON "external_busy_blocks" ("calendar_id", "source_ref");
CREATE INDEX IF NOT EXISTS "external_busy_blocks_window_idx"
  ON "external_busy_blocks" ("calendar_id", "starts_at", "ends_at");
