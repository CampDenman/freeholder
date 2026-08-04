CREATE TABLE "analytics_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"anon_id" text NOT NULL,
	"session_id" text NOT NULL,
	"contact_id" uuid,
	"name" text NOT NULL,
	"path" text NOT NULL,
	"referrer" text,
	"locale" text,
	"props" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analytics_at_idx" ON "analytics_events" USING btree ("at");--> statement-breakpoint
CREATE INDEX "analytics_name_at_idx" ON "analytics_events" USING btree ("name","at");--> statement-breakpoint
CREATE INDEX "analytics_anon_idx" ON "analytics_events" USING btree ("anon_id");--> statement-breakpoint
CREATE INDEX "analytics_contact_idx" ON "analytics_events" USING btree ("contact_id");