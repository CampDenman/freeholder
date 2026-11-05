-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C3.36 (MASTER.md §43): the private preview outbox. A preview holds every
-- message it may not deliver as a `held` delivery whose encrypted body stays in
-- mail_outbox for the owner to read, with the reason it was held.
--
-- Additive: a nullable column and a status constraint that only widens, so
-- every existing row stays valid. The constraint is re-added NOT VALID and
-- validated separately, so the scan runs under SHARE UPDATE EXCLUSIVE rather
-- than an exclusive lock. Rolling back is forward-only once a 'held' row
-- exists: the previous release's narrower constraint would reject it.
ALTER TABLE "mail_deliveries" ADD COLUMN "hold_reason" text;
--> statement-breakpoint
ALTER TABLE "mail_deliveries" DROP CONSTRAINT "mail_deliveries_status_allowed";
--> statement-breakpoint
ALTER TABLE "mail_deliveries" ADD CONSTRAINT "mail_deliveries_status_allowed" CHECK ("mail_deliveries"."status" in ('queued', 'submitted', 'delivered', 'bounced', 'complained', 'failed', 'suppressed', 'held')) NOT VALID;
--> statement-breakpoint
ALTER TABLE "mail_deliveries" VALIDATE CONSTRAINT "mail_deliveries_status_allowed";
--> statement-breakpoint
ALTER TABLE "mail_deliveries" ADD CONSTRAINT "mail_deliveries_hold_reason_allowed" CHECK ("mail_deliveries"."hold_reason" is null or "mail_deliveries"."hold_reason" in ('recipient', 'cap', 'no_adapter'));
