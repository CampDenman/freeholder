-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- Automatic subscription billing (MASTER.md §4.15, C9.33).
--
-- Platform mode charges a stored method. Provider mode follows the provider's
-- schedule. A pending plan is the period-end change when proration is none.
ALTER TABLE "subscriptions" ADD COLUMN "payment_method_id" uuid;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "pending_plan_id" uuid;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_payment_method_fk" FOREIGN KEY ("payment_method_id") REFERENCES "payment_methods"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_pending_plan_fk" FOREIGN KEY ("pending_plan_id") REFERENCES "plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "subscriptions_payment_method_idx" ON "subscriptions" USING btree ("payment_method_id");
