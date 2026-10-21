-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C12.34 (MASTER.md §44.6): earlier end-to-end encrypted history, sent from
-- one of a member's devices to another, sealed to the new device's key.
CREATE TABLE "member_history_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"public_key" text NOT NULL,
	"sig" text NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_history_requests_state_valid" CHECK ("member_history_requests"."state" in ('open','closed'))
);
--> statement-breakpoint
ALTER TABLE "member_history_requests" ADD CONSTRAINT "member_history_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "member_history_requests" ADD CONSTRAINT "member_history_requests_device_id_member_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."member_devices"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "member_history_requests_user_idx" ON "member_history_requests" USING btree ("user_id","state");
--> statement-breakpoint
CREATE TABLE "member_history_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"from_device_id" uuid,
	"enc" text NOT NULL,
	"ct" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "member_history_transfers" ADD CONSTRAINT "member_history_transfers_request_id_member_history_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."member_history_requests"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "member_history_transfers" ADD CONSTRAINT "member_history_transfers_conversation_id_member_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."member_conversations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "member_history_transfers" ADD CONSTRAINT "member_history_transfers_from_device_id_member_devices_id_fk" FOREIGN KEY ("from_device_id") REFERENCES "public"."member_devices"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "member_history_transfers_request_idx" ON "member_history_transfers" USING btree ("request_id");
