CREATE TABLE "project_collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"kind" text NOT NULL,
	"description" text,
	"cover_asset_id" uuid,
	"position" integer DEFAULT 0 NOT NULL,
	"publication_status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"public_page_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_collections_name" CHECK (char_length("project_collections"."name") between 1 and 160),
	CONSTRAINT "project_collections_slug" CHECK ("project_collections"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "project_collections_kind" CHECK ("project_collections"."kind" in ('portfolio','service','industry','season')),
	CONSTRAINT "project_collections_status" CHECK ("project_collections"."publication_status" in ('draft','published')),
	CONSTRAINT "project_collections_publication_time" CHECK (("project_collections"."publication_status" = 'published' and "project_collections"."published_at" is not null) or "project_collections"."publication_status" = 'draft')
);--> statement-breakpoint

CREATE TABLE "project_collection_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collection_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "project_collections" ADD CONSTRAINT "project_collections_cover_asset_id_assets_id_fk" FOREIGN KEY ("cover_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_collection_items" ADD CONSTRAINT "project_collection_items_collection_id_project_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."project_collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_collection_items" ADD CONSTRAINT "project_collection_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_collections_slug_idx" ON "project_collections" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "project_collections_public_idx" ON "project_collections" USING btree ("publication_status","position");--> statement-breakpoint
CREATE UNIQUE INDEX "project_collection_items_unique_idx" ON "project_collection_items" USING btree ("collection_id","project_id");--> statement-breakpoint
CREATE INDEX "project_collection_items_project_idx" ON "project_collection_items" USING btree ("project_id","collection_id");--> statement-breakpoint
CREATE INDEX "project_collection_items_order_idx" ON "project_collection_items" USING btree ("collection_id","position");
