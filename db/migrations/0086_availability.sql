-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- What may be booked on a calendar (C6.02, MASTER.md §4.4).
CREATE TABLE IF NOT EXISTS "availability_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "calendar_id" uuid NOT NULL REFERENCES "calendars"("id") ON DELETE cascade,
  "weekday" smallint NOT NULL,
  "starts" time NOT NULL,
  "ends" time NOT NULL,
  "effective_from" date,
  "effective_to" date,
  "kind" text DEFAULT 'bookable' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "availability_rules_weekday" CHECK ("weekday" between 0 and 6),
  -- Overnight hours are split into two rules: a window that ends before it
  -- starts has to be special-cased by every reader, and one will forget.
  CONSTRAINT "availability_rules_order" CHECK ("ends" > "starts"),
  CONSTRAINT "availability_rules_effective_order" CHECK (
    "effective_from" is null or "effective_to" is null
    or "effective_to" >= "effective_from"
  )
);

CREATE INDEX IF NOT EXISTS "availability_rules_calendar_idx"
  ON "availability_rules" ("calendar_id", "weekday");

CREATE TABLE IF NOT EXISTS "availability_exceptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "calendar_id" uuid NOT NULL REFERENCES "calendars"("id") ON DELETE cascade,
  "starts_on" date NOT NULL,
  "ends_on" date NOT NULL,
  "kind" text NOT NULL,
  "starts" time,
  "ends" time,
  "reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "availability_exceptions_order" CHECK ("ends_on" >= "starts_on"),
  -- Closed means no times; anything else means both. A row that is half of
  -- each cannot be rendered, and guessing would be the platform deciding
  -- somebody's hours for them.
  CONSTRAINT "availability_exceptions_times" CHECK (
    case when "kind" = 'closed'
      then "starts" is null and "ends" is null
      else "starts" is not null and "ends" is not null and "ends" > "starts" end
  )
);

CREATE INDEX IF NOT EXISTS "availability_exceptions_calendar_idx"
  ON "availability_exceptions" ("calendar_id", "starts_on");
