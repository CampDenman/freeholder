CREATE TABLE "content_layouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"template_key" text NOT NULL,
	"detached" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "content_layouts_page_idx" ON "content_layouts" USING btree ("page_id");--> statement-breakpoint
CREATE UNIQUE INDEX "content_layouts_entity_locale_idx" ON "content_layouts" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "content_layouts_template_idx" ON "content_layouts" USING btree ("template_key");