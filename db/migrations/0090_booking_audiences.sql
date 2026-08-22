-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- Booking audiences (C6.05, MASTER.md §41).
--
-- Bookability is a property of the audience, not of the calendar: customers
-- book during shop hours, friends book any time, and the same busy time
-- blocks both.
CREATE TABLE IF NOT EXISTS "booking_audiences" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "who" text DEFAULT 'public' NOT NULL,
  "token" text,
  "contact_tag" text,
  "hours" text DEFAULT 'calendar' NOT NULL,
  "min_notice_min" integer,
  "booking_horizon_days" integer,
  "buffer_before_min" integer,
  "buffer_after_min" integer,
  "enabled" boolean DEFAULT true NOT NULL,
  "position" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  -- Each kind of proof carries exactly what it needs. A tokenised audience
  -- with no token is a link nobody can use; a tag audience with no tag is one
  -- everybody is in.
  CONSTRAINT "booking_audiences_token_present" CHECK (("who" = 'token') = ("token" is not null)),
  CONSTRAINT "booking_audiences_tag_present" CHECK (("who" = 'tag') = ("contact_tag" is not null)),
  CONSTRAINT "booking_audiences_notice" CHECK ("min_notice_min" is null or "min_notice_min" >= 0),
  CONSTRAINT "booking_audiences_horizon" CHECK ("booking_horizon_days" is null or "booking_horizon_days" > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "booking_audiences_slug_idx" ON "booking_audiences" ("slug");
CREATE UNIQUE INDEX IF NOT EXISTS "booking_audiences_token_idx"
  ON "booking_audiences" ("token") WHERE "token" is not null;
CREATE INDEX IF NOT EXISTS "booking_audiences_enabled_idx"
  ON "booking_audiences" ("enabled", "position");

CREATE TABLE IF NOT EXISTS "booking_audience_hours" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "audience_id" uuid NOT NULL REFERENCES "booking_audiences"("id") ON DELETE cascade,
  "weekday" smallint NOT NULL,
  "starts" time NOT NULL,
  "ends" time NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "booking_audience_hours_weekday" CHECK ("weekday" between 0 and 6),
  CONSTRAINT "booking_audience_hours_order" CHECK ("ends" > "starts")
);

CREATE INDEX IF NOT EXISTS "booking_audience_hours_idx"
  ON "booking_audience_hours" ("audience_id", "weekday");

CREATE TABLE IF NOT EXISTS "booking_audience_services" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "audience_id" uuid NOT NULL REFERENCES "booking_audiences"("id") ON DELETE cascade,
  "service_offering_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "booking_audience_services_idx"
  ON "booking_audience_services" ("audience_id", "service_offering_id");

CREATE TABLE IF NOT EXISTS "booking_audience_calendars" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "audience_id" uuid NOT NULL REFERENCES "booking_audiences"("id") ON DELETE cascade,
  "calendar_id" uuid NOT NULL REFERENCES "calendars"("id") ON DELETE cascade,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "booking_audience_calendars_idx"
  ON "booking_audience_calendars" ("audience_id", "calendar_id");
