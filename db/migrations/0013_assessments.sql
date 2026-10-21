-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C8.14: owner-authored guided assessments (MASTER.md §4.18).
--
-- The safety property of this feature is a schema fact, not a service
-- convention. Two constraints carry it:
--
--   * `assessment_responses.band_id` is NOT NULL and RESTRICTs deletion, so an
--     outcome nobody authored cannot be stored, and an authored one cannot be
--     deleted out from under a person who was already shown it.
--   * `assessment_bands_no_overlap` makes two bands covering the same score
--     impossible, so "which outcome did they get" can never depend on row
--     order. Drizzle has no EXCLUDE USING gist expression, so — as with
--     `bookings_no_overlap` (§4.4) — it is written here by hand.
CREATE TABLE "assessments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "trashed_at" timestamp with time zone,
  "slug" text NOT NULL,
  "name" text NOT NULL,
  "intro" text,
  "questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "destination" text DEFAULT 'contact' NOT NULL,
  "notify" text[] DEFAULT '{}'::text[] NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "assessments_destination_check" CHECK ("destination" IN ('contact', 'none')),
  CONSTRAINT "assessments_status_check" CHECK ("status" IN ('draft', 'active', 'closed'))
);
--> statement-breakpoint
CREATE TABLE "assessment_bands" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "assessment_id" uuid NOT NULL,
  "key" text NOT NULL,
  "label" text NOT NULL,
  "body" text NOT NULL,
  "min_score" integer NOT NULL,
  "max_score" integer NOT NULL,
  "ordinal" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "assessment_bands_range" CHECK ("max_score" >= "min_score")
);
--> statement-breakpoint
CREATE TABLE "assessment_escalations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "assessment_id" uuid NOT NULL,
  "question_key" text NOT NULL,
  "option_key" text NOT NULL,
  "instruction" text NOT NULL,
  "ordinal" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assessment_responses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "assessment_id" uuid NOT NULL,
  "contact_id" uuid,
  "answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "score" integer NOT NULL,
  "band_id" uuid NOT NULL,
  "escalation_id" uuid,
  "idempotency_key" text,
  "source_url" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assessment_bands" ADD CONSTRAINT "assessment_bands_assessment_id_assessments_id_fk"
  FOREIGN KEY ("assessment_id") REFERENCES "assessments"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "assessment_escalations" ADD CONSTRAINT "assessment_escalations_assessment_id_assessments_id_fk"
  FOREIGN KEY ("assessment_id") REFERENCES "assessments"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "assessment_responses" ADD CONSTRAINT "assessment_responses_assessment_id_assessments_id_fk"
  FOREIGN KEY ("assessment_id") REFERENCES "assessments"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "assessment_responses" ADD CONSTRAINT "assessment_responses_contact_id_contacts_id_fk"
  FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "assessment_responses" ADD CONSTRAINT "assessment_responses_band_id_assessment_bands_id_fk"
  FOREIGN KEY ("band_id") REFERENCES "assessment_bands"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "assessment_responses" ADD CONSTRAINT "assessment_responses_escalation_id_assessment_escalations_id_fk"
  FOREIGN KEY ("escalation_id") REFERENCES "assessment_escalations"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "assessments_slug_idx" ON "assessments" ("slug");
--> statement-breakpoint
CREATE INDEX "assessments_trash_idx" ON "assessments" ("trashed_at") WHERE "trashed_at" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "assessment_bands_key_idx" ON "assessment_bands" ("assessment_id", "key");
--> statement-breakpoint
CREATE INDEX "assessment_bands_range_idx" ON "assessment_bands" ("assessment_id", "min_score");
--> statement-breakpoint
CREATE UNIQUE INDEX "assessment_escalations_answer_idx" ON "assessment_escalations" ("assessment_id", "question_key", "option_key");
--> statement-breakpoint
CREATE INDEX "assessment_responses_assessment_idx" ON "assessment_responses" ("assessment_id", "created_at");
--> statement-breakpoint
CREATE INDEX "assessment_responses_contact_idx" ON "assessment_responses" ("contact_id");
--> statement-breakpoint
CREATE INDEX "assessment_responses_band_idx" ON "assessment_responses" ("band_id");
--> statement-breakpoint
CREATE INDEX "assessment_responses_escalation_idx" ON "assessment_responses" ("escalation_id");
--> statement-breakpoint
-- A double-click, a back button and a flaky connection all post twice. The
-- second post carries the key the page was rendered with, so it resolves to
-- the answer already stored instead of telling somebody a second time.
CREATE UNIQUE INDEX "assessment_responses_idempotency_idx"
  ON "assessment_responses" ("assessment_id", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;
--> statement-breakpoint
-- Drizzle has no EXCLUDE USING gist expression; §4.18 requires it in the database.
-- Inclusive bounds: a band from 0 to 3 and a band from 3 to 6 both contain 3,
-- and that is the ambiguity this refuses.
ALTER TABLE "assessment_bands" ADD CONSTRAINT "assessment_bands_no_overlap"
  EXCLUDE USING gist (
    "assessment_id" WITH =,
    int4range("min_score", "max_score", '[]') WITH &&
  );
