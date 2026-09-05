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
ALTER TABLE "newsletter_subscriptions" ADD COLUMN "consent_terms_version" text;--> statement-breakpoint
ALTER TABLE "newsletter_subscriptions" ADD COLUMN "consent_source_url" text;--> statement-breakpoint
ALTER TABLE "newsletter_subscriptions" ADD COLUMN "consent_ip" text;--> statement-breakpoint
ALTER TABLE "newsletter_subscriptions" ADD COLUMN "consent_evidence" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "newsletter_subscriptions" ADD CONSTRAINT "newsletter_subscriptions_consent_terms_bounded" CHECK ("newsletter_subscriptions"."consent_terms_version" is null or char_length("newsletter_subscriptions"."consent_terms_version") <= 100);--> statement-breakpoint
ALTER TABLE "newsletter_subscriptions" ADD CONSTRAINT "newsletter_subscriptions_consent_source_bounded" CHECK ("newsletter_subscriptions"."consent_source_url" is null or char_length("newsletter_subscriptions"."consent_source_url") <= 2048);--> statement-breakpoint
ALTER TABLE "newsletter_subscriptions" ADD CONSTRAINT "newsletter_subscriptions_consent_ip_bounded" CHECK ("newsletter_subscriptions"."consent_ip" is null or char_length("newsletter_subscriptions"."consent_ip") <= 64);--> statement-breakpoint
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
	CONSTRAINT "popups_slug_bounded" CHECK (char_length("popups"."slug") <= 180),
	CONSTRAINT "popups_name_bounded" CHECK (char_length("popups"."name") between 1 and 120),
	CONSTRAINT "popups_title" CHECK (char_length("popups"."title") between 1 and 160),
	CONSTRAINT "popups_surface_allowed" CHECK ("popups"."surface" in ('modal', 'banner', 'corner')),
	CONSTRAINT "popups_trigger_allowed" CHECK ("popups"."trigger" in ('immediate', 'delay', 'scroll', 'exitIntent')),
	CONSTRAINT "popups_trigger_value" CHECK ("popups"."trigger_value" between 0 and 600 and ("popups"."trigger" <> 'scroll' or "popups"."trigger_value" between 1 and 100)),
	CONSTRAINT "popups_audience_allowed" CHECK ("popups"."audience" in ('everyone', 'inSegment', 'notInSegment')),
	CONSTRAINT "popups_paths_array" CHECK (jsonb_typeof("popups"."path_patterns") = 'array'),
	CONSTRAINT "popups_locales_array" CHECK (jsonb_typeof("popups"."locales") = 'array'),
	CONSTRAINT "popups_audience_segment" CHECK ("popups"."audience" = 'everyone' or "popups"."segment_id" is not null),
	CONSTRAINT "popups_capture_consent" CHECK ("popups"."capture_mode" <> 'email' or ("popups"."consent_statement" is not null and "popups"."newsletter_id" is not null)),
	CONSTRAINT "popups_capture_allowed" CHECK ("popups"."capture_mode" in ('none', 'email')),
	CONSTRAINT "popups_consent_bounded" CHECK ("popups"."consent_statement" is null or char_length("popups"."consent_statement") <= 500),
	CONSTRAINT "popups_consent_version_bounded" CHECK ("popups"."consent_version" is null or char_length("popups"."consent_version") <= 60),
	CONSTRAINT "popups_success_message_bounded" CHECK ("popups"."success_message" is null or char_length("popups"."success_message") <= 400),
	CONSTRAINT "popups_frequency_cap_positive" CHECK ("popups"."frequency_cap" is null or "popups"."frequency_cap" > 0),
	CONSTRAINT "popups_frequency_cap_bounded" CHECK ("popups"."frequency_cap" is null or "popups"."frequency_cap" <= 100),
	CONSTRAINT "popups_frequency_period" CHECK ("popups"."frequency_period_hours" between 1 and 8760),
	CONSTRAINT "popups_dismiss_suppress" CHECK ("popups"."dismiss_suppress_hours" between 0 and 8760),
	CONSTRAINT "popups_priority_bounded" CHECK ("popups"."priority" between 0 and 1000),
	CONSTRAINT "popups_status_allowed" CHECK ("popups"."status" in ('draft', 'active', 'paused')),
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
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "popup_events_kind_allowed" CHECK ("popup_events"."kind" in ('shown', 'dismissed', 'captured')),
	CONSTRAINT "popup_events_visitor_bounded" CHECK ("popup_events"."visitor_key" is null or char_length("popup_events"."visitor_key") <= 64),
	CONSTRAINT "popup_events_path_bounded" CHECK ("popup_events"."path" is null or char_length("popup_events"."path") <= 2048)
);
--> statement-breakpoint
ALTER TABLE "popups" ADD CONSTRAINT "popups_segment_id_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."segments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "popups" ADD CONSTRAINT "popups_newsletter_id_newsletters_id_fk" FOREIGN KEY ("newsletter_id") REFERENCES "public"."newsletters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "popup_events" ADD CONSTRAINT "popup_events_popup_id_popups_id_fk" FOREIGN KEY ("popup_id") REFERENCES "public"."popups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "popup_events" ADD CONSTRAINT "popup_events_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "popups_slug_idx" ON "popups" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "popups_status_idx" ON "popups" USING btree ("status","priority");--> statement-breakpoint
CREATE INDEX "popup_events_cap_idx" ON "popup_events" USING btree ("popup_id","visitor_key","kind","occurred_at");--> statement-breakpoint
CREATE INDEX "popup_events_report_idx" ON "popup_events" USING btree ("popup_id","kind","occurred_at");--> statement-breakpoint
CREATE INDEX "popup_events_contact_idx" ON "popup_events" USING btree ("contact_id");

