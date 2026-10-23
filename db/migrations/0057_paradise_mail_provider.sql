-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C3.31 (MASTER.md §12): Paradise Modern as one more transactional and bulk
-- mail adapter. Widening only: every existing row stays valid, and the
-- previous release never writes the new value.
ALTER TABLE "mail_senders" DROP CONSTRAINT "mail_senders_provider_allowed";
--> statement-breakpoint
ALTER TABLE "mail_senders" ADD CONSTRAINT "mail_senders_provider_allowed" CHECK ("mail_senders"."provider" in ('gmail', 'outlook', 'smtp', 'console', 'resend', 'postmark', 'ses', 'paradise'));
--> statement-breakpoint
ALTER TABLE "mail_senders" DROP CONSTRAINT "mail_senders_provider_purpose";
--> statement-breakpoint
ALTER TABLE "mail_senders" ADD CONSTRAINT "mail_senders_provider_purpose" CHECK (("mail_senders"."purpose" = 'transactional' and "mail_senders"."provider" in ('gmail', 'outlook', 'smtp', 'console', 'paradise')) or ("mail_senders"."purpose" = 'bulk' and "mail_senders"."provider" in ('resend', 'postmark', 'ses', 'paradise')));
--> statement-breakpoint
ALTER TABLE "mail_deliveries" DROP CONSTRAINT "mail_deliveries_provider_allowed";
--> statement-breakpoint
ALTER TABLE "mail_deliveries" ADD CONSTRAINT "mail_deliveries_provider_allowed" CHECK ("mail_deliveries"."provider" in ('gmail', 'outlook', 'smtp', 'console', 'resend', 'postmark', 'ses', 'paradise', 'none'));
--> statement-breakpoint
ALTER TABLE "mail_deliveries" DROP CONSTRAINT "mail_deliveries_provider_purpose";
--> statement-breakpoint
ALTER TABLE "mail_deliveries" ADD CONSTRAINT "mail_deliveries_provider_purpose" CHECK (("mail_deliveries"."purpose" = 'transactional' and "mail_deliveries"."provider" in ('gmail', 'outlook', 'smtp', 'console', 'paradise')) or ("mail_deliveries"."purpose" = 'bulk' and "mail_deliveries"."provider" in ('resend', 'postmark', 'ses', 'paradise', 'none')));
