// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// What invoicing puts in the daily briefing (MASTER.md §42, C4.16).
//
// Money is integer minor units all the way to the string, and the string is
// built by the platform's formatter rather than by dividing here (§4.7).
import { z } from "zod";
import { and, asc, eq, lt, sql } from "drizzle-orm";
import { contacts } from "@/core/contacts/schema";
import { invoices } from "@/modules/invoicing/schema";
import { formatMoney } from "@/core/i18n";
import { currentBusiness } from "@/core/settings/read";
import { defineService } from "@/core/service";
import { briefingContribution } from "@/core/briefing/registry";

export const overdueInvoices = defineService({
  name: "invoicing.briefingOverdue",
  summary: "Invoices that are past their due date and still unpaid.",
  kind: "query",
  permission: "system",
  input: z.object({
    userId: z.uuid(),
    onDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    timezone: z.string().min(1).max(80),
  }),
  output: briefingContribution,
  handler: async (input, ctx) => {
    const rows = await ctx.tx
      .select({
        id: invoices.id,
        number: invoices.number,
        currency: invoices.currency,
        totalMinor: invoices.totalMinor,
        paidMinor: invoices.paidMinor,
        dueAt: invoices.dueAt,
        contactName: contacts.name,
      })
      .from(invoices)
      .innerJoin(contacts, eq(contacts.id, invoices.contactId))
      .where(
        and(
          // Sent-but-unpaid as well as explicitly `overdue`: an invoice does
          // not stop being late because a status sweep has not run yet.
          sql`${invoices.status} in ('sent', 'viewed', 'partially_paid', 'overdue')`,
          lt(invoices.dueAt, sql`now()`),
        ),
      )
      .orderBy(asc(invoices.dueAt))
      .limit(15);
    if (rows.length === 0) return null;

    const business = await currentBusiness().catch(() => null);
    const locale = business?.defaultLocale ?? "en";
    const days = (dueAt: Date): number =>
      Math.max(0, Math.floor((Date.now() - dueAt.getTime()) / 86_400_000));

    return {
      title: "Overdue invoices",
      severity: "attention" as const,
      items: rows.map((row) => ({
        label: row.contactName ?? row.number ?? "An invoice",
        href: `/admin/invoices/${row.id}`,
        // What is still owed, not what was billed: an invoice half paid is
        // half a problem, and showing the full amount would overstate it.
        detail: `${formatMoney(row.totalMinor - row.paidMinor, row.currency, locale)} · ${
          row.dueAt ? `${days(row.dueAt)} days late` : "past due"
        }`,
      })),
    };
  },
});

export default [overdueInvoices];
