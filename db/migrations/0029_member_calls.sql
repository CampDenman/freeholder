-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C12.07 (MASTER.md §44.7): private member calls and their WebRTC signalling.
CREATE TABLE "member_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"caller_id" uuid NOT NULL,
	"callee_id" uuid NOT NULL,
	"media" text NOT NULL,
	"state" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"answered_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	CONSTRAINT "member_calls_not_self" CHECK ("member_calls"."caller_id" <> "member_calls"."callee_id"),
	CONSTRAINT "member_calls_media_valid" CHECK ("member_calls"."media" in ('voice','video')),
	CONSTRAINT "member_calls_state_valid" CHECK ("member_calls"."state" in ('ringing','active','ended','declined','missed'))
);
--> statement-breakpoint
ALTER TABLE "member_calls" ADD CONSTRAINT "member_calls_caller_id_users_id_fk" FOREIGN KEY ("caller_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "member_calls" ADD CONSTRAINT "member_calls_callee_id_users_id_fk" FOREIGN KEY ("callee_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "member_calls_callee_idx" ON "member_calls" USING btree ("callee_id","state");
--> statement-breakpoint
CREATE INDEX "member_calls_caller_idx" ON "member_calls" USING btree ("caller_id","state");
--> statement-breakpoint
CREATE TABLE "member_call_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"call_id" uuid NOT NULL,
	"from_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "member_call_signals_kind_valid" CHECK ("member_call_signals"."kind" in ('offer','answer','candidate'))
);
--> statement-breakpoint
ALTER TABLE "member_call_signals" ADD CONSTRAINT "member_call_signals_call_id_member_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."member_calls"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "member_call_signals" ADD CONSTRAINT "member_call_signals_from_id_users_id_fk" FOREIGN KEY ("from_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "member_call_signals_call_idx" ON "member_call_signals" USING btree ("call_id","created_at");
