-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C3.37 (MASTER.md §43): service intake and delivery.
--
-- `forms.intake` marks a form whose accepted submissions open a project for
-- the person who sent them; null is an ordinary form. `projects.delivery_note`
-- is the owner's written note on the latest delivery, which the customer reads
-- in My Account. Both are nullable additions, so the previous release reads
-- and writes these tables unchanged.
ALTER TABLE "forms" ADD COLUMN "intake" jsonb;
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "delivery_note" text;
