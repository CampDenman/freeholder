// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Scheduled exports and the accounting shapes (MASTER.md §2535, §43 C9.32).
//
// §2535 sets the boundary and this module stays inside it: "the platform does
// not do bookkeeping; it refuses to make bookkeeping harder." So there is no
// ledger here and no chart of accounts — there is the column shape QuickBooks
// and Xero accept, filled from invoices that already exist, delivered on a
// schedule.
//
// Two things carry most of the weight.
//
// **One export is one currency.** Not a filter that happens to be there: §4.9
// forbids converting at charge time, so a file that added CAD to EUR would be
// converting with extra steps and handing the result to an accountant as
// fact. A run also records the currencies it deliberately left out, because a
// file that is quietly short is worse than one that says why.
//
// **A delivery is a thing that can fail.** A report an owner opens is wrong
// loudly. A report emailed on the first of the month fails by *not arriving*,
// which nobody notices for a quarter. So building, encrypted-outbox staging,
// provider submission and settlement are separate phases. Recipient copies
// point at the durable mail ledger, and a failure is a row and a notification
// rather than an absence.
import { createHash } from "node:crypto";
import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { listed, row, timestamp, uuid as uuidSchema } from "@/core/contract";
import { contacts } from "@/core/contacts/schema";
import { db } from "@/core/db";
import { env } from "@/core/env";
import { formatMoney, translator } from "@/core/i18n";
import { mailDeliveries } from "@/core/mail/schema";
import { sendMail } from "@/core/mail/service";
import { actorString, defineService, ServiceError, type ServiceContext } from "@/core/service";
import { getBusiness } from "@/core/settings/service";
import { invoiceLines, invoices } from "@/modules/invoicing/schema";
import {
  EXPORT_BASES,
  EXPORT_DATE_FORMATS,
  EXPORT_PERIODS,
  EXPORT_RUN_STATUSES,
  EXPORT_SHAPES,
  exportDefinitions,
  exportRunDeliveries,
  exportRuns,
} from "./export-schema";
import { hashExportToken, newExportToken } from "./export-tokens";
import {
  buildExportCsv,
  exportDate,
  linesFor,
  type ExportAddress,
  type ExportInvoice,
  type ExportRow,
} from "./export-shapes";

/**
 * The ceiling on one file.
 *
 * A refusal an owner can act on ("narrow the period") beats a worker that
 * spends its lease building a 400 MB string and is killed halfway, leaving a
 * run pending forever. Both packages also have import limits well under this.
 */
const MAX_ROWS = 20_000;

/**
 * How long a run may sit `pending` before it is treated as never delivered.
 *
 * Longer than any single delivery takes, shorter than the gap between two
 * scheduled runs — so a crash is noticed within the hour rather than at the
 * end of the quarter.
 */
const DOWNLOAD_DAYS = 30;

const email = z.string().trim().toLowerCase().email().max(320);

/**
 * Recipients are plain addresses, and deliberately not contacts.
 *
 * The spine rule is that no module may invent a private notion of *customer*
 * (§2 principle 3), and this does not: the person who receives an accounting
 * export is the business's bookkeeper. Resolving them into the contact
 * record would file the accountant in the customer list, where segments,
 * campaigns and lifecycle stages would all then have an opinion about them.
 * `mail_deliveries` and notification deliveries already address an outsider by
 * address alone, for the same reason.
 */
const recipients = z
  .array(email)
  .max(20)
  .transform((values) => [...new Set(values)]);

const definitionRow = row({
  id: uuidSchema,
  name: z.string(),
  shape: z.enum(EXPORT_SHAPES),
  basis: z.enum(EXPORT_BASES),
  currency: z.string(),
  period: z.enum(EXPORT_PERIODS),
  timezone: z.string(),
  scheduled: z.boolean(),
  recipients: listed(z.string()),
  dateFormat: z.enum(EXPORT_DATE_FORMATS),
  itemCode: z.string().nullable(),
  accountCode: z.string().nullable(),
  taxCode: z.string().nullable(),
  updatedAt: timestamp,
});

const runRow = row({
  id: uuidSchema,
  definitionId: uuidSchema,
  definitionName: z.string(),
  trigger: z.enum(["schedule", "manual"]),
  status: z.enum(EXPORT_RUN_STATUSES),
  periodFrom: timestamp,
  periodTo: timestamp,
  shape: z.enum(EXPORT_SHAPES),
  basis: z.enum(EXPORT_BASES),
  currency: z.string(),
  timezone: z.string(),
  rowCount: z.number().int(),
  invoiceCount: z.number().int(),
  totalMinor: z.number().int(),
  refundedMinor: z.number().int(),
  excludedCurrencies: listed(z.string()),
  excludedInvoiceCount: z.number().int(),
  filename: z.string().nullable(),
  bytes: z.number().int().nullable(),
  sha256: z.string().nullable(),
  recipients: listed(z.string()),
  deliveredCount: z.number().int(),
  attempts: z.number().int(),
  startedAt: timestamp,
  deliveredAt: timestamp.nullable(),
  failedAt: timestamp.nullable(),
  error: z.string().nullable(),
});

/** Everything but the file itself: a run summary must stay small. */
type RunRow = typeof exportRuns.$inferSelect;

