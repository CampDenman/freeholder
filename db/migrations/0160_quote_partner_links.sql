-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- View-only quote partner links (MASTER.md §34, C9.34).
--
-- Separate from `quotes.view_token`. That token is the authorisation to
-- decide. This table is the authorisation to look, issued by the prospect
-- so a business partner can read the offer without accepting it.
CREATE TABLE "quote_partner_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"invited_by_contact_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "quote_partner_links" ADD CONSTRAINT "quote_partner_links_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_partner_links" ADD CONSTRAINT "quote_partner_links_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_partner_links" ADD CONSTRAINT "quote_partner_links_invited_by_contact_id_contacts_id_fk" FOREIGN KEY ("invited_by_contact_id") REFERENCES "public"."contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "quote_partner_links_person_idx" ON "quote_partner_links" USING btree ("quote_id","contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "quote_partner_links_token_idx" ON "quote_partner_links" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "quote_partner_links_invited_by_idx" ON "quote_partner_links" USING btree ("invited_by_contact_id");
