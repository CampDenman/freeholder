CREATE TABLE "content_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"kind" text NOT NULL,
	"preset" text NOT NULL,
	"name" text NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"blocks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"origin" text DEFAULT 'system' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "content_templates_key_preset_locale_idx" ON "content_templates" USING btree ("key","preset","locale");--> statement-breakpoint
CREATE INDEX "content_templates_kind_preset_idx" ON "content_templates" USING btree ("kind","preset");