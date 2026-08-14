CREATE TABLE "demo_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"generation" integer NOT NULL,
	"contribution_key" text NOT NULL,
	"contribution_version" integer NOT NULL,
	"fixture_key" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "demo_records_generation_positive" CHECK ("demo_records"."generation" > 0),
	CONSTRAINT "demo_records_contribution_version_positive" CHECK ("demo_records"."contribution_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "demo_scenario_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scenario_key" text NOT NULL,
	"scenario_version" integer NOT NULL,
	"locale" text NOT NULL,
	"generation" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"loaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"purged_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "demo_scenario_runs_generation_positive" CHECK ("demo_scenario_runs"."generation" > 0),
	CONSTRAINT "demo_scenario_runs_status_valid" CHECK ("demo_scenario_runs"."status" in ('active', 'purged')),
	CONSTRAINT "demo_scenario_runs_purge_consistent" CHECK (("demo_scenario_runs"."status" = 'purged' and "demo_scenario_runs"."purged_at" is not null) or ("demo_scenario_runs"."status" = 'active' and "demo_scenario_runs"."purged_at" is null))
);
--> statement-breakpoint
CREATE TABLE "demo_scenarios" (
	"key" text NOT NULL,
	"version" integer NOT NULL,
	"title_key" text NOT NULL,
	"description_key" text NOT NULL,
	"preset" text NOT NULL,
	"required_modules" text[] DEFAULT '{}' NOT NULL,
	"required_capabilities" text[] DEFAULT '{}' NOT NULL,
	"fixture_manifest" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"default_locale" text NOT NULL,
	"supported_locales" text[] NOT NULL,
	"tour_flow_key" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "demo_scenarios_key_version_pk" PRIMARY KEY("key","version"),
	CONSTRAINT "demo_scenarios_version_positive" CHECK ("demo_scenarios"."version" > 0),
	CONSTRAINT "demo_scenarios_status_valid" CHECK ("demo_scenarios"."status" in ('draft', 'active', 'retired')),
	CONSTRAINT "demo_scenarios_fixture_manifest_array" CHECK (jsonb_typeof("demo_scenarios"."fixture_manifest") = 'array')
);
--> statement-breakpoint
ALTER TABLE "demo_records" ADD CONSTRAINT "demo_records_run_id_demo_scenario_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."demo_scenario_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "demo_records_fixture_idx" ON "demo_records" USING btree ("run_id","generation","contribution_key","fixture_key");--> statement-breakpoint
CREATE INDEX "demo_records_subject_idx" ON "demo_records" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "demo_scenario_runs_scenario_idx" ON "demo_scenario_runs" USING btree ("scenario_key","scenario_version","loaded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "demo_scenario_runs_one_active_idx" ON "demo_scenario_runs" USING btree ("status") WHERE "demo_scenario_runs"."status" = 'active';--> statement-breakpoint
CREATE INDEX "demo_scenarios_status_idx" ON "demo_scenarios" USING btree ("status","key","version");