CREATE TABLE "notification_receipts" (
	"idempotency_key" text PRIMARY KEY NOT NULL,
	"notification_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_receipts" ADD CONSTRAINT "notification_receipts_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_receipts_notification_idx" ON "notification_receipts" USING btree ("notification_id");