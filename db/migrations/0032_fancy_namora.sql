CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notification_id" uuid NOT NULL,
	"digest_id" uuid,
	"channel" text NOT NULL,
	"kind" text DEFAULT 'immediate' NOT NULL,
	"status" text NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"provider" text,
	"provider_ref" text,
	"last_error" text,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_deliveries_channel_allowed" CHECK ("notification_deliveries"."channel" in ('in_app', 'email', 'sms', 'push')),
	CONSTRAINT "notification_deliveries_kind_allowed" CHECK ("notification_deliveries"."kind" in ('immediate', 'digest', 'escalation')),
	CONSTRAINT "notification_deliveries_status_allowed" CHECK ("notification_deliveries"."status" in ('pending', 'deferred', 'processing', 'delivered', 'skipped', 'failed')),
	CONSTRAINT "notification_deliveries_attempts_nonnegative" CHECK ("notification_deliveries"."attempts" >= 0),
	CONSTRAINT "notification_deliveries_terminal_consistent" CHECK ("notification_deliveries"."status" <> 'delivered' or "notification_deliveries"."delivered_at" is not null),
	CONSTRAINT "notification_deliveries_digest_consistent" CHECK (("notification_deliveries"."kind" = 'digest' and "notification_deliveries"."status" in ('deferred', 'processing', 'delivered', 'skipped', 'failed')) or ("notification_deliveries"."kind" <> 'digest' and "notification_deliveries"."digest_id" is null))
);
--> statement-breakpoint
CREATE TABLE "notification_digests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_user_id" uuid,
	"recipient_contact_id" uuid,
	"recipient" text NOT NULL,
	"channel" text DEFAULT 'email' NOT NULL,
	"status" text DEFAULT 'processing' NOT NULL,
	"idempotency_key" text NOT NULL,
	"item_count" integer NOT NULL,
	"provider" text,
	"provider_ref" text,
	"last_error" text,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_digests_one_recipient" CHECK (num_nonnulls("notification_digests"."recipient_user_id", "notification_digests"."recipient_contact_id") = 1),
	CONSTRAINT "notification_digests_recipient_lower" CHECK ("notification_digests"."recipient" = lower("notification_digests"."recipient")),
	CONSTRAINT "notification_digests_items_positive" CHECK ("notification_digests"."item_count" >= 1),
	CONSTRAINT "notification_digests_status_allowed" CHECK ("notification_digests"."status" in ('processing', 'delivered', 'skipped', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"contact_id" uuid,
	"topic" text NOT NULL,
	"channel" text NOT NULL,
	"mode" text DEFAULT 'immediate' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preferences_one_recipient" CHECK (num_nonnulls("notification_preferences"."user_id", "notification_preferences"."contact_id") = 1),
	CONSTRAINT "notification_preferences_channel_allowed" CHECK ("notification_preferences"."channel" in ('in_app', 'email', 'sms', 'push')),
	CONSTRAINT "notification_preferences_mode_allowed" CHECK ("notification_preferences"."mode" in ('immediate', 'digest', 'off')),
	CONSTRAINT "notification_preferences_in_app_immediate" CHECK ("notification_preferences"."channel" <> 'in_app' or "notification_preferences"."mode" in ('immediate', 'off')),
	CONSTRAINT "notification_preferences_digest_email_only" CHECK ("notification_preferences"."mode" <> 'digest' or "notification_preferences"."channel" = 'email'),
	CONSTRAINT "notification_preferences_topic_bounded" CHECK (length("notification_preferences"."topic") between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "notification_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"contact_id" uuid,
	"digest_cadence" text DEFAULT 'daily' NOT NULL,
	"digest_minute" integer DEFAULT 480 NOT NULL,
	"digest_weekday" integer DEFAULT 1 NOT NULL,
	"timezone" text,
	"escalation_minutes" integer DEFAULT 60 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_settings_one_recipient" CHECK (num_nonnulls("notification_settings"."user_id", "notification_settings"."contact_id") = 1),
	CONSTRAINT "notification_settings_cadence_allowed" CHECK ("notification_settings"."digest_cadence" in ('daily', 'weekly')),
	CONSTRAINT "notification_settings_minute_allowed" CHECK ("notification_settings"."digest_minute" between 0 and 1439),
	CONSTRAINT "notification_settings_weekday_allowed" CHECK ("notification_settings"."digest_weekday" between 1 and 7),
	CONSTRAINT "notification_settings_escalation_allowed" CHECK ("notification_settings"."escalation_minutes" between 5 and 10080)
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_user_id" uuid,
	"recipient_contact_id" uuid,
	"external_recipient" text,
	"topic" text NOT NULL,
	"priority" text DEFAULT 'information' NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"href" text,
	"reply_to" text,
	"source_event_id" text,
	"source_event_name" text,
	"idempotency_key" text NOT NULL,
	"dedupe_key" text,
	"occurrence_count" integer DEFAULT 1 NOT NULL,
	"first_occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"escalate_at" timestamp with time zone,
	"escalated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_one_recipient" CHECK (num_nonnulls("notifications"."recipient_user_id", "notifications"."recipient_contact_id", "notifications"."external_recipient") = 1),
	CONSTRAINT "notifications_priority_allowed" CHECK ("notifications"."priority" in ('information', 'warning', 'critical')),
	CONSTRAINT "notifications_topic_bounded" CHECK (length("notifications"."topic") between 1 and 100),
	CONSTRAINT "notifications_title_bounded" CHECK (length("notifications"."title") between 1 and 240),
	CONSTRAINT "notifications_body_bounded" CHECK (length("notifications"."body") between 1 and 4000),
	CONSTRAINT "notifications_href_internal" CHECK ("notifications"."href" is null or ("notifications"."href" ~ '^/' and length("notifications"."href") <= 1000)),
	CONSTRAINT "notifications_external_lower" CHECK ("notifications"."external_recipient" is null or "notifications"."external_recipient" = lower("notifications"."external_recipient")),
	CONSTRAINT "notifications_occurrences_positive" CHECK ("notifications"."occurrence_count" >= 1),
	CONSTRAINT "notifications_occurrence_order" CHECK ("notifications"."last_occurred_at" >= "notifications"."first_occurred_at"),
	CONSTRAINT "notifications_escalation_consistent" CHECK ("notifications"."escalated_at" is null or "notifications"."escalate_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_digest_id_notification_digests_id_fk" FOREIGN KEY ("digest_id") REFERENCES "public"."notification_digests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_digests" ADD CONSTRAINT "notification_digests_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_digests" ADD CONSTRAINT "notification_digests_recipient_contact_id_contacts_id_fk" FOREIGN KEY ("recipient_contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_contact_id_contacts_id_fk" FOREIGN KEY ("recipient_contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_deliveries_once_idx" ON "notification_deliveries" USING btree ("notification_id","channel","kind");--> statement-breakpoint
CREATE INDEX "notification_deliveries_due_idx" ON "notification_deliveries" USING btree ("status","available_at");--> statement-breakpoint
CREATE INDEX "notification_deliveries_digest_idx" ON "notification_deliveries" USING btree ("digest_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_digests_idempotency_idx" ON "notification_digests" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "notification_digests_recipient_idx" ON "notification_digests" USING btree ("recipient","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_preferences_user_idx" ON "notification_preferences" USING btree ("user_id","topic","channel") WHERE "notification_preferences"."user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_preferences_contact_idx" ON "notification_preferences" USING btree ("contact_id","topic","channel") WHERE "notification_preferences"."contact_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_settings_user_idx" ON "notification_settings" USING btree ("user_id") WHERE "notification_settings"."user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_settings_contact_idx" ON "notification_settings" USING btree ("contact_id") WHERE "notification_settings"."contact_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_idempotency_idx" ON "notifications" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "notifications_user_inbox_idx" ON "notifications" USING btree ("recipient_user_id","archived_at","read_at","last_occurred_at");--> statement-breakpoint
CREATE INDEX "notifications_contact_inbox_idx" ON "notifications" USING btree ("recipient_contact_id","archived_at","read_at","last_occurred_at");--> statement-breakpoint
CREATE INDEX "notifications_escalation_idx" ON "notifications" USING btree ("escalate_at","escalated_at");--> statement-breakpoint
CREATE INDEX "notifications_user_dedupe_idx" ON "notifications" USING btree ("recipient_user_id","dedupe_key","archived_at");--> statement-breakpoint
CREATE INDEX "notifications_contact_dedupe_idx" ON "notifications" USING btree ("recipient_contact_id","dedupe_key","archived_at");--> statement-breakpoint
CREATE INDEX "notifications_external_dedupe_idx" ON "notifications" USING btree ("external_recipient","dedupe_key","archived_at");