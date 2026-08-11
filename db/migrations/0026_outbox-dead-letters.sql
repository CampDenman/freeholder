CREATE TABLE "outbox_event_deliveries" (
	"event_id" uuid NOT NULL,
	"listener_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_expires_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"dead_lettered_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbox_event_deliveries_pk" PRIMARY KEY("event_id","listener_id"),
	CONSTRAINT "outbox_event_deliveries_status_check" CHECK ("outbox_event_deliveries"."status" in ('pending', 'processing', 'delivered', 'dead_letter')),
	CONSTRAINT "outbox_event_deliveries_attempts_nonnegative" CHECK ("outbox_event_deliveries"."attempts" >= 0),
	CONSTRAINT "outbox_event_deliveries_listener_not_blank" CHECK (length(trim("outbox_event_deliveries"."listener_id")) > 0)
);
--> statement-breakpoint
DROP INDEX "outbox_pending_idx";--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "dead_lettered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "replay_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "outbox_events"
SET "status" = 'dispatched'
WHERE "dispatched_at" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "outbox_event_deliveries" ADD CONSTRAINT "outbox_event_deliveries_event_id_outbox_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."outbox_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "outbox_delivery_pending_idx" ON "outbox_event_deliveries" USING btree ("status","next_attempt_at","lease_expires_at");--> statement-breakpoint
CREATE INDEX "outbox_dead_letter_idx" ON "outbox_events" USING btree ("status","dead_lettered_at");--> statement-breakpoint
CREATE INDEX "outbox_pending_idx" ON "outbox_events" USING btree ("status","next_attempt_at","created_at");--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_status_check" CHECK ("outbox_events"."status" in ('pending', 'dispatched', 'dead_letter'));--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_attempts_nonnegative" CHECK ("outbox_events"."attempts" >= 0);--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_replay_count_nonnegative" CHECK ("outbox_events"."replay_count" >= 0);
