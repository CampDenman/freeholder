-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
--
-- Loyalty programmes, earn rules, accounts and the points ledger
-- (MASTER.md §4.13, C9.11).
--
-- The shape follows §4.13's first rule: "Points are a ledger, not a number —
-- the same discipline as stock (§4.2) and for the same reason: 'I had 400
-- points last week' must be answerable, and a balance you cannot explain is a
-- balance customers stop believing."
--
-- So points_ledger is append-only and loyalty_accounts.points_balance_cached
-- is a cache for display. Nothing decides anything from that column.
CREATE TABLE "loyalty_programs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"points_label" text DEFAULT 'points' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"earn_currency" text DEFAULT 'USD' NOT NULL,
	"redemption_value_cents" integer DEFAULT 1 NOT NULL,
	"expiry_policy" jsonb DEFAULT '{"kind":"never"}'::jsonb NOT NULL,
	"enrolment" text DEFAULT 'opt_in' NOT NULL,
	"terms_page_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "loyalty_programs_status_idx" ON "loyalty_programs" USING btree ("status");--> statement-breakpoint

-- event_type is a timeline_events.event_type, not a bus topic. That is the
-- difference between "loyalty watches the contact's history" and "loyalty
-- watches commerce", and only the first survives commerce being swapped out.
CREATE TABLE "earn_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_id" uuid NOT NULL,
	"name" text NOT NULL,
	"event_type" text NOT NULL,
	"formula" text DEFAULT 'fixed' NOT NULL,
	"points" integer DEFAULT 0 NOT NULL,
	"cap_per_period" integer,
	"cap_period_days" integer DEFAULT 30 NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"priority" integer DEFAULT 0 NOT NULL,
	"active" text DEFAULT 'yes' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "earn_rules" ADD CONSTRAINT "earn_rules_program_id_loyalty_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."loyalty_programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "earn_rules_program_idx" ON "earn_rules" USING btree ("program_id");--> statement-breakpoint
CREATE INDEX "earn_rules_event_idx" ON "earn_rules" USING btree ("event_type","active");--> statement-breakpoint

CREATE TABLE "loyalty_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"program_id" uuid NOT NULL,
	"points_balance_cached" integer DEFAULT 0 NOT NULL,
	"lifetime_points" integer DEFAULT 0 NOT NULL,
	"enrolled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "loyalty_accounts" ADD CONSTRAINT "loyalty_accounts_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_accounts" ADD CONSTRAINT "loyalty_accounts_program_id_loyalty_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."loyalty_programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- One account per contact per programme. Two accounts is two balances, and
-- the customer only believes one of them.
CREATE UNIQUE INDEX "loyalty_accounts_contact_program_idx" ON "loyalty_accounts" USING btree ("contact_id","program_id");--> statement-breakpoint
CREATE INDEX "loyalty_accounts_program_idx" ON "loyalty_accounts" USING btree ("program_id");--> statement-breakpoint
CREATE INDEX "loyalty_accounts_activity_idx" ON "loyalty_accounts" USING btree ("last_activity_at");--> statement-breakpoint

CREATE TABLE "points_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"delta" integer NOT NULL,
	"reason" text NOT NULL,
	"rule_id" uuid,
	"source_type" text,
	"source_id" uuid,
	"reverses_id" uuid,
	"actor" text NOT NULL,
	"note" text,
	"expires_at" timestamp with time zone,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "points_ledger" ADD CONSTRAINT "points_ledger_account_id_loyalty_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."loyalty_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_ledger" ADD CONSTRAINT "points_ledger_rule_id_earn_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."earn_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "points_ledger_account_idx" ON "points_ledger" USING btree ("account_id","at");--> statement-breakpoint
-- An earn is written at most once per (rule, source). This is what makes the
-- listener safe to re-run: the outbox retries a failed delivery, and without
-- this a retry pays for the same order twice. "We paid you twice for one
-- order" is a harder conversation than "we have not paid you yet".
CREATE UNIQUE INDEX "points_ledger_earn_once_idx" ON "points_ledger" USING btree ("rule_id","source_type","source_id") WHERE "points_ledger"."reason" = 'earn';--> statement-breakpoint
CREATE INDEX "points_ledger_reverses_idx" ON "points_ledger" USING btree ("reverses_id");--> statement-breakpoint
CREATE INDEX "points_ledger_expiry_idx" ON "points_ledger" USING btree ("expires_at");
