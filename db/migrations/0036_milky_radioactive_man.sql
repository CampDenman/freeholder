CREATE TABLE "analytics_attributions" (
	"anon_id" text PRIMARY KEY NOT NULL,
	"first_source" text NOT NULL,
	"first_medium" text,
	"first_campaign" text,
	"first_term" text,
	"first_content" text,
	"first_path" text NOT NULL,
	"first_referrer" text,
	"first_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_source" text NOT NULL,
	"last_medium" text,
	"last_campaign" text,
	"last_term" text,
	"last_content" text,
	"last_path" text NOT NULL,
	"last_referrer" text,
	"last_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analytics_events" ADD COLUMN "event_key" text;--> statement-breakpoint
ALTER TABLE "analytics_events" ADD COLUMN "classification_override" text;--> statement-breakpoint
ALTER TABLE "analytics_events" ADD COLUMN "classification_note" text;--> statement-breakpoint
CREATE INDEX "analytics_attribution_last_at_idx" ON "analytics_attributions" USING btree ("last_at");--> statement-breakpoint
CREATE INDEX "analytics_attribution_first_campaign_idx" ON "analytics_attributions" USING btree ("first_source","first_medium","first_campaign");--> statement-breakpoint
CREATE INDEX "analytics_attribution_last_campaign_idx" ON "analytics_attributions" USING btree ("last_source","last_medium","last_campaign");--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_event_key_idx" ON "analytics_events" USING btree ("event_key") WHERE "analytics_events"."event_key" is not null;--> statement-breakpoint
CREATE INDEX "analytics_effective_kind_at_idx" ON "analytics_events" USING btree (coalesce("classification_override", "visitor_kind"),"name","at");--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_classification_override_valid" CHECK ("analytics_events"."classification_override" is null or "analytics_events"."classification_override" in ('human', 'bot', 'suspected'));