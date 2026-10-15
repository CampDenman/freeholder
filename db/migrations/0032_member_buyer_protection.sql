-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C12.10 (MASTER.md §44.8): delivery, disputes and the sale thread.
CREATE TABLE "member_sale_fulfilments" (
	"order_id" uuid NOT NULL,
	"seller_id" uuid NOT NULL,
	"state" text DEFAULT 'awaiting' NOT NULL,
	"carrier" text,
	"tracking" text,
	"shipped_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"delivered_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_sale_fulfilments_order_id_seller_id_pk" PRIMARY KEY("order_id","seller_id"),
	CONSTRAINT "member_sale_fulfilments_state_valid" CHECK ("member_sale_fulfilments"."state" in ('awaiting','shipped','delivered'))
);
--> statement-breakpoint
ALTER TABLE "member_sale_fulfilments" ADD CONSTRAINT "member_sale_fulfilments_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "member_disputes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"seller_id" uuid NOT NULL,
	"buyer_user_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"resolution_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "member_disputes_reason_valid" CHECK ("member_disputes"."reason" in ('not_received','not_as_described','other')),
	CONSTRAINT "member_disputes_state_valid" CHECK ("member_disputes"."state" in ('open','released','refunded','withdrawn'))
);
--> statement-breakpoint
ALTER TABLE "member_disputes" ADD CONSTRAINT "member_disputes_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "member_disputes" ADD CONSTRAINT "member_disputes_buyer_user_id_users_id_fk" FOREIGN KEY ("buyer_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "member_disputes_order_idx" ON "member_disputes" USING btree ("order_id","seller_id");
--> statement-breakpoint
CREATE INDEX "member_disputes_state_idx" ON "member_disputes" USING btree ("state","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "member_disputes_one_open_idx" ON "member_disputes" USING btree ("order_id","seller_id") WHERE "member_disputes"."state" = 'open';
--> statement-breakpoint
CREATE TABLE "member_sale_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"seller_id" uuid NOT NULL,
	"author_user_id" uuid,
	"role" text NOT NULL,
	"body_sealed" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_sale_messages_role_valid" CHECK ("member_sale_messages"."role" in ('buyer','seller','site'))
);
--> statement-breakpoint
ALTER TABLE "member_sale_messages" ADD CONSTRAINT "member_sale_messages_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "member_sale_messages" ADD CONSTRAINT "member_sale_messages_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "member_sale_messages_sale_idx" ON "member_sale_messages" USING btree ("order_id","seller_id","created_at");
