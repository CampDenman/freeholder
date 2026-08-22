-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- Equipment and space hire (C6.10, §4.2).
--
-- No availability tables here on purpose. §4.2: "A rental is a bookable thing
-- rather than a bookable person, so it reuses the scheduling engine's resource
-- calendars rather than inventing a second availability model." A hire holds
-- its time as an ordinary booking, and the exclusion constraint that stops a
-- massage room being double-booked stops the lens going out twice.

CREATE TABLE IF NOT EXISTS "rental_terms" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "variant_id" uuid NOT NULL REFERENCES "product_variants"("id") ON DELETE cascade,
  -- The whole of "reuses the scheduling engine" is this column, and it is not
  -- nullable: a hire with no calendar is a hire nothing can stop double-booking.
  "calendar_id" uuid NOT NULL REFERENCES "calendars"("id") ON DELETE restrict,
  "unit" text DEFAULT 'day' NOT NULL,
  "min_units" integer DEFAULT 1 NOT NULL,
  "max_units" integer,
  -- Turnaround: cleaning, charging, checking. Time nobody else may book.
  "buffer_before_hours" integer DEFAULT 0 NOT NULL,
  "buffer_after_hours" integer DEFAULT 0 NOT NULL,
  "deposit_minor" bigint DEFAULT 0 NOT NULL,
  "damage_policy" text DEFAULT 'deposit_only' NOT NULL,
  "replacement_value_minor" bigint DEFAULT 0 NOT NULL,
  "late_fee_per_unit_minor" bigint DEFAULT 0 NOT NULL,
  "conditions_body" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "rental_terms_unit" CHECK ("unit" in ('hour', 'day', 'week')),
  CONSTRAINT "rental_terms_damage_policy" CHECK (
    "damage_policy" in ('deposit_only', 'repair_cost', 'replacement')
  ),
  CONSTRAINT "rental_terms_min_units" CHECK ("min_units" > 0),
  CONSTRAINT "rental_terms_max_units" CHECK (
    "max_units" is null or "max_units" >= "min_units"
  ),
  CONSTRAINT "rental_terms_buffers" CHECK (
    "buffer_before_hours" >= 0 and "buffer_after_hours" >= 0
  ),
  CONSTRAINT "rental_terms_money" CHECK (
    "deposit_minor" >= 0 and "replacement_value_minor" >= 0
    and "late_fee_per_unit_minor" >= 0
  ),
  -- A policy that charges for a replacement without knowing what one costs
  -- produces a fee of zero at the exact moment the business needs a number.
  CONSTRAINT "rental_terms_replacement_known" CHECK (
    "damage_policy" <> 'replacement' or "replacement_value_minor" > 0
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS "rental_terms_variant_idx"
  ON "rental_terms" ("variant_id");
CREATE INDEX IF NOT EXISTS "rental_terms_calendar_idx"
  ON "rental_terms" ("calendar_id");

CREATE TABLE IF NOT EXISTS "rental_agreements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "contact_id" uuid NOT NULL REFERENCES "contacts"("id") ON DELETE restrict,
  "variant_id" uuid NOT NULL REFERENCES "product_variants"("id") ON DELETE restrict,
  -- The booking that holds the time. Nullable only so a hire survives its
  -- booking being erased; while it exists, it is what stops the thing going
  -- out twice.
  "booking_id" uuid REFERENCES "bookings"("id") ON DELETE set null,
  "calendar_id" uuid NOT NULL REFERENCES "calendars"("id") ON DELETE restrict,
  "starts_at" timestamp with time zone NOT NULL,
  -- When it is due back, which is not the same as when it came back.
  "ends_at" timestamp with time zone NOT NULL,
  "unit" text NOT NULL,
  "units" integer NOT NULL,
  "status" text DEFAULT 'reserved' NOT NULL,
  "quoted_minor" bigint DEFAULT 0 NOT NULL,
  "deposit_minor" bigint DEFAULT 0 NOT NULL,
  "currency" text,
  "invoice_id" uuid,
  "picked_up_at" timestamp with time zone,
  "returned_at" timestamp with time zone,
  "condition_out" text,
  "condition_in" text,
  "return_condition" text,
  -- A record of the decision, not of a transaction. A hire is not a payment:
  -- charging for a broken lens is a deliberate act in invoicing.
  "late_fee_minor" bigint DEFAULT 0 NOT NULL,
  "damage_fee_minor" bigint DEFAULT 0 NOT NULL,
  "deposit_refund_minor" bigint DEFAULT 0 NOT NULL,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "rental_agreements_unit" CHECK ("unit" in ('hour', 'day', 'week')),
  CONSTRAINT "rental_agreements_status" CHECK (
    "status" in ('reserved', 'out', 'overdue', 'returned', 'closed', 'cancelled')
  ),
  CONSTRAINT "rental_agreements_condition" CHECK (
    "return_condition" is null or "return_condition" in ('fine', 'damaged', 'lost')
  ),
  CONSTRAINT "rental_agreements_order" CHECK ("ends_at" > "starts_at"),
  CONSTRAINT "rental_agreements_units" CHECK ("units" > 0),
  CONSTRAINT "rental_agreements_money" CHECK (
    "quoted_minor" >= 0 and "deposit_minor" >= 0 and "late_fee_minor" >= 0
    and "damage_fee_minor" >= 0 and "deposit_refund_minor" >= 0
  ),
  -- Something cannot be out without having gone out, or back without having
  -- been out — the shape a bug leaves is a row that claims both.
  CONSTRAINT "rental_agreements_out_complete" CHECK (
    "status" not in ('out', 'overdue', 'returned', 'closed')
    or "picked_up_at" is not null
  ),
  CONSTRAINT "rental_agreements_return_complete" CHECK (
    "status" not in ('returned', 'closed')
    or ("returned_at" is not null and "return_condition" is not null)
  )
);

CREATE INDEX IF NOT EXISTS "rental_agreements_contact_idx"
  ON "rental_agreements" ("contact_id");
CREATE INDEX IF NOT EXISTS "rental_agreements_variant_idx"
  ON "rental_agreements" ("variant_id", "starts_at");
CREATE INDEX IF NOT EXISTS "rental_agreements_status_idx"
  ON "rental_agreements" ("status", "ends_at");
CREATE INDEX IF NOT EXISTS "rental_agreements_booking_idx"
  ON "rental_agreements" ("booking_id");
