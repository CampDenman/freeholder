-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- Group bookings, waitlists and the terms a booking was made under
-- (C6.08, §4.4).

-- The terms as they stood when this was booked, snapshotted rather than
-- referenced. §4.4: "the customer saw the terms before booking" — which is
-- only true while editing the policy tomorrow cannot change what somebody
-- agreed to today.
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "cancellation_policy" jsonb;
-- What the policy decided when it was cancelled or no-showed. A record of the
-- decision, not of a transaction: a booking is not a payment.
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "cancellation_outcome" jsonb;
-- Carried across a reschedule rather than counted by walking the chain, which
-- stops being countable the first time somebody tidies up an old row.
ALTER TABLE "bookings"
  ADD COLUMN IF NOT EXISTS "reschedule_count" integer DEFAULT 0 NOT NULL;

CREATE TABLE IF NOT EXISTS "booking_waitlist" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "contact_id" uuid NOT NULL REFERENCES "contacts"("id") ON DELETE cascade,
  -- Untyped by a foreign key: catalog is a module and core may not depend on
  -- one.
  "service_offering_id" uuid,
  -- Null means "whoever is free", which is what most people actually want.
  "calendar_id" uuid REFERENCES "calendars"("id") ON DELETE cascade,
  "window_start" timestamp with time zone NOT NULL,
  "window_end" timestamp with time zone NOT NULL,
  "seat_count" integer DEFAULT 1 NOT NULL,
  "status" text DEFAULT 'waiting' NOT NULL,
  "position" integer DEFAULT 0 NOT NULL,
  "offered_at" timestamp with time zone,
  "offer_expires_at" timestamp with time zone,
  "offer_token" text,
  "offer_starts_at" timestamp with time zone,
  "offer_ends_at" timestamp with time zone,
  "booking_id" uuid REFERENCES "bookings"("id") ON DELETE set null,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "booking_waitlist_order" CHECK ("window_end" > "window_start"),
  CONSTRAINT "booking_waitlist_seats" CHECK ("seat_count" > 0),
  CONSTRAINT "booking_waitlist_status" CHECK (
    "status" in ('waiting', 'offered', 'booked', 'expired', 'withdrawn')
  ),
  -- An offer with no deadline is an indefinite hold on a seat, which is the
  -- failure mode this table exists to avoid.
  CONSTRAINT "booking_waitlist_offer_complete" CHECK (
    "status" <> 'offered'
    or ("offer_token" is not null and "offer_expires_at" is not null
        and "offer_starts_at" is not null and "offer_ends_at" is not null)
  )
);

CREATE INDEX IF NOT EXISTS "booking_waitlist_queue_idx"
  ON "booking_waitlist" ("calendar_id", "status", "position", "created_at");
CREATE INDEX IF NOT EXISTS "booking_waitlist_contact_idx"
  ON "booking_waitlist" ("contact_id");
CREATE INDEX IF NOT EXISTS "booking_waitlist_window_idx"
  ON "booking_waitlist" ("window_start", "window_end");
CREATE UNIQUE INDEX IF NOT EXISTS "booking_waitlist_offer_token_idx"
  ON "booking_waitlist" ("offer_token") WHERE "offer_token" is not null;
