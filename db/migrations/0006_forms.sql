CREATE TABLE "form_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"form_id" uuid NOT NULL,
	"contact_id" uuid,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_url" text,
	"status" text DEFAULT 'received' NOT NULL,
	"spam_reasons" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"submit_label" text,
	"success_message" text,
	"destination" text DEFAULT 'contact' NOT NULL,
	"notify" text[] DEFAULT '{}' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_form_id_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "form_submissions_form_idx" ON "form_submissions" USING btree ("form_id","created_at");--> statement-breakpoint
CREATE INDEX "form_submissions_contact_idx" ON "form_submissions" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "form_submissions_status_idx" ON "form_submissions" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "forms_slug_idx" ON "forms" USING btree ("slug");