CREATE TABLE "event_registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"ticket_id" uuid,
	"contact_id" uuid NOT NULL,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"checked_in_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_registrations_quantity_positive" CHECK ("event_registrations"."quantity" > 0),
	CONSTRAINT "event_registrations_status_valid" CHECK ("event_registrations"."status" in ('reserved','confirmed','waitlisted','cancelled','checked_in'))
);
--> statement-breakpoint
CREATE TABLE "event_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"capacity" integer DEFAULT 0 NOT NULL,
	"waitlist_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_sessions_capacity_nonneg" CHECK ("event_sessions"."capacity" >= 0),
	CONSTRAINT "event_sessions_ends_after_start" CHECK ("event_sessions"."ends_at" > "event_sessions"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "event_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"name" text NOT NULL,
	"price_minor" bigint DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'CAD' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_tickets_name_valid" CHECK (char_length("event_tickets"."name") between 1 and 120),
	CONSTRAINT "event_tickets_price_nonneg" CHECK ("event_tickets"."price_minor" >= 0),
	CONSTRAINT "event_tickets_currency_valid" CHECK (char_length("event_tickets"."currency") = 3)
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"summary" text,
	"venue_name" text,
	"venue_address" text,
	"venue_location_id" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"seo" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"published_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_slug_valid" CHECK (char_length("events"."slug") between 1 and 180 and "events"."slug" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
	CONSTRAINT "events_name_valid" CHECK (char_length("events"."name") between 1 and 240),
	CONSTRAINT "events_status_valid" CHECK ("events"."status" in ('draft','published','cancelled')),
	CONSTRAINT "events_version_positive" CHECK ("events"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "newsletter_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"newsletter_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"excerpt" text,
	"body" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"seo" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "newsletter_issues_slug_valid" CHECK (char_length("newsletter_issues"."slug") between 1 and 180 and "newsletter_issues"."slug" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
	CONSTRAINT "newsletter_issues_title_valid" CHECK (char_length("newsletter_issues"."title") between 1 and 240),
	CONSTRAINT "newsletter_issues_status_valid" CHECK ("newsletter_issues"."status" in ('draft','published')),
	CONSTRAINT "newsletter_issues_version_positive" CHECK ("newsletter_issues"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "newsletter_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"newsletter_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"confirm_token" text NOT NULL,
	"unsubscribe_token" text NOT NULL,
	"confirmed_at" timestamp with time zone,
	"unsubscribed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "newsletter_subscriptions_status_valid" CHECK ("newsletter_subscriptions"."status" in ('pending','confirmed','unsubscribed'))
);
--> statement-breakpoint
CREATE TABLE "newsletters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "newsletters_slug_valid" CHECK (char_length("newsletters"."slug") between 1 and 180 and "newsletters"."slug" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
	CONSTRAINT "newsletters_name_valid" CHECK (char_length("newsletters"."name") between 1 and 200),
	CONSTRAINT "newsletters_status_valid" CHECK ("newsletters"."status" in ('active','paused'))
);
--> statement-breakpoint
ALTER TABLE "event_registrations" ADD CONSTRAINT "event_registrations_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_registrations" ADD CONSTRAINT "event_registrations_session_id_event_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."event_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_registrations" ADD CONSTRAINT "event_registrations_ticket_id_event_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."event_tickets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_registrations" ADD CONSTRAINT "event_registrations_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_sessions" ADD CONSTRAINT "event_sessions_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_tickets" ADD CONSTRAINT "event_tickets_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_venue_location_id_business_locations_id_fk" FOREIGN KEY ("venue_location_id") REFERENCES "public"."business_locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_issues" ADD CONSTRAINT "newsletter_issues_newsletter_id_newsletters_id_fk" FOREIGN KEY ("newsletter_id") REFERENCES "public"."newsletters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_subscriptions" ADD CONSTRAINT "newsletter_subscriptions_newsletter_id_newsletters_id_fk" FOREIGN KEY ("newsletter_id") REFERENCES "public"."newsletters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_subscriptions" ADD CONSTRAINT "newsletter_subscriptions_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_registrations_session_idx" ON "event_registrations" USING btree ("session_id","status");--> statement-breakpoint
CREATE INDEX "event_registrations_contact_idx" ON "event_registrations" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "event_registrations_event_idx" ON "event_registrations" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "event_sessions_event_starts_idx" ON "event_sessions" USING btree ("event_id","starts_at");--> statement-breakpoint
CREATE INDEX "event_tickets_event_idx" ON "event_tickets" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "events_slug_idx" ON "events" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "events_status_updated_idx" ON "events" USING btree ("status","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "newsletter_issues_slug_idx" ON "newsletter_issues" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "newsletter_issues_newsletter_idx" ON "newsletter_issues" USING btree ("newsletter_id","published_at");--> statement-breakpoint
CREATE UNIQUE INDEX "newsletter_subscriptions_newsletter_contact_idx" ON "newsletter_subscriptions" USING btree ("newsletter_id","contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "newsletter_subscriptions_confirm_token_idx" ON "newsletter_subscriptions" USING btree ("confirm_token");--> statement-breakpoint
CREATE UNIQUE INDEX "newsletter_subscriptions_unsubscribe_token_idx" ON "newsletter_subscriptions" USING btree ("unsubscribe_token");--> statement-breakpoint
CREATE INDEX "newsletter_subscriptions_contact_idx" ON "newsletter_subscriptions" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "newsletters_slug_idx" ON "newsletters" USING btree ("slug");