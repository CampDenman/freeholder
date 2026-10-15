-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C12.22 (MASTER.md §44): standard Web Push with the site's own keys, and quiet hours.
ALTER TABLE "notification_settings" ADD COLUMN "quiet_start_minute" integer;
--> statement-breakpoint
ALTER TABLE "notification_settings" ADD COLUMN "quiet_end_minute" integer;
--> statement-breakpoint
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_quiet_hours_valid" CHECK (("notification_settings"."quiet_start_minute" is null and "notification_settings"."quiet_end_minute" is null) or ("notification_settings"."quiet_start_minute" between 0 and 1439 and "notification_settings"."quiet_end_minute" between 0 and 1439 and "notification_settings"."quiet_start_minute" <> "notification_settings"."quiet_end_minute"));
--> statement-breakpoint
CREATE TABLE "web_push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_success_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "web_push_subscriptions" ADD CONSTRAINT "web_push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "web_push_subscriptions_endpoint_idx" ON "web_push_subscriptions" USING btree ("endpoint");
--> statement-breakpoint
CREATE INDEX "web_push_subscriptions_user_idx" ON "web_push_subscriptions" USING btree ("user_id");
--> statement-breakpoint
CREATE TABLE "web_push_keys" (
	"id" integer PRIMARY KEY NOT NULL,
	"public_key" text NOT NULL,
	"private_key_sealed" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "web_push_keys_singleton" CHECK ("web_push_keys"."id" = 1)
);
