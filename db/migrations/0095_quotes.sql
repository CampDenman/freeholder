-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- Negotiable offers (C6.12, §4.3).
--
--   draft → sent → viewed → (negotiating ⇄) → accepted | declined | expired
--
-- The shape that matters is versioning: a quote is a sequence of offers rather
-- than one offer that gets edited, so line items carry the version they belong
-- to and a revision writes a new set. "But you quoted me £4,000" is answerable
-- from the database rather than from anybody's memory.

CREATE TABLE IF NOT EXISTS "quote_sequences" (
  "id" text PRIMARY KEY NOT NULL,
  "next_value" integer DEFAULT 1 NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "quotes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "contact_id" uuid NOT NULL REFERENCES "contacts"("id") ON DELETE restrict,
  -- Human-facing, sequential, and the thing an owner says on the phone.
  "reference" text NOT NULL,
  "title" text NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  -- Which set of line items is live. Revising increments it.
  "version" integer DEFAULT 1 NOT NULL,
  "currency" text NOT NULL,
  -- A quote that stays open forever is a price the business is still bound by
  -- two years later, which is what a validity date exists to prevent.
  "valid_until" timestamp with time zone,
  "deposit_minor" bigint,
  "terms" text,
  "notes" text,
  "view_token" text,
  "sent_at" timestamp with time zone,
  "first_viewed_at" timestamp with time zone,
  "accepted_at" timestamp with time zone,
  "accepted_by_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "declined_at" timestamp with time zone,
  "decline_reason" text,
  -- What was actually agreed, frozen at acceptance. Optional lines make the
  -- total a function of what the customer chose, so recomputing it later from
  -- rows somebody has since revised would answer a different question.
  "accepted_snapshot" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "quotes_status" CHECK (
    "status" in ('draft', 'sent', 'viewed', 'negotiating', 'accepted', 'declined', 'expired')
  ),
  CONSTRAINT "quotes_version" CHECK ("version" > 0),
  CONSTRAINT "quotes_deposit" CHECK ("deposit_minor" is null or "deposit_minor" >= 0),
  CONSTRAINT "quotes_title" CHECK (char_length("title") between 1 and 200),
  -- An accepted quote without the thing it accepted is a number nobody can
  -- defend — the shape a bug leaves.
  CONSTRAINT "quotes_accepted_complete" CHECK (
    "status" <> 'accepted'
    or ("accepted_at" is not null and "accepted_snapshot" is not null)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS "quotes_reference_idx" ON "quotes" ("reference");
CREATE INDEX IF NOT EXISTS "quotes_contact_idx" ON "quotes" ("contact_id");
CREATE INDEX IF NOT EXISTS "quotes_status_idx" ON "quotes" ("status", "valid_until");
CREATE UNIQUE INDEX IF NOT EXISTS "quotes_view_token_idx"
  ON "quotes" ("view_token") WHERE "view_token" is not null;

CREATE TABLE IF NOT EXISTS "quote_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "quote_id" uuid NOT NULL REFERENCES "quotes"("id") ON DELETE cascade,
  -- Rows are never edited across versions; a revision writes a new set.
  "version" integer NOT NULL,
  "description" text NOT NULL,
  -- Six-decimal fixed point, as everywhere else money meets quantity.
  "quantity_micros" bigint DEFAULT 1000000 NOT NULL,
  "unit_price_minor" bigint NOT NULL,
  -- §4.3: the client can toggle these. Everything else is the offer.
  "optional" boolean DEFAULT false NOT NULL,
  "selected" boolean DEFAULT true NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "quote_items_version" CHECK ("version" > 0),
  CONSTRAINT "quote_items_quantity" CHECK ("quantity_micros" > 0),
  CONSTRAINT "quote_items_price" CHECK ("unit_price_minor" >= 0),
  CONSTRAINT "quote_items_description" CHECK (
    char_length("description") between 1 and 500
  )
);

CREATE INDEX IF NOT EXISTS "quote_items_quote_idx"
  ON "quote_items" ("quote_id", "version", "sort_order");

CREATE TABLE IF NOT EXISTS "quote_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "quote_id" uuid NOT NULL REFERENCES "quotes"("id") ON DELETE cascade,
  -- Which version they were looking at, so a reply reads in context.
  "version" integer NOT NULL,
  "author" text NOT NULL,
  "author_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "body" text NOT NULL,
  -- Carried, never applied. A counter-offer is a message; only the owner turns
  -- one into a revision, which is what keeps the price the business's to set.
  "proposed_changes" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "quote_messages_author" CHECK ("author" in ('owner', 'contact')),
  CONSTRAINT "quote_messages_body" CHECK (char_length("body") between 1 and 10000)
);

CREATE INDEX IF NOT EXISTS "quote_messages_quote_idx"
  ON "quote_messages" ("quote_id", "created_at");
