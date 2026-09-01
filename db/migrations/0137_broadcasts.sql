-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
--
-- Sending one message to many people (MASTER.md §30, §4.14, C9.06).
--
-- Additive: two new tables, nothing renamed or dropped.
--
-- A broadcast is a template plus an audience plus a moment, and deliberately
-- none of those things itself: the wording is an email_templates row (C9.05),
-- the audience is a segment (§30's "unit of who"), and the sending is
-- core/mail, which already refuses a suppressed address and insists on a
-- verified bulk sender.
--
-- broadcast_recipients is a row per person rather than a counter per
-- broadcast, because §30 asks for honest analytics and a counter cannot answer
-- "did Nils get it", cannot be recomputed after a provider replays a webhook,
-- and cannot resume a send that stopped halfway.
CREATE TABLE "broadcasts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"template_id" uuid NOT NULL,
	"segment_id" uuid NOT NULL,
	"subject" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"audience_count" integer DEFAULT 0 NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- ON DELETE restrict on both: deleting the template or the segment out from
-- under a sent campaign would leave a record that cannot say what went to whom.
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_template_id_email_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."email_templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_segment_id_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."segments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "broadcasts_status_idx" ON "broadcasts" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE INDEX "broadcasts_template_idx" ON "broadcasts" USING btree ("template_id");--> statement-breakpoint

CREATE TABLE "broadcast_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"broadcast_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"email" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"detail" text,
	"sent_at" timestamp with time zone,
	"delivery_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "broadcast_recipients" ADD CONSTRAINT "broadcast_recipients_broadcast_id_broadcasts_id_fk" FOREIGN KEY ("broadcast_id") REFERENCES "public"."broadcasts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast_recipients" ADD CONSTRAINT "broadcast_recipients_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- Which delivery this copy was, so a bounce reported weeks later lands on the
-- campaign that caused it rather than on whichever campaign last used the same
-- address. ON DELETE set null: mail_deliveries ages out, and losing the link
-- must not lose the record that somebody was sent to.
ALTER TABLE "broadcast_recipients" ADD CONSTRAINT "broadcast_recipients_delivery_id_mail_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."mail_deliveries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- Reverse lookup for provider feedback: given a delivery, whose copy was it.
CREATE INDEX "broadcast_recipients_delivery_idx" ON "broadcast_recipients" USING btree ("delivery_id");--> statement-breakpoint

-- One copy per person per broadcast. A resumed send must not double up, and
-- under concurrency only the index holds that.
CREATE UNIQUE INDEX "broadcast_recipients_once_idx" ON "broadcast_recipients" USING btree ("broadcast_id","contact_id");--> statement-breakpoint

-- The send loop's own query: the next unsent batch, oldest first.
CREATE INDEX "broadcast_recipients_pending_idx" ON "broadcast_recipients" USING btree ("broadcast_id","created_at") WHERE "broadcast_recipients"."state" = 'pending';--> statement-breakpoint
CREATE INDEX "broadcast_recipients_contact_idx" ON "broadcast_recipients" USING btree ("contact_id");
