-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C12.12 (MASTER.md §44.9): reports and the moderation queue.
ALTER TABLE "member_reviews" ADD COLUMN "hidden_at" timestamp with time zone;
--> statement-breakpoint
CREATE TABLE "member_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reporter_id" uuid,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"details" text DEFAULT '' NOT NULL,
	"excerpt" text DEFAULT '' NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"action" text,
	"resolution_note" text,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_reports_target_valid" CHECK ("member_reports"."target_type" in ('post','comment','message','listing','review','member')),
	CONSTRAINT "member_reports_state_valid" CHECK ("member_reports"."state" in ('open','actioned','dismissed')),
	CONSTRAINT "member_reports_details_length" CHECK (char_length("member_reports"."details") <= 2000)
);
--> statement-breakpoint
ALTER TABLE "member_reports" ADD CONSTRAINT "member_reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "member_reports" ADD CONSTRAINT "member_reports_subject_id_users_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "member_reports" ADD CONSTRAINT "member_reports_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "member_reports_one_open_idx" ON "member_reports" USING btree ("reporter_id","target_type","target_id") WHERE "member_reports"."state" = 'open';
--> statement-breakpoint
CREATE INDEX "member_reports_queue_idx" ON "member_reports" USING btree ("state","created_at");
--> statement-breakpoint
CREATE INDEX "member_reports_target_idx" ON "member_reports" USING btree ("target_type","target_id");
