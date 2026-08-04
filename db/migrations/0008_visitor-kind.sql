ALTER TABLE "analytics_events" ADD COLUMN "visitor_kind" text DEFAULT 'human' NOT NULL;--> statement-breakpoint
ALTER TABLE "analytics_events" ADD COLUMN "bot_reasons" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
CREATE INDEX "analytics_kind_at_idx" ON "analytics_events" USING btree ("visitor_kind","name","at");