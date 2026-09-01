// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Reports an owner will actually read (MASTER.md §2535, §4.7, §43 C9.08).
//
// Three rules run through all of it.
//
// **Money keeps its currency.** §4.9 forbids converting at charge time, and a
// report that adds CAD to EUR to make one impressive number would be doing
// exactly that with extra steps. Every figure here is grouped by currency and
// returned per currency, even when a business has only one — the shape should
// not change the first time somebody is invoiced in another.
//
// **Revenue means money that arrived.** Paid invoices, dated by `paid_at`
// rather than by when the invoice was written, less anything refunded. An
// invoice sent in March and settled in May is May's revenue, because that is
// the month the business could spend it.
//
// **A number says how it was made.** `reports.definitions` returns the same
// plain-English lines as C9.07's funnel does, for the same reason: a business
// that cannot say how a figure was reached cannot defend it to an accountant.
import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { listed, row, timestamp, uuid as uuidSchema } from "@/core/contract";
import { defineService, ServiceError, getService } from "@/core/service";
import { invoices } from "@/modules/invoicing/schema";
import {
  REVENUE_DIMENSIONS,
  availableRevenueDimensions,
  revenueSourcesFor,
  type RevenueWindow,
} from "@/core/reporting/dimensions";
import { REPORT_KEYS, reportViews } from "./schema";

const days = z.number().int().min(1).max(1095).default(90);
const timezone = z.string().trim().min(1).max(100).default("UTC");

/** Half-open, like every other window in the platform: `from` ≤ at < `to`. */
function windowOf(count: number): RevenueWindow {
  const to = new Date();
  return { from: new Date(to.getTime() - count * 86_400_000), to };
}

const moneyRow = row({
  currency: z.string(),
  amountMinor: z.number().int(),
});

export const revenueReport = defineService({
  name: "reports.revenue",
  summary: "Money that arrived, by month and currency.",
  kind: "query",
  permission: "scoped",
  input: z.object({ days, timezone }),
  output: row({
    from: timestamp,
    to: timestamp,
    months: listed(
      row({
        month: z.string(),
        currency: z.string(),
        /** Paid, less refunded. What the business actually kept. */
        amountMinor: z.number().int(),
        paidMinor: z.number().int(),
        refundedMinor: z.number().int(),
        invoices: z.number().int(),
      }),
    ),
    totals: listed(moneyRow),
  }),
  handler: async (input, ctx) => {
    const window = windowOf(input.days);
    // Raw rather than composed: the month bucket has to appear identically in
    // the select and the group by, and a query builder that qualifies a column
    // in one and not the other produces SQL Postgres will not accept.
    //
    // Bucketed in the business's timezone, like the traffic chart: an owner
    // closing their books for March means their March.
    const result = await ctx.tx.execute(sql`
      select to_char(
               date_trunc('month', ${invoices.paidAt} at time zone ${input.timezone}),
               'YYYY-MM'
             ) as month,
             ${invoices.currency} as currency,
             coalesce(sum(${invoices.paidMinor}), 0)::bigint as paid_minor,
             coalesce(sum(${invoices.refundedMinor}), 0)::bigint as refunded_minor,
             count(*)::int as invoice_count
      from ${invoices}
      where ${invoices.paidAt} is not null
        and ${invoices.paidAt} >= ${window.from.toISOString()}::timestamptz
        and ${invoices.paidAt} < ${window.to.toISOString()}::timestamptz
      group by 1, 2
      order by 1 asc, 2 asc
    `);

    const rows = (
      result as unknown as Array<{
        month: string;
        currency: string;
        paid_minor: string | number;
        refunded_minor: string | number;
        invoice_count: number;
      }>
    ).map((each) => ({
      month: each.month,
      currency: each.currency,
      paidMinor: Number(each.paid_minor),
      refundedMinor: Number(each.refunded_minor),
      amountMinor: Number(each.paid_minor) - Number(each.refunded_minor),
      invoices: Number(each.invoice_count),
    }));

    const byCurrency = new Map<string, number>();
    for (const each of rows) {
      byCurrency.set(each.currency, (byCurrency.get(each.currency) ?? 0) + each.amountMinor);
    }

    return {
      from: window.from,
      to: window.to,
      months: rows,
      totals: [...byCurrency.entries()]
        .map(([currency, amountMinor]) => ({ currency, amountMinor }))
        .sort((a, b) => b.amountMinor - a.amountMinor),
    };
  },
});

