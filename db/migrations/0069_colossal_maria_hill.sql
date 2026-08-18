ALTER TABLE "contributions" ADD COLUMN "spoke_id" uuid;--> statement-breakpoint
ALTER TABLE "contributions" ADD COLUMN "reply_url" text;--> statement-breakpoint
ALTER TABLE "contributions" ADD COLUMN "reply_token" text;