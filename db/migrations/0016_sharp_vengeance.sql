CREATE TABLE "connected_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"email" text,
	"display_name" text,
	"kind" text DEFAULT 'personal' NOT NULL,
	"scopes_granted" text[] DEFAULT '{}' NOT NULL,
	"credentials" text,
	"status" text DEFAULT 'active' NOT NULL,
	"last_error" text,
	"shared_with_business" boolean DEFAULT false NOT NULL,
	"detail_visibility" text DEFAULT 'busy_only' NOT NULL,
	"last_sync_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connection_capabilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connected_account_id" uuid NOT NULL,
	"capability" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"scope_string" text,
	"granted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_calendars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connected_account_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"colour" text,
	"timezone" text,
	"role" text DEFAULT 'busy_source' NOT NULL,
	"sync_token" text,
	"last_sync_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_calendar_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"all_day" boolean DEFAULT false NOT NULL,
	"busy" boolean DEFAULT true NOT NULL,
	"title" text,
	"booking_id" uuid,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "connected_accounts" ADD CONSTRAINT "connected_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_capabilities" ADD CONSTRAINT "connection_capabilities_connected_account_id_connected_accounts_id_fk" FOREIGN KEY ("connected_account_id") REFERENCES "public"."connected_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_calendars" ADD CONSTRAINT "external_calendars_connected_account_id_connected_accounts_id_fk" FOREIGN KEY ("connected_account_id") REFERENCES "public"."connected_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_events" ADD CONSTRAINT "external_events_external_calendar_id_external_calendars_id_fk" FOREIGN KEY ("external_calendar_id") REFERENCES "public"."external_calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "connected_accounts_provider_idx" ON "connected_accounts" USING btree ("provider","provider_account_id");--> statement-breakpoint
CREATE INDEX "connected_accounts_user_idx" ON "connected_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "connection_capabilities_unique_idx" ON "connection_capabilities" USING btree ("connected_account_id","capability");--> statement-breakpoint
CREATE UNIQUE INDEX "external_calendars_unique_idx" ON "external_calendars" USING btree ("connected_account_id","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "external_events_unique_idx" ON "external_events" USING btree ("external_calendar_id","external_id");--> statement-breakpoint
CREATE INDEX "external_events_window_idx" ON "external_events" USING btree ("starts_at","ends_at");