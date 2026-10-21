-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- Voice/video rooms, joins, and transcript artifacts on the conversation spine
-- (MASTER.md §4.14). Expand-only: new tables and nullable columns the previous
-- release never reads.
CREATE TABLE "voice_video_rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"conversation_id" uuid,
	"kind" text NOT NULL,
	"provider" text NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"external_ref" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "voice_video_rooms" ADD CONSTRAINT "voice_video_rooms_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "voice_video_rooms_contact_idx" ON "voice_video_rooms" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "voice_video_rooms_status_idx" ON "voice_video_rooms" USING btree ("status");--> statement-breakpoint
CREATE TABLE "voice_video_joins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"conversation_id" uuid,
	"status" text DEFAULT 'joined' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "voice_video_joins" ADD CONSTRAINT "voice_video_joins_room_id_voice_video_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."voice_video_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_video_joins" ADD CONSTRAINT "voice_video_joins_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "voice_video_joins_room_contact_idx" ON "voice_video_joins" USING btree ("room_id", "contact_id");--> statement-breakpoint
CREATE INDEX "voice_video_joins_contact_idx" ON "voice_video_joins" USING btree ("contact_id");--> statement-breakpoint
ALTER TABLE "voice_video_artifacts" ADD COLUMN "room_id" uuid;--> statement-breakpoint
ALTER TABLE "voice_video_artifacts" ADD COLUMN "transcript" text;--> statement-breakpoint
ALTER TABLE "voice_video_artifacts" ADD COLUMN "duration_seconds" integer;--> statement-breakpoint
ALTER TABLE "voice_video_artifacts" ADD CONSTRAINT "voice_video_artifacts_room_id_voice_video_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."voice_video_rooms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "voice_video_artifacts_room_idx" ON "voice_video_artifacts" USING btree ("room_id");
