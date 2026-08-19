CREATE TABLE "installed_plugins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"version" text NOT NULL,
	"status" text DEFAULT 'installed' NOT NULL,
	"source" text NOT NULL,
	"tier" text DEFAULT 'local' NOT NULL,
	"integrity" text NOT NULL,
	"signature" text,
	"license" text NOT NULL,
	"freeholder" text NOT NULL,
	"permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"disabled_reason" text,
	"previous_version" text,
	"installed_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "installed_plugins_name_idx" ON "installed_plugins" USING btree ("name");--> statement-breakpoint
CREATE INDEX "installed_plugins_status_idx" ON "installed_plugins" USING btree ("status");--> statement-breakpoint
CREATE TABLE "plugin_registries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"tier" text DEFAULT 'community' NOT NULL,
	"signature" text,
	"cached_index" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"fetched_at" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "plugin_registries_url_idx" ON "plugin_registries" USING btree ("url");--> statement-breakpoint
CREATE TABLE "plugin_retentions" (
	"name" text PRIMARY KEY NOT NULL,
	"retention" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"origin" text,
	"kind" text,
	"status" text DEFAULT 'discover' NOT NULL,
	"checkpoint" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"preview" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"mapping" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"conflicts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "import_runs_status_idx" ON "import_runs" USING btree ("status");
