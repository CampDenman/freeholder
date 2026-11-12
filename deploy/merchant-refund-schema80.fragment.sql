-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C12.38: unpublished owned original refund models, generated without database access.
-- Guard and assembly qualification required before use.
CREATE TABLE "merchant_cash_return_inspection_finishes" (
	"inspection_id" uuid PRIMARY KEY NOT NULL,
	"caller_instance_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchant_cash_return_inspection_finishes_outcome" CHECK ("merchant_cash_return_inspection_finishes"."outcome" in ('returned','threw'))
);

--> statement-breakpoint
CREATE TABLE "merchant_cash_return_inspections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid,
	"subscription_charge_receipt_id" uuid,
	"original_observation_id" uuid,
	"subscription_charge_observation_id" uuid,
	"provider_platform_account_id" text NOT NULL,
	"charge_account_id" text,
	"provider_api_version" text NOT NULL,
	"original_payment_ref" text NOT NULL,
	"original_cash_amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"source_history_digest" text NOT NULL,
	"caller" jsonb NOT NULL,
	"completion_nonce_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchant_cash_return_inspections_source" CHECK ((("merchant_cash_return_inspections"."payment_id" is not null and "merchant_cash_return_inspections"."original_observation_id" is not null and "merchant_cash_return_inspections"."subscription_charge_receipt_id" is null and "merchant_cash_return_inspections"."subscription_charge_observation_id" is null) or ("merchant_cash_return_inspections"."payment_id" is null and "merchant_cash_return_inspections"."original_observation_id" is null and "merchant_cash_return_inspections"."subscription_charge_receipt_id" is not null and "merchant_cash_return_inspections"."subscription_charge_observation_id" is not null)) is true),
	CONSTRAINT "merchant_cash_return_inspections_digest" CHECK ("merchant_cash_return_inspections"."source_history_digest" ~ '^[a-f0-9]{64}$')
);

--> statement-breakpoint
CREATE TABLE "merchant_cash_return_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inspection_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"evidence" jsonb NOT NULL,
	"evidence_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchant_cash_return_observations_sequence" CHECK ("merchant_cash_return_observations"."sequence" > 0),
	CONSTRAINT "merchant_cash_return_observations_evidence" CHECK (jsonb_typeof("merchant_cash_return_observations"."evidence")='object' and "merchant_cash_return_observations"."evidence_digest" ~ '^[a-f0-9]{64}$')
);

--> statement-breakpoint
CREATE TABLE "merchant_cash_return_primary_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inspection_id" uuid NOT NULL,
	"evidence" jsonb NOT NULL,
	"evidence_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchant_cash_return_primary_observations_evidence" CHECK (jsonb_typeof("merchant_cash_return_primary_observations"."evidence")='object' and "merchant_cash_return_primary_observations"."evidence_digest" ~ '^[a-f0-9]{64}$')
);

