ALTER TABLE "pages" ADD COLUMN "working_title" text;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "working_blocks" jsonb;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "working_seo" jsonb;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;