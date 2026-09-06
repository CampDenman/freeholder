-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- Owner-permitted client-issued gallery partner sharing (MASTER.md §34, C9.29).
--
-- The owner opts the gallery in. The client who already opened it may then
-- invite a partner as a scoped guest. `invited_by_contact_id` is who issued
-- that invite; owner-issued guests keep `invited_by_user_id` and leave this
-- null, so a client cannot rotate an owner invitation.
ALTER TABLE "galleries" ADD COLUMN "client_can_invite_partner" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "gallery_guests" ADD COLUMN "invited_by_contact_id" uuid;--> statement-breakpoint
ALTER TABLE "gallery_guests" ADD CONSTRAINT "gallery_guests_invited_by_contact_id_contacts_id_fk" FOREIGN KEY ("invited_by_contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gallery_guests_invited_by_contact_idx" ON "gallery_guests" USING btree ("invited_by_contact_id");
