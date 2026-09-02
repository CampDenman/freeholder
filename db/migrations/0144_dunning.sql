-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
--
-- Dunning policies (MASTER.md §4.15, C9.16).
--
-- Additive: a policy per plan, and a clock on the subscription. Access during
-- grace is the grant window (`grace_ends_at`), not a flag on the content.
CREATE TABLE "dunning_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"retries" jsonb DEFAULT '[3, 7, 14]'::jsonb NOT NULL,
	"grace_days" integer DEFAULT 14 NOT NULL,
	"notify_channels" jsonb DEFAULT '["email"]'::jsonb NOT NULL,
	"final_action" text DEFAULT 'pause' NOT NULL,
	"downgrade_to_plan_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dunning_policies_grace_nonnegative" CHECK ("grace_days" >= 0)
);
--> statement-breakpoint
ALTER TABLE "dunning_policies" ADD CONSTRAINT "dunning_policies_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dunning_policies" ADD CONSTRAINT "dunning_policies_downgrade_to_plan_id_plans_id_fk" FOREIGN KEY ("downgrade_to_plan_id") REFERENCES "public"."plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dunning_policies_plan_idx" ON "dunning_policies" USING btree ("plan_id");--> statement-breakpoint

ALTER TABLE "subscriptions" ADD COLUMN "dunning_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "dunning_attempt" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "dunning_next_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "grace_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "dunning_invoice_id" uuid;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_dunning_invoice_id_invoices_id_fk" FOREIGN KEY ("dunning_invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "subscriptions_dunning_idx" ON "subscriptions" USING btree ("status","dunning_next_at");
