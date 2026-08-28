-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
--
-- Client proofing (MASTER.md §4.5, C8.05). What the client said about one
-- photograph: favourite, select or reject, with an optional note.
--
-- Keyed on the asset rather than the gallery item, as §4.5 keys it: the
-- opinion is about the photograph, so removing and re-adding an item must not
-- lose the fact that the client had already rejected it.
--
-- contact_id is nullable so privacy erasure can unlink the person and leave
-- the owner's record of which work was chosen, the same trade the gallery row
-- and the access log make. Postgres treats NULLs as distinct in a unique
-- index, so erasing two people who both chose one photograph cannot collide.
CREATE TABLE "gallery_selections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gallery_id" uuid NOT NULL,
	"contact_id" uuid,
	"asset_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gallery_selections_kind" CHECK ("gallery_selections"."kind" in ('favorite', 'select', 'reject')),
	CONSTRAINT "gallery_selections_comment" CHECK ("gallery_selections"."comment" is null or char_length("gallery_selections"."comment") between 1 and 2000)
);
--> statement-breakpoint
ALTER TABLE "gallery_selections" ADD CONSTRAINT "gallery_selections_gallery_id_galleries_id_fk" FOREIGN KEY ("gallery_id") REFERENCES "public"."galleries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gallery_selections" ADD CONSTRAINT "gallery_selections_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gallery_selections" ADD CONSTRAINT "gallery_selections_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gallery_selections_unique_idx" ON "gallery_selections" USING btree ("gallery_id","contact_id","asset_id");--> statement-breakpoint
CREATE INDEX "gallery_selections_gallery_idx" ON "gallery_selections" USING btree ("gallery_id","kind");--> statement-breakpoint
CREATE INDEX "gallery_selections_contact_idx" ON "gallery_selections" USING btree ("contact_id");