export const revenueByReport = defineService({
  name: "reports.revenueBy",
  summary: "Money that arrived, cut by service, product or location.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    dimension: z.enum(REVENUE_DIMENSIONS),
    days,
    limit: z.number().int().min(1).max(100).default(25),
  }),
  output: row({
    dimension: z.enum(REVENUE_DIMENSIONS),
    /** Which of the two ways this dimension's money was arrived at. */
    basis: z.enum(["invoice", "lines"]),
    from: timestamp,
    to: timestamp,
    buckets: listed(
      row({
        bucket: z.string(),
        currency: z.string(),
        amountMinor: z.number().int(),
      }),
    ),
  }),
  handler: async (input, ctx) => {
    const sources = revenueSourcesFor(input.dimension);
    if (sources.length === 0) {
      throw new ServiceError(
        "not_found",
        "Nothing installed can answer that question about revenue.",
      );
    }
    const window = windowOf(input.days);
    const basis = sources[0]!.basis;

    const parts = sql.join(
      sources.map((source) => sql`(${source.rows(window)})`),
      sql` union all `,
    );

    // For an `invoice` basis the figure is the invoice's own net paid amount,
    // and `distinct` guards the case where two sources name the same invoice:
    // an invoice must be counted once even if two modules can both explain it.
    const amount =
      basis === "invoice"
        ? sql`sum(distinct_paid.net)`
        : sql`sum(source.amount_minor)`;
    const from =
      basis === "invoice"
        ? sql`(
            select distinct on (source.invoice_id, source.bucket)
                   source.bucket,
                   ${invoices.currency} as currency,
                   (${invoices.paidMinor} - ${invoices.refundedMinor}) as net
            from (${parts}) as source
            join ${invoices} on ${invoices.id} = source.invoice_id
          ) as distinct_paid`
        : sql`(${parts}) as source
            join ${invoices} on ${invoices.id} = source.invoice_id`;
    const bucketColumn = basis === "invoice" ? sql`distinct_paid.bucket` : sql`source.bucket`;
    const currencyColumn =
      basis === "invoice" ? sql`distinct_paid.currency` : sql`${invoices.currency}`;

    const result = await ctx.tx.execute(sql`
      select ${bucketColumn} as bucket,
             ${currencyColumn} as currency,
             ${amount}::bigint as amount_minor
      from ${from}
      group by 1, 2
      order by 3 desc
      limit ${input.limit}
    `);

    const rows = result as unknown as Array<{
      bucket: string;
      currency: string;
      amount_minor: string | number;
    }>;

    return {
      dimension: input.dimension,
      basis,
      from: window.from,
      to: window.to,
      buckets: rows.map((each) => ({
        bucket: each.bucket,
        currency: each.currency,
        amountMinor: Number(each.amount_minor),
      })),
    };
  },
});

export const cohortReport = defineService({
  name: "reports.cohort",
  summary: "What each month's new customers went on to spend.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    months: z.number().int().min(2).max(36).default(12),
    timezone,
  }),
  output: row({
    /** Cohort month → what they spent in the months since. */
    cohorts: listed(
      row({
        cohort: z.string(),
        currency: z.string(),
        customers: z.number().int(),
        cells: listed(
          row({
            /** 0 is the month they first paid. */
            monthsSince: z.number().int(),
            amountMinor: z.number().int(),
            customers: z.number().int(),
          }),
        ),
      }),
    ),
  }),
  handler: async (input, ctx) => {
    // A cohort is dated by a customer's *first* payment, not by when they
    // became a contact: somebody on the list for two years who buys today is
    // this month's new customer, and treating them as an old one would credit
    // a month that earned nothing.
    const result = await ctx.tx.execute(sql`
      with paid as (
        select ${invoices.contactId} as contact_id,
               ${invoices.currency} as currency,
               (${invoices.paidMinor} - ${invoices.refundedMinor}) as net,
               date_trunc('month', ${invoices.paidAt} at time zone ${input.timezone}) as month
        from ${invoices}
        where ${invoices.paidAt} is not null
          and ${invoices.contactId} is not null
      ),
      first_payment as (
        select contact_id, currency, min(month) as cohort
        from paid
        group by contact_id, currency
      )
      select to_char(f.cohort, 'YYYY-MM') as cohort,
             p.currency as currency,
             (extract(year from age(p.month, f.cohort)) * 12
               + extract(month from age(p.month, f.cohort)))::int as months_since,
             sum(p.net)::bigint as amount_minor,
             count(distinct p.contact_id)::int as customers
      from paid p
      join first_payment f
        on f.contact_id = p.contact_id and f.currency = p.currency
      where f.cohort >= date_trunc('month', now() at time zone ${input.timezone})
            - make_interval(months => ${input.months - 1})
      group by 1, 2, 3
      order by 1, 2, 3
    `);

    const rows = result as unknown as Array<{
      cohort: string;
      currency: string;
      months_since: number;
      amount_minor: string | number;
      customers: number;
    }>;

    const grouped = new Map<
      string,
      {
        cohort: string;
        currency: string;
        customers: number;
        cells: Array<{ monthsSince: number; amountMinor: number; customers: number }>;
      }
    >();
    for (const each of rows) {
      const key = `${each.cohort}:${each.currency}`;
      const entry = grouped.get(key) ?? {
        cohort: each.cohort,
        currency: each.currency,
        customers: 0,
        cells: [],
      };
      const cell = {
        monthsSince: Number(each.months_since),
        amountMinor: Number(each.amount_minor),
        customers: Number(each.customers),
      };
      // The cohort's size is how many were in it at month nought — the number
      // every later month should be read against.
      if (cell.monthsSince === 0) entry.customers = cell.customers;
      entry.cells.push(cell);
      grouped.set(key, entry);
    }

    return { cohorts: [...grouped.values()] };
  },
});