--> statement-breakpoint
CREATE TABLE "merchant_refund_creation_refusals" (
	"dispatch_id" uuid PRIMARY KEY NOT NULL,
	"provider_code" text NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
CREATE TABLE "merchant_refund_dispatch_finishes" (
	"dispatch_id" uuid PRIMARY KEY NOT NULL,
	"caller_instance_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	"provider_ref" text,
	"finished_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchant_refund_dispatch_finishes_outcome" CHECK ("merchant_refund_dispatch_finishes"."outcome" in ('returned','threw'))
);

--> statement-breakpoint
CREATE TABLE "merchant_refund_dispatch_stops" (
	"dispatch_id" uuid PRIMARY KEY NOT NULL,
	"caller_instance_id" uuid NOT NULL,
	"request_digest" text NOT NULL,
	"mechanical_check" text NOT NULL,
	"evidence_digest" text NOT NULL,
	"reviewed_by" text NOT NULL,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
CREATE TABLE "merchant_refund_dispatches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"request_digest" text NOT NULL,
	"caller" jsonb NOT NULL,
	"completion_nonce_hash" text NOT NULL,
	"dispatched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchant_refund_dispatches_ordinal" CHECK ("merchant_refund_dispatches"."ordinal">0),
	CONSTRAINT "merchant_refund_dispatches_digest" CHECK ("merchant_refund_dispatches"."request_digest" ~ '^[a-f0-9]{64}$')
);

--> statement-breakpoint
CREATE TABLE "merchant_refund_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid,
	"payment_id" uuid,
	"subscription_charge_receipt_id" uuid,
	"inspection_id" uuid,
	"claimed_inspection_id" uuid,
	"claimed_request_id" uuid,
	"provider_platform_account_id" text NOT NULL,
	"charge_account_id" text,
	"provider_api_version" text NOT NULL,
	"provider_ref" text NOT NULL,
	"payment_provider_ref" text,
	"provider_charge_ref" text,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"status" text,
	"failure_code" text,
	"failure_reason" text,
	"failure_balance_transaction_ref" text,
	"transfer_reversal_ref" text,
	"source_transfer_reversal_ref" text,
	"binding_verified" boolean NOT NULL,
	"evidence_digest" text NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchant_refund_observations_source" CHECK ((("merchant_refund_observations"."payment_id" is not null and "merchant_refund_observations"."subscription_charge_receipt_id" is null) or ("merchant_refund_observations"."payment_id" is null and "merchant_refund_observations"."subscription_charge_receipt_id" is not null)) is true),
	CONSTRAINT "merchant_refund_observations_money" CHECK ("merchant_refund_observations"."amount_minor" between 1 and 9007199254740991 and "merchant_refund_observations"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "merchant_refund_observations_status" CHECK ("merchant_refund_observations"."status" is null or "merchant_refund_observations"."status" in ('pending','requires_action','succeeded','failed','canceled')),
	CONSTRAINT "merchant_refund_observations_scope" CHECK ("merchant_refund_observations"."provider_platform_account_id" ~ '^acct_[A-Za-z0-9]+$' and ("merchant_refund_observations"."charge_account_id" is null or "merchant_refund_observations"."charge_account_id" ~ '^acct_[A-Za-z0-9]+$') and "merchant_refund_observations"."provider_api_version" in ('2026-02-25.clover','2026-10-28.endive')),
	CONSTRAINT "merchant_refund_observations_refs" CHECK ("merchant_refund_observations"."provider_ref" ~ '^re_[A-Za-z0-9_]+$' and ("merchant_refund_observations"."payment_provider_ref" is null or "merchant_refund_observations"."payment_provider_ref" ~ '^pi_[A-Za-z0-9_]+$') and "merchant_refund_observations"."evidence_digest" ~ '^[a-f0-9]{64}$')
);

--> statement-breakpoint
CREATE TABLE "merchant_refund_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purpose" text NOT NULL,
	"refund_id" uuid,
	"payment_id" uuid,
	"subscription_charge_receipt_id" uuid,
	"original_observation_id" uuid,
	"subscription_charge_observation_id" uuid,
	"provider_platform_account_id" text NOT NULL,
	"charge_account_id" text,
	"provider_api_version" text NOT NULL,
	"original_payment_ref" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"reason_digest" text NOT NULL,
	"original_request" jsonb NOT NULL,
	"original_cash_amount_minor" bigint NOT NULL,
	"request_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchant_refund_requests_source" CHECK ((("merchant_refund_requests"."payment_id" is not null and "merchant_refund_requests"."original_observation_id" is not null and "merchant_refund_requests"."subscription_charge_receipt_id" is null and "merchant_refund_requests"."subscription_charge_observation_id" is null) or ("merchant_refund_requests"."payment_id" is null and "merchant_refund_requests"."original_observation_id" is null and "merchant_refund_requests"."subscription_charge_receipt_id" is not null and "merchant_refund_requests"."subscription_charge_observation_id" is not null)) is true),
	CONSTRAINT "merchant_refund_requests_purpose" CHECK ((("merchant_refund_requests"."purpose"='invoice_refund' and "merchant_refund_requests"."refund_id" is not null and "merchant_refund_requests"."payment_id" is not null) or ("merchant_refund_requests"."purpose"='unapplied_return' and "merchant_refund_requests"."refund_id" is null)) is true),
	CONSTRAINT "merchant_refund_requests_amount" CHECK ("merchant_refund_requests"."original_cash_amount_minor" between 1 and 9007199254740991 and "merchant_refund_requests"."amount_minor" between 1 and "merchant_refund_requests"."original_cash_amount_minor" and "merchant_refund_requests"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "merchant_refund_requests_scope" CHECK ("merchant_refund_requests"."provider_platform_account_id" ~ '^acct_[A-Za-z0-9]+$' and ("merchant_refund_requests"."charge_account_id" is null or ("merchant_refund_requests"."charge_account_id" ~ '^acct_[A-Za-z0-9]+$' and "merchant_refund_requests"."charge_account_id"<>"merchant_refund_requests"."provider_platform_account_id")) and "merchant_refund_requests"."provider_api_version" in ('2026-02-25.clover','2026-10-28.endive')),
	CONSTRAINT "merchant_refund_requests_original" CHECK ("merchant_refund_requests"."original_payment_ref" ~ '^pi_[A-Za-z0-9_]+$' and "merchant_refund_requests"."request_digest" ~ '^[a-f0-9]{64}$' and jsonb_typeof("merchant_refund_requests"."original_request")='object')
);

--> statement-breakpoint
CREATE TABLE "merchant_refund_reservation_retirements" (
	"request_id" uuid PRIMARY KEY NOT NULL,
	"request_digest" text NOT NULL,
	"reason" text NOT NULL,
	"initiated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchant_refund_reservation_retirements_reason" CHECK ("merchant_refund_reservation_retirements"."reason"='cancelled_before_dispatch' and "merchant_refund_reservation_retirements"."request_digest" ~ '^[a-f0-9]{64}$')
);

--> statement-breakpoint
CREATE TABLE "merchant_refund_resource_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"dispatch_id" uuid NOT NULL,
	"provider_ref" text NOT NULL,
	"origin" text NOT NULL,
	"evidence_digest" text NOT NULL,
	"reviewed_by" text,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchant_refund_resource_bindings_ref" CHECK ("merchant_refund_resource_bindings"."provider_ref" ~ '^re_[A-Za-z0-9_]+$')
);

