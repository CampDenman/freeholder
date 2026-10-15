-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C12.05 (MASTER.md §44.5): a seller's payout can come from a paid
-- subscription invoice as well as an order line.
ALTER TABLE "member_payouts" ALTER COLUMN "order_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "member_payouts" ALTER COLUMN "order_item_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "member_payouts" ADD COLUMN "invoice_id" uuid;
--> statement-breakpoint
CREATE UNIQUE INDEX "member_payouts_invoice_idx" ON "member_payouts" USING btree ("invoice_id") WHERE "member_payouts"."invoice_id" is not null;
--> statement-breakpoint
ALTER TABLE "member_payouts" ADD CONSTRAINT "member_payouts_one_source" CHECK (("member_payouts"."order_item_id" is not null and "member_payouts"."order_id" is not null and "member_payouts"."invoice_id" is null) or ("member_payouts"."order_item_id" is null and "member_payouts"."order_id" is null and "member_payouts"."invoice_id" is not null));
