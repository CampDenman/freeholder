-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C12.26–C12.27: transfers from before numbered attempts. The earlier code
-- never recorded an unknown outcome, and did not count an attempt until the
-- call came back, so any transfer it left pending or failed may have been
-- paid — by a call that timed out, or one whose result was never recorded —
-- and Razorpay calls then carried no idempotency key. Every such transfer is
-- marked "unknown" so it is never resent under a new key without the
-- owner checking the provider; its attempt is dated so same-key retries
-- stop in time. Each affected payout under review says so.
UPDATE "member_payouts" SET "note" = 'Check with ' || t."provider" || ' whether the seller was paid: an attempt from before this update may have gone through. Then record "provider paid" or "provider did not pay — send again"; nothing is sent until you do.'
FROM "member_payout_transfers" t
WHERE t."payout_id" = "member_payouts"."id" AND t."kind" = 'transfer' AND t."state" IN ('pending', 'failed') AND t."attempt" = 1 AND "member_payouts"."state" = 'review';--> statement-breakpoint
UPDATE "member_payout_transfers" SET "state" = 'unknown', "attempt_started_at" = COALESCE("attempt_started_at", "updated_at"), "last_error" = 'Outcome unknown: tried before this update; ' || COALESCE("last_error", 'no result recorded.')
WHERE "kind" = 'transfer' AND "state" IN ('pending', 'failed') AND "attempt" = 1;--> statement-breakpoint
CREATE INDEX "member_payout_transfers_previous_attempts_idx" ON "member_payout_transfers" USING gin ("previous_attempts" jsonb_path_ops);
