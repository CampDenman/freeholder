// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Scheduled exports and the accounting shapes (MASTER.md §2535, §43 C9.32).
//
// Two tables, and the second one is the point. §2535 draws the boundary this
// module lives inside — "the platform does not do bookkeeping; it refuses to
// make bookkeeping harder" — so there is no chart of accounts here, no journal
// and no double entry. There is a definition of a file, and a permanent record
// of every attempt to deliver one.
//
// The record exists because of what a scheduled export fails like. A report an
// owner reads is wrong loudly: they look at it and disbelieve it. A report
// emailed to a bookkeeper on the first of the month fails *silently* — it
// simply stops arriving, and nobody notices until a quarter is missing. So an
// attempt writes a row before it can succeed, the row says which period it
// covered, and a run that never reached anybody stays visible as a failure
// rather than as an absence.
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "@/core/auth/schema";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";

/** Which column layout the file is written in. */
export const EXPORT_SHAPES = ["csv", "quickbooks", "xero"] as const;

/**
 * Which invoices a period contains — and it is genuinely two questions.
 *
 * `paid` — invoices whose money arrived in the period. This is the revenue
 * report's basis (§4.6, C9.08), so the export and the screen agree.
 *
 * `issued` — invoices raised in the period, which is what an accountant doing
 * accrual bookkeeping means by "March sales".
 *
 * Neither is the right answer in general, and picking one silently would give
 * an owner a file that disagrees with either their bank or their accountant
 * with no way to tell which. Basis is part of the answer (C9.08).
 */
export const EXPORT_BASES = ["paid", "issued"] as const;

/**
 * The window, and therefore the cadence.
 *
 * Deliberately closed periods only. A rolling "last 30 days" has no boundary,
 * so two runs a day apart overlap and an accountant imports the same invoice
 * twice; a completed calendar period can be asked for by name, and asking for
 * it twice is the same question with the same answer.
 */
export const EXPORT_PERIODS = ["previous_week", "previous_month", "previous_quarter"] as const;

/**
 * How a date is written.
 *
 * Not a detail. QuickBooks and Xero both read a date in the format of the
 * company file's region, so `03/04/2026` is the third of April in Sydney and
 * the fourth of March in Denver. The platform cannot know which, so it asks
 * once and then never guesses — and defaults to ISO, the one form that cannot
 * be read two ways.
 */
export const EXPORT_DATE_FORMATS = ["iso", "dmy", "mdy"] as const;

export const EXPORT_RUN_STATUSES = ["pending", "built", "delivered", "failed"] as const;

export const EXPORT_TRIGGERS = ["schedule", "manual"] as const;

