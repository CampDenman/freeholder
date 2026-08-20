CREATE TABLE "agent_playbook_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"playbook_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"brief_template" text NOT NULL,
	"params_schema" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_playbook_versions" ADD CONSTRAINT "agent_playbook_versions_playbook_id_agent_playbooks_id_fk" FOREIGN KEY ("playbook_id") REFERENCES "public"."agent_playbooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_playbook_versions" ADD CONSTRAINT "agent_playbook_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_playbook_versions_idx" ON "agent_playbook_versions" USING btree ("playbook_id","version");--> statement-breakpoint
ALTER TABLE "agent_playbooks" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_playbooks" ADD COLUMN "autonomy_ceiling" text;--> statement-breakpoint
ALTER TABLE "agent_playbooks" ADD COLUMN "budget_cents" integer;
