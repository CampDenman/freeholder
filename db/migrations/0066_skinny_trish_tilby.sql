ALTER TABLE "products" ADD COLUMN "working_name" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "working_subtitle" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "working_description" jsonb;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "working_seo" jsonb;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "working_name" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "working_summary" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "working_venue_name" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "working_venue_address" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "working_seo" jsonb;--> statement-breakpoint
ALTER TABLE "newsletter_issues" ADD COLUMN "working_title" text;--> statement-breakpoint
ALTER TABLE "newsletter_issues" ADD COLUMN "working_excerpt" text;--> statement-breakpoint
ALTER TABLE "newsletter_issues" ADD COLUMN "working_body" text;--> statement-breakpoint
ALTER TABLE "newsletter_issues" ADD COLUMN "working_seo" jsonb;