function summarize(run: RunRow) {
  const { content: _content, createdAt: _createdAt, updatedAt: _updatedAt, ...rest } = run;
  return rest;
}

/* ------------------------------------------------------------- the period */

export interface PeriodBounds {
  from: Date;
  to: Date;
}

const UNITS = {
  previous_week: { unit: "week", step: "1 week" },
  previous_month: { unit: "month", step: "1 month" },
  previous_quarter: { unit: "quarter", step: "3 months" },
} as const;

/**
 * The most recently *completed* period, in the business's own timezone.
 *
 * Computed by Postgres rather than in JavaScript, like every other bucketed
 * figure in this module: an owner closing their books for March means their
 * March, and `date_trunc` in a named zone is the one thing that gets the hour
 * clocks changed right without a table of rules.
 *
 * Only ever the last completed period — never a backfill. Switching a schedule
 * on should produce last month's file, not fourteen of them.
 */
async function periodsFor(
  ctx: ServiceContext,
  wanted: ReadonlyArray<{ period: keyof typeof UNITS; timezone: string }>,
): Promise<Map<string, PeriodBounds>> {
  const found = new Map<string, PeriodBounds>();
  if (wanted.length === 0) return found;
  const distinct = new Map<string, { period: keyof typeof UNITS; timezone: string }>();
  for (const each of wanted) distinct.set(`${each.period}:${each.timezone}`, each);

  const values = sql.join(
    [...distinct.values()].map(
      (each) =>
        sql`(${each.period}::text, ${UNITS[each.period].unit}::text, ${each.timezone}::text, ${UNITS[each.period].step}::interval)`,
    ),
    sql`, `,
  );
  const result = await ctx.tx.execute(sql`
    select v.period,
           v.tz,
           (date_trunc(v.unit, (now() at time zone v.tz)) - v.step) at time zone v.tz as period_from,
           (date_trunc(v.unit, (now() at time zone v.tz))) at time zone v.tz as period_to
    from (values ${values}) as v(period, unit, tz, step)
  `);
  for (const each of result as unknown as Array<{
    period: string;
    tz: string;
    period_from: string | Date;
    period_to: string | Date;
  }>) {
    found.set(`${each.period}:${each.tz}`, {
      from: new Date(each.period_from),
      to: new Date(each.period_to),
    });
  }
  return found;
}

/* -------------------------------------------------------------- the rows */

function addressOf(value: unknown): ExportAddress | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const read = (key: string) => {
    const found = source[key];
    return typeof found === "string" ? found : null;
  };
  return {
    street1: read("street1"),
    street2: read("street2"),
    city: read("city"),
    region: read("region"),
    postalCode: read("postalCode"),
    country: read("country"),
  };
}

interface Gathered {
  rows: ExportRow[];
  invoiceCount: number;
  totalMinor: number;
  refundedMinor: number;
  excludedCurrencies: string[];
  excludedInvoiceCount: number;
  /** The period holds more than one file can. Refused rather than trimmed. */
  truncated: boolean;
}

/**
 * Every invoice in the window, in one currency, as rows.
 *
 * The currency filter is on the query rather than applied afterwards, so there
 * is no moment at which two currencies are in the same array waiting for
 * somebody to add them up. What the filter excluded is counted separately and
 * carried on the run.
 */
