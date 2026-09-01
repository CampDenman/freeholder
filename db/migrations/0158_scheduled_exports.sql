-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- Scheduled exports and the accounting shapes (MASTER.md §2535, §43 C9.32).
--
-- Two tables. `export_definitions` is what an owner configured; `export_runs`
-- is what actually happened, including the attempts that did not arrive — a
-- report that silently stops being delivered is worse than one that was never
-- set up, so a failure has to be a row rather than an absence.

create table "export_definitions" (
  "id" uuid primary key default gen_random_uuid(),
  "name" text not null,
  "shape" text not null,
  "basis" text not null default 'paid',
  -- One export, one currency: §4.9 forbids converting at charge time, and both
  -- QuickBooks and Xero import one file into one company file.
  "currency" text not null,
  "period" text not null default 'previous_month',
  "timezone" text not null default 'UTC',
  "scheduled" boolean not null default false,
  "recipients" text[] not null default '{}',
  "date_format" text not null default 'iso',
  -- The bookkeeper's own codes, carried verbatim. The platform does not keep a
  -- chart of accounts and will not invent one.
  "item_code" text,
  "account_code" text,
  "tax_code" text,
  "created_by_user_id" uuid references "users"("id") on delete set null,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now(),
  constraint "export_definitions_shape_valid" check ("shape" in ('csv','quickbooks','xero')),
  constraint "export_definitions_basis_valid" check ("basis" in ('paid','issued')),
  constraint "export_definitions_period_valid" check ("period" in ('previous_week','previous_month','previous_quarter')),
  constraint "export_definitions_date_format_valid" check ("date_format" in ('iso','dmy','mdy')),
  constraint "export_definitions_currency_valid" check ("currency" ~ '^[A-Z]{3}$'),
  constraint "export_definitions_name_present" check (length(btrim("name")) > 0),
  -- A scheduled export with nobody to send it to runs every month and reaches
  -- no one. Refused by the schema so it cannot be configured at all.
  constraint "export_definitions_scheduled_has_recipient"
    check ("scheduled" = false or array_length("recipients", 1) >= 1)
);

create unique index "export_definitions_name_idx" on "export_definitions" ("name");
create index "export_definitions_scheduled_idx" on "export_definitions" ("scheduled");

create table "export_runs" (
  "id" uuid primary key default gen_random_uuid(),
  "definition_id" uuid not null references "export_definitions"("id") on delete cascade,
  "trigger" text not null,
  "status" text not null default 'pending',
  -- The period is the run's identity, not its description: the scheduler asks
  -- "is there a delivered run for the month that ended?" rather than "has an
  -- hour passed?", so a worker that was down makes a report late, never lost.
  "period_from" timestamp with time zone not null,
  "period_to" timestamp with time zone not null,
  -- Copied from the definition: editing an export next month must not rewrite
  -- what last month's file says it was.
  "shape" text not null,
  "basis" text not null,
  "currency" text not null,
  "row_count" integer not null default 0,
  "invoice_count" integer not null default 0,
  "total_minor" bigint not null default 0,
  -- Kept apart from the total: a refund is a credit note in an accounting
  -- package, and inventing one would be bookkeeping.
  "refunded_minor" bigint not null default 0,
  -- What this file left out on purpose, so a short reconciliation has an
  -- explanation attached to it.
  "excluded_currencies" text[] not null default '{}',
  "excluded_invoice_count" integer not null default 0,
  "filename" text,
  -- The file itself, beside the run, so the evidence of what was delivered
  -- lives in the same backup as the invoices it was made from.
  "content" text,
  "bytes" integer,
  "sha256" text,
  "recipients" text[] not null default '{}',
  "delivered_count" integer not null default 0,
  "attempts" integer not null default 0,
  "started_at" timestamp with time zone not null default now(),
  "delivered_at" timestamp with time zone,
  "failed_at" timestamp with time zone,
  "error" text,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now(),
  constraint "export_runs_trigger_valid" check ("trigger" in ('schedule','manual')),
  constraint "export_runs_status_valid" check ("status" in ('pending','built','delivered','failed')),
  constraint "export_runs_shape_valid" check ("shape" in ('csv','quickbooks','xero')),
  constraint "export_runs_basis_valid" check ("basis" in ('paid','issued')),
  constraint "export_runs_currency_valid" check ("currency" ~ '^[A-Z]{3}$'),
  constraint "export_runs_period_ordered" check ("period_from" < "period_to"),
  constraint "export_runs_counts_nonnegative" check (
    "row_count" >= 0 and "invoice_count" >= 0 and "delivered_count" >= 0
    and "attempts" >= 0 and "excluded_invoice_count" >= 0
  ),
  -- "Delivered to nobody" is the state this forbids.
  constraint "export_runs_delivered_consistent"
    check ("status" <> 'delivered' or ("delivered_at" is not null and "delivered_count" > 0)),
  constraint "export_runs_failed_consistent"
    check ("status" <> 'failed' or ("failed_at" is not null and "error" is not null))
);

create index "export_runs_definition_idx" on "export_runs" ("definition_id", "started_at");
create index "export_runs_status_idx" on "export_runs" ("status", "started_at");
-- What makes "did the March one go?" one indexed question, and what stops two
-- workers producing March twice.
create unique index "export_runs_period_idx"
  on "export_runs" ("definition_id", "period_from", "period_to");
