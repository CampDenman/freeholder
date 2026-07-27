CREATE TABLE "business_profile" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"tagline" text,
	"schema_type" text DEFAULT 'LocalBusiness' NOT NULL,
	"country" text NOT NULL,
	"default_locale" text DEFAULT 'en' NOT NULL,
	"enabled_locales" text[] DEFAULT '{"en"}' NOT NULL,
	"base_currency" text NOT NULL,
	"timezone" text NOT NULL,
	"units" text DEFAULT 'metric' NOT NULL,
	"first_day_of_week" integer DEFAULT 1 NOT NULL,
	"setup_completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_profile_singleton" CHECK ("business_profile"."id" = 1),
	CONSTRAINT "business_profile_country_alpha2" CHECK ("business_profile"."country" ~ '^[A-Z]{2}$'),
	CONSTRAINT "business_profile_currency_alpha3" CHECK ("business_profile"."base_currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "business_profile_first_day" CHECK ("business_profile"."first_day_of_week" between 0 and 6)
);
--> statement-breakpoint
ALTER TABLE "timeline_events" ALTER COLUMN "subject_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "audit_log" ALTER COLUMN "subject_id" SET DATA TYPE text;