async function gather(
  ctx: ServiceContext,
  definition: { currency: string; basis: "paid" | "issued" },
  period: PeriodBounds,
): Promise<Gathered> {
  const dated =
    definition.basis === "paid"
      ? and(gte(invoices.paidAt, period.from), lt(invoices.paidAt, period.to))
      : and(
          gte(invoices.issuedAt, period.from),
          lt(invoices.issuedAt, period.to),
          ne(invoices.status, "draft"),
        );
  // A void invoice is not a sale, whichever basis is in use. Exporting one
  // would have the accountant reverse a document that never counted.
  const inWindow = and(dated, ne(invoices.status, "void"));

  // Count and total before materializing anything. At least one output row is
  // required per invoice, so more invoices than the row ceiling is already a
  // refusal; loading their item lines first could turn a deliberate 20k bound
  // into millions of objects in one service transaction.
  const [included] = await ctx.tx
    .select({
      count: sql<number>`count(*)::int`,
      totalMinor: sql<string>`coalesce(sum(${invoices.totalMinor}), 0)::bigint`,
      refundedMinor: sql<string>`coalesce(sum(${invoices.refundedMinor}), 0)::bigint`,
    })
    .from(invoices)
    .where(and(inWindow, eq(invoices.currency, definition.currency)));
  const invoiceCount = Number(included?.count ?? 0);
  const totalMinor = Number(included?.totalMinor ?? 0);
  const refundedMinor = Number(included?.refundedMinor ?? 0);

  const excluded = await ctx.tx
    .select({
      currency: invoices.currency,
      count: sql<number>`count(*)::int`,
    })
    .from(invoices)
    .where(and(inWindow, ne(invoices.currency, definition.currency)))
    .groupBy(invoices.currency)
    .orderBy(asc(invoices.currency));

  const refusal = (rows: ExportRow[]): Gathered => ({
    rows,
    invoiceCount,
    totalMinor,
    refundedMinor,
    excludedCurrencies: excluded.map((each) => each.currency),
    excludedInvoiceCount: excluded.reduce((sum, each) => sum + Number(each.count), 0),
    truncated: true,
  });
  if (invoiceCount > MAX_ROWS) return refusal([]);

  const found = await ctx.tx
    .select({
      id: invoices.id,
      number: invoices.number,
      status: invoices.status,
      sourceType: invoices.sourceType,
      currency: invoices.currency,
      memo: invoices.memo,
      issuedAt: invoices.issuedAt,
      dueAt: invoices.dueAt,
      paidAt: invoices.paidAt,
      subtotalMinor: invoices.subtotalMinor,
      discountMinor: invoices.discountMinor,
      shippingMinor: invoices.shippingMinor,
      taxMinor: invoices.taxMinor,
      totalMinor: invoices.totalMinor,
      paidMinor: invoices.paidMinor,
      refundedMinor: invoices.refundedMinor,
      billingAddress: invoices.billingAddress,
      contactName: contacts.name,
      contactEmail: contacts.email,
    })
    .from(invoices)
    .innerJoin(contacts, eq(contacts.id, invoices.contactId))
    .where(and(inWindow, eq(invoices.currency, definition.currency)))
    .orderBy(asc(invoices.issuedAt), asc(invoices.number));

  const lines =
    found.length === 0
      ? []
      : await ctx.tx
          .select({
            invoiceId: invoiceLines.invoiceId,
            position: invoiceLines.position,
            description: invoiceLines.description,
            quantityMicros: invoiceLines.quantityMicros,
            unitAmountMinor: invoiceLines.unitAmountMinor,
            subtotalMinor: invoiceLines.subtotalMinor,
            discountMinor: invoiceLines.discountMinor,
            taxMinor: invoiceLines.taxMinor,
          })
          .from(invoiceLines)
          .where(
            inArray(
              invoiceLines.invoiceId,
              found.map((each) => each.id),
            ),
          )
          .orderBy(asc(invoiceLines.invoiceId), asc(invoiceLines.position))
          .limit(MAX_ROWS + 1);

  if (lines.length > MAX_ROWS) return refusal([]);

  const byInvoice = new Map<string, typeof lines>();
  for (const line of lines) {
    const bucket = byInvoice.get(line.invoiceId) ?? [];
    bucket.push(line);
    byInvoice.set(line.invoiceId, bucket);
  }

  const rows: ExportRow[] = [];
  for (const each of found) {
    const invoice: ExportInvoice = {
      ...each,
      billingAddress: addressOf(each.billingAddress),
    };
    rows.push(...linesFor(invoice, byInvoice.get(each.id) ?? []));
    if (rows.length > MAX_ROWS) break;
  }

  return {
    rows,
    invoiceCount,
    totalMinor,
    refundedMinor,
    excludedCurrencies: excluded.map((each) => each.currency),
    excludedInvoiceCount: excluded.reduce((sum, each) => sum + Number(each.count), 0),
    truncated: rows.length > MAX_ROWS,
  };
}

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "export"
  );
}

/* ---------------------------------------------------------- the definition */

const saveInput = z.object({
  id: uuidSchema.optional(),
  name: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .refine((value) => !/[\r\n]/.test(value), "An export name must fit on one line."),
  shape: z.enum(EXPORT_SHAPES),
  basis: z.enum(EXPORT_BASES).default("paid"),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "Use a three-letter currency code, such as CAD."),
  period: z.enum(EXPORT_PERIODS).default("previous_month"),
  timezone: z.string().trim().min(1).max(100).default("UTC"),
  scheduled: z.boolean().default(false),
  recipients: recipients.default([]),
  dateFormat: z.enum(EXPORT_DATE_FORMATS).default("iso"),
  itemCode: z.string().trim().max(200).nullable().default(null),
  accountCode: z.string().trim().max(50).nullable().default(null),
  taxCode: z.string().trim().max(80).nullable().default(null),
});

export const saveExport = defineService({
  name: "reports.saveExport",
  writeClass: "write",
  summary: "Define a file, its shape, its currency and where it goes.",
  kind: "mutation",
  permission: "scoped",
  input: saveInput,
  output: definitionRow,
  handler: async (input, ctx) => {
    if (input.scheduled && input.recipients.length === 0) {
      throw new ServiceError(
        "validation",
        "A scheduled export needs at least one recipient — otherwise it runs every month and reaches nobody.",
      );
    }
    // Xero rejects a line with no account code and no tax type, so a file
    // saved without them is one the owner will only discover is useless at the
    // moment they hand it to their accountant. The platform will not guess
    // them — that would be keeping a chart of accounts — but it will refuse to
    // pretend the export is ready.
    if (input.shape === "xero" && (!input.accountCode || !input.taxCode)) {
      throw new ServiceError(
        "validation",
        "Xero will not import a line without an account code and a tax type. Ask your bookkeeper for both.",
      );
    }
    try {
      Intl.DateTimeFormat(undefined, { timeZone: input.timezone });
    } catch {
      throw new ServiceError("validation", `"${input.timezone}" is not a timezone.`);
    }

    const values = {
      name: input.name,
      shape: input.shape,
      basis: input.basis,
      currency: input.currency,
      period: input.period,
      timezone: input.timezone,
      scheduled: input.scheduled,
      recipients: input.recipients,
      dateFormat: input.dateFormat,
      itemCode: input.itemCode || null,
      accountCode: input.accountCode || null,
      taxCode: input.taxCode || null,
      updatedAt: new Date(),
    };

    if (input.id) {
      const [updated] = await ctx.tx
        .update(exportDefinitions)
        .set(values)
        .where(eq(exportDefinitions.id, input.id))
        .returning();
      if (!updated) throw new ServiceError("not_found", "There is no such export.");
      ctx.setSubject("exportDefinition", updated.id);
      return updated;
    }
    const [created] = await ctx.tx
      .insert(exportDefinitions)
      .values({
        ...values,
        createdByUserId: ctx.actor.kind === "user" ? ctx.actor.userId : null,
      })
      .returning();
    ctx.setSubject("exportDefinition", created!.id);
    ctx.queueEvent("report.exportDefined", { id: created!.id, shape: created!.shape });
    return created!;
  },
});

