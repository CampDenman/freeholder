-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- Bookings (C6.07, MASTER.md §4.4), and the constraint that makes
-- double-booking impossible rather than unlikely.
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS "bookings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "contact_id" uuid NOT NULL REFERENCES "contacts"("id") ON DELETE restrict,
  "service_offering_id" uuid,
  "calendar_id" uuid NOT NULL REFERENCES "calendars"("id") ON DELETE restrict,
  "secondary_calendar_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
  "starts_at" timestamp with time zone NOT NULL,
  "ends_at" timestamp with time zone NOT NULL,
  "timezone_at_booking" text NOT NULL,
  "status" text DEFAULT 'requested' NOT NULL,
  "location_id" uuid REFERENCES "business_locations"("id") ON DELETE set null,
  "location_detail" text,
  "capacity_used" integer DEFAULT 1 NOT NULL,
  "exclusive" boolean DEFAULT true NOT NULL,
  "invoice_id" uuid,
  "rescheduled_from_id" uuid,
  "reschedule_token" text,
  "intake_submission_id" uuid,
  "waiver_id" uuid,
  "source" text DEFAULT 'admin' NOT NULL,
  "notes" text,
  "cancellation_reason" text,
  "meta" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "bookings_order" CHECK ("ends_at" > "starts_at"),
  CONSTRAINT "bookings_capacity_positive" CHECK ("capacity_used" > 0)
);

CREATE INDEX IF NOT EXISTS "bookings_calendar_idx" ON "bookings" ("calendar_id", "starts_at");
CREATE INDEX IF NOT EXISTS "bookings_contact_idx" ON "bookings" ("contact_id", "starts_at");
CREATE INDEX IF NOT EXISTS "bookings_status_idx" ON "bookings" ("status", "starts_at");
CREATE UNIQUE INDEX IF NOT EXISTS "bookings_reschedule_token_idx"
  ON "bookings" ("reschedule_token") WHERE "reschedule_token" is not null;

-- §4.4: "Double-booking is prevented in the database, not in the UI ... no
-- amount of careful service-layer checking survives two processes."
--
-- Scoped to bookings that actually hold time and to calendars that can only
-- hold one thing at once. A class of twelve overlaps by design, which is why
-- `exclusive` is denormalized onto the row: an exclusion constraint cannot
-- join to the calendar to find out.
ALTER TABLE "bookings" DROP CONSTRAINT IF EXISTS "bookings_no_overlap";
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_no_overlap"
  EXCLUDE USING gist (
    "calendar_id" WITH =,
    tstzrange("starts_at", "ends_at", '[)') WITH &&
  )
  WHERE ("exclusive" AND "status" IN ('requested', 'confirmed', 'in_progress'));

CREATE TABLE IF NOT EXISTS "booking_participants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "booking_id" uuid NOT NULL REFERENCES "bookings"("id") ON DELETE cascade,
  "contact_id" uuid REFERENCES "contacts"("id") ON DELETE set null,
  "name" text,
  "status" text DEFAULT 'registered' NOT NULL,
  "seat_count" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "booking_participants_seats" CHECK ("seat_count" > 0),
  CONSTRAINT "booking_participants_identified" CHECK (
    "contact_id" is not null or "name" is not null
  )
);

CREATE INDEX IF NOT EXISTS "booking_participants_booking_idx"
  ON "booking_participants" ("booking_id");
CREATE INDEX IF NOT EXISTS "booking_participants_contact_idx"
  ON "booking_participants" ("contact_id");