export const exportDefinitions = pgTable(
  "export_definitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    shape: text("shape", { enum: EXPORT_SHAPES }).notNull(),
    basis: text("basis", { enum: EXPORT_BASES }).notNull().default("paid"),
    /**
     * One export, one currency. Not a filter — the whole design.
     *
     * §4.9 forbids converting at charge time, so the platform has no rate and
     * inventing one to make a single tidy file would be doing exactly that
     * with extra steps. Worse, QuickBooks and Xero each import a file into one
     * company file at one currency: a mixed file is either rejected or, in the
     * bad case, posted at whatever rate the package assumed. A business
     * invoicing in two currencies makes two exports.
     */
    currency: text("currency").notNull(),
    period: text("period", { enum: EXPORT_PERIODS }).notNull().default("previous_month"),
    /** The business's own month, like every other bucketed figure (§4.9). */
    timezone: text("timezone").notNull().default("UTC"),
    /** Whether the job runs it. False still allows "run it now". */
    scheduled: boolean("scheduled").notNull().default(false),
    /** Where it goes. Plain addresses; see the note in the service. */
    recipients: text("recipients").array().notNull().default([]),
    dateFormat: text("date_format", { enum: EXPORT_DATE_FORMATS }).notNull().default("iso"),
    /*
     * The three bookkeeping facts the platform carries and never invents.
     *
     * Xero will not import a line without an account code and a tax type, and
     * QuickBooks wants a product/service the file's rows attach to. Every one
     * of those belongs to a chart of accounts the platform deliberately does
     * not have. Guessing one would be doing bookkeeping badly; leaving them
     * out would make the file useless. So the bookkeeper says them once and
     * the platform repeats them on every row without opinion.
     */
    itemCode: text("item_code"),
    accountCode: text("account_code"),
    taxCode: text("tax_code"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    // One deploy is one business (§2), so an export is the business's rather
    // than a private bookmark — the same rule saved views follow.
    uniqueIndex("export_definitions_name_idx").on(t.name),
    index("export_definitions_scheduled_idx").on(t.scheduled),
    check("export_definitions_currency_valid", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check("export_definitions_name_present", sql`length(btrim(${t.name})) > 0`),
    // A scheduled export with nobody to send it to is a job that runs forever
    // and delivers nothing — the silent failure this table exists to make
    // impossible, written into the schema so it cannot be configured at all.
    check(
      "export_definitions_scheduled_has_recipient",
      sql`${t.scheduled} = false or array_length(${t.recipients}, 1) >= 1`,
    ),
  ],
);

export const exportRuns = pgTable(
  "export_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    definitionId: uuid("definition_id")
      .notNull()
      .references(() => exportDefinitions.id, { onDelete: "cascade" }),
    trigger: text("trigger", { enum: EXPORT_TRIGGERS }).notNull(),
    status: text("status", { enum: EXPORT_RUN_STATUSES }).notNull().default("pending"),
    /*
     * The period is the run's identity, not its description.
     *
     * The scheduler asks "is there a delivered run for the month that just
     * ended?" rather than "has an hour passed?" — so a worker that was down
     * for a day makes a report late instead of losing it, and a worker that
     * runs twice does not send an accountant the same month twice.
     */
    periodFrom: timestamp("period_from", { withTimezone: true }).notNull(),
    periodTo: timestamp("period_to", { withTimezone: true }).notNull(),
    /*
     * Copied from the definition rather than joined to it: an owner who edits
     * an export next month must not silently rewrite what last month's file
     * says it was.
     */
    shape: text("shape", { enum: EXPORT_SHAPES }).notNull(),
    basis: text("basis", { enum: EXPORT_BASES }).notNull(),
    currency: text("currency").notNull(),
    rowCount: integer("row_count").notNull().default(0),
    invoiceCount: integer("invoice_count").notNull().default(0),
    /** Safe as one figure only because a run is one currency. */
    totalMinor: bigint("total_minor", { mode: "number" }).notNull().default(0),
    /**
     * What was refunded against those invoices, kept apart from the total.
     *
     * A refund is a credit note in an accounting package, and inventing one
     * would be bookkeeping. So the file carries the invoices as invoiced and
     * this column carries the number the owner has to go and account for.
     */
    refundedMinor: bigint("refunded_minor", { mode: "number" }).notNull().default(0),
    /**
     * Currencies present in the period that this file left out, on purpose.
     *
     * The alternative to saying so is an accountant who reconciles a file
     * against a bank statement and finds it short, with nothing anywhere
     * explaining why.
     */
    excludedCurrencies: text("excluded_currencies").array().notNull().default([]),
    excludedInvoiceCount: integer("excluded_invoice_count").notNull().default(0),
    filename: text("filename"),
    /**
     * The file itself, in the row.
     *
     * Object storage was the other option and is worse here: an export is
     * small and bounded, and keeping it beside the run means the file an
     * accountant was sent lives in the same backup as the invoices it was made
     * from. A bucket can be re-pointed or emptied, and then the evidence of
     * what was delivered is gone while the row still claims it was.
     */
    content: text("content"),
    bytes: integer("bytes"),
    sha256: text("sha256"),
    /** Frozen at build time: who this copy was for, whatever the list says now. */
    recipients: text("recipients").array().notNull().default([]),
    deliveredCount: integer("delivered_count").notNull().default(0),
    attempts: integer("attempts").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    error: text("error"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("export_runs_definition_idx").on(t.definitionId, t.startedAt),
    index("export_runs_status_idx").on(t.status, t.startedAt),
    // What makes "did the March one go?" a single indexed question, and what
    // stops two workers producing March twice.
    uniqueIndex("export_runs_period_idx").on(t.definitionId, t.periodFrom, t.periodTo),
    check("export_runs_currency_valid", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check("export_runs_period_ordered", sql`${t.periodFrom} < ${t.periodTo}`),
    check("export_runs_counts_nonnegative", sql`${t.rowCount} >= 0 and ${t.invoiceCount} >= 0 and ${t.deliveredCount} >= 0 and ${t.attempts} >= 0 and ${t.excludedInvoiceCount} >= 0`),
    // A run that says it was delivered must be able to say when, and to how
    // many people. "Delivered to nobody" is the state this forbids.
    check(
      "export_runs_delivered_consistent",
      sql`${t.status} <> 'delivered' or (${t.deliveredAt} is not null and ${t.deliveredCount} > 0)`,
    ),
    check(
      "export_runs_failed_consistent",
      sql`${t.status} <> 'failed' or (${t.failedAt} is not null and ${t.error} is not null)`,
    ),
  ],
);