export const deleteExport = defineService({
  name: "reports.deleteExport",
  writeClass: "destructive",
  summary: "Forget an export and its delivery history.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id: uuidSchema, confirm: z.literal(true) }),
  output: row({ deleted: z.boolean() }),
  handler: async (input, ctx) => {
    const gone = await ctx.tx
      .delete(exportDefinitions)
      .where(eq(exportDefinitions.id, input.id))
      .returning({ id: exportDefinitions.id });
    if (gone.length === 0) throw new ServiceError("not_found", "There is no such export.");
    ctx.setSubject("exportDefinition", input.id);
    return { deleted: true };
  },
});

/**
 * Every export, with the answer to the only question that matters about a
 * scheduled one: did the provider accept every copy, with no later failure?
 *
 * `due` and `overdue` are computed from the same period helper the job uses,
 * so the screen and the scheduler cannot disagree. `overdue` is the important
 * one: it is true when a scheduled export's completed period has no delivered
 * run and the period ended some time ago — which is what "the job is not
 * running at all" looks like from the outside, and the state that would
 * otherwise be indistinguishable from silence.
 */
export const listExports = defineService({
  name: "reports.listExports",
  summary: "Exports, their schedule, and whether the last one arrived.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: listed(
    row({
      definition: definitionRow,
      lastRun: runRow.nullable(),
      periodFrom: timestamp,
      periodTo: timestamp,
      due: z.boolean(),
      overdue: z.boolean(),
    }),
  ),
  handler: async (_input, ctx) => {
    const definitions = await ctx.tx
      .select()
      .from(exportDefinitions)
      .orderBy(asc(exportDefinitions.name))
      .limit(100);
    if (definitions.length === 0) return [];

    const bounds = await periodsFor(ctx, definitions);
    const runs = await ctx.tx
      .select()
      .from(exportRuns)
      .where(
        inArray(
          exportRuns.definitionId,
          definitions.map((each) => each.id),
        ),
      )
      .orderBy(desc(exportRuns.startedAt));

    const latest = new Map<string, RunRow>();
    const settled = new Set<string>();
    for (const run of runs) {
      if (!latest.has(run.definitionId)) latest.set(run.definitionId, run);
      // Only provider-accepted mail settles a scheduled period. A file built
      // for manual download is not evidence that any recipient received it.
      if (run.status === "delivered") {
        settled.add(`${run.definitionId}:${run.periodFrom.toISOString()}`);
      }
    }

    const now = Date.now();
    return definitions.map((definition) => {
      const period = bounds.get(`${definition.period}:${definition.timezone}`)!;
      const done = settled.has(`${definition.id}:${period.from.toISOString()}`);
      const due = definition.scheduled && !done;
      return {
        definition,
        lastRun: latest.get(definition.id) ? summarize(latest.get(definition.id)!) : null,
        periodFrom: period.from,
        periodTo: period.to,
        due,
        // A day's grace, because the sweep runs on a cron and a period that
        // ended nine minutes ago is not evidence of anything.
        overdue: due && now - period.to.getTime() > 24 * 60 * 60 * 1000,
      };
    });
  },
});

/* --------------------------------------------------------------- building */

