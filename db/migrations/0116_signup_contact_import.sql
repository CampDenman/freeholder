ALTER TABLE "contact_imports" ADD COLUMN "source_kind" text DEFAULT 'owner_csv' NOT NULL;--> statement-breakpoint
ALTER TABLE "contact_imports" ADD COLUMN "signup_flow" text;--> statement-breakpoint
ALTER TABLE "contact_imports" ADD COLUMN "subject_contact_id" uuid;--> statement-breakpoint
ALTER TABLE "contact_imports" ADD COLUMN "allowed_fields" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "contact_import_rows" ADD COLUMN "relationship_id" uuid;--> statement-breakpoint

CREATE TABLE "signup_contact_import_policies" (
	"flow" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"allowed_sources" text[] DEFAULT ARRAY['csv','vcard','device']::text[] NOT NULL,
	"allowed_fields" text[] DEFAULT ARRAY['email','name','phone']::text[] NOT NULL,
	"max_contacts" integer DEFAULT 100 NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signup_contact_import_policy_max" CHECK ("signup_contact_import_policies"."max_contacts" between 1 and 500),
	CONSTRAINT "signup_contact_import_policy_sources" CHECK ("signup_contact_import_policies"."allowed_sources" <@ ARRAY['google','microsoft','vcard','csv','device']::text[]),
	CONSTRAINT "signup_contact_import_policy_fields" CHECK ("signup_contact_import_policies"."allowed_fields" <@ ARRAY['email','name','phone']::text[] and "signup_contact_import_policies"."allowed_fields" @> ARRAY['email']::text[])
);--> statement-breakpoint

CREATE TABLE "signup_contact_import_choices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"flow" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"import_id" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "contact_imports" ADD CONSTRAINT "contact_imports_subject_contact_id_contacts_id_fk" FOREIGN KEY ("subject_contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_import_rows" ADD CONSTRAINT "contact_import_rows_relationship_id_contact_relationships_id_fk" FOREIGN KEY ("relationship_id") REFERENCES "public"."contact_relationships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signup_contact_import_policies" ADD CONSTRAINT "signup_contact_import_policies_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signup_contact_import_choices" ADD CONSTRAINT "signup_contact_import_choices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signup_contact_import_choices" ADD CONSTRAINT "signup_contact_import_choices_import_id_contact_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."contact_imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "contact_import_rows_relationship_idx" ON "contact_import_rows" USING btree ("relationship_id");--> statement-breakpoint
CREATE UNIQUE INDEX "signup_contact_import_choice_user_flow_idx" ON "signup_contact_import_choices" USING btree ("user_id","flow");--> statement-breakpoint
CREATE INDEX "signup_contact_import_choice_import_idx" ON "signup_contact_import_choices" USING btree ("import_id");--> statement-breakpoint

ALTER TABLE "mail_oauth_states" DROP CONSTRAINT "mail_oauth_states_admin_return";--> statement-breakpoint
ALTER TABLE "mail_oauth_states" ADD CONSTRAINT "mail_oauth_states_safe_return" CHECK ("mail_oauth_states"."return_to" ~ '^/(admin|portal/contact-import)(/|$|\?)');
