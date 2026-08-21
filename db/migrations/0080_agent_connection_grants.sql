CREATE TABLE "agent_connection_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"connected_account_id" uuid NOT NULL,
	"access" text DEFAULT 'read' NOT NULL,
	"granted_by" uuid,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_connection_grants" ADD CONSTRAINT "agent_connection_grants_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_connection_grants" ADD CONSTRAINT "agent_connection_grants_connected_account_id_connected_accounts_id_fk" FOREIGN KEY ("connected_account_id") REFERENCES "public"."connected_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_connection_grants" ADD CONSTRAINT "agent_connection_grants_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_connection_grants_idx" ON "agent_connection_grants" USING btree ("agent_id","connected_account_id");--> statement-breakpoint
CREATE INDEX "agent_connection_grants_account_idx" ON "agent_connection_grants" USING btree ("connected_account_id");
