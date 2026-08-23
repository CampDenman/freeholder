-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- Invoices that come round again, and the chasing that follows (C6.17, §4.3).
--
-- A payment plan (C5.25) splits ONE invoice into installments. A schedule here
-- raises a NEW invoice each period: the retainer client owes £500 every month,
-- and each month is its own debt with its own due date, its own receipt and
-- its own overdue clock. Modelling that as a payment plan would make twelve
-- months of a retainer one enormous permanently part-paid invoice.

CREATE TABLE IF NOT EXISTS "invoice_schedules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "contact_id" uuid NOT NULL REFERENCES "contacts"("id") ON DELETE restrict,
  -- What the owner calls it: "Acme retainer", not "schedule #3".
  "name" text NOT NULL,
  "currency" text NOT NULL,
  "cadence" text DEFAULT 'monthly' NOT NULL,
  "interval_count" integer DEFAULT 1 NOT NULL,
  -- A snapshot per occurrence: editing the schedule changes what the NEXT
  -- invoice says and never what an issued one said.
  "lines" jsonb NOT NULL,
  "memo" text,
  "due_in_days" integer DEFAULT 14 NOT NULL,
  -- Off by default: an invoice going to a customer without anybody looking is
  -- the one automation an owner cannot take back.
  "auto_issue" boolean DEFAULT false NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "next_run_at" timestamp with time zone NOT NULL,
  "ends_on" timestamp with time zone,
  "last_run_at" timestamp with time zone,
  "last_invoice_id" uuid,
  "occurrences" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "invoice_schedules_cadence" CHECK (
    "cadence" in ('weekly', 'monthly', 'quarterly', 'yearly')
  ),
  CONSTRAINT "invoice_schedules_status" CHECK (
    "status" in ('active', 'paused', 'ended')
  ),
  CONSTRAINT "invoice_schedules_interval" CHECK ("interval_count" between 1 and 24),
  CONSTRAINT "invoice_schedules_due_days" CHECK ("due_in_days" between 0 and 365),
  CONSTRAINT "invoice_schedules_name" CHECK (char_length("name") between 1 and 120)
);

CREATE INDEX IF NOT EXISTS "invoice_schedules_due_idx"
  ON "invoice_schedules" ("status", "next_run_at");
CREATE INDEX IF NOT EXISTS "invoice_schedules_contact_idx"
  ON "invoice_schedules" ("contact_id");

-- Offsets are relative to the due date and signed: -3 is three days before,
-- +7 is a week after. That is how an owner thinks about chasing, and computing
-- the absolute date at schedule time means a re-dated invoice re-computes.
CREATE TABLE IF NOT EXISTS "invoice_reminders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "invoice_id" uuid NOT NULL REFERENCES "invoices"("id") ON DELETE cascade,
  "offset_days" integer NOT NULL,
  "send_at" timestamp with time zone NOT NULL,
  "sent_at" timestamp with time zone,
  "status" text DEFAULT 'scheduled' NOT NULL,
  "skip_reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "invoice_reminders_status" CHECK (
    "status" in ('scheduled', 'sent', 'skipped', 'failed')
  ),
  CONSTRAINT "invoice_reminders_offset" CHECK ("offset_days" between -60 and 180)
);

CREATE INDEX IF NOT EXISTS "invoice_reminders_due_idx"
  ON "invoice_reminders" ("status", "send_at");
-- One reminder per invoice and offset: re-issuing an invoice must move its
-- reminders rather than double them.
CREATE UNIQUE INDEX IF NOT EXISTS "invoice_reminders_unique_idx"
  ON "invoice_reminders" ("invoice_id", "offset_days");
