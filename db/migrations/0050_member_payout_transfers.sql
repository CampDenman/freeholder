-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C12.26–C12.27 (MASTER.md §44.8): payouts sent, and reversed, through a
-- payout provider.
CREATE TABLE "member_payout_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payout_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"provider" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"reference" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_payout_transfers_kind_valid" CHECK ("member_payout_transfers"."kind" in ('transfer','reversal')),
	CONSTRAINT "member_payout_transfers_state_valid" CHECK ("member_payout_transfers"."state" in ('pending','sent','settled','failed'))
);
--> statement-breakpoint
ALTER TABLE "member_payout_transfers" ADD CONSTRAINT "member_payout_transfers_payout_id_member_payouts_id_fk" FOREIGN KEY ("payout_id") REFERENCES "public"."member_payouts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "member_payout_transfers_once_idx" ON "member_payout_transfers" USING btree ("payout_id","kind");
--> statement-breakpoint
CREATE INDEX "member_payout_transfers_due_idx" ON "member_payout_transfers" USING btree ("state","next_attempt_at");
--> statement-breakpoint
CREATE INDEX "member_payout_transfers_reference_idx" ON "member_payout_transfers" USING btree ("provider","reference");
