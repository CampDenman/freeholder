CREATE TABLE "agent_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid,
	"task_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"summary" text NOT NULL,
	"preview" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"service_name" text NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"adapter" text,
	"model" text,
	"credential_ref" text,
	"base_url" text,
	"max_concurrency" integer DEFAULT 2 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_seen_at" timestamp with time zone,
	"last_error" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_playbooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"brief_template" text NOT NULL,
	"default_agent_id" uuid,
	"params_schema" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"trigger" text DEFAULT 'manual' NOT NULL,
	"schedule_cron" text,
	"event_pattern" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"model" text,
	"tokens_in" integer DEFAULT 0 NOT NULL,
	"tokens_out" integer DEFAULT 0 NOT NULL,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"stop_reason" text,
	"error" text,
	"lease_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_spend" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"run_id" uuid,
	"period_start" timestamp with time zone NOT NULL,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"tokens_in" integer DEFAULT 0 NOT NULL,
	"tokens_out" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"kind" text NOT NULL,
	"service_name" text,
	"input" jsonb,
	"output" jsonb,
	"tokens" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid,
	"root_id" uuid NOT NULL,
	"agent_id" uuid,
	"title" text NOT NULL,
	"brief" text DEFAULT '' NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"input_trust" text DEFAULT 'owner' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"priority" smallint DEFAULT 3 NOT NULL,
	"depends_on" uuid[] DEFAULT '{}' NOT NULL,
	"due_at" timestamp with time zone,
	"autonomy_ceiling" text,
	"budget_cents" integer,
	"result" jsonb,
	"failure_reason" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_by_actor" text NOT NULL,
	"source" text DEFAULT 'human' NOT NULL,
	"source_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"instructions" text DEFAULT '' NOT NULL,
	"api_key_id" uuid,
	"tool_scopes" text[] DEFAULT '{}' NOT NULL,
	"autonomy" text DEFAULT 'suggest' NOT NULL,
	"max_concurrency" integer DEFAULT 1 NOT NULL,
	"budget_cents" integer DEFAULT 0 NOT NULL,
	"budget_period" text DEFAULT 'month' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_approvals" ADD CONSTRAINT "agent_approvals_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_approvals" ADD CONSTRAINT "agent_approvals_task_id_agent_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."agent_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_approvals" ADD CONSTRAINT "agent_approvals_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_connections" ADD CONSTRAINT "agent_connections_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_playbooks" ADD CONSTRAINT "agent_playbooks_default_agent_id_agents_id_fk" FOREIGN KEY ("default_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_task_id_agent_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."agent_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_spend" ADD CONSTRAINT "agent_spend_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_spend" ADD CONSTRAINT "agent_spend_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_steps" ADD CONSTRAINT "agent_steps_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_connection_id_agent_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."agent_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_approvals_task_idx" ON "agent_approvals" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "agent_approvals_pending_idx" ON "agent_approvals" USING btree ("created_at") WHERE "agent_approvals"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "agent_connections_name_idx" ON "agent_connections" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_playbooks_name_idx" ON "agent_playbooks" USING btree ("name");--> statement-breakpoint
CREATE INDEX "agent_runs_task_idx" ON "agent_runs" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "agent_runs_agent_idx" ON "agent_runs" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "agent_runs_lease_idx" ON "agent_runs" USING btree ("lease_expires_at") WHERE "agent_runs"."status" = 'running';--> statement-breakpoint
CREATE INDEX "agent_spend_agent_period_idx" ON "agent_spend" USING btree ("agent_id","period_start");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_steps_run_seq_idx" ON "agent_steps" USING btree ("run_id","seq");--> statement-breakpoint
CREATE INDEX "agent_tasks_root_idx" ON "agent_tasks" USING btree ("root_id");--> statement-breakpoint
CREATE INDEX "agent_tasks_parent_idx" ON "agent_tasks" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "agent_tasks_agent_idx" ON "agent_tasks" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "agent_tasks_runnable_idx" ON "agent_tasks" USING btree ("priority","created_at") WHERE "agent_tasks"."status" = 'queued';--> statement-breakpoint
CREATE UNIQUE INDEX "agents_name_idx" ON "agents" USING btree ("name");--> statement-breakpoint
CREATE INDEX "agents_connection_idx" ON "agents" USING btree ("connection_id");