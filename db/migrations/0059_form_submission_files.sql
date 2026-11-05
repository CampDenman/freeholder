-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C3.38: a form's file answer links its submission to the private asset the
-- submitter uploaded. One asset is one attachment (the unique asset index is
-- the reuse refusal), and one field holds one file per submission. A new
-- table only: the previous release never reads it, so rollback is safe.
CREATE TABLE "form_submission_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"field_key" text NOT NULL,
	"asset_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "form_submission_files" ADD CONSTRAINT "form_submission_files_submission_id_form_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."form_submissions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "form_submission_files" ADD CONSTRAINT "form_submission_files_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "form_submission_files_asset_idx" ON "form_submission_files" USING btree ("asset_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "form_submission_files_field_idx" ON "form_submission_files" USING btree ("submission_id","field_key");
