-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C8.15: owner-supplied facts and the correction ledger (MASTER.md §4.18).
--
-- Two guarantees live in the database rather than in the service, for the same
-- reason `bookings_no_overlap` and `assessment_bands_no_overlap` do: a rule the
-- application alone checks is a rule a second writer, a retry or a future
-- caller can miss.
--
--   * `attestations_current_idx` — at most one *current* fact per key and
--     subject. Current means published, not withdrawn, not superseded. Without
--     it, "what is the rate today" could have two answers and which one a page
--     showed would depend on row order.
--   * `attestations_one_correction_idx` — a fact can be superseded once. Two
--     corrections of the same row would fork the ledger, and the history would
--     stop being a history.
--
-- COALESCE is why the first one is written here: a NULL subject is the common
-- case (a business-wide rate belongs to no row), and NULLs do not collide in a
-- plain unique index, so every business-wide fact would be exempt from the one
-- rule that matters most.
CREATE TABLE "attestations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "key" text NOT NULL,
  "subject_kind" text,
  "subject_id" text,
  "value" jsonb NOT NULL,
  "source" text NOT NULL,
  "as_of" timestamp with time zone NOT NULL,
  "valid_until" timestamp with time zone,
  "recorded_by" text,
  "published_at" timestamp with time zone,
  "withdrawn_at" timestamp with time zone,
  "supersedes_id" uuid,
  "superseded_at" timestamp with time zone,
  "correction_note" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "attestations_not_self_superseding"
    CHECK ("supersedes_id" IS NULL OR "supersedes_id" <> "id"),
  CONSTRAINT "attestations_validity_after_as_of"
    CHECK ("valid_until" IS NULL OR "valid_until" > "as_of")
);
--> statement-breakpoint
ALTER TABLE "attestations" ADD CONSTRAINT "attestations_supersedes_id_attestations_id_fk"
  FOREIGN KEY ("supersedes_id") REFERENCES "attestations"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "attestations_key_idx" ON "attestations" ("key", "created_at");
--> statement-breakpoint
CREATE INDEX "attestations_subject_idx" ON "attestations" ("subject_kind", "subject_id");
--> statement-breakpoint
CREATE INDEX "attestations_supersedes_idx" ON "attestations" ("supersedes_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "attestations_one_correction_idx"
  ON "attestations" ("supersedes_id")
  WHERE "supersedes_id" IS NOT NULL;
--> statement-breakpoint
-- One current fact per key and subject. Drizzle cannot express the COALESCE,
-- so it is written here by hand.
CREATE UNIQUE INDEX "attestations_current_idx"
  ON "attestations" (
    "key",
    (COALESCE("subject_kind", '')),
    (COALESCE("subject_id", ''))
  )
  WHERE "published_at" IS NOT NULL
    AND "withdrawn_at" IS NULL
    AND "superseded_at" IS NULL;
