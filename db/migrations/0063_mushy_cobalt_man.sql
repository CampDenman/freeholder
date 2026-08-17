CREATE TABLE "content_preview_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "content_revisions" ADD COLUMN "seo" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "content_revisions" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "content_revisions" ADD COLUMN "kind" text DEFAULT 'autosave' NOT NULL;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "scheduled_publish_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "scheduled_unpublish_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "approval_state" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "approval_note" text;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "approved_by" text;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "edit_lease_actor" text;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "edit_lease_until" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "content_preview_links_token_idx" ON "content_preview_links" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "content_preview_links_page_idx" ON "content_preview_links" USING btree ("page_id");