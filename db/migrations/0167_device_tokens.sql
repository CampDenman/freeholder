-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- One app install that may be pushed to (MASTER.md §35.1, C10.14). Expand-only.
--
-- Unique on the token rather than on (contact, token): a device token is
-- globally unique and belongs to an install, not to a person. When a phone is
-- handed on, re-registration moves the row instead of leaving a second one
-- that would push somebody else's bookings to the new owner.
CREATE TABLE "device_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"token" text NOT NULL,
	"app_version" text NOT NULL,
	"contract_version" integer NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_tokens_token_not_blank" CHECK (length(trim("token")) > 0),
	CONSTRAINT "device_tokens_contract_version" CHECK ("contract_version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_contact_fk" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "device_tokens_token_key" ON "device_tokens" ("token");--> statement-breakpoint
CREATE INDEX "device_tokens_contact_idx" ON "device_tokens" ("contact_id");
