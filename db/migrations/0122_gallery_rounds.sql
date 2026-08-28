-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
--
-- Approval rounds over a selection set (MASTER.md §4.5, C8.06).
--
-- A round is one pass of "the client chooses, the owner decides". Sending a
-- round back opens the next one rather than editing this one, which is what
-- makes the history real instead of a status field that forgets.
--
-- `snapshot` freezes what was submitted, because selections stay editable: a
-- round that read live selections would rewrite its own history the moment the
-- client changed their mind in the next round. It holds asset, verdict and
-- comment and deliberately no contact id — an identity buried in jsonb is one
-- contacts.merge cannot repoint, and gallery_selections already records whose
-- opinion each one was.
CREATE TABLE "gallery_rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gallery_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"submitted_by_contact_id" uuid,
	"note" text,
	"snapshot" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"submitted_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gallery_rounds_sequence" CHECK ("gallery_rounds"."sequence" >= 1),
	CONSTRAINT "gallery_rounds_state" CHECK ("gallery_rounds"."state" in ('open', 'submitted', 'approved', 'reopened')),
	CONSTRAINT "gallery_rounds_decided" CHECK (("gallery_rounds"."state" in ('approved', 'reopened') and "gallery_rounds"."decided_at" is not null) or ("gallery_rounds"."state" in ('open', 'submitted') and "gallery_rounds"."decided_at" is null)),
	CONSTRAINT "gallery_rounds_submitted" CHECK (("gallery_rounds"."state" = 'open' and "gallery_rounds"."submitted_at" is null) or ("gallery_rounds"."state" <> 'open' and "gallery_rounds"."submitted_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "gallery_rounds" ADD CONSTRAINT "gallery_rounds_gallery_id_galleries_id_fk" FOREIGN KEY ("gallery_id") REFERENCES "public"."galleries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gallery_rounds" ADD CONSTRAINT "gallery_rounds_submitted_by_contact_id_contacts_id_fk" FOREIGN KEY ("submitted_by_contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gallery_rounds_sequence_idx" ON "gallery_rounds" USING btree ("gallery_id","sequence");--> statement-breakpoint
CREATE INDEX "gallery_rounds_gallery_idx" ON "gallery_rounds" USING btree ("gallery_id","state");--> statement-breakpoint
CREATE INDEX "gallery_rounds_contact_idx" ON "gallery_rounds" USING btree ("submitted_by_contact_id");
