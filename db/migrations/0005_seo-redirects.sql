CREATE TABLE "redirects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_path" text NOT NULL,
	"to_path" text NOT NULL,
	"status" text DEFAULT '301' NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "redirects_from_locale_idx" ON "redirects" USING btree ("from_path","locale");--> statement-breakpoint
CREATE INDEX "redirects_to_idx" ON "redirects" USING btree ("to_path");