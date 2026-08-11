CREATE TABLE "consent_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"channel" text,
	"state" text NOT NULL,
	"method" text NOT NULL,
	"terms_version" text,
	"source_url" text,
	"ip" text,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consent_records_purpose" CHECK ("consent_records"."purpose" in ('marketing', 'analytics', 'data_processing')),
	CONSTRAINT "consent_records_purpose_channel" CHECK (("consent_records"."purpose" = 'marketing' and "consent_records"."channel" in ('email', 'sms', 'push'))
        or ("consent_records"."purpose" = 'analytics' and "consent_records"."channel" = 'web')
        or ("consent_records"."purpose" = 'data_processing' and "consent_records"."channel" is null)),
	CONSTRAINT "consent_records_state" CHECK ("consent_records"."state" in ('granted', 'denied', 'withdrawn')),
	CONSTRAINT "consent_records_method" CHECK ("consent_records"."method" in ('form', 'preference_center', 'double_opt_in', 'verbal', 'written', 'contract', 'import', 'system')),
	CONSTRAINT "consent_records_expiry_after_event" CHECK ("consent_records"."expires_at" is null or "consent_records"."expires_at" > "consent_records"."occurred_at")
);
--> statement-breakpoint
CREATE TABLE "data_request_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_request_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"mime" text DEFAULT 'application/json' NOT NULL,
	"body" jsonb NOT NULL,
	"sha256" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_downloaded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "data_request_artifacts_sha256_length" CHECK (length("data_request_artifacts"."sha256") = 64),
	CONSTRAINT "data_request_artifacts_expiry_after_creation" CHECK ("data_request_artifacts"."expires_at" > "data_request_artifacts"."created_at")
);
--> statement-breakpoint
CREATE TABLE "data_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'submitted' NOT NULL,
	"jurisdiction" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"requested_by" text NOT NULL,
	"verification_method" text,
	"verified_at" timestamp with time zone,
	"response_due_at" timestamp with time zone NOT NULL,
	"resolution" text,
	"fulfilled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "data_requests_kind" CHECK ("data_requests"."kind" in ('access', 'export', 'correction', 'erasure')),
	CONSTRAINT "data_requests_status" CHECK ("data_requests"."status" in ('submitted', 'verified', 'in_progress', 'completed', 'partially_completed', 'denied', 'cancelled')),
	CONSTRAINT "data_requests_verified_state" CHECK ("data_requests"."status" not in ('verified', 'in_progress', 'completed', 'partially_completed') or "data_requests"."verified_at" is not null),
	CONSTRAINT "data_requests_fulfilled_state" CHECK ("data_requests"."status" not in ('completed', 'partially_completed', 'denied') or "data_requests"."fulfilled_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "privacy_retention_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_request_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"reason" text NOT NULL,
	"legal_basis" text NOT NULL,
	"notes" text,
	"expires_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "privacy_retention_exceptions_reason" CHECK ("privacy_retention_exceptions"."reason" in ('legal_obligation', 'legal_claim', 'contractual_obligation', 'accounting_tax', 'security_fraud')),
	CONSTRAINT "privacy_retention_exceptions_expiry_after_creation" CHECK ("privacy_retention_exceptions"."expires_at" is null or "privacy_retention_exceptions"."expires_at" > "privacy_retention_exceptions"."created_at")
);
--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_request_artifacts" ADD CONSTRAINT "data_request_artifacts_data_request_id_data_requests_id_fk" FOREIGN KEY ("data_request_id") REFERENCES "public"."data_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_requests" ADD CONSTRAINT "data_requests_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_retention_exceptions" ADD CONSTRAINT "privacy_retention_exceptions_data_request_id_data_requests_id_fk" FOREIGN KEY ("data_request_id") REFERENCES "public"."data_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "consent_records_contact_idx" ON "consent_records" USING btree ("contact_id","occurred_at");--> statement-breakpoint
CREATE INDEX "consent_records_effective_idx" ON "consent_records" USING btree ("contact_id","purpose","channel","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "data_request_artifacts_request_idx" ON "data_request_artifacts" USING btree ("data_request_id");--> statement-breakpoint
CREATE INDEX "data_request_artifacts_expiry_idx" ON "data_request_artifacts" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "data_requests_contact_idx" ON "data_requests" USING btree ("contact_id","created_at");--> statement-breakpoint
CREATE INDEX "data_requests_status_due_idx" ON "data_requests" USING btree ("status","response_due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "privacy_retention_exceptions_scope_idx" ON "privacy_retention_exceptions" USING btree ("data_request_id","scope");--> statement-breakpoint
CREATE INDEX "privacy_retention_exceptions_expiry_idx" ON "privacy_retention_exceptions" USING btree ("expires_at");
