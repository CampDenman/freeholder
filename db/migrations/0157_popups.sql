-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
--
-- Popups, announcement surfaces and what visitors did with them
-- (MASTER.md Â§36, Â§43 C9.30).
--
-- Two new tables, nothing altered and nothing dropped: an instance that never
-- creates a popup carries two empty tables and behaves exactly as before.
--
-- The check constraints are the ones a form could otherwise walk past. The
-- last one is the one worth reading: a popup that collects an email address
-- must carry the words shown beside the tick box, because those words become
-- the `terms_version` on the consent record and evidence that cannot say what
-- was agreed to is not evidence.
CREATE TABLE "popups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"title" text NOT NULL,
	"surface" text DEFAULT 'modal' NOT NULL,
	"trigger" text DEFAULT 'delay' NOT NULL,
	"trigger_value" integer DEFAULT 5 NOT NULL,
	"blocks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"audience" text DEFAULT 'everyone' NOT NULL,
	"segment_id" uuid,
	"path_patterns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"locales" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"frequency_cap" integer,
	"frequency_period_hours" integer DEFAULT 168 NOT NULL,
	"dismiss_suppress_hours" integer DEFAULT 720 NOT NULL,
	"stop_after_capture" boolean DEFAULT true NOT NULL,
	"capture_mode" text DEFAULT 'none' NOT NULL,
	"newsletter_id" uuid,
	"consent_statement" text,
	"consent_version" text,
	"success_message" text,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"priority" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "popups_slug_shape" CHECK ("popups"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "popups_title" CHECK (char_length("popups"."title") between 1 and 160),
	CONSTRAINT "popups_audience_segment" CHECK ("popups"."audience" = 'everyone' or "popups"."segment_id" is not null),
	CONSTRAINT "popups_capture_consent" CHECK ("popups"."capture_mode" <> 'email' or "popups"."consent_statement" is not null),
	CONSTRAINT "popups_frequency_cap_positive" CHECK ("popups"."frequency_cap" is null or "popups"."frequency_cap" > 0),
	CONSTRAINT "popups_frequency_period" CHECK ("popups"."frequency_period_hours" > 0),
	CONSTRAINT "popups_dismiss_suppress" CHECK ("popups"."dismiss_suppress_hours" >= 0),
	CONSTRAINT "popups_window" CHECK ("popups"."ends_at" is null or "popups"."starts_at" is null or "popups"."ends_at" > "popups"."starts_at")
);
--> statement-breakpoint
-- The frequency cap's memory, and the owner's answer to "did it work".
-- `visitor_key` is nullable on purpose: a visitor who has declined analytics
-- identifiers still gets a cap, carried in their own browser instead.
CREATE TABLE "popup_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"popup_id" uuid NOT NULL,
	"visitor_key" text,
	"contact_id" uuid,
	"kind" text NOT NULL,
	"path" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "popups" ADD CONSTRAINT "popups_segment_id_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."segments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "popup_events" ADD CONSTRAINT "popup_events_popup_id_popups_id_fk" FOREIGN KEY ("popup_id") REFERENCES "public"."popups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "popup_events" ADD CONSTRAINT "popup_events_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "popups_slug_idx" ON "popups" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "popups_status_idx" ON "popups" USING btree ("status","priority");--> statement-breakpoint
CREATE INDEX "popup_events_cap_idx" ON "popup_events" USING btree ("popup_id","visitor_key","kind","occurred_at");--> statement-breakpoint
CREATE INDEX "popup_events_report_idx" ON "popup_events" USING btree ("popup_id","kind","occurred_at");--> statement-breakpoint
CREATE INDEX "popup_events_contact_idx" ON "popup_events" USING btree ("contact_id");

