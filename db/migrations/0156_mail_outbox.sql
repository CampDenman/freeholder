-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- Encrypted, short-lived mail bodies. Provider I/O happens only after the
-- transaction that staged this row and its pg-boss job has committed.
CREATE TABLE "mail_outbox" (
	"delivery_id" uuid PRIMARY KEY NOT NULL,
	"encrypted_message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_outbox_envelope_present" CHECK (char_length("mail_outbox"."encrypted_message") > 20)
);
--> statement-breakpoint
ALTER TABLE "mail_outbox" ADD CONSTRAINT "mail_outbox_delivery_id_mail_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."mail_deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mail_outbox_created_idx" ON "mail_outbox" USING btree ("created_at");
