-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C8.16: permission to publish media of an identifiable person, as a ledger
-- (MASTER.md §4.18).
--
-- Publication consent used to live in three nullable columns on `projects`,
-- and `projects.revokeConsent` set all three back to NULL. That worked, and it
-- destroyed the evidence at the exact moment the evidence starts mattering:
-- after a withdrawal, a clinic could no longer show that it had published
-- lawfully for the six months before. §4.18 is explicit that a withdrawal
-- unpublishes *without deleting*.
--
-- So consent moves to the shape `consent_records` has used all along —
-- immutable proof of one decision, current state derived from the history. A
-- withdrawal is a new row. The existing grants are carried across below rather
-- than dropped, because they are the same evidence.
--
-- Consent is scoped to the work it covers, not to the person. Somebody who
-- agreed to one before-and-after has not agreed to every photograph of them
-- the business will ever hold.
CREATE TABLE "media_consents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "contact_id" uuid NOT NULL,
  "subject_kind" text NOT NULL,
  "subject_id" uuid NOT NULL,
  "state" text NOT NULL,
  "method" text NOT NULL,
  "surfaces" text[] DEFAULT ARRAY['project']::text[] NOT NULL,
  "note" text,
  "evidence_asset_id" uuid,
  "effective_at" timestamp with time zone NOT NULL,
  "expires_at" timestamp with time zone,
  "recorded_by" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "media_consents_state"
    CHECK ("state" IN ('granted', 'withdrawn')),
  CONSTRAINT "media_consents_method"
    CHECK ("method" IN ('contract', 'form', 'email', 'written', 'verbal', 'other')),
  CONSTRAINT "media_consents_expiry_after_effective"
    CHECK ("expires_at" IS NULL OR "expires_at" > "effective_at"),
  -- A withdrawal does not expire; only a grant has a period.
  CONSTRAINT "media_consents_withdrawal_has_no_expiry"
    CHECK ("state" <> 'withdrawn' OR "expires_at" IS NULL),
  CONSTRAINT "media_consents_surfaces"
    CHECK ("surfaces" <@ ARRAY['project','portfolio','service','social','advertising']::text[]),
  CONSTRAINT "media_consents_surfaces_present"
    CHECK (array_length("surfaces", 1) >= 1)
);
--> statement-breakpoint
ALTER TABLE "media_consents" ADD CONSTRAINT "media_consents_contact_id_contacts_id_fk"
  FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "media_consents" ADD CONSTRAINT "media_consents_evidence_asset_id_assets_id_fk"
  FOREIGN KEY ("evidence_asset_id") REFERENCES "assets"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "media_consents_subject_idx"
  ON "media_consents" ("subject_kind", "subject_id", "effective_at");
--> statement-breakpoint
CREATE INDEX "media_consents_contact_idx"
  ON "media_consents" ("contact_id", "effective_at");
--> statement-breakpoint
-- Carry the existing grants over. They are the same evidence, and losing them
-- to a refactor would be the thing this change exists to prevent.
INSERT INTO "media_consents"
  ("contact_id", "subject_kind", "subject_id", "state", "method", "note", "effective_at")
SELECT
  "contact_id",
  'project',
  "id",
  'granted',
  "client_consent_method",
  "client_consent_note",
  "client_consent_given_at"
FROM "projects"
WHERE "contact_id" IS NOT NULL
  AND "client_consent_given_at" IS NOT NULL
  AND "client_consent_method" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "client_consent_given_at";
--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "client_consent_method";
--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "client_consent_note";
--> statement-breakpoint
-- A progress series: orthodontic tracking and a recovery timeline are ordered
-- over time, which a before/after pair cannot express. `captured_at` is when
-- the picture was taken, not when it was uploaded — the distinction the whole
-- of §4.18 turns on.
-- `role` is constrained in the database, so widening the vocabulary is a real
-- migration rather than a TypeScript edit.
ALTER TABLE "project_files" DROP CONSTRAINT "project_files_role";
--> statement-breakpoint
ALTER TABLE "project_files" ADD CONSTRAINT "project_files_role"
  CHECK (role = ANY (ARRAY['hero'::text, 'gallery'::text, 'before'::text, 'after'::text, 'series'::text, 'process'::text, 'detail'::text, 'document'::text]));
--> statement-breakpoint
ALTER TABLE "project_files" ADD COLUMN "series_key" text;
--> statement-breakpoint
ALTER TABLE "project_files" ADD COLUMN "captured_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "project_files" ADD CONSTRAINT "project_files_series"
  CHECK (("role" = 'series') = ("series_key" IS NOT NULL));
--> statement-breakpoint
CREATE INDEX "project_files_series_idx"
  ON "project_files" ("project_id", "series_key", "captured_at")
  WHERE "series_key" IS NOT NULL;
