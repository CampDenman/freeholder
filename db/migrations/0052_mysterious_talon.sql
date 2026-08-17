CREATE TABLE "cancellation_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"free_until_hours" integer DEFAULT 24 NOT NULL,
	"fee_type" text DEFAULT 'none' NOT NULL,
	"fee_value" bigint,
	"reschedule_limit" integer DEFAULT 1 NOT NULL,
	"no_show_fee_minor" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cancellation_policies_name_valid" CHECK (char_length("cancellation_policies"."name") between 1 and 80),
	CONSTRAINT "cancellation_policies_free_hours" CHECK ("cancellation_policies"."free_until_hours" >= 0),
	CONSTRAINT "cancellation_policies_reschedule" CHECK ("cancellation_policies"."reschedule_limit" >= 0),
	CONSTRAINT "cancellation_policies_no_show" CHECK ("cancellation_policies"."no_show_fee_minor" >= 0),
	CONSTRAINT "cancellation_policies_fee_type" CHECK ("cancellation_policies"."fee_type" in ('none','fixed','percent','forfeit_deposit')),
	CONSTRAINT "cancellation_policies_fee_value" CHECK (("cancellation_policies"."fee_type" in ('none','forfeit_deposit') and "cancellation_policies"."fee_value" is null)
        or ("cancellation_policies"."fee_type" = 'fixed' and "cancellation_policies"."fee_value" > 0)
        or ("cancellation_policies"."fee_type" = 'percent' and "cancellation_policies"."fee_value" between 1 and 1000000))
);
--> statement-breakpoint
CREATE TABLE "price_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"plan_schedule" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_rules_mode_valid" CHECK ("price_rules"."mode" in ('full','deposit_balance','payment_plan','hourly','retainer'))
);
--> statement-breakpoint
CREATE TABLE "service_offerings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"duration_min" integer NOT NULL,
	"buffer_before_min" integer DEFAULT 0 NOT NULL,
	"buffer_after_min" integer DEFAULT 0 NOT NULL,
	"location_type" text NOT NULL,
	"deposit_type" text DEFAULT 'none' NOT NULL,
	"deposit_value" bigint DEFAULT 0 NOT NULL,
	"cancellation_policy_id" uuid,
	"intake_form_id" uuid,
	"waiver_template_id" uuid,
	"capacity" integer DEFAULT 1 NOT NULL,
	"assignment" text DEFAULT 'specific' NOT NULL,
	"calendar_ids" uuid[] DEFAULT '{}' NOT NULL,
	"travel_time_min" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_offerings_duration" CHECK ("service_offerings"."duration_min" > 0),
	CONSTRAINT "service_offerings_buffer_before" CHECK ("service_offerings"."buffer_before_min" >= 0),
	CONSTRAINT "service_offerings_buffer_after" CHECK ("service_offerings"."buffer_after_min" >= 0),
	CONSTRAINT "service_offerings_capacity" CHECK ("service_offerings"."capacity" > 0),
	CONSTRAINT "service_offerings_travel" CHECK ("service_offerings"."travel_time_min" >= 0),
	CONSTRAINT "service_offerings_location" CHECK ("service_offerings"."location_type" in ('in_person','virtual','client_site')),
	CONSTRAINT "service_offerings_assignment" CHECK ("service_offerings"."assignment" in ('specific','pool','round_robin')),
	CONSTRAINT "service_offerings_deposit_type" CHECK ("service_offerings"."deposit_type" in ('none','fixed','percent')),
	CONSTRAINT "service_offerings_deposit_value" CHECK (("service_offerings"."deposit_type" = 'none' and "service_offerings"."deposit_value" = 0)
        or ("service_offerings"."deposit_type" = 'fixed' and "service_offerings"."deposit_value" > 0)
        or ("service_offerings"."deposit_type" = 'percent' and "service_offerings"."deposit_value" between 1 and 1000000))
);
--> statement-breakpoint
ALTER TABLE "price_rules" ADD CONSTRAINT "price_rules_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_offerings" ADD CONSTRAINT "service_offerings_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_offerings" ADD CONSTRAINT "service_offerings_cancellation_policy_id_cancellation_policies_id_fk" FOREIGN KEY ("cancellation_policy_id") REFERENCES "public"."cancellation_policies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_offerings" ADD CONSTRAINT "service_offerings_intake_form_id_forms_id_fk" FOREIGN KEY ("intake_form_id") REFERENCES "public"."forms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cancellation_policies_name_idx" ON "cancellation_policies" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "price_rules_product_mode_idx" ON "price_rules" USING btree ("product_id","mode");--> statement-breakpoint
CREATE INDEX "price_rules_product_idx" ON "price_rules" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "service_offerings_product_idx" ON "service_offerings" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "service_offerings_policy_idx" ON "service_offerings" USING btree ("cancellation_policy_id");--> statement-breakpoint
CREATE INDEX "service_offerings_form_idx" ON "service_offerings" USING btree ("intake_form_id");