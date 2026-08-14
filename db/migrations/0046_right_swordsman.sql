CREATE TABLE "payment_disputes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_ref" text NOT NULL,
	"provider_payment_ref" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"currency" text NOT NULL,
	"amount_minor" bigint DEFAULT 0 NOT NULL,
	"reason" text,
	"evidence_due_at" timestamp with time zone,
	"opened_at" timestamp with time zone NOT NULL,
	"provider_status_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_disputes_currency_valid" CHECK ("payment_disputes"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "payment_disputes_amount_positive" CHECK ("payment_disputes"."amount_minor" > 0),
	CONSTRAINT "payment_disputes_status_valid" CHECK ("payment_disputes"."status" in ('open','won','lost')),
	CONSTRAINT "payment_disputes_closed_consistent" CHECK (("payment_disputes"."status" = 'open' and "payment_disputes"."closed_at" is null) or ("payment_disputes"."status" <> 'open' and "payment_disputes"."closed_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "payment_methods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_method_ref" text NOT NULL,
	"provider_customer_ref" text,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"brand" text,
	"last4" text,
	"expiry_month" integer,
	"expiry_year" integer,
	"status" text DEFAULT 'active' NOT NULL,
	"consent_source" text NOT NULL,
	"consented_at" timestamp with time zone NOT NULL,
	"provider_status_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_methods_provider_valid" CHECK (length(trim("payment_methods"."provider")) between 1 and 100),
	CONSTRAINT "payment_methods_ref_valid" CHECK (length(trim("payment_methods"."provider_method_ref")) between 1 and 500),
	CONSTRAINT "payment_methods_label_valid" CHECK (length(trim("payment_methods"."label")) between 1 and 200),
	CONSTRAINT "payment_methods_last4_valid" CHECK ("payment_methods"."last4" is null or "payment_methods"."last4" ~ '^[A-Za-z0-9]{2,4}$'),
	CONSTRAINT "payment_methods_expiry_pair" CHECK (("payment_methods"."expiry_month" is null and "payment_methods"."expiry_year" is null) or ("payment_methods"."expiry_month" between 1 and 12 and "payment_methods"."expiry_year" between 2000 and 9999)),
	CONSTRAINT "payment_methods_status_valid" CHECK ("payment_methods"."status" in ('active','revoked','expired')),
	CONSTRAINT "payment_methods_revocation_consistent" CHECK ("payment_methods"."status" <> 'revoked' or "payment_methods"."revoked_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "payment_provider_customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_customer_ref" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_provider_customers_provider_valid" CHECK (length(trim("payment_provider_customers"."provider")) between 1 and 100),
	CONSTRAINT "payment_provider_customers_ref_valid" CHECK (length(trim("payment_provider_customers"."provider_customer_ref")) between 1 and 500)
);
--> statement-breakpoint
CREATE TABLE "payment_provider_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"kind" text NOT NULL,
	"provider_object_ref" text,
	"body_sha256" text NOT NULL,
	"status" text NOT NULL,
	"detail" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_provider_events_hash_valid" CHECK (length("payment_provider_events"."body_sha256") = 64),
	CONSTRAINT "payment_provider_events_status_valid" CHECK ("payment_provider_events"."status" in ('processed','ignored'))
);
--> statement-breakpoint
ALTER TABLE "money_state_events" DROP CONSTRAINT "money_state_events_subject_valid";--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "provider_checkout_ref" text;--> statement-breakpoint
ALTER TABLE "payment_disputes" ADD CONSTRAINT "payment_disputes_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_disputes" ADD CONSTRAINT "payment_disputes_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_provider_customers" ADD CONSTRAINT "payment_provider_customers_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_disputes_provider_ref_idx" ON "payment_disputes" USING btree ("provider","provider_ref");--> statement-breakpoint
CREATE INDEX "payment_disputes_payment_idx" ON "payment_disputes" USING btree ("payment_id","created_at");--> statement-breakpoint
CREATE INDEX "payment_disputes_invoice_idx" ON "payment_disputes" USING btree ("invoice_id","created_at");--> statement-breakpoint
CREATE INDEX "payment_disputes_status_due_idx" ON "payment_disputes" USING btree ("status","evidence_due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_methods_provider_ref_idx" ON "payment_methods" USING btree ("provider","provider_method_ref");--> statement-breakpoint
CREATE INDEX "payment_methods_contact_status_idx" ON "payment_methods" USING btree ("contact_id","status","created_at");--> statement-breakpoint
CREATE INDEX "payment_methods_customer_ref_idx" ON "payment_methods" USING btree ("provider","provider_customer_ref");--> statement-breakpoint
CREATE INDEX "payment_provider_customers_contact_idx" ON "payment_provider_customers" USING btree ("contact_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_provider_customers_ref_idx" ON "payment_provider_customers" USING btree ("provider","provider_customer_ref");--> statement-breakpoint
CREATE INDEX "payment_provider_customers_contact_created_idx" ON "payment_provider_customers" USING btree ("contact_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_provider_events_provider_id_idx" ON "payment_provider_events" USING btree ("provider","provider_event_id");--> statement-breakpoint
CREATE INDEX "payment_provider_events_status_received_idx" ON "payment_provider_events" USING btree ("status","received_at");--> statement-breakpoint
CREATE INDEX "payment_provider_events_object_idx" ON "payment_provider_events" USING btree ("provider","provider_object_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_checkout_ref_idx" ON "payments" USING btree ("provider","provider_checkout_ref");--> statement-breakpoint
ALTER TABLE "money_state_events" ADD CONSTRAINT "money_state_events_subject_valid" CHECK ("money_state_events"."subject_type" in ('invoice','payment','refund','credit_note','dispute'));