--> statement-breakpoint
CREATE TABLE "merchant_refund_terminal_receipts" (
	"request_id" uuid PRIMARY KEY NOT NULL,
	"observation_id" uuid NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
CREATE TABLE "merchant_unapplied_charge_resolution_refunds" (
	"resolution_id" uuid NOT NULL,
	"observation_id" uuid NOT NULL,
	CONSTRAINT "merchant_unapplied_charge_resolution_refunds_resolution_id_observation_id_pk" PRIMARY KEY("resolution_id","observation_id")
);

--> statement-breakpoint
CREATE TABLE "merchant_unapplied_charge_resolutions" (
	"inspection_id" uuid NOT NULL,
	"return_observation_id" uuid NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid,
	"subscription_charge_receipt_id" uuid,
	"original_observation_id" uuid,
	"subscription_charge_observation_id" uuid,
	"provider_platform_account_id" text NOT NULL,
	"charge_account_id" text,
	"original_payment_ref" text NOT NULL,
	"original_cash_amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"own_evidence_digest" text NOT NULL,
	"disposition" text NOT NULL,
	"evidence_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchant_unapplied_charge_resolutions_source" CHECK ((("merchant_unapplied_charge_resolutions"."payment_id" is not null and "merchant_unapplied_charge_resolutions"."original_observation_id" is not null and "merchant_unapplied_charge_resolutions"."subscription_charge_receipt_id" is null and "merchant_unapplied_charge_resolutions"."subscription_charge_observation_id" is null) or ("merchant_unapplied_charge_resolutions"."payment_id" is null and "merchant_unapplied_charge_resolutions"."original_observation_id" is null and "merchant_unapplied_charge_resolutions"."subscription_charge_receipt_id" is not null and "merchant_unapplied_charge_resolutions"."subscription_charge_observation_id" is not null)) is true),
	CONSTRAINT "merchant_unapplied_charge_resolutions_money" CHECK ("merchant_unapplied_charge_resolutions"."original_cash_amount_minor" between 1 and 9007199254740991 and "merchant_unapplied_charge_resolutions"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "merchant_unapplied_charge_resolutions_kind" CHECK ("merchant_unapplied_charge_resolutions"."disposition"='returned_to_original_payer' and "merchant_unapplied_charge_resolutions"."evidence_digest" ~ '^[a-f0-9]{64}$')
);

--> statement-breakpoint
ALTER TABLE "merchant_cash_return_inspection_finishes" ADD CONSTRAINT "merchant_cash_return_inspection_finishes_inspection_id_merchant_cash_return_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."merchant_cash_return_inspections"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "merchant_cash_return_inspections" ADD CONSTRAINT "merchant_cash_return_inspections_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "merchant_cash_return_inspections" ADD CONSTRAINT "merchant_cash_return_inspections_subscription_charge_receipt_id_subscription_provider_charge_receipts_id_fk" FOREIGN KEY ("subscription_charge_receipt_id") REFERENCES "public"."subscription_provider_charge_receipts"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "merchant_cash_return_inspections" ADD CONSTRAINT "merchant_cash_return_inspections_original_observation_id_merchant_payment_observations_id_fk" FOREIGN KEY ("original_observation_id") REFERENCES "public"."merchant_payment_observations"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "merchant_cash_return_inspections" ADD CONSTRAINT "merchant_cash_return_inspections_subscription_charge_observation_id_subscription_provider_charge_observations_id_fk" FOREIGN KEY ("subscription_charge_observation_id") REFERENCES "public"."subscription_provider_charge_observations"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "merchant_cash_return_observations" ADD CONSTRAINT "merchant_cash_return_observations_inspection_id_merchant_cash_return_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."merchant_cash_return_inspections"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "merchant_cash_return_primary_observations" ADD CONSTRAINT "merchant_cash_return_primary_observations_inspection_id_merchant_cash_return_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."merchant_cash_return_inspections"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "merchant_refund_creation_refusals" ADD CONSTRAINT "merchant_refund_creation_refusals_dispatch_id_merchant_refund_dispatches_id_fk" FOREIGN KEY ("dispatch_id") REFERENCES "public"."merchant_refund_dispatches"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "merchant_refund_dispatch_finishes" ADD CONSTRAINT "merchant_refund_dispatch_finishes_dispatch_id_merchant_refund_dispatches_id_fk" FOREIGN KEY ("dispatch_id") REFERENCES "public"."merchant_refund_dispatches"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "merchant_refund_dispatch_stops" ADD CONSTRAINT "merchant_refund_dispatch_stops_dispatch_id_merchant_refund_dispatches_id_fk" FOREIGN KEY ("dispatch_id") REFERENCES "public"."merchant_refund_dispatches"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "merchant_refund_dispatches" ADD CONSTRAINT "merchant_refund_dispatches_request_id_merchant_refund_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."merchant_refund_requests"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "merchant_refund_observations" ADD CONSTRAINT "merchant_refund_observations_request_id_merchant_refund_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."merchant_refund_requests"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "merchant_refund_observations" ADD CONSTRAINT "merchant_refund_observations_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "merchant_refund_observations" ADD CONSTRAINT "merchant_refund_observations_subscription_charge_receipt_id_subscription_provider_charge_receipts_id_fk" FOREIGN KEY ("subscription_charge_receipt_id") REFERENCES "public"."subscription_provider_charge_receipts"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "merchant_refund_observations" ADD CONSTRAINT "merchant_refund_observations_inspection_id_merchant_cash_return_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."merchant_cash_return_inspections"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "merchant_refund_requests" ADD CONSTRAINT "merchant_refund_requests_refund_id_refunds_id_fk" FOREIGN KEY ("refund_id") REFERENCES "public"."refunds"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "merchant_refund_requests" ADD CONSTRAINT "merchant_refund_requests_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "merchant_refund_requests" ADD CONSTRAINT "merchant_refund_requests_subscription_charge_receipt_id_subscription_provider_charge_receipts_id_fk" FOREIGN KEY ("subscription_charge_receipt_id") REFERENCES "public"."subscription_provider_charge_receipts"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "merchant_refund_requests" ADD CONSTRAINT "merchant_refund_requests_original_observation_id_merchant_payment_observations_id_fk" FOREIGN KEY ("original_observation_id") REFERENCES "public"."merchant_payment_observations"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "merchant_refund_requests" ADD CONSTRAINT "merchant_refund_requests_subscription_charge_observation_id_subscription_provider_charge_observations_id_fk" FOREIGN KEY ("subscription_charge_observation_id") REFERENCES "public"."subscription_provider_charge_observations"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "merchant_refund_reservation_retirements" ADD CONSTRAINT "merchant_refund_reservation_retirements_request_id_merchant_refund_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."merchant_refund_requests"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "merchant_refund_resource_bindings" ADD CONSTRAINT "merchant_refund_resource_bindings_request_id_merchant_refund_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."merchant_refund_requests"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "merchant_refund_resource_bindings" ADD CONSTRAINT "merchant_refund_resource_bindings_dispatch_id_merchant_refund_dispatches_id_fk" FOREIGN KEY ("dispatch_id") REFERENCES "public"."merchant_refund_dispatches"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "merchant_refund_terminal_receipts" ADD CONSTRAINT "merchant_refund_terminal_receipts_request_id_merchant_refund_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."merchant_refund_requests"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "merchant_refund_terminal_receipts" ADD CONSTRAINT "merchant_refund_terminal_receipts_observation_id_merchant_refund_observations_id_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."merchant_refund_observations"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "merchant_unapplied_charge_resolution_refunds" ADD CONSTRAINT "merchant_unapplied_charge_resolution_refunds_resolution_id_merchant_unapplied_charge_resolutions_id_fk" FOREIGN KEY ("resolution_id") REFERENCES "public"."merchant_unapplied_charge_resolutions"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "merchant_unapplied_charge_resolution_refunds" ADD CONSTRAINT "merchant_unapplied_charge_resolution_refunds_observation_id_merchant_refund_observations_id_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."merchant_refund_observations"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "merchant_unapplied_charge_resolutions" ADD CONSTRAINT "merchant_unapplied_charge_resolutions_inspection_id_merchant_cash_return_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."merchant_cash_return_inspections"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "merchant_unapplied_charge_resolutions" ADD CONSTRAINT "merchant_unapplied_charge_resolutions_return_observation_id_merchant_cash_return_observations_id_fk" FOREIGN KEY ("return_observation_id") REFERENCES "public"."merchant_cash_return_observations"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "merchant_unapplied_charge_resolutions" ADD CONSTRAINT "merchant_unapplied_charge_resolutions_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "merchant_unapplied_charge_resolutions" ADD CONSTRAINT "merchant_unapplied_charge_resolutions_subscription_charge_receipt_id_subscription_provider_charge_receipts_id_fk" FOREIGN KEY ("subscription_charge_receipt_id") REFERENCES "public"."subscription_provider_charge_receipts"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "merchant_unapplied_charge_resolutions" ADD CONSTRAINT "merchant_unapplied_charge_resolutions_original_observation_id_merchant_payment_observations_id_fk" FOREIGN KEY ("original_observation_id") REFERENCES "public"."merchant_payment_observations"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "merchant_unapplied_charge_resolutions" ADD CONSTRAINT "merchant_unapplied_charge_resolutions_subscription_charge_observation_id_subscription_provider_charge_observations_id_fk" FOREIGN KEY ("subscription_charge_observation_id") REFERENCES "public"."subscription_provider_charge_observations"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_cash_return_observations_fact_idx" ON "merchant_cash_return_observations" USING btree ("inspection_id","evidence_digest");
--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_cash_return_observations_sequence_idx" ON "merchant_cash_return_observations" USING btree ("inspection_id","sequence");
--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_cash_return_primary_observations_fact_idx" ON "merchant_cash_return_primary_observations" USING btree ("inspection_id","evidence_digest");
--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_refund_dispatches_ordinal_idx" ON "merchant_refund_dispatches" USING btree ("request_id","ordinal");
--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_refund_observations_fact_idx" ON "merchant_refund_observations" USING btree ("evidence_digest");
--> statement-breakpoint
CREATE INDEX "merchant_refund_observations_payment_idx" ON "merchant_refund_observations" USING btree ("payment_id");
--> statement-breakpoint
CREATE INDEX "merchant_refund_observations_subscription_idx" ON "merchant_refund_observations" USING btree ("subscription_charge_receipt_id");
--> statement-breakpoint
CREATE INDEX "merchant_refund_observations_request_idx" ON "merchant_refund_observations" USING btree ("request_id");
--> statement-breakpoint
CREATE INDEX "merchant_refund_observations_original_idx" ON "merchant_refund_observations" USING btree ("provider_platform_account_id","charge_account_id","provider_ref");
--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_refund_requests_logical_idx" ON "merchant_refund_requests" USING btree ("refund_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_refund_requests_key_idx" ON "merchant_refund_requests" USING btree ("provider_platform_account_id",coalesce("charge_account_id",''),"idempotency_key");
--> statement-breakpoint
CREATE INDEX "merchant_refund_requests_payment_idx" ON "merchant_refund_requests" USING btree ("payment_id");
--> statement-breakpoint
CREATE INDEX "merchant_refund_requests_subscription_idx" ON "merchant_refund_requests" USING btree ("subscription_charge_receipt_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_refund_resource_bindings_evidence_idx" ON "merchant_refund_resource_bindings" USING btree ("request_id","evidence_digest");
--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_unapplied_charge_resolutions_version_idx" ON "merchant_unapplied_charge_resolutions" USING btree ("provider_platform_account_id",coalesce("charge_account_id",''),"original_payment_ref","evidence_digest");
--> statement-breakpoint
CREATE INDEX "merchant_unapplied_charge_resolutions_original_idx" ON "merchant_unapplied_charge_resolutions" USING btree ("provider_platform_account_id","charge_account_id","original_payment_ref");
