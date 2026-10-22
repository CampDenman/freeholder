-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C6.11 paid event admission: a held seat points at the invoice that settles
-- it, and the hold expires on a deadline the sweeper can find.
ALTER TABLE "event_registrations" ADD COLUMN "invoice_id" uuid;--> statement-breakpoint
ALTER TABLE "event_registrations" ADD COLUMN "hold_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "event_registrations" ADD CONSTRAINT "event_registrations_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_registrations_hold_idx" ON "event_registrations" USING btree ("status","hold_expires_at");