export const runExport = defineService({
  name: "reports.runExport",
  writeClass: "write",
  summary: "Build one export's file for a period, and record the attempt.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    id: uuidSchema,
    trigger: z.enum(["schedule", "manual"]).default("manual"),
  }),
  output: runRow,
  handler: async (input, ctx) => {
    const [definition] = await ctx.tx
      .select()
      .from(exportDefinitions)
      .where(eq(exportDefinitions.id, input.id));
    if (!definition) throw new ServiceError("not_found", "There is no such export.");

    const bounds = await periodsFor(ctx, [definition]);
    const period = bounds.get(`${definition.period}:${definition.timezone}`)!;

    // The period is the run's identity (see the schema). Asking again for a
    // period already built is the same question, so it returns the same answer
    // rather than sending an accountant a second copy of March.
    const [already] = await ctx.tx
      .select()
      .from(exportRuns)
      .where(
        and(
          eq(exportRuns.definitionId, definition.id),
          eq(exportRuns.periodFrom, period.from),
          eq(exportRuns.periodTo, period.to),
        ),
      );
    // A queued/sent file is immutable for the period, and a failed delivery
    // has its own explicit retry. A build refusal has no content, however, so
    // it may be rebuilt after the owner reduces the data or changes the shape.
    if (
      already &&
      already.status !== "built" &&
      !(already.status === "failed" && !already.content)
    ) {
      return summarize(already);
    }

    const shared = {
      definitionId: definition.id,
      definitionName: definition.name,
      trigger: input.trigger,
      periodFrom: period.from,
      periodTo: period.to,
      shape: definition.shape,
      basis: definition.basis,
      currency: definition.currency,
      timezone: definition.timezone,
      recipients: definition.recipients,
      startedAt: new Date(),
      updatedAt: new Date(),
    };

    /**
     * Write the outcome onto the one row for this period, new or retried.
     *
     * `attempts` is untouched here: it counts *deliveries*, and rebuilding a
     * file nobody has tried to send yet is not an attempt to send it.
     */
    const record = async (values: Partial<typeof exportRuns.$inferInsert>) => {
      if (already) {
        const [updated] = await ctx.tx
          .update(exportRuns)
          .set({ ...shared, ...values })
          .where(eq(exportRuns.id, already.id))
          .returning();
        return updated!;
      }
      const [created] = await ctx.tx
        .insert(exportRuns)
        .values({ ...shared, ...values })
        .returning();
      return created!;
    };

    const gathered = await gather(ctx, definition, period);
    const counted = {
      rowCount: gathered.rows.length,
      invoiceCount: gathered.invoiceCount,
      totalMinor: gathered.totalMinor,
      refundedMinor: gathered.refundedMinor,
      excludedCurrencies: gathered.excludedCurrencies,
      excludedInvoiceCount: gathered.excludedInvoiceCount,
    };

    if (gathered.truncated) {
      // A refusal, written down rather than thrown. A run that vanished
      // because the period was too big is the same silence as one that was
      // never attempted, and silence is the failure mode this table exists to
      // remove. Trimming the file instead would be worse still: an accountant
      // would import a month that is quietly short.
      const failed = await record({
        ...counted,
        status: "failed",
        failedAt: new Date(),
        error: `This period has more than ${MAX_ROWS} invoice lines, which is more than one import file should carry. Export a shorter period.`,
        content: null,
        filename: null,
        bytes: null,
        sha256: null,
      });
      ctx.setSubject("exportRun", failed.id);
      return summarize(failed);
    }

    const csv = buildExportCsv(gathered.rows, {
      shape: definition.shape,
      dateFormat: definition.dateFormat,
      timezone: definition.timezone,
      itemCode: definition.itemCode,
      accountCode: definition.accountCode,
      taxCode: definition.taxCode,
    });
    const inclusive = new Date(period.to.getTime() - 1);
    const filename = [
      slug(definition.name),
      definition.shape,
      definition.currency,
      exportDate(period.from, "iso", definition.timezone),
      "to",
      exportDate(inclusive, "iso", definition.timezone),
    ].join("-");

    const built = await record({
      ...counted,
      // Nothing to deliver is not the same as delivered: an export with no
      // recipients is a file waiting to be downloaded, and saying "delivered"
      // about it would make the one word that matters meaningless.
      status: definition.recipients.length === 0 ? "built" : "pending",
      filename: `${filename}.csv`,
      content: csv,
      bytes: Buffer.byteLength(csv, "utf8"),
      sha256: createHash("sha256").update(csv).digest("hex"),
      deliveredAt: null,
      failedAt: null,
      error: null,
    });

    ctx.setSubject("exportRun", built.id);
    ctx.queueEvent("report.exportBuilt", {
      runId: built.id,
      definitionId: definition.id,
      rows: built.rowCount,
    });
    if (built.status === "pending") {
      // Atomic with the built file: a request process may stop after commit,
      // but the work needed to stage its mail cannot disappear in that gap.
      await ctx.queueJob(
        "reports.prepareExportRun",
        { runId: built.id },
        {
          idempotencyKey: `export-prepare:${built.id}`,
          idempotencyTtlSeconds: 365 * 24 * 60 * 60,
        },
      );
    }
    return summarize(built);
  },
});

export const exportFile = defineService({
  name: "reports.exportFile",
  summary: "One built export, as the file itself.",
  kind: "query",
  permission: "scoped",
  input: z.object({ runId: uuidSchema }),
  output: row({ filename: z.string(), csv: z.string(), rowCount: z.number().int() }),
  handler: async (input, ctx) => {
    const [run] = await ctx.tx.select().from(exportRuns).where(eq(exportRuns.id, input.runId));
    if (!run) throw new ServiceError("not_found", "There is no such export run.");
    // A failed *delivery* must not destroy the file. If the mail could not go
    // out, the owner can still download this and send it by hand — which is
    // the whole difference between a delayed report and a lost one.
    if (!run.content || !run.filename) {
      throw new ServiceError("not_found", "That run produced no file.");
    }
    return { filename: run.filename, csv: run.content, rowCount: run.rowCount };
  },
});

