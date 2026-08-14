CREATE TABLE "customer_balance_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"currency" text NOT NULL,
	"balance_minor" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_balance_accounts_currency_valid" CHECK ("customer_balance_accounts"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "customer_balance_accounts_nonnegative" CHECK ("customer_balance_accounts"."balance_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "customer_balance_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"delta_minor" bigint NOT NULL,
	"balance_after_minor" bigint DEFAULT 0 NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"reason" text NOT NULL,
	"actor" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_balance_entries_delta_nonzero" CHECK ("customer_balance_entries"."delta_minor" <> 0),
	CONSTRAINT "customer_balance_entries_request_hash_valid" CHECK (length("customer_balance_entries"."request_hash") = 64)
);
--> statement-breakpoint
CREATE TABLE "flexible_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"attached_invoice_id" uuid,
	"kind" text NOT NULL,
	"context" text NOT NULL,
	"chosen_minor" bigint DEFAULT 0 NOT NULL,
	"minimum_minor" bigint DEFAULT 0 NOT NULL,
	"maximum_minor" bigint,
	"message" text,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "flexible_payments_kind_valid" CHECK ("flexible_payments"."kind" in ('tip','pay_what_you_want')),
	CONSTRAINT "flexible_payments_context_valid" CHECK ("flexible_payments"."context" in ('checkout','invoice','gallery','booking','store','other')),
	CONSTRAINT "flexible_payments_chosen_positive" CHECK ("flexible_payments"."chosen_minor" > 0),
	CONSTRAINT "flexible_payments_minimum_valid" CHECK ("flexible_payments"."minimum_minor" >= 0 and "flexible_payments"."chosen_minor" >= "flexible_payments"."minimum_minor"),
	CONSTRAINT "flexible_payments_maximum_valid" CHECK ("flexible_payments"."maximum_minor" is null or ("flexible_payments"."maximum_minor" >= "flexible_payments"."minimum_minor" and "flexible_payments"."chosen_minor" <= "flexible_payments"."maximum_minor")),
	CONSTRAINT "flexible_payments_request_hash_valid" CHECK (length("flexible_payments"."request_hash") = 64)
);
--> statement-breakpoint
CREATE TABLE "late_fee_assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_invoice_id" uuid NOT NULL,
	"fee_invoice_id" uuid NOT NULL,
	"basis" text NOT NULL,
	"outstanding_minor" bigint DEFAULT 0 NOT NULL,
	"fixed_minor" bigint,
	"rate_ppm" integer,
	"cap_minor" bigint,
	"grace_days" integer DEFAULT 0 NOT NULL,
	"assessed_minor" bigint DEFAULT 0 NOT NULL,
	"assessed_at" timestamp with time zone NOT NULL,
	"reason" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "late_fee_assessments_basis_valid" CHECK ("late_fee_assessments"."basis" in ('fixed','percentage')),
	CONSTRAINT "late_fee_assessments_outstanding_positive" CHECK ("late_fee_assessments"."outstanding_minor" > 0),
	CONSTRAINT "late_fee_assessments_value_valid" CHECK (("late_fee_assessments"."basis" = 'fixed' and "late_fee_assessments"."fixed_minor" > 0 and "late_fee_assessments"."rate_ppm" is null) or ("late_fee_assessments"."basis" = 'percentage' and "late_fee_assessments"."fixed_minor" is null and "late_fee_assessments"."rate_ppm" between 1 and 10000000)),
	CONSTRAINT "late_fee_assessments_cap_valid" CHECK ("late_fee_assessments"."cap_minor" is null or "late_fee_assessments"."cap_minor" > 0),
	CONSTRAINT "late_fee_assessments_grace_valid" CHECK ("late_fee_assessments"."grace_days" between 0 and 3650),
	CONSTRAINT "late_fee_assessments_amount_positive" CHECK ("late_fee_assessments"."assessed_minor" > 0),
	CONSTRAINT "late_fee_assessments_request_hash_valid" CHECK (length("late_fee_assessments"."request_hash") = 64)
);
--> statement-breakpoint
CREATE TABLE "payment_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"installment_id" uuid NOT NULL,
	"amount_minor" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_allocations_amount_positive" CHECK ("payment_allocations"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "payment_plan_installments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"amount_minor" bigint DEFAULT 0 NOT NULL,
	"paid_minor" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_plan_installments_position_valid" CHECK ("payment_plan_installments"."position" >= 0),
	CONSTRAINT "payment_plan_installments_amount_positive" CHECK ("payment_plan_installments"."amount_minor" > 0),
	CONSTRAINT "payment_plan_installments_paid_bounded" CHECK ("payment_plan_installments"."paid_minor" between 0 and "payment_plan_installments"."amount_minor"),
	CONSTRAINT "payment_plan_installments_status_valid" CHECK ("payment_plan_installments"."status" in ('scheduled','due','partially_paid','paid','waived','defaulted')),
	CONSTRAINT "payment_plan_installments_paid_consistent" CHECK ("payment_plan_installments"."status" <> 'paid' or "payment_plan_installments"."paid_minor" = "payment_plan_installments"."amount_minor")
);
--> statement-breakpoint
CREATE TABLE "payment_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"currency" text NOT NULL,
	"principal_minor" bigint DEFAULT 0 NOT NULL,
	"paid_minor" bigint DEFAULT 0 NOT NULL,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_plans_request_hash_valid" CHECK (length("payment_plans"."request_hash") = 64),
	CONSTRAINT "payment_plans_currency_valid" CHECK ("payment_plans"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "payment_plans_principal_positive" CHECK ("payment_plans"."principal_minor" > 0),
	CONSTRAINT "payment_plans_paid_bounded" CHECK ("payment_plans"."paid_minor" between 0 and "payment_plans"."principal_minor"),
	CONSTRAINT "payment_plans_status_valid" CHECK ("payment_plans"."status" in ('active','completed','defaulted','cancelled')),
	CONSTRAINT "payment_plans_complete_consistent" CHECK ("payment_plans"."status" <> 'completed' or "payment_plans"."paid_minor" = "payment_plans"."principal_minor"),
	CONSTRAINT "payment_plans_cancelled_consistent" CHECK ("payment_plans"."status" <> 'cancelled' or "payment_plans"."cancelled_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "provider_balance_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"provider_ref" text NOT NULL,
	"kind" text NOT NULL,
	"source_type" text,
	"source_id" uuid,
	"currency" text NOT NULL,
	"gross_minor" bigint NOT NULL,
	"fee_minor" bigint DEFAULT 0 NOT NULL,
	"net_minor" bigint NOT NULL,
	"available_at" timestamp with time zone,
	"occurred_at" timestamp with time zone NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"request_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_balance_transactions_kind_valid" CHECK ("provider_balance_transactions"."kind" in ('charge','refund','dispute','fee','adjustment','reserve','release')),
	CONSTRAINT "provider_balance_transactions_currency_valid" CHECK ("provider_balance_transactions"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "provider_balance_transactions_net_consistent" CHECK ("provider_balance_transactions"."net_minor" = "provider_balance_transactions"."gross_minor" - "provider_balance_transactions"."fee_minor"),
	CONSTRAINT "provider_balance_transactions_nonzero" CHECK ("provider_balance_transactions"."gross_minor" <> 0 or "provider_balance_transactions"."fee_minor" <> 0),
	CONSTRAINT "provider_balance_transactions_metadata_object" CHECK (jsonb_typeof("provider_balance_transactions"."metadata") = 'object'),
	CONSTRAINT "provider_balance_transactions_request_hash_valid" CHECK (length("provider_balance_transactions"."request_hash") = 64)
);
--> statement-breakpoint
CREATE TABLE "provider_payout_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payout_id" uuid NOT NULL,
	"balance_transaction_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"provider_ref" text NOT NULL,
	"status" text NOT NULL,
	"currency" text NOT NULL,
	"amount_minor" bigint DEFAULT 0 NOT NULL,
	"statement_ref" text,
	"failure_reason" text,
	"expected_at" timestamp with time zone,
	"provider_status_at" timestamp with time zone NOT NULL,
	"paid_at" timestamp with time zone,
	"reconciled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_payouts_status_valid" CHECK ("provider_payouts"."status" in ('pending','in_transit','paid','failed','cancelled')),
	CONSTRAINT "provider_payouts_currency_valid" CHECK ("provider_payouts"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "provider_payouts_amount_positive" CHECK ("provider_payouts"."amount_minor" > 0),
	CONSTRAINT "provider_payouts_paid_consistent" CHECK ("provider_payouts"."status" <> 'paid' or "provider_payouts"."paid_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "money_state_events" DROP CONSTRAINT "money_state_events_subject_valid";--> statement-breakpoint
ALTER TABLE "customer_balance_accounts" ADD CONSTRAINT "customer_balance_accounts_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_balance_entries" ADD CONSTRAINT "customer_balance_entries_account_id_customer_balance_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."customer_balance_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flexible_payments" ADD CONSTRAINT "flexible_payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flexible_payments" ADD CONSTRAINT "flexible_payments_attached_invoice_id_invoices_id_fk" FOREIGN KEY ("attached_invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "late_fee_assessments" ADD CONSTRAINT "late_fee_assessments_source_invoice_id_invoices_id_fk" FOREIGN KEY ("source_invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "late_fee_assessments" ADD CONSTRAINT "late_fee_assessments_fee_invoice_id_invoices_id_fk" FOREIGN KEY ("fee_invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_installment_id_payment_plan_installments_id_fk" FOREIGN KEY ("installment_id") REFERENCES "public"."payment_plan_installments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_plan_installments" ADD CONSTRAINT "payment_plan_installments_plan_id_payment_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."payment_plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_plans" ADD CONSTRAINT "payment_plans_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_payout_items" ADD CONSTRAINT "provider_payout_items_payout_id_provider_payouts_id_fk" FOREIGN KEY ("payout_id") REFERENCES "public"."provider_payouts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_payout_items" ADD CONSTRAINT "provider_payout_items_balance_transaction_id_provider_balance_transactions_id_fk" FOREIGN KEY ("balance_transaction_id") REFERENCES "public"."provider_balance_transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_balance_accounts_contact_currency_idx" ON "customer_balance_accounts" USING btree ("contact_id","currency");--> statement-breakpoint
CREATE INDEX "customer_balance_accounts_contact_idx" ON "customer_balance_accounts" USING btree ("contact_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_balance_entries_idempotency_idx" ON "customer_balance_entries" USING btree ("account_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "customer_balance_entries_account_idx" ON "customer_balance_entries" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "customer_balance_entries_source_idx" ON "customer_balance_entries" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "flexible_payments_invoice_idx" ON "flexible_payments" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "flexible_payments_idempotency_idx" ON "flexible_payments" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "flexible_payments_attached_idx" ON "flexible_payments" USING btree ("attached_invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "late_fee_assessments_fee_invoice_idx" ON "late_fee_assessments" USING btree ("fee_invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "late_fee_assessments_idempotency_idx" ON "late_fee_assessments" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "late_fee_assessments_source_idx" ON "late_fee_assessments" USING btree ("source_invoice_id","assessed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_allocations_payment_installment_idx" ON "payment_allocations" USING btree ("payment_id","installment_id");--> statement-breakpoint
CREATE INDEX "payment_allocations_installment_idx" ON "payment_allocations" USING btree ("installment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_plan_installments_position_idx" ON "payment_plan_installments" USING btree ("plan_id","position");--> statement-breakpoint
CREATE INDEX "payment_plan_installments_due_idx" ON "payment_plan_installments" USING btree ("status","due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_plans_invoice_idx" ON "payment_plans" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_plans_idempotency_idx" ON "payment_plans" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "payment_plans_status_idx" ON "payment_plans" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_balance_transactions_ref_idx" ON "provider_balance_transactions" USING btree ("provider","provider_ref");--> statement-breakpoint
CREATE INDEX "provider_balance_transactions_source_idx" ON "provider_balance_transactions" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE INDEX "provider_balance_transactions_available_idx" ON "provider_balance_transactions" USING btree ("provider","currency","available_at");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_payout_items_transaction_idx" ON "provider_payout_items" USING btree ("balance_transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_payout_items_pair_idx" ON "provider_payout_items" USING btree ("payout_id","balance_transaction_id");--> statement-breakpoint
CREATE INDEX "provider_payout_items_payout_idx" ON "provider_payout_items" USING btree ("payout_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_payouts_ref_idx" ON "provider_payouts" USING btree ("provider","provider_ref");--> statement-breakpoint
CREATE INDEX "provider_payouts_status_idx" ON "provider_payouts" USING btree ("status","expected_at");--> statement-breakpoint
ALTER TABLE "money_state_events" ADD CONSTRAINT "money_state_events_subject_valid" CHECK ("money_state_events"."subject_type" in ('invoice','payment','refund','credit_note','dispute','payment_plan','payout'));