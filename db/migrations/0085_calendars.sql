-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- Calendars: anything whose time can be spent (C6.01, MASTER.md §4.4).
CREATE TABLE IF NOT EXISTS "calendars" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "kind" text NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "location_id" uuid REFERENCES "business_locations"("id") ON DELETE set null,
  "timezone" text NOT NULL,
  "capacity_default" integer DEFAULT 1 NOT NULL,
  "colour" text,
  "external_calendar_id" uuid REFERENCES "external_calendars"("id") ON DELETE set null,
  "booking_horizon_days" integer DEFAULT 180 NOT NULL,
  "min_notice_min" integer DEFAULT 120 NOT NULL,
  "max_per_day" integer,
  "status" text DEFAULT 'active' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "calendars_capacity_positive" CHECK ("capacity_default" > 0),
  CONSTRAINT "calendars_horizon_positive" CHECK ("booking_horizon_days" > 0),
  CONSTRAINT "calendars_notice_not_negative" CHECK ("min_notice_min" >= 0),
  CONSTRAINT "calendars_max_per_day_positive" CHECK ("max_per_day" is null or "max_per_day" > 0),
  CONSTRAINT "calendars_person_has_holder" CHECK (("kind" = 'person') = ("user_id" is not null))
);

CREATE UNIQUE INDEX IF NOT EXISTS "calendars_slug_idx" ON "calendars" ("slug");
CREATE INDEX IF NOT EXISTS "calendars_kind_idx" ON "calendars" ("kind", "status");
CREATE INDEX IF NOT EXISTS "calendars_user_idx" ON "calendars" ("user_id");
-- Exactly one business calendar: a second is two answers to "when is the
-- business open", not a configuration anybody meant to make.
CREATE UNIQUE INDEX IF NOT EXISTS "calendars_one_business_idx"
  ON "calendars" ("kind") WHERE "kind" = 'business';

CREATE TABLE IF NOT EXISTS "calendar_memberships" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "calendar_id" uuid NOT NULL REFERENCES "calendars"("id") ON DELETE cascade,
  "service_offering_id" uuid NOT NULL,
  "role" text DEFAULT 'primary' NOT NULL,
  "priority" integer DEFAULT 0 NOT NULL,
  "skill_level" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "calendar_memberships_priority" CHECK ("priority" between 0 and 1000)
);

CREATE UNIQUE INDEX IF NOT EXISTS "calendar_memberships_unique_idx"
  ON "calendar_memberships" ("service_offering_id", "calendar_id", "role");
CREATE INDEX IF NOT EXISTS "calendar_memberships_service_idx"
  ON "calendar_memberships" ("service_offering_id", "priority");
CREATE INDEX IF NOT EXISTS "calendar_memberships_calendar_idx"
  ON "calendar_memberships" ("calendar_id");