export const listExportRuns = defineService({
  name: "reports.listExportRuns",
  summary: "What was sent, when, and whether it arrived.",
  kind: "query",
  permission: "scoped",
  input: z.object({ id: uuidSchema, limit: z.number().int().min(1).max(50).default(12) }),
  output: listed(runRow),
  handler: async (input, ctx) => {
    const found = await ctx.tx
      .select()
      .from(exportRuns)
      .where(eq(exportRuns.definitionId, input.id))
      .orderBy(desc(exportRuns.startedAt))
      .limit(input.limit);
    return found.map(summarize);
  },
});

/* -------------------------------------------------------------- delivering */

/**
 * Stage one built run for delivery, without contacting a provider.
 *
 * Deliberately a *second* transaction, called after the one that built the
 * file has committed. Building and sending in one transaction would mean a
 * failed send rolls the run row back too, and the evidence that a report did
 * not arrive would be destroyed by the same failure that stopped it arriving.
 *
 * `sendMail` writes encrypted outbox and ledger rows only. A worker submits
 * them after this transaction commits, and `settleExportRun` later derives the
 * run's state from those ledger rows. Queue acceptance is never called delivery.
 */
export const queueExportRunDelivery = defineService({
  name: "reports.queueExportRunDelivery",
  writeClass: "write",
  summary: "Queue a built export for its recipients and track every copy.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ runId: uuidSchema }),
  output: runRow,
  handler: async (input, ctx) => {
    // Serializes initial delivery, explicit retries and the recovery job. The
    // per-attempt unique key is the backstop; the row lock avoids turning an
    // ordinary race into a transaction error first.
    await ctx.tx.execute(sql`select id from export_runs where id = ${input.runId} for update`);
    const [run] = await ctx.tx.select().from(exportRuns).where(eq(exportRuns.id, input.runId));
    if (!run) throw new ServiceError("not_found", "There is no such export run.");
    if (!run.content || !run.filename) {
      throw new ServiceError("conflict", "That run has no file to deliver.");
    }
    if (run.status === "delivered") {
      throw new ServiceError("conflict", "That export was already sent.");
    }
    if (run.status === "pending" && run.attempts > 0) {
      const [current] = await ctx.tx
        .select({ id: exportRunDeliveries.id })
        .from(exportRunDeliveries)
        .where(
          and(
            eq(exportRunDeliveries.runId, run.id),
            eq(exportRunDeliveries.attempt, run.attempts),
          ),
        )
        .limit(1);
      if (current) return summarize(run);
    }
    // A failed run is retried only by an explicit action. Use the definition's
    // current addresses then, so correcting a typo is sufficient to recover;
    // every previous attempt keeps its own immutable recipient rows.
    const [currentDefinition] =
      run.status === "failed"
        ? await ctx.tx
            .select({ recipients: exportDefinitions.recipients })
            .from(exportDefinitions)
            .where(eq(exportDefinitions.id, run.definitionId))
        : [];
    const targetRecipients = currentDefinition?.recipients ?? run.recipients;
    if (targetRecipients.length === 0) {
      throw new ServiceError("conflict", "That export has nobody to deliver to.");
    }
    const attempt = run.attempts + 1;

    const business = await ctx.call(getBusiness, {});
    const locale = business?.defaultLocale ?? "en";
    const t = translator(locale);
    const site = business?.name ?? "Freeholder";
    const name = run.definitionName;
    const from = exportDate(run.periodFrom, "iso", run.timezone);
    const to = exportDate(new Date(run.periodTo.getTime() - 1), "iso", run.timezone);

    /*
     * A link, not an attachment, and on purpose.
     *
     * This file names every customer and what they paid. Attached, it is
     * copied into an inbox, a sent-items folder and every mail server between
     * here and there, none of which the business controls, and it stays there
     * for years. Each recipient instead gets a separate expiring bearer link;
     * only its HMAC is stored. The email carries the figures that let the
     * recipient tell at a glance whether the run is the one they expected.
     */
    const lines = [
      t("exports.email.intro", { name, site }),
      "",
      t("exports.email.period", { from, to }),
      t("exports.email.rows", { rows: run.rowCount, invoices: run.invoiceCount }),
      t("exports.email.total", {
        total: formatMoney(run.totalMinor, run.currency, locale),
      }),
      run.refundedMinor > 0
        ? t("exports.email.refunds", {
            refunded: formatMoney(run.refundedMinor, run.currency, locale),
          })
        : "",
      run.excludedCurrencies.length > 0
        ? t("exports.email.excluded", {
            count: run.excludedInvoiceCount,
            currencies: run.excludedCurrencies.join(", "),
            currency: run.currency,
          })
        : "",
    ].filter(Boolean);

    const failures: string[] = [];
    let queued = 0;
    for (const recipient of targetRecipients) {
      try {
        const token = newExportToken();
        const expiresAt = new Date(Date.now() + DOWNLOAD_DAYS * 24 * 60 * 60 * 1000);
        const link = `${env().APP_URL.replace(/\/+$/, "")}/report-exports/${token}`;
        const sent = await sendMail(
          ctx.tx,
          {
            to: recipient,
            subject: t("exports.email.subject", { name, from, to }),
            text: [...lines, "", t("exports.email.link", { days: DOWNLOAD_DAYS }), link].join(
              "\n",
            ),
          },
          {
            purpose: "transactional",
            requestedBy: actorString(ctx.actor),
            // Stable per run, per recipient and per attempt: a retried
            // delivery is a new attempt and must actually go out, while the
            // same attempt twice must not.
            idempotencyKey: `export-run:${run.id}:${attempt}:${recipient}`,
            requireDelivery: true,
          },
        );
        await ctx.tx.insert(exportRunDeliveries).values({
          runId: run.id,
          attempt,
          recipient,
          state: "queued",
          mailDeliveryId: sent.id,
          tokenHash: hashExportToken(token),
          expiresAt,
        });
        queued += 1;
      } catch (error) {
        // Suppression and missing configuration are ordinary, non-database
        // refusals. They still get a recipient row. A database/provider-queue
        // failure aborts the transaction so it can be retried atomically.
        if (!(error instanceof ServiceError)) throw error;
        const detail = error.message.slice(0, 500);
        failures.push(`${recipient}: ${detail}`);
        await ctx.tx.insert(exportRunDeliveries).values({
          runId: run.id,
          attempt,
          recipient,
          state: "failed",
          detail,
        });
      }
    }

    const allFailed = queued === 0;
    const [settled] = await ctx.tx
      .update(exportRuns)
      .set({
        status: allFailed ? "failed" : "pending",
        deliveredCount: 0,
        attempts: attempt,
        recipients: targetRecipients,
        deliveredAt: null,
        failedAt: allFailed ? new Date() : null,
        error: allFailed ? failures.join(" · ").slice(0, 2000) : null,
        updatedAt: new Date(),
      })
      .where(eq(exportRuns.id, run.id))
      .returning();

    ctx.setSubject("exportRun", run.id);
    if (allFailed) {
      // The event the notification hangs off. A failed delivery has to reach a
      // person: the whole failure mode here is that nobody notices.
      ctx.queueEvent("report.exportFailed", {
        id: run.id,
        name,
        detail: failures.join(" · ").slice(0, 500),
      });
    } else {
      await ctx.queueJob(
        "reports.settleExportRun",
        { runId: run.id, attempt },
        {
          idempotencyKey: `export-settle:${run.id}:${attempt}`,
          idempotencyTtlSeconds: 365 * 24 * 60 * 60,
          startAfter: 30,
        },
      );
    }
    return summarize(settled!);
  },
});

