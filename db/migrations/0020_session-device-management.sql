CREATE TABLE "login_security_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"device_hash" text,
	"network_hash" text,
	"device_label" text NOT NULL,
	"ip_hint" text,
	"reason" text,
	"notice_status" text DEFAULT 'not_needed' NOT NULL,
	"notice_attempts" integer DEFAULT 0 NOT NULL,
	"notice_error" text,
	"notice_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone DEFAULT now() + interval '90 days' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "device_hash" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "network_hash" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "two_factor_challenges" ADD COLUMN "ip_hint" text;--> statement-breakpoint
ALTER TABLE "two_factor_challenges" ADD COLUMN "user_agent" text;--> statement-breakpoint
ALTER TABLE "two_factor_challenges" ADD COLUMN "device_hash" text;--> statement-breakpoint
ALTER TABLE "two_factor_challenges" ADD COLUMN "network_hash" text;--> statement-breakpoint
UPDATE "sessions"
SET
	"ip" = NULL,
	"user_agent" = CASE
		WHEN "user_agent" IS NULL THEN NULL
		ELSE left(regexp_replace("user_agent", '[[:cntrl:]]', ' ', 'g'), 512)
	END;--> statement-breakpoint
ALTER TABLE "login_security_events" ADD CONSTRAINT "login_security_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "login_security_events_user_created_idx" ON "login_security_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "login_security_events_notice_idx" ON "login_security_events" USING btree ("notice_status","created_at");--> statement-breakpoint
CREATE INDEX "login_security_events_expiry_idx" ON "login_security_events" USING btree ("expires_at");
