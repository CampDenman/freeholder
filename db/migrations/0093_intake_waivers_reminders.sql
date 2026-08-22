-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- Intake, waivers and reminders (C6.09, §4.3, §4.4).

-- §4.3's `Contract`: an agreement requiring a signature. The body is a
-- snapshot rather than a reference, because what somebody agreed to is the
-- text as it stood when they read it — a pointer would let the business
-- rewrite an agreement after it was signed and nobody could tell.
CREATE TABLE IF NOT EXISTS "contract_documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "contact_id" uuid NOT NULL REFERENCES "contacts"("id") ON DELETE restrict,
  -- Untyped by a foreign key: a waiver hangs off a booking, an agreement will
  -- hang off a quote (C6.12), and contracts may not depend on either.
  "subject_type" text NOT NULL,
  "subject_id" uuid,
  -- Reserved for C6.14's templates; null while the body is typed by hand.
  "template_id" uuid,
  "kind" text DEFAULT 'waiver' NOT NULL,
  "title" text NOT NULL,
  "body_snapshot" text NOT NULL,
  "body_hash" text NOT NULL,
  "status" text DEFAULT 'issued' NOT NULL,
  "sign_token" text,
  "issued_at" timestamp with time zone DEFAULT now() NOT NULL,
  "signed_at" timestamp with time zone,
  "declined_at" timestamp with time zone,
  "signer_name" text,
  "signer_email" text,
  "signer_ip" text,
  "signer_user_agent" text,
  "signature_hash" text,
  "decline_reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "contract_documents_kind" CHECK ("kind" in ('waiver', 'agreement')),
  CONSTRAINT "contract_documents_status" CHECK (
    "status" in ('issued', 'signed', 'declined', 'void')
  ),
  CONSTRAINT "contract_documents_title_valid" CHECK (
    char_length("title") between 1 and 200
  ),
  CONSTRAINT "contract_documents_body_present" CHECK (char_length("body_snapshot") > 0),
  -- `signer_name` is deliberately absent: erasure (§30) removes the person and
  -- keeps the business's evidence, so a signed row with no name is a
  -- legitimate end state rather than a broken one.
  CONSTRAINT "contract_documents_signed_complete" CHECK (
    "status" <> 'signed'
    or ("signed_at" is not null and "signature_hash" is not null)
  )
);

CREATE INDEX IF NOT EXISTS "contract_documents_contact_idx"
  ON "contract_documents" ("contact_id");
CREATE INDEX IF NOT EXISTS "contract_documents_subject_idx"
  ON "contract_documents" ("subject_type", "subject_id");
CREATE INDEX IF NOT EXISTS "contract_documents_status_idx"
  ON "contract_documents" ("status");
CREATE UNIQUE INDEX IF NOT EXISTS "contract_documents_sign_token_idx"
  ON "contract_documents" ("sign_token") WHERE "sign_token" is not null;

-- §4.4's `BookingReminder`. Rows rather than a computed schedule, because "was
-- she reminded?" is a question an owner asks when somebody does not turn up,
-- and a rule that says a reminder *would* have been sent is not an answer.
CREATE TABLE IF NOT EXISTS "booking_reminders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "booking_id" uuid NOT NULL REFERENCES "bookings"("id") ON DELETE cascade,
  "channel" text DEFAULT 'email' NOT NULL,
  "offset_min" integer NOT NULL,
  "send_at" timestamp with time zone NOT NULL,
  "sent_at" timestamp with time zone,
  "status" text DEFAULT 'scheduled' NOT NULL,
  "skip_reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "booking_reminders_channel" CHECK ("channel" in ('email', 'sms')),
  CONSTRAINT "booking_reminders_status" CHECK (
    "status" in ('scheduled', 'sent', 'skipped', 'failed')
  ),
  CONSTRAINT "booking_reminders_offset" CHECK ("offset_min" between 0 and 43200)
);

CREATE INDEX IF NOT EXISTS "booking_reminders_due_idx"
  ON "booking_reminders" ("status", "send_at");
-- Confirming an appointment twice must not text somebody twice, and the upsert
-- on this is what makes rescheduling a re-computation rather than a
-- duplication.
CREATE UNIQUE INDEX IF NOT EXISTS "booking_reminders_unique_idx"
  ON "booking_reminders" ("booking_id", "channel", "offset_min");

-- The pre-template form of `waiver_template_id`: a booking cannot require a
-- waiver until something can hold one, and C6.14's templates render into
-- exactly this shape rather than replacing it.
ALTER TABLE "service_offerings" ADD COLUMN IF NOT EXISTS "waiver_title" text;
ALTER TABLE "service_offerings" ADD COLUMN IF NOT EXISTS "waiver_body" text;
-- A list, because the reminder that works is the day before *and* the hour
-- before, and an owner who wants one should not have to give up the other.
ALTER TABLE "service_offerings"
  ADD COLUMN IF NOT EXISTS "reminder_offsets_min" integer[] DEFAULT '{1440,120}' NOT NULL;