/** Settle one attempt from core/mail's durable provider evidence. */
export const settleExportRun = defineService({
  name: "reports.settleExportRun",
  writeClass: "write",
  summary: "Settle an export attempt from its mail-delivery ledger rows.",
  kind: "mutation",
  permission: "system",
  input: z.object({ runId: uuidSchema, attempt: z.number().int().positive() }),
  output: row({
    state: z.enum(["pending", "delivered", "failed", "stale"]),
    run: runRow,
  }),
  handler: async (input, ctx) => {
    if (ctx.actor.kind !== "system") {
      throw new ServiceError("permission", "Only trusted platform work settles a run.");
    }
    await ctx.tx.execute(sql`select id from export_runs where id = ${input.runId} for update`);
    const [run] = await ctx.tx.select().from(exportRuns).where(eq(exportRuns.id, input.runId));
    if (!run) throw new ServiceError("not_found", "There is no such export run.");
    if (run.attempts !== input.attempt) {
      return { state: "stale" as const, run: summarize(run) };
    }

    const copies = await ctx.tx
      .select({
        recipient: exportRunDeliveries.recipient,
        stage: exportRunDeliveries.state,
        detail: exportRunDeliveries.detail,
        mailDeliveryId: exportRunDeliveries.mailDeliveryId,
        mailStatus: mailDeliveries.status,
        mailError: mailDeliveries.lastError,
        submittedAt: mailDeliveries.submittedAt,
        deliveredAt: mailDeliveries.deliveredAt,
      })
      .from(exportRunDeliveries)
      .leftJoin(mailDeliveries, eq(mailDeliveries.id, exportRunDeliveries.mailDeliveryId))
      .where(
        and(
          eq(exportRunDeliveries.runId, run.id),
          eq(exportRunDeliveries.attempt, input.attempt),
        ),
      );

    const successes = copies.filter(
      (copy) => copy.stage === "queued" && ["submitted", "delivered"].includes(copy.mailStatus ?? ""),
    );
    const pending = copies.filter(
      (copy) => copy.stage === "queued" && copy.mailStatus === "queued",
    );
    if (pending.length > 0) {
      return { state: "pending" as const, run: summarize(run) };
    }

    const failures = copies
      .filter((copy) => !successes.includes(copy))
      .map((copy) => {
        const reason =
          copy.detail ??
          copy.mailError ??
          (copy.mailDeliveryId ? `mail status ${copy.mailStatus ?? "missing"}` : "mail record missing");
        return `${copy.recipient}: ${reason}`;
      });
    if (copies.length === 0) failures.push("No recipient delivery records survived this attempt.");
    else if (copies.length !== run.recipients.length) {
      failures.push(
        `${run.recipients.length - copies.length} recipient delivery record(s) are missing from this attempt.`,
      );
    }

    const failed = failures.length > 0;
    const error = failed ? failures.join(" · ").slice(0, 2000) : null;
    const previousStatus = run.status;
    const deliveredAt = successes.reduce<Date | null>((latest, copy) => {
      const candidate = copy.deliveredAt ?? copy.submittedAt;
      return candidate && (!latest || candidate > latest) ? candidate : latest;
    }, null);
    const [settled] = await ctx.tx
      .update(exportRuns)
      .set({
        status: failed ? "failed" : "delivered",
        deliveredCount: successes.length,
        deliveredAt: failed ? null : (deliveredAt ?? new Date()),
        failedAt: failed ? new Date() : null,
        error,
        updatedAt: new Date(),
      })
      .where(eq(exportRuns.id, run.id))
      .returning();

    ctx.setSubject("exportRun", run.id);
    if (failed && previousStatus !== "failed") {
      ctx.queueEvent("report.exportFailed", {
        id: run.id,
        name: run.definitionName,
        detail: error?.slice(0, 500) ?? "Delivery failed.",
      });
    } else if (!failed && previousStatus !== "delivered") {
      ctx.queueEvent("report.exportDelivered", {
        runId: run.id,
        recipients: successes.length,
      });
    }
    return {
      state: failed ? ("failed" as const) : ("delivered" as const),
      run: summarize(settled!),
    };
  },
});

