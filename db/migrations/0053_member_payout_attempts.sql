-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C12.26–C12.27: numbered provider attempts per payout transfer, the earlier
-- attempts kept for late webhooks, and two states that need the owner or the
-- seller: "unknown" (the provider may have paid) and "unclaimed" (PayPal is
-- holding the money for the seller to claim).
ALTER TABLE "member_payout_transfers" ADD COLUMN "attempt" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "member_payout_transfers" ADD COLUMN "attempt_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "member_payout_transfers" ADD COLUMN "previous_attempts" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "member_payout_transfers" DROP CONSTRAINT "member_payout_transfers_state_valid";--> statement-breakpoint
ALTER TABLE "member_payout_transfers" ADD CONSTRAINT "member_payout_transfers_state_valid" CHECK ("member_payout_transfers"."state" in ('pending','sent','settled','failed','unknown','unclaimed'));
