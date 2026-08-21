ALTER TABLE "mail_oauth_states" ADD COLUMN "purpose" text DEFAULT 'mail' NOT NULL;--> statement-breakpoint
ALTER TABLE "mail_oauth_states" ADD COLUMN "access" text DEFAULT 'read' NOT NULL;
