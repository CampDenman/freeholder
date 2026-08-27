// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// What forms puts in the daily briefing (MASTER.md §42, C4.16).
//
// A module contributes a section by declaring this service in its manifest,
// the same way it declares sitemap sources. Nothing in core knows enquiries
// exist; switch the module off and the section goes with it.
import { z } from "zod";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { forms, formSubmissions } from "@/modules/forms/schema";
import { zonedInstant } from "@/core/i18n/zoned";
import { defineService } from "@/core/service";
import { briefingContribution } from "@/core/briefing/registry";

export const enquiriesSinceYesterday = defineService({
  name: "forms.briefingEnquiries",
  summary: "Enquiries that arrived since yesterday morning.",
  kind: "query",
  permission: "system",
  input: z.object({
    userId: z.uuid(),
    onDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    timezone: z.string().min(1).max(80),
  }),
  output: briefingContribution,
  handler: async (input, ctx) => {
    const [year, month, day] = input.onDate.split("-").map(Number) as [
      number,
      number,
      number,
    ];
    // Since yesterday morning, not "the last 24 hours": a briefing read on
    // Monday should cover the weekend's enquiries, and a rolling window would
    // have quietly dropped them.
    const since = zonedInstant(input.timezone, { year, month, day: day - 1 });

    const rows = await ctx.tx
      .select({
        id: formSubmissions.id,
        formName: forms.name,
        createdAt: formSubmissions.createdAt,
      })
      .from(formSubmissions)
      .innerJoin(forms, eq(forms.id, formSubmissions.formId))
      .where(
        and(
          gte(formSubmissions.createdAt, since),
          // Quarantined spam is reviewable (§36) but it is not an enquiry,
          // and a briefing that counted it would train people to ignore the
          // number.
          eq(formSubmissions.status, "received"),
        ),
      )
      .orderBy(desc(formSubmissions.createdAt))
      .limit(15);
    if (rows.length === 0) return null;

    const [{ total } = { total: rows.length }] = await ctx.tx
      .select({ total: sql<number>`count(*)::int` })
      .from(formSubmissions)
      .where(
        and(
          gte(formSubmissions.createdAt, since),
          eq(formSubmissions.status, "received"),
        ),
      );

    const clock = new Intl.DateTimeFormat("en-GB", {
      timeZone: input.timezone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
    return {
      title: "New enquiries",
      severity: "attention" as const,
      body:
        total > rows.length
          ? `${total} since yesterday; the most recent ${rows.length} are below.`
          : undefined,
      items: rows.map((row) => ({
        // Never the submitted fields themselves. What somebody typed into a
        // form is not summary material, and the enquiry is one click away.
        label: row.formName,
        href: `/admin/forms/submissions/${row.id}`,
        detail: clock.format(row.createdAt),
      })),
    };
  },
});

export default [enquiriesSinceYesterday];
