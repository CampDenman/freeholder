CREATE TABLE "staff_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"role_key" text NOT NULL,
	"token_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL,
	"send_count" integer DEFAULT 1 NOT NULL,
	"last_attempted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_sent_at" timestamp with time zone,
	"delivery_adapter" text,
	"provider_ref" text,
	"accepted_user_id" uuid,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "staff_invitations_token_idx" ON "staff_invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_invitations_pending_email_idx" ON "staff_invitations" USING btree ("email") WHERE "staff_invitations"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "staff_invitations_status_expiry_idx" ON "staff_invitations" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "staff_invitations_created_idx" ON "staff_invitations" USING btree ("created_at");--> statement-breakpoint
-- A new permission module never silently arrives in an existing role. These
-- are the two deliberate compatibility defaults: administrators can manage
-- the new workflow; legacy staff may inspect it but cannot issue credentials.
INSERT INTO "role_grants" ("role_key", "module", "access") VALUES
	('administrator', 'invitations', 'manage'),
	('staff', 'invitations', 'view')
ON CONFLICT ("role_key", "module") DO NOTHING;
