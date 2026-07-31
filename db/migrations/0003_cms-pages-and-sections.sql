CREATE TABLE "content_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"title" text,
	"blocks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"actor" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"title" text NOT NULL,
	"blocks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"seo" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'reusable' NOT NULL,
	"blocks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "content_revisions_subject_idx" ON "content_revisions" USING btree ("subject_type","subject_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pages_slug_locale_idx" ON "pages" USING btree ("slug","locale");--> statement-breakpoint
CREATE INDEX "pages_status_idx" ON "pages" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "sections_key_locale_idx" ON "sections" USING btree ("key","locale");