ALTER TABLE "projects" ADD COLUMN "blocks" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "cover_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "featured" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "seo" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "publication_status" text DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "public_page_id" uuid;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "client_consent_given_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "client_consent_method" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "client_consent_note" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint

ALTER TABLE "projects" ADD CONSTRAINT "projects_cover_asset_id_assets_id_fk" FOREIGN KEY ("cover_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_publication_status" CHECK ("projects"."publication_status" in ('draft','published'));--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_publication_time" CHECK (("projects"."publication_status" = 'published' and "projects"."published_at" is not null) or "projects"."publication_status" = 'draft');--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_consent_complete" CHECK (("projects"."client_consent_given_at" is null and "projects"."client_consent_method" is null) or ("projects"."client_consent_given_at" is not null and "projects"."client_consent_method" is not null));--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_consent_method" CHECK ("projects"."client_consent_method" is null or "projects"."client_consent_method" in ('contract','email','written','verbal','other'));--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_version_positive" CHECK ("projects"."version" > 0);--> statement-breakpoint

CREATE INDEX "projects_publication_idx" ON "projects" USING btree ("publication_status","published_at");--> statement-breakpoint
CREATE INDEX "projects_featured_idx" ON "projects" USING btree ("featured","published_at");--> statement-breakpoint
CREATE UNIQUE INDEX "project_files_pair_role_idx" ON "project_files" USING btree ("project_id","pair_key","role") WHERE "pair_key" is not null;--> statement-breakpoint

CREATE TABLE "project_testimonials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"role" text,
	"body" text NOT NULL,
	"rating" integer,
	"asset_id" uuid,
	"consent_given_at" timestamp with time zone NOT NULL,
	"consent_method" text NOT NULL,
	"consent_note" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"display_locations" text[] DEFAULT ARRAY['project']::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_testimonials_name" CHECK (char_length("project_testimonials"."display_name") between 1 and 200),
	CONSTRAINT "project_testimonials_body" CHECK (char_length("project_testimonials"."body") between 1 and 5000),
	CONSTRAINT "project_testimonials_rating" CHECK ("project_testimonials"."rating" is null or "project_testimonials"."rating" between 1 and 5),
	CONSTRAINT "project_testimonials_locations" CHECK ("project_testimonials"."display_locations" <@ ARRAY['project','service','portfolio']::text[]),
	CONSTRAINT "project_testimonials_status" CHECK ("project_testimonials"."status" in ('draft','published','withdrawn')),
	CONSTRAINT "project_testimonials_consent_method" CHECK ("project_testimonials"."consent_method" in ('contract','email','written','verbal','other'))
);--> statement-breakpoint

ALTER TABLE "project_testimonials" ADD CONSTRAINT "project_testimonials_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_testimonials" ADD CONSTRAINT "project_testimonials_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_testimonials" ADD CONSTRAINT "project_testimonials_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_testimonials_project_idx" ON "project_testimonials" USING btree ("project_id","status","created_at");--> statement-breakpoint
CREATE INDEX "project_testimonials_contact_idx" ON "project_testimonials" USING btree ("contact_id");
