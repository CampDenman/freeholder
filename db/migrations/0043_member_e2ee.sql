-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C12.23 (MASTER.md §44.6): end-to-end encrypted member messages with MLS.
ALTER TABLE "member_messages" ADD COLUMN "e2ee" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "member_messages" ADD COLUMN "frank_tag" text;
--> statement-breakpoint
ALTER TABLE "member_messages" ADD CONSTRAINT "member_messages_frank_tag" CHECK ("member_messages"."e2ee" = ("member_messages"."frank_tag" is not null) or "member_messages"."deleted_at" is not null);
--> statement-breakpoint
CREATE TABLE "member_devices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"label" text NOT NULL,
	"signature_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "member_devices_label_length" CHECK (char_length("member_devices"."label") between 1 and 80)
);
--> statement-breakpoint
ALTER TABLE "member_devices" ADD CONSTRAINT "member_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "member_devices_user_idx" ON "member_devices" USING btree ("user_id");
--> statement-breakpoint
CREATE TABLE "member_key_packages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"device_id" uuid NOT NULL,
	"key_package" text NOT NULL,
	"last_resort" boolean DEFAULT false NOT NULL,
	"claimed_at" timestamp with time zone,
	"claimed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "member_key_packages" ADD CONSTRAINT "member_key_packages_device_id_member_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."member_devices"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "member_key_packages_device_idx" ON "member_key_packages" USING btree ("device_id","claimed_at");
--> statement-breakpoint
CREATE TABLE "member_mls_groups" (
	"conversation_id" uuid PRIMARY KEY NOT NULL,
	"epoch" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "member_mls_groups" ADD CONSTRAINT "member_mls_groups_conversation_id_member_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."member_conversations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "member_mls_roster" (
	"conversation_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"joined_seq" bigint NOT NULL,
	CONSTRAINT "member_mls_roster_conversation_id_device_id_pk" PRIMARY KEY("conversation_id","device_id")
);
--> statement-breakpoint
ALTER TABLE "member_mls_roster" ADD CONSTRAINT "member_mls_roster_conversation_id_member_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."member_conversations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "member_mls_roster" ADD CONSTRAINT "member_mls_roster_device_id_member_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."member_devices"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "member_mls_log" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"epoch" bigint NOT NULL,
	"kind" text NOT NULL,
	"sender_device_id" uuid,
	"target_device_id" uuid,
	"key_package_id" uuid,
	"message_id" uuid,
	"payload" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_mls_log_kind_valid" CHECK ("member_mls_log"."kind" in ('commit','welcome','application')),
	CONSTRAINT "member_mls_log_welcome_target" CHECK (("member_mls_log"."kind" = 'welcome') = ("member_mls_log"."target_device_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "member_mls_log" ADD CONSTRAINT "member_mls_log_conversation_id_member_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."member_conversations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "member_mls_log" ADD CONSTRAINT "member_mls_log_sender_device_id_member_devices_id_fk" FOREIGN KEY ("sender_device_id") REFERENCES "public"."member_devices"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "member_mls_log" ADD CONSTRAINT "member_mls_log_target_device_id_member_devices_id_fk" FOREIGN KEY ("target_device_id") REFERENCES "public"."member_devices"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "member_mls_log" ADD CONSTRAINT "member_mls_log_message_id_member_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."member_messages"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "member_mls_log_conversation_idx" ON "member_mls_log" USING btree ("conversation_id","seq");
