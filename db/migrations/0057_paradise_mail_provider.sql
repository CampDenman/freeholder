-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C3.31 (MASTER.md §12): Paradise Modern as one more transactional and bulk
-- mail adapter.
--
-- The provider constraints only widen: every existing row stays valid. Each
-- is re-added NOT VALID and then validated separately, so the check scans the
-- table under SHARE UPDATE EXCLUSIVE instead of holding an exclusive lock for
-- the scan. Rolling back is forward-only once a 'paradise' row exists: the
-- previous release's narrower constraints would reject it.
ALTER TABLE "mail_senders" DROP CONSTRAINT "mail_senders_provider_allowed";
--> statement-breakpoint
ALTER TABLE "mail_senders" ADD CONSTRAINT "mail_senders_provider_allowed" CHECK ("mail_senders"."provider" in ('gmail', 'outlook', 'smtp', 'console', 'resend', 'postmark', 'ses', 'paradise')) NOT VALID;
--> statement-breakpoint
ALTER TABLE "mail_senders" VALIDATE CONSTRAINT "mail_senders_provider_allowed";
--> statement-breakpoint
ALTER TABLE "mail_senders" DROP CONSTRAINT "mail_senders_provider_purpose";
--> statement-breakpoint
ALTER TABLE "mail_senders" ADD CONSTRAINT "mail_senders_provider_purpose" CHECK (("mail_senders"."purpose" = 'transactional' and "mail_senders"."provider" in ('gmail', 'outlook', 'smtp', 'console', 'paradise')) or ("mail_senders"."purpose" = 'bulk' and "mail_senders"."provider" in ('resend', 'postmark', 'ses', 'paradise'))) NOT VALID;
--> statement-breakpoint
ALTER TABLE "mail_senders" VALIDATE CONSTRAINT "mail_senders_provider_purpose";
--> statement-breakpoint
ALTER TABLE "mail_deliveries" DROP CONSTRAINT "mail_deliveries_provider_allowed";
--> statement-breakpoint
ALTER TABLE "mail_deliveries" ADD CONSTRAINT "mail_deliveries_provider_allowed" CHECK ("mail_deliveries"."provider" in ('gmail', 'outlook', 'smtp', 'console', 'resend', 'postmark', 'ses', 'paradise', 'none')) NOT VALID;
--> statement-breakpoint
ALTER TABLE "mail_deliveries" VALIDATE CONSTRAINT "mail_deliveries_provider_allowed";
--> statement-breakpoint
ALTER TABLE "mail_deliveries" DROP CONSTRAINT "mail_deliveries_provider_purpose";
--> statement-breakpoint
ALTER TABLE "mail_deliveries" ADD CONSTRAINT "mail_deliveries_provider_purpose" CHECK (("mail_deliveries"."purpose" = 'transactional' and "mail_deliveries"."provider" in ('gmail', 'outlook', 'smtp', 'console', 'paradise')) or ("mail_deliveries"."purpose" = 'bulk' and "mail_deliveries"."provider" in ('resend', 'postmark', 'ses', 'paradise', 'none'))) NOT VALID;
--> statement-breakpoint
ALTER TABLE "mail_deliveries" VALIDATE CONSTRAINT "mail_deliveries_provider_purpose";
--> statement-breakpoint
-- Grants Freeholder recorded at a permission-checking campaign carrier, so a
-- withdrawal is mirrored only where a grant was sent, to the address it was
-- recorded under.
CREATE TABLE "mail_provider_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"email" text NOT NULL,
	"consent_record_id" uuid,
	"withdrawn_at" timestamp with time zone,
	"withdrawal_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_provider_grants_provider_allowed" CHECK ("mail_provider_grants"."provider" in ('paradise'))
);
--> statement-breakpoint
ALTER TABLE "mail_provider_grants" ADD CONSTRAINT "mail_provider_grants_consent_record_id_consent_records_id_fk" FOREIGN KEY ("consent_record_id") REFERENCES "public"."consent_records"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "mail_provider_grants_unique_idx" ON "mail_provider_grants" USING btree ("provider","email","consent_record_id");
--> statement-breakpoint
CREATE INDEX "mail_provider_grants_consent_idx" ON "mail_provider_grants" USING btree ("consent_record_id");
--> statement-breakpoint
CREATE INDEX "mail_provider_grants_detached_idx" ON "mail_provider_grants" USING btree ("id") WHERE "mail_provider_grants"."consent_record_id" is null;
