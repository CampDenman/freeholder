-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
--
-- Share targets and tracked short links (MASTER.md §34, §43 C9.28).
--
-- Additive: two new tables, nothing renamed or dropped.
--
-- There is deliberately no row per shareable thing. §34 makes sharing "a
-- property of every entity with a public face", and the set of entities with a
-- public face is already answered by the SEO entity registry every module
-- feeds. A `share_targets` row is a *decision an owner made* — sharing off, a
-- social headline written — plus the anchor a tracked link hangs from. No row
-- means shareable, described by the page itself.
--
-- There is also deliberately no click counter. §34 wants clicks to "land as
-- analytics events attributed to the share", and the platform already counts
-- visits and attributes campaigns. A `clicks` column here would be a second
-- set of numbers that disagrees with the traffic report the first time a
-- visitor declines analytics, and a business cannot use two.
CREATE TABLE "share_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_kind" text DEFAULT 'page' NOT NULL,
	"path" text NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"shareable" boolean DEFAULT true NOT NULL,
	"channels" text[],
	"social_title" text,
	"social_description" text,
	"image_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- One act of sharing: one person, one thing, one channel. Not deduplicated,
-- because the count of rows is the sentence §34 promises an owner ("this
-- gallery was shared 12 times") and reusing a row would turn that into "how
-- many distinct ways it could be shared", which nobody asked.
CREATE TABLE "shared_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_id" uuid NOT NULL,
	"ref" text NOT NULL,
	"channel" text NOT NULL,
	"sharer_contact_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "shared_links" ADD CONSTRAINT "shared_links_target_id_share_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."share_targets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- The sharer is a Contact like everybody else (§4.1), nullable because most
-- sharing is done by people the business has never met. `contacts.merge`
-- repoints it and the privacy registry exports and erases it; both
-- registrations live beside the schema in `src/modules/share/service.ts`.
ALTER TABLE "shared_links" ADD CONSTRAINT "shared_links_sharer_contact_id_contacts_id_fk" FOREIGN KEY ("sharer_contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- One answer per URL per language. Two rows for one path would be two answers
-- to "may this be shared", and the safe one would lose whichever query sorted
-- first.
CREATE UNIQUE INDEX "share_targets_path_idx" ON "share_targets" USING btree ("path","locale");--> statement-breakpoint
CREATE INDEX "share_targets_shareable_idx" ON "share_targets" USING btree ("shareable");--> statement-breakpoint

-- The whole public redirect is a lookup on this.
CREATE UNIQUE INDEX "shared_links_ref_idx" ON "shared_links" USING btree ("ref");--> statement-breakpoint
CREATE INDEX "shared_links_target_idx" ON "shared_links" USING btree ("target_id","created_at");--> statement-breakpoint
CREATE INDEX "shared_links_sharer_idx" ON "shared_links" USING btree ("sharer_contact_id");