/**
 * Recipient download: an expiring bearer grant, not a staff session.
 *
 * The token is HMACed before lookup and redacted by the service audit layer.
 * It becomes usable only after core/mail has evidence that a delivering
 * provider accepted that exact recipient's message.
 */
export const downloadExportForRecipient = defineService({
  name: "reports.downloadExport",
  writeClass: "write",
  summary: "Download the export named by an unexpired recipient link.",
  kind: "mutation",
  permission: "public",
  agentCallable: false,
  mcpExclude: true,
  rateLimit: {
    limit: 30,
    windowSeconds: 15 * 60,
    subject: (input) => `report-export:${hashExportToken(input.token)}`,
    message: "Too many download attempts. Wait a few minutes and try again.",
  },
  input: z.object({ token: z.string().min(20).max(200) }),
  output: row({ filename: z.string(), csv: z.string(), rowCount: z.number().int() }),
  handler: async (input, ctx) => {
    const [found] = await ctx.tx
      .select({
        deliveryId: exportRunDeliveries.id,
        runId: exportRuns.id,
        filename: exportRuns.filename,
        csv: exportRuns.content,
        rowCount: exportRuns.rowCount,
      })
      .from(exportRunDeliveries)
      .innerJoin(exportRuns, eq(exportRuns.id, exportRunDeliveries.runId))
      .innerJoin(mailDeliveries, eq(mailDeliveries.id, exportRunDeliveries.mailDeliveryId))
      .where(
        and(
          eq(exportRunDeliveries.tokenHash, hashExportToken(input.token)),
          isNull(exportRunDeliveries.revokedAt),
          gt(exportRunDeliveries.expiresAt, new Date()),
          inArray(mailDeliveries.status, ["submitted", "delivered"]),
        ),
      )
      .limit(1);
    if (!found?.filename || !found.csv) {
      throw new ServiceError("not_found", "That download link is invalid or has expired.");
    }
    await ctx.tx
      .update(exportRunDeliveries)
      .set({
        downloadedAt: new Date(),
        downloadCount: sql`${exportRunDeliveries.downloadCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(exportRunDeliveries.id, found.deliveryId));
    ctx.setSubject("exportRun", found.runId);
    return { filename: found.filename, csv: found.csv, rowCount: found.rowCount };
  },
});

/** Reconcile in-flight runs and late provider failures, one short transaction each. */
export async function reconcileExportRuns(limit = 200): Promise<{
  checked: number;
  delivered: number;
  failed: number;
  pending: number;
}> {
  const candidates = await db()
    .selectDistinct({
      id: exportRuns.id,
      attempt: exportRuns.attempts,
      startedAt: exportRuns.startedAt,
    })
    .from(exportRuns)
    .leftJoin(
      exportRunDeliveries,
      and(
        eq(exportRunDeliveries.runId, exportRuns.id),
        eq(exportRunDeliveries.attempt, exportRuns.attempts),
      ),
    )
    .leftJoin(mailDeliveries, eq(mailDeliveries.id, exportRunDeliveries.mailDeliveryId))
    .where(
      or(
        eq(exportRuns.status, "pending"),
        and(
          eq(exportRuns.status, "delivered"),
          inArray(mailDeliveries.status, ["bounced", "complained", "failed", "suppressed"]),
        ),
      ),
    )
    .orderBy(asc(exportRuns.startedAt))
    .limit(limit);

  const totals = { checked: 0, delivered: 0, failed: 0, pending: 0 };
  for (const candidate of candidates) {
    totals.checked += 1;
    if (candidate.attempt === 0) {
      const run = await queueExportRunDelivery.call({ runId: candidate.id }, { kind: "system" });
      if (run.status === "failed") totals.failed += 1;
      else totals.pending += 1;
      continue;
    }
    const result = await settleExportRun.call(
      { runId: candidate.id, attempt: candidate.attempt },
      { kind: "system" },
    );
    if (result.state === "delivered") totals.delivered += 1;
    else if (result.state === "failed") totals.failed += 1;
    else totals.pending += 1;
  }
  return totals;
}

export default [
  saveExport,
  deleteExport,
  listExports,
  runExport,
  exportFile,
  listExportRuns,
  queueExportRunDelivery,
  settleExportRun,
  downloadExportForRecipient,
];
