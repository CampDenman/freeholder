-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- Rooms, posts, join requests and moderation inside a community space
-- (MASTER.md §36, C3.13). Expand-only.
CREATE TABLE "community_rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "community_rooms" ADD CONSTRAINT "community_rooms_space_fk" FOREIGN KEY ("space_id") REFERENCES "community_spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "community_rooms_space_slug_idx" ON "community_rooms" ("space_id", "slug");--> statement-breakpoint
CREATE INDEX "community_rooms_space_idx" ON "community_rooms" ("space_id");--> statement-breakpoint
CREATE TABLE "community_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'visible' NOT NULL,
	"reported_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_posts_body" CHECK (char_length("body") between 1 and 2000),
	CONSTRAINT "community_posts_status" CHECK ("status" in ('visible', 'hidden', 'removed'))
);
--> statement-breakpoint
ALTER TABLE "community_posts" ADD CONSTRAINT "community_posts_room_fk" FOREIGN KEY ("room_id") REFERENCES "community_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_posts" ADD CONSTRAINT "community_posts_contact_fk" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "community_posts_room_created_idx" ON "community_posts" ("room_id", "created_at");--> statement-breakpoint
CREATE INDEX "community_posts_contact_idx" ON "community_posts" ("contact_id");--> statement-breakpoint
CREATE INDEX "community_posts_status_idx" ON "community_posts" ("status", "created_at");--> statement-breakpoint
CREATE TABLE "community_join_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "community_join_requests" ADD CONSTRAINT "community_join_requests_space_fk" FOREIGN KEY ("space_id") REFERENCES "community_spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_join_requests" ADD CONSTRAINT "community_join_requests_contact_fk" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "community_join_requests_space_contact_idx" ON "community_join_requests" ("space_id", "contact_id");--> statement-breakpoint
CREATE INDEX "community_join_requests_contact_idx" ON "community_join_requests" ("contact_id");
