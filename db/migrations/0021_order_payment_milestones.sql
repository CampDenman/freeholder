-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C5.21/C5.22: immutable checkout promise and explicitly released payment stages.
ALTER TABLE "orders" ADD COLUMN "checkout_terms_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "checkout_payment_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_status_valid";--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_status_valid" CHECK ("orders"."status" in ('pending_payment','partially_paid','paid','fulfilling','fulfilled','refunded','cancelled'));--> statement-breakpoint
CREATE TABLE "order_payment_milestones" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "order_id" uuid NOT NULL,
    "position" integer NOT NULL,
    "label" text NOT NULL,
    "amount_minor" bigint NOT NULL,
    "released_at" timestamp with time zone,
    "released_by" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "order_payment_milestones_amount_positive" CHECK ("order_payment_milestones"."amount_minor" > 0),
    CONSTRAINT "order_payment_milestones_position_nonnegative" CHECK ("order_payment_milestones"."position" >= 0)
);--> statement-breakpoint
ALTER TABLE "order_payment_milestones" ADD CONSTRAINT "order_payment_milestones_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "order_payment_milestones_position_idx" ON "order_payment_milestones" USING btree ("order_id","position");
