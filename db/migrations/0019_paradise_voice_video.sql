-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C3.13: Paradise Comms inbound webhook relay. One row per PM event envelope
-- (evt_…); the unique index is what makes redelivery idempotent.
CREATE TABLE "voice_video_webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" text NOT NULL,
	"delivery_id" text NOT NULL,
	"event_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"action" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "voice_video_webhook_deliveries_event_idx" ON "voice_video_webhook_deliveries" ("event_id");
