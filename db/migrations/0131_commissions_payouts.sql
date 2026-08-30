-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
--
-- Commission events, holdbacks, payout batches and tax status
-- (MASTER.md §4.3, §4.13, C9.10).
--
-- C9.09 recorded and attributed and paid nobody. This is the half that pays.
--
-- Three of §4.13's rules are visible in the columns below.
--
-- "Commission has a holdback. A `CommissionEvent` becomes payable only after
-- the refund window closes." So the programme gains `holdback_days` and every
-- commission carries a `payable_at` computed from it. A timestamp rather than
-- a flag, because the question a payout batch asks is "what is payable as of
-- this run" and a flag is only right if a job already ran correctly.
--
-- "Reversing after payout produces a negative line on the next batch rather
-- than an argument." So `reverses_id` exists and a clawback is a *second row*
-- with a negative amount citing the first. The original is never edited: it is
-- the record of a payment that really happened.
--
-- "One hop only ... Multi-level structures are refused by the data model, not
-- by policy — there is no parent link on `AffiliateCode`." Nothing below adds
-- one. A commission names the code that earned it and the customer who
-- converted, and there is no column that could point at a referrer's referrer.
ALTER TABLE "affiliate_programs" ADD COLUMN "holdback_days" integer DEFAULT 30 NOT NULL;--> statement-breakpoint

CREATE TABLE "commission_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_id" uuid NOT NULL,
	"code_id" uuid NOT NULL,
	"affiliate_contact_id" uuid NOT NULL,
	"referred_contact_id" uuid NOT NULL,
	"conversion_type" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid,
	"invoice_id" uuid,
	"share_ppm" integer DEFAULT 1000000 NOT NULL,
	"basis_minor" integer DEFAULT 0 NOT NULL,
	"amount_minor" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'GBP' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"payable_at" timestamp with time zone NOT NULL,
	"reverses_id" uuid,
	"payout_line_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- `invoice_id` deliberately carries no foreign key. This module requires only
-- core, so a business with no invoicing module still earns and settles
-- commission; a real reference here would make it unbootable without one.
ALTER TABLE "commission_events" ADD CONSTRAINT "commission_events_program_id_affiliate_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."affiliate_programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_events" ADD CONSTRAINT "commission_events_code_id_affiliate_codes_id_fk" FOREIGN KEY ("code_id") REFERENCES "public"."affiliate_codes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_events" ADD CONSTRAINT "commission_events_affiliate_contact_id_contacts_id_fk" FOREIGN KEY ("affiliate_contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_events" ADD CONSTRAINT "commission_events_referred_contact_id_contacts_id_fk" FOREIGN KEY ("referred_contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "commission_events_affiliate_idx" ON "commission_events" USING btree ("affiliate_contact_id","status");--> statement-breakpoint
CREATE INDEX "commission_events_payable_idx" ON "commission_events" USING btree ("status","payable_at");--> statement-breakpoint
CREATE INDEX "commission_events_subject_idx" ON "commission_events" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "commission_events_program_idx" ON "commission_events" USING btree ("program_id");--> statement-breakpoint

-- One commission per code per conversion, and partial so that a reversal —
-- deliberately a second row about the same subject — does not collide with the
-- row it reverses. The bus can redeliver and a retried job re-runs its
-- handler; without this, a redelivery pays somebody twice for one sale.
CREATE UNIQUE INDEX "commission_events_once_idx" ON "commission_events" USING btree ("code_id","subject_type","subject_id") WHERE "commission_events"."reverses_id" is null and "commission_events"."subject_id" is not null;--> statement-breakpoint

CREATE TABLE "payout_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"currency" text DEFAULT 'GBP' NOT NULL,
	"method" text DEFAULT 'manual' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"total_minor" integer DEFAULT 0 NOT NULL,
	"approved_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "payout_batches_status_idx" ON "payout_batches" USING btree ("status","period_end");--> statement-breakpoint

CREATE TABLE "payout_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"affiliate_contact_id" uuid NOT NULL,
	"amount_minor" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'GBP' NOT NULL,
	"tax_form_state" text DEFAULT 'not_required' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payout_lines" ADD CONSTRAINT "payout_lines_batch_id_payout_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."payout_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_lines" ADD CONSTRAINT "payout_lines_affiliate_contact_id_contacts_id_fk" FOREIGN KEY ("affiliate_contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payout_lines_batch_idx" ON "payout_lines" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "payout_lines_affiliate_idx" ON "payout_lines" USING btree ("affiliate_contact_id");--> statement-breakpoint

-- One line per person per batch: somebody with three codes is paid once, and
-- that is enforced rather than assumed.
CREATE UNIQUE INDEX "payout_lines_once_idx" ON "payout_lines" USING btree ("batch_id","affiliate_contact_id");--> statement-breakpoint

-- "Tax paperwork is acknowledged, not automated ... The platform prompts and
-- records; it does not file." (§4.13). A table rather than a column on the
-- payout line, because the threshold is a property of a person and a year: an
-- affiliate crosses it across several batches, and a per-line enum could never
-- answer "have they crossed it yet".
CREATE TABLE "affiliate_tax_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"jurisdiction" text DEFAULT '' NOT NULL,
	"form_kind" text DEFAULT '' NOT NULL,
	"state" text DEFAULT 'not_required' NOT NULL,
	"threshold_minor" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'GBP' NOT NULL,
	"requested_at" timestamp with time zone,
	"collected_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "affiliate_tax_profiles" ADD CONSTRAINT "affiliate_tax_profiles_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "affiliate_tax_profiles_contact_idx" ON "affiliate_tax_profiles" USING btree ("contact_id");
