-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C12.18 (MASTER.md §44.11): opt-in ActivityPub federation.
ALTER TABLE "member_settings" ADD COLUMN "federation" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "member_profiles" ADD COLUMN "federated" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE TABLE "member_actor_keys" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"public_key_pem" text NOT NULL,
	"private_key_sealed" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "member_actor_keys" ADD CONSTRAINT "member_actor_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "member_remote_followers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"actor_uri" text NOT NULL,
	"inbox_uri" text NOT NULL,
	"shared_inbox_uri" text,
	"handle" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "member_remote_followers" ADD CONSTRAINT "member_remote_followers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "member_remote_followers_pair_idx" ON "member_remote_followers" USING btree ("user_id","actor_uri");
--> statement-breakpoint
CREATE INDEX "member_remote_followers_user_idx" ON "member_remote_followers" USING btree ("user_id");
--> statement-breakpoint
CREATE TABLE "member_federation_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"inbox_uri" text NOT NULL,
	"activity" jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "member_federation_deliveries" ADD CONSTRAINT "member_federation_deliveries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "member_federation_deliveries_due_idx" ON "member_federation_deliveries" USING btree ("delivered_at","next_attempt_at");
