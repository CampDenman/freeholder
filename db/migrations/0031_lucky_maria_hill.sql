CREATE TABLE "mail_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sender_id" uuid,
	"purpose" text NOT NULL,
	"provider" text NOT NULL,
	"recipient" text NOT NULL,
	"subject" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"provider_ref" text,
	"idempotency_key" text,
	"requested_by" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"submitted_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"provider_status_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_deliveries_purpose_allowed" CHECK ("mail_deliveries"."purpose" in ('transactional', 'bulk')),
	CONSTRAINT "mail_deliveries_provider_allowed" CHECK ("mail_deliveries"."provider" in ('gmail', 'outlook', 'smtp', 'console', 'resend', 'postmark', 'ses', 'none')),
	CONSTRAINT "mail_deliveries_status_allowed" CHECK ("mail_deliveries"."status" in ('queued', 'submitted', 'delivered', 'bounced', 'complained', 'failed', 'suppressed')),
	CONSTRAINT "mail_deliveries_provider_purpose" CHECK (("mail_deliveries"."purpose" = 'transactional' and "mail_deliveries"."provider" in ('gmail', 'outlook', 'smtp', 'console')) or ("mail_deliveries"."purpose" = 'bulk' and "mail_deliveries"."provider" in ('resend', 'postmark', 'ses', 'none'))),
	CONSTRAINT "mail_deliveries_recipient_lower" CHECK ("mail_deliveries"."recipient" = lower("mail_deliveries"."recipient")),
	CONSTRAINT "mail_deliveries_recipient_bounded" CHECK (length("mail_deliveries"."recipient") <= 320),
	CONSTRAINT "mail_deliveries_subject_bounded" CHECK (length("mail_deliveries"."subject") <= 998),
	CONSTRAINT "mail_deliveries_attempts_nonnegative" CHECK ("mail_deliveries"."attempts" >= 0),
	CONSTRAINT "mail_deliveries_terminal_consistent" CHECK ("mail_deliveries"."status" <> 'delivered' or "mail_deliveries"."delivered_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "mail_oauth_states" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"return_to" text DEFAULT '/admin/settings' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_oauth_states_hash_format" CHECK ("mail_oauth_states"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "mail_oauth_states_provider_allowed" CHECK ("mail_oauth_states"."provider" in ('google', 'microsoft')),
	CONSTRAINT "mail_oauth_states_admin_return" CHECK ("mail_oauth_states"."return_to" ~ '^/admin(/|$)'),
	CONSTRAINT "mail_oauth_states_expiry_order" CHECK ("mail_oauth_states"."expires_at" > "mail_oauth_states"."created_at"),
	CONSTRAINT "mail_oauth_states_consumed_order" CHECK ("mail_oauth_states"."consumed_at" is null or "mail_oauth_states"."consumed_at" >= "mail_oauth_states"."created_at")
);
--> statement-breakpoint
CREATE TABLE "mail_provider_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"external_event_id" text NOT NULL,
	"delivery_id" uuid,
	"provider_ref" text,
	"recipient" text NOT NULL,
	"event_type" text NOT NULL,
	"detail" text,
	"raw_digest" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_provider_events_provider_allowed" CHECK ("mail_provider_events"."provider" in ('resend', 'postmark', 'ses')),
	CONSTRAINT "mail_provider_events_type_allowed" CHECK ("mail_provider_events"."event_type" in ('submitted', 'delivered', 'delayed', 'soft_bounce', 'hard_bounce', 'complaint', 'suppressed', 'failed')),
	CONSTRAINT "mail_provider_events_recipient_lower" CHECK ("mail_provider_events"."recipient" = lower("mail_provider_events"."recipient")),
	CONSTRAINT "mail_provider_events_recipient_bounded" CHECK (length("mail_provider_events"."recipient") <= 320),
	CONSTRAINT "mail_provider_events_digest_format" CHECK ("mail_provider_events"."raw_digest" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "mail_senders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purpose" text NOT NULL,
	"provider" text NOT NULL,
	"connected_account_id" uuid,
	"email" text NOT NULL,
	"display_name" text,
	"provider_identity" text,
	"verification_status" text DEFAULT 'pending' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"verification_detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_verified_at" timestamp with time zone,
	"last_error" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_senders_purpose_allowed" CHECK ("mail_senders"."purpose" in ('transactional', 'bulk')),
	CONSTRAINT "mail_senders_provider_allowed" CHECK ("mail_senders"."provider" in ('gmail', 'outlook', 'smtp', 'console', 'resend', 'postmark', 'ses')),
	CONSTRAINT "mail_senders_verification_allowed" CHECK ("mail_senders"."verification_status" in ('pending', 'verified', 'failed')),
	CONSTRAINT "mail_senders_status_allowed" CHECK ("mail_senders"."status" in ('active', 'paused', 'needs_attention')),
	CONSTRAINT "mail_senders_email_lower" CHECK ("mail_senders"."email" = lower("mail_senders"."email")),
	CONSTRAINT "mail_senders_email_bounded" CHECK (length("mail_senders"."email") <= 320),
	CONSTRAINT "mail_senders_provider_purpose" CHECK (("mail_senders"."purpose" = 'transactional' and "mail_senders"."provider" in ('gmail', 'outlook', 'smtp', 'console')) or ("mail_senders"."purpose" = 'bulk' and "mail_senders"."provider" in ('resend', 'postmark', 'ses'))),
	CONSTRAINT "mail_senders_connection_consistent" CHECK (("mail_senders"."provider" in ('gmail', 'outlook') and "mail_senders"."connected_account_id" is not null) or ("mail_senders"."provider" not in ('gmail', 'outlook') and "mail_senders"."connected_account_id" is null)),
	CONSTRAINT "mail_senders_default_ready" CHECK ("mail_senders"."is_default" = false or ("mail_senders"."status" = 'active' and "mail_senders"."verification_status" = 'verified' and "mail_senders"."provider" <> 'console'))
);
--> statement-breakpoint
CREATE TABLE "mail_suppressions" (
	"email" text PRIMARY KEY NOT NULL,
	"reason" text NOT NULL,
	"provider" text NOT NULL,
	"source_event_id" uuid,
	"detail" text,
	"active" boolean DEFAULT true NOT NULL,
	"released_at" timestamp with time zone,
	"released_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_suppressions_reason_allowed" CHECK ("mail_suppressions"."reason" in ('hard_bounce', 'complaint', 'provider', 'manual')),
	CONSTRAINT "mail_suppressions_provider_allowed" CHECK ("mail_suppressions"."provider" in ('resend', 'postmark', 'ses', 'manual')),
	CONSTRAINT "mail_suppressions_source_consistent" CHECK (("mail_suppressions"."reason" = 'manual' and "mail_suppressions"."provider" = 'manual') or ("mail_suppressions"."reason" <> 'manual' and "mail_suppressions"."provider" <> 'manual')),
	CONSTRAINT "mail_suppressions_email_lower" CHECK ("mail_suppressions"."email" = lower("mail_suppressions"."email")),
	CONSTRAINT "mail_suppressions_email_bounded" CHECK (length("mail_suppressions"."email") <= 320),
	CONSTRAINT "mail_suppressions_release_consistent" CHECK (("mail_suppressions"."active" = true and "mail_suppressions"."released_at" is null) or ("mail_suppressions"."active" = false and "mail_suppressions"."released_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "mail_deliveries" ADD CONSTRAINT "mail_deliveries_sender_id_mail_senders_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."mail_senders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_oauth_states" ADD CONSTRAINT "mail_oauth_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_provider_events" ADD CONSTRAINT "mail_provider_events_delivery_id_mail_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."mail_deliveries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_senders" ADD CONSTRAINT "mail_senders_connected_account_id_connected_accounts_id_fk" FOREIGN KEY ("connected_account_id") REFERENCES "public"."connected_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_senders" ADD CONSTRAINT "mail_senders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_suppressions" ADD CONSTRAINT "mail_suppressions_source_event_id_mail_provider_events_id_fk" FOREIGN KEY ("source_event_id") REFERENCES "public"."mail_provider_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_suppressions" ADD CONSTRAINT "mail_suppressions_released_by_users_id_fk" FOREIGN KEY ("released_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mail_deliveries_idempotency_idx" ON "mail_deliveries" USING btree ("idempotency_key") WHERE "mail_deliveries"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "mail_deliveries_provider_ref_idx" ON "mail_deliveries" USING btree ("provider","provider_ref");--> statement-breakpoint
CREATE INDEX "mail_deliveries_recipient_idx" ON "mail_deliveries" USING btree ("recipient","created_at");--> statement-breakpoint
CREATE INDEX "mail_deliveries_status_idx" ON "mail_deliveries" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "mail_oauth_states_expiry_idx" ON "mail_oauth_states" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_provider_events_external_idx" ON "mail_provider_events" USING btree ("provider","external_event_id");--> statement-breakpoint
CREATE INDEX "mail_provider_events_delivery_idx" ON "mail_provider_events" USING btree ("delivery_id","occurred_at");--> statement-breakpoint
CREATE INDEX "mail_provider_events_recipient_idx" ON "mail_provider_events" USING btree ("recipient","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_senders_identity_idx" ON "mail_senders" USING btree ("purpose","provider","email");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_senders_default_idx" ON "mail_senders" USING btree ("purpose") WHERE "mail_senders"."is_default" = true;--> statement-breakpoint
CREATE INDEX "mail_senders_connection_idx" ON "mail_senders" USING btree ("connected_account_id");--> statement-breakpoint
CREATE INDEX "mail_senders_status_idx" ON "mail_senders" USING btree ("purpose","status");--> statement-breakpoint
CREATE INDEX "mail_suppressions_active_idx" ON "mail_suppressions" USING btree ("created_at") WHERE "mail_suppressions"."active" = true;