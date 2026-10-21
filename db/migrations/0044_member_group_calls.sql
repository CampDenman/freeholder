-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C12.24 (MASTER.md §44.7): group calls through the site's SFU, with media
-- keys carried in the conversation's MLS group.
ALTER TABLE "member_mls_log" DROP CONSTRAINT "member_mls_log_kind_valid";
--> statement-breakpoint
ALTER TABLE "member_mls_log" ADD CONSTRAINT "member_mls_log_kind_valid" CHECK ("member_mls_log"."kind" in ('commit','welcome','application','control'));
--> statement-breakpoint
ALTER TABLE "member_mls_log" ADD COLUMN "call_id" uuid;
--> statement-breakpoint
CREATE TABLE "member_group_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"started_by" uuid,
	"media" text NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "member_group_calls_media_valid" CHECK ("member_group_calls"."media" in ('voice','video')),
	CONSTRAINT "member_group_calls_state_valid" CHECK ("member_group_calls"."state" in ('active','ended'))
);
--> statement-breakpoint
ALTER TABLE "member_group_calls" ADD CONSTRAINT "member_group_calls_conversation_id_member_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."member_conversations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "member_group_calls" ADD CONSTRAINT "member_group_calls_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "member_group_calls_conversation_idx" ON "member_group_calls" USING btree ("conversation_id","state");
--> statement-breakpoint
CREATE TABLE "member_group_call_participants" (
	"call_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone,
	CONSTRAINT "member_group_call_participants_call_id_user_id_pk" PRIMARY KEY("call_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "member_group_call_participants" ADD CONSTRAINT "member_group_call_participants_call_id_member_group_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."member_group_calls"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "member_group_call_participants" ADD CONSTRAINT "member_group_call_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