/**
 * The funnel, borrowed rather than rebuilt.
 *
 * §2535 lists a funnel among the reports an owner should get, and C9.07 built
 * one. Asking `analytics.funnel` rather than writing a second query is the
 * whole point of C7.17: two definitions of "lead" in one product is how a
 * business ends up with two numbers and no way to choose.
 */
export const funnelReport = defineService({
  name: "reports.funnel",
  summary: "The visit-to-paid funnel, as the analytics module defines it.",
  kind: "query",
  permission: "scoped",
  input: z.object({ days }),
  output: z.unknown(),
  handler: (input, ctx) => ctx.call(getService("analytics.funnel"), { days: input.days }),
});

export const reportDefinitions = defineService({
  name: "reports.definitions",
  summary: "What each report counts, in plain words.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: row({
    reports: listed(
      row({
        key: z.enum(REPORT_KEYS),
        labelKey: z.string(),
        definitionKey: z.string(),
      }),
    ),
    dimensions: listed(
      row({
        dimension: z.enum(REVENUE_DIMENSIONS),
        available: z.boolean(),
        basis: z.enum(["invoice", "lines"]).nullable(),
        sources: listed(row({ module: z.string(), definitionKey: z.string() })),
      }),
    ),
  }),
  handler: async () => {
    const available = new Set(availableRevenueDimensions());
    return {
      reports: REPORT_KEYS.map((key) => ({
        key,
        labelKey: `reports.label.${key}`,
        definitionKey: `reports.definition.${key}`,
      })),
      dimensions: REVENUE_DIMENSIONS.map((dimension) => {
        const sources = revenueSourcesFor(dimension);
        return {
          dimension,
          available: available.has(dimension),
          basis: sources[0]?.basis ?? null,
          sources: sources.map((each) => ({
            module: each.module,
            definitionKey: each.definitionKey,
          })),
        };
      }),
    };
  },
});

/* ------------------------------------------------------------ saved views */

const viewRow = row({
  id: uuidSchema,
  name: z.string(),
  key: z.enum(REPORT_KEYS),
  params: z.record(z.string(), z.unknown()),
  updatedAt: timestamp,
});

export const saveReportView = defineService({
  name: "reports.saveView",
  writeClass: "write",
  summary: "Keep a report's question under a name.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    id: uuidSchema.optional(),
    name: z.string().trim().min(1).max(120),
    key: z.enum(REPORT_KEYS),
    params: z.record(z.string(), z.unknown()).default({}),
  }),
  output: viewRow,
  handler: async (input, ctx) => {
    // Validated against the report's own input before it is stored, so a saved
    // view cannot become a question the report will not answer — the failure
    // an owner would otherwise meet weeks later, on opening it.
    const report = REPORTS[input.key];
    const checked = report.def.input.safeParse(input.params);
    if (!checked.success) {
      throw new ServiceError(
        "validation",
        `Those are not settings ${input.key} accepts: ${checked.error.issues[0]?.message ?? "invalid"}.`,
      );
    }

    const values = { name: input.name, key: input.key, params: checked.data as object };
    if (input.id) {
      const [updated] = await ctx.tx
        .update(reportViews)
        .set(values)
        .where(eq(reportViews.id, input.id))
        .returning();
      if (!updated) throw new ServiceError("not_found", "There is no such saved view.");
      ctx.setSubject("reportView", updated.id);
      return updated;
    }
    const [created] = await ctx.tx.insert(reportViews).values(values).returning();
    ctx.setSubject("reportView", created!.id);
    ctx.queueEvent("report.viewSaved", { viewId: created!.id, key: created!.key });
    return created!;
  },
});

export const listReportViews = defineService({
  name: "reports.listViews",
  summary: "Saved views, by name.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: listed(viewRow),
  handler: (_input, ctx) =>
    ctx.tx.select().from(reportViews).orderBy(asc(reportViews.name)).limit(200),
});

export const deleteReportView = defineService({
  name: "reports.deleteView",
  writeClass: "write",
  summary: "Forget a saved view.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id: uuidSchema }),
  output: row({ deleted: z.boolean() }),
  handler: async (input, ctx) => {
    const gone = await ctx.tx
      .delete(reportViews)
      .where(eq(reportViews.id, input.id))
      .returning({ id: reportViews.id });
    if (gone.length === 0) throw new ServiceError("not_found", "There is no such saved view.");
    ctx.setSubject("reportView", input.id);
    return { deleted: true };
  },
});

/** Which service answers each saved view's key. */
const REPORTS = {
  revenue: revenueReport,
  revenueBy: revenueByReport,
  cohort: cohortReport,
  funnel: funnelReport,
} as const;

export default [
  revenueReport,
  revenueByReport,
  cohortReport,
  funnelReport,
  reportDefinitions,
  saveReportView,
  listReportViews,
  deleteReportView,
];
