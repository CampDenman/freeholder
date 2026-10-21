-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C12.36 (MASTER.md §44.6): files in end-to-end encrypted conversations,
-- stored as ciphertext the server cannot open.
CREATE TABLE "member_sealed_blobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"message_id" uuid,
	"storage_key" text NOT NULL,
	"size" integer NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "member_sealed_blobs_state_valid" CHECK ("member_sealed_blobs"."state" in ('pending','ready'))
);
--> statement-breakpoint
ALTER TABLE "member_sealed_blobs" ADD CONSTRAINT "member_sealed_blobs_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "member_sealed_blobs" ADD CONSTRAINT "member_sealed_blobs_conversation_id_member_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."member_conversations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "member_sealed_blobs" ADD CONSTRAINT "member_sealed_blobs_message_id_member_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."member_messages"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "member_sealed_blobs_message_idx" ON "member_sealed_blobs" USING btree ("message_id");
--> statement-breakpoint
CREATE INDEX "member_sealed_blobs_purge_idx" ON "member_sealed_blobs" USING btree ("deleted_at","created_at");
