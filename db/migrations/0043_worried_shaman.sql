CREATE TABLE "credit_note_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"credit_note_id" uuid NOT NULL,
	"invoice_line_id" uuid,
	"position" integer NOT NULL,
	"description" text NOT NULL,
	"quantity_micros" bigint NOT NULL,
	"subtotal_minor" bigint DEFAULT 0 NOT NULL,
	"tax_minor" bigint DEFAULT 0 NOT NULL,
	"total_minor" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_note_lines_position_valid" CHECK ("credit_note_lines"."position" >= 0),
	CONSTRAINT "credit_note_lines_quantity_positive" CHECK ("credit_note_lines"."quantity_micros" > 0),
	CONSTRAINT "credit_note_lines_amounts_nonnegative" CHECK ("credit_note_lines"."subtotal_minor" >= 0 and "credit_note_lines"."tax_minor" >= 0 and "credit_note_lines"."total_minor" >= 0),
	CONSTRAINT "credit_note_lines_total_consistent" CHECK ("credit_note_lines"."total_minor" = "credit_note_lines"."subtotal_minor" + "credit_note_lines"."tax_minor")
);
--> statement-breakpoint
CREATE TABLE "credit_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"number" text,
	"sequence_key" text DEFAULT 'credit-note' NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"currency" text NOT NULL,
	"reason" text NOT NULL,
	"subtotal_minor" bigint DEFAULT 0 NOT NULL,
	"tax_minor" bigint DEFAULT 0 NOT NULL,
	"total_minor" bigint DEFAULT 0 NOT NULL,
	"issued_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_notes_currency_valid" CHECK ("credit_notes"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "credit_notes_request_hash_valid" CHECK (length("credit_notes"."request_hash") = 64),
	CONSTRAINT "credit_notes_status_valid" CHECK ("credit_notes"."status" in ('draft','issued','void')),
	CONSTRAINT "credit_notes_amounts_nonnegative" CHECK ("credit_notes"."subtotal_minor" >= 0 and "credit_notes"."tax_minor" >= 0 and "credit_notes"."total_minor" >= 0),
	CONSTRAINT "credit_notes_total_consistent" CHECK ("credit_notes"."total_minor" = "credit_notes"."subtotal_minor" + "credit_notes"."tax_minor"),
	CONSTRAINT "credit_notes_issued_consistent" CHECK (("credit_notes"."status" = 'draft' and "credit_notes"."number" is null and "credit_notes"."issued_at" is null) or ("credit_notes"."status" <> 'draft' and "credit_notes"."number" is not null and "credit_notes"."issued_at" is not null)),
	CONSTRAINT "credit_notes_void_consistent" CHECK ("credit_notes"."status" <> 'void' or "credit_notes"."voided_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"source_type" text,
	"source_id" text,
	"description" text NOT NULL,
	"quantity_micros" bigint NOT NULL,
	"unit_amount_minor" bigint DEFAULT 0 NOT NULL,
	"subtotal_minor" bigint DEFAULT 0 NOT NULL,
	"discount_minor" bigint DEFAULT 0 NOT NULL,
	"tax_minor" bigint DEFAULT 0 NOT NULL,
	"total_minor" bigint DEFAULT 0 NOT NULL,
	"tax_category_code" text DEFAULT 'standard' NOT NULL,
	"snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_lines_position_valid" CHECK ("invoice_lines"."position" >= 0),
	CONSTRAINT "invoice_lines_quantity_positive" CHECK ("invoice_lines"."quantity_micros" > 0),
	CONSTRAINT "invoice_lines_amounts_nonnegative" CHECK ("invoice_lines"."unit_amount_minor" >= 0 and "invoice_lines"."subtotal_minor" >= 0 and "invoice_lines"."discount_minor" >= 0 and "invoice_lines"."tax_minor" >= 0 and "invoice_lines"."total_minor" >= 0),
	CONSTRAINT "invoice_lines_discount_bounded" CHECK ("invoice_lines"."discount_minor" <= "invoice_lines"."subtotal_minor"),
	CONSTRAINT "invoice_lines_total_consistent" CHECK ("invoice_lines"."total_minor" = "invoice_lines"."subtotal_minor" - "invoice_lines"."discount_minor" + "invoice_lines"."tax_minor"),
	CONSTRAINT "invoice_lines_snapshot_object" CHECK (jsonb_typeof("invoice_lines"."snapshot") = 'object')
);
--> statement-breakpoint
CREATE TABLE "invoice_sequences" (
	"key" text PRIMARY KEY NOT NULL,
	"prefix" text DEFAULT 'INV-' NOT NULL,
	"next_value" bigint DEFAULT 1 NOT NULL,
	"padding" integer DEFAULT 6 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_sequences_key_valid" CHECK (length(trim("invoice_sequences"."key")) between 1 and 80),
	CONSTRAINT "invoice_sequences_next_positive" CHECK ("invoice_sequences"."next_value" > 0),
	CONSTRAINT "invoice_sequences_padding_valid" CHECK ("invoice_sequences"."padding" between 1 and 18)
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"number" text,
	"sequence_key" text DEFAULT 'invoice' NOT NULL,
	"source_type" text DEFAULT 'manual' NOT NULL,
	"source_id" text,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"currency" text NOT NULL,
	"subtotal_minor" bigint DEFAULT 0 NOT NULL,
	"discount_minor" bigint DEFAULT 0 NOT NULL,
	"shipping_minor" bigint DEFAULT 0 NOT NULL,
	"tax_minor" bigint DEFAULT 0 NOT NULL,
	"total_minor" bigint DEFAULT 0 NOT NULL,
	"paid_minor" bigint DEFAULT 0 NOT NULL,
	"refunded_minor" bigint DEFAULT 0 NOT NULL,
	"billing_address" jsonb,
	"customer_tax_id" text,
	"required_tax_legend" text,
	"memo" text,
	"schedule" jsonb,
	"deposit_of_invoice_id" uuid,
	"due_at" timestamp with time zone,
	"issued_at" timestamp with time zone,
	"viewed_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_currency_valid" CHECK ("invoices"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "invoices_request_hash_valid" CHECK (length("invoices"."request_hash") = 64),
	CONSTRAINT "invoices_status_valid" CHECK ("invoices"."status" in ('draft','sent','viewed','partially_paid','paid','overdue','void','refunded')),
	CONSTRAINT "invoices_amounts_nonnegative" CHECK ("invoices"."subtotal_minor" >= 0 and "invoices"."discount_minor" >= 0 and "invoices"."shipping_minor" >= 0 and "invoices"."tax_minor" >= 0 and "invoices"."total_minor" >= 0 and "invoices"."paid_minor" >= 0 and "invoices"."refunded_minor" >= 0),
	CONSTRAINT "invoices_total_consistent" CHECK ("invoices"."total_minor" = "invoices"."subtotal_minor" - "invoices"."discount_minor" + "invoices"."shipping_minor" + "invoices"."tax_minor"),
	CONSTRAINT "invoices_discount_bounded" CHECK ("invoices"."discount_minor" <= "invoices"."subtotal_minor"),
	CONSTRAINT "invoices_paid_bounded" CHECK ("invoices"."paid_minor" <= "invoices"."total_minor"),
	CONSTRAINT "invoices_refund_bounded" CHECK ("invoices"."refunded_minor" <= "invoices"."paid_minor"),
	CONSTRAINT "invoices_issued_consistent" CHECK (("invoices"."status" = 'draft' and "invoices"."number" is null and "invoices"."issued_at" is null) or ("invoices"."status" <> 'draft' and "invoices"."number" is not null and "invoices"."issued_at" is not null)),
	CONSTRAINT "invoices_paid_consistent" CHECK ("invoices"."status" <> 'paid' or ("invoices"."paid_minor" = "invoices"."total_minor" and "invoices"."paid_at" is not null)),
	CONSTRAINT "invoices_void_consistent" CHECK ("invoices"."status" <> 'void' or "invoices"."voided_at" is not null),
	CONSTRAINT "invoices_refunded_consistent" CHECK ("invoices"."status" <> 'refunded' or ("invoices"."refunded_minor" = "invoices"."paid_minor" and "invoices"."paid_minor" > 0)),
	CONSTRAINT "invoices_not_own_deposit" CHECK ("invoices"."deposit_of_invoice_id" is null or "invoices"."deposit_of_invoice_id" <> "invoices"."id")
);
--> statement-breakpoint
CREATE TABLE "money_state_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"from_state" text,
	"to_state" text NOT NULL,
	"reason" text,
	"actor" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "money_state_events_subject_valid" CHECK ("money_state_events"."subject_type" in ('invoice','payment','refund','credit_note')),
	CONSTRAINT "money_state_events_transition_valid" CHECK ("money_state_events"."from_state" is null or "money_state_events"."from_state" <> "money_state_events"."to_state"),
	CONSTRAINT "money_state_events_metadata_object" CHECK (jsonb_typeof("money_state_events"."metadata") = 'object')
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_ref" text,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"status" text DEFAULT 'created' NOT NULL,
	"method" text NOT NULL,
	"currency" text NOT NULL,
	"amount_minor" bigint DEFAULT 0 NOT NULL,
	"refunded_minor" bigint DEFAULT 0 NOT NULL,
	"failure_code" text,
	"failure_message" text,
	"processed_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_currency_valid" CHECK ("payments"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "payments_request_hash_valid" CHECK (length("payments"."request_hash") = 64),
	CONSTRAINT "payments_amount_positive" CHECK ("payments"."amount_minor" > 0),
	CONSTRAINT "payments_refund_bounded" CHECK ("payments"."refunded_minor" between 0 and "payments"."amount_minor"),
	CONSTRAINT "payments_status_valid" CHECK ("payments"."status" in ('created','processing','succeeded','failed','cancelled')),
	CONSTRAINT "payments_metadata_object" CHECK (jsonb_typeof("payments"."metadata") = 'object'),
	CONSTRAINT "payments_success_consistent" CHECK ("payments"."status" <> 'succeeded' or ("payments"."provider_ref" is not null and "payments"."processed_at" is not null)),
	CONSTRAINT "payments_failure_consistent" CHECK ("payments"."status" <> 'failed' or "payments"."failed_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_ref" text,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"status" text DEFAULT 'created' NOT NULL,
	"currency" text NOT NULL,
	"amount_minor" bigint DEFAULT 0 NOT NULL,
	"reason" text,
	"failure_code" text,
	"failure_message" text,
	"processed_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refunds_currency_valid" CHECK ("refunds"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "refunds_request_hash_valid" CHECK (length("refunds"."request_hash") = 64),
	CONSTRAINT "refunds_amount_positive" CHECK ("refunds"."amount_minor" > 0),
	CONSTRAINT "refunds_status_valid" CHECK ("refunds"."status" in ('created','processing','succeeded','failed','cancelled')),
	CONSTRAINT "refunds_success_consistent" CHECK ("refunds"."status" <> 'succeeded' or ("refunds"."provider_ref" is not null and "refunds"."processed_at" is not null)),
	CONSTRAINT "refunds_failure_consistent" CHECK ("refunds"."status" <> 'failed' or "refunds"."failed_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "tax_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"default_rate_hint_ppm" integer,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_categories_code_valid" CHECK ("tax_categories"."code" ~ '^[a-z0-9]+(?:_[a-z0-9]+)*$'),
	CONSTRAINT "tax_categories_hint_valid" CHECK ("tax_categories"."default_rate_hint_ppm" is null or "tax_categories"."default_rate_hint_ppm" between 0 and 10000000)
);
--> statement-breakpoint
CREATE TABLE "tax_exemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"zone_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"certificate_ref" text,
	"validated_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_exemptions_status_valid" CHECK ("tax_exemptions"."status" in ('pending','valid','expired','revoked')),
	CONSTRAINT "tax_exemptions_window_valid" CHECK ("tax_exemptions"."validated_at" is null or "tax_exemptions"."expires_at" is null or "tax_exemptions"."expires_at" > "tax_exemptions"."validated_at")
);
--> statement-breakpoint
CREATE TABLE "tax_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"invoice_line_id" uuid,
	"kind" text NOT NULL,
	"rate_name" text NOT NULL,
	"rate_ppm" integer NOT NULL,
	"taxable_minor" bigint DEFAULT 0 NOT NULL,
	"amount_minor" bigint DEFAULT 0 NOT NULL,
	"jurisdiction" text NOT NULL,
	"registration_number" text,
	"inclusive" boolean DEFAULT false NOT NULL,
	"compound" boolean DEFAULT false NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"exemption_kind" text,
	"explanation" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_lines_kind_valid" CHECK ("tax_lines"."kind" in ('item','shipping','exemption')),
	CONSTRAINT "tax_lines_rate_valid" CHECK ("tax_lines"."rate_ppm" between 0 and 10000000),
	CONSTRAINT "tax_lines_amounts_nonnegative" CHECK ("tax_lines"."taxable_minor" >= 0 and "tax_lines"."amount_minor" >= 0),
	CONSTRAINT "tax_lines_item_pointer" CHECK (("tax_lines"."kind" = 'item' and "tax_lines"."invoice_line_id" is not null) or ("tax_lines"."kind" = 'shipping' and "tax_lines"."invoice_line_id" is null) or "tax_lines"."kind" = 'exemption')
);
--> statement-breakpoint
CREATE TABLE "tax_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"zone_id" uuid NOT NULL,
	"category_id" uuid,
	"name" text NOT NULL,
	"jurisdiction" text NOT NULL,
	"rate_ppm" integer NOT NULL,
	"compound" boolean DEFAULT false NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"applies_to_shipping" boolean DEFAULT false NOT NULL,
	"effective_from" date,
	"effective_to" date,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_rates_rate_valid" CHECK ("tax_rates"."rate_ppm" between 0 and 10000000),
	CONSTRAINT "tax_rates_priority_valid" CHECK ("tax_rates"."priority" between -100000 and 100000),
	CONSTRAINT "tax_rates_effective_window_valid" CHECK ("tax_rates"."effective_from" is null or "tax_rates"."effective_to" is null or "tax_rates"."effective_to" >= "tax_rates"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "tax_registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"zone_id" uuid NOT NULL,
	"number" text,
	"scheme" text DEFAULT 'standard' NOT NULL,
	"collects_from" date,
	"threshold_minor" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'monitoring' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_registrations_threshold_valid" CHECK ("tax_registrations"."threshold_minor" >= 0),
	CONSTRAINT "tax_registrations_status_valid" CHECK ("tax_registrations"."status" in ('monitoring','active','paused','closed'))
);
--> statement-breakpoint
CREATE TABLE "tax_zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"template_key" text,
	"template_version" integer,
	"country" text NOT NULL,
	"regions" text[] DEFAULT '{}' NOT NULL,
	"postal_patterns" text[] DEFAULT '{}' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"basis" text DEFAULT 'destination' NOT NULL,
	"prices_include_tax" boolean DEFAULT false NOT NULL,
	"rounding_scope" text DEFAULT 'line' NOT NULL,
	"rounding_mode" text DEFAULT 'half_up' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_zones_country_valid" CHECK ("tax_zones"."country" ~ '^[A-Z]{2}$'),
	CONSTRAINT "tax_zones_priority_valid" CHECK ("tax_zones"."priority" between -100000 and 100000),
	CONSTRAINT "tax_zones_basis_valid" CHECK ("tax_zones"."basis" in ('origin','destination')),
	CONSTRAINT "tax_zones_rounding_scope_valid" CHECK ("tax_zones"."rounding_scope" in ('line','invoice')),
	CONSTRAINT "tax_zones_rounding_mode_valid" CHECK ("tax_zones"."rounding_mode" in ('half_up','bankers')),
	CONSTRAINT "tax_zones_template_pair" CHECK (("tax_zones"."template_key" is null and "tax_zones"."template_version" is null) or ("tax_zones"."template_key" is not null and "tax_zones"."template_version" > 0))
);
--> statement-breakpoint
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_credit_note_id_credit_notes_id_fk" FOREIGN KEY ("credit_note_id") REFERENCES "public"."credit_notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_invoice_line_id_invoice_lines_id_fk" FOREIGN KEY ("invoice_line_id") REFERENCES "public"."invoice_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_deposit_of_fk" FOREIGN KEY ("deposit_of_invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_exemptions" ADD CONSTRAINT "tax_exemptions_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_exemptions" ADD CONSTRAINT "tax_exemptions_zone_id_tax_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."tax_zones"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_lines" ADD CONSTRAINT "tax_lines_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_lines" ADD CONSTRAINT "tax_lines_invoice_line_id_invoice_lines_id_fk" FOREIGN KEY ("invoice_line_id") REFERENCES "public"."invoice_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_rates" ADD CONSTRAINT "tax_rates_zone_id_tax_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."tax_zones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_rates" ADD CONSTRAINT "tax_rates_category_id_tax_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."tax_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_registrations" ADD CONSTRAINT "tax_registrations_zone_id_tax_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."tax_zones"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "credit_note_lines_position_idx" ON "credit_note_lines" USING btree ("credit_note_id","position");--> statement-breakpoint
CREATE INDEX "credit_note_lines_invoice_line_idx" ON "credit_note_lines" USING btree ("invoice_line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_notes_number_idx" ON "credit_notes" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_notes_idempotency_idx" ON "credit_notes" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "credit_notes_invoice_idx" ON "credit_notes" USING btree ("invoice_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_lines_position_idx" ON "invoice_lines" USING btree ("invoice_id","position");--> statement-breakpoint
CREATE INDEX "invoice_lines_source_idx" ON "invoice_lines" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_number_idx" ON "invoices" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_source_idx" ON "invoices" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_idempotency_idx" ON "invoices" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "invoices_contact_idx" ON "invoices" USING btree ("contact_id","created_at");--> statement-breakpoint
CREATE INDEX "invoices_status_due_idx" ON "invoices" USING btree ("status","due_at");--> statement-breakpoint
CREATE INDEX "invoices_deposit_of_idx" ON "invoices" USING btree ("deposit_of_invoice_id");--> statement-breakpoint
CREATE INDEX "money_state_events_subject_idx" ON "money_state_events" USING btree ("subject_type","subject_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_idempotency_idx" ON "payments" USING btree ("provider","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_ref_idx" ON "payments" USING btree ("provider","provider_ref");--> statement-breakpoint
CREATE INDEX "payments_invoice_idx" ON "payments" USING btree ("invoice_id","created_at");--> statement-breakpoint
CREATE INDEX "payments_status_idx" ON "payments" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "refunds_idempotency_idx" ON "refunds" USING btree ("provider","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "refunds_provider_ref_idx" ON "refunds" USING btree ("provider","provider_ref");--> statement-breakpoint
CREATE INDEX "refunds_payment_idx" ON "refunds" USING btree ("payment_id","created_at");--> statement-breakpoint
CREATE INDEX "refunds_invoice_idx" ON "refunds" USING btree ("invoice_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_categories_code_idx" ON "tax_categories" USING btree ("code");--> statement-breakpoint
CREATE INDEX "tax_exemptions_contact_idx" ON "tax_exemptions" USING btree ("contact_id","status");--> statement-breakpoint
CREATE INDEX "tax_exemptions_zone_idx" ON "tax_exemptions" USING btree ("zone_id","status");--> statement-breakpoint
CREATE INDEX "tax_lines_invoice_idx" ON "tax_lines" USING btree ("invoice_id","priority");--> statement-breakpoint
CREATE INDEX "tax_lines_invoice_line_idx" ON "tax_lines" USING btree ("invoice_line_id");--> statement-breakpoint
CREATE INDEX "tax_rates_zone_idx" ON "tax_rates" USING btree ("zone_id","active","priority");--> statement-breakpoint
CREATE INDEX "tax_rates_category_idx" ON "tax_rates" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "tax_registrations_zone_idx" ON "tax_registrations" USING btree ("zone_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_zones_template_idx" ON "tax_zones" USING btree ("template_key");--> statement-breakpoint
CREATE INDEX "tax_zones_match_idx" ON "tax_zones" USING btree ("country","active","priority");