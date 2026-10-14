-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C12.06 (MASTER.md §44.6): member conversations, message requests and
-- messages encrypted at rest.
ALTER TABLE "member_profiles" ADD COLUMN "read_receipts" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE TABLE "member_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"direct_key" text,
	"title" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_conversations_kind_valid" CHECK ("member_conversations"."kind" in ('direct','group')),
	CONSTRAINT "member_conversations_direct_key" CHECK (("member_conversations"."kind" = 'direct') = ("member_conversations"."direct_key" is not null)),
	CONSTRAINT "member_conversations_title_length" CHECK ("member_conversations"."title" is null or char_length("member_conversations"."title") between 1 and 80)
);
--> statement-breakpoint
ALTER TABLE "member_conversations" ADD CONSTRAINT "member_conversations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "member_conversations_direct_idx" ON "member_conversations" USING btree ("direct_key");
--> statement-breakpoint
CREATE TABLE "member_conversation_participants" (
	"conversation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"state" text NOT NULL,
	"last_read_at" timestamp with time zone,
	"muted" boolean DEFAULT false NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_conversation_participants_conversation_id_user_id_pk" PRIMARY KEY("conversation_id","user_id"),
	CONSTRAINT "member_conversation_participants_state_valid" CHECK ("member_conversation_participants"."state" in ('active','requested','left'))
);
--> statement-breakpoint
ALTER TABLE "member_conversation_participants" ADD CONSTRAINT "member_conversation_participants_conversation_id_member_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."member_conversations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "member_conversation_participants" ADD CONSTRAINT "member_conversation_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "member_conversation_participants_user_idx" ON "member_conversation_participants" USING btree ("user_id","state");
--> statement-breakpoint
CREATE TABLE "member_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"sender_id" uuid,
	"body_sealed" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "member_messages" ADD CONSTRAINT "member_messages_conversation_id_member_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."member_conversations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "member_messages" ADD CONSTRAINT "member_messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "member_messages_conversation_idx" ON "member_messages" USING btree ("conversation_id","created_at");
