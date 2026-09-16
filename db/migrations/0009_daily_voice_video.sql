-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C3.13: verified Daily room identity and fenced room/recording work.
ALTER TABLE "voice_video_rooms" ADD COLUMN "provider_room_id" text;
--> statement-breakpoint
ALTER TABLE "voice_video_rooms" ADD COLUMN "provider_domain" text;
--> statement-breakpoint
ALTER TABLE "voice_video_rooms" ADD COLUMN "provider_lease_token" uuid;
--> statement-breakpoint
ALTER TABLE "voice_video_rooms" ADD COLUMN "provider_lease_expires_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "voice_video_artifacts" ADD COLUMN "provider_lease_token" uuid;
--> statement-breakpoint
ALTER TABLE "voice_video_artifacts" ADD COLUMN "provider_lease_expires_at" timestamp with time zone;
