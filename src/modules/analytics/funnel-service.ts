// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Visit → lead → quote/booking/cart → invoice → paid (MASTER.md §4.7, C9.07).
//
// The numbers here are *period counts*, not a cohort walked forward in time,
// and the difference matters enough to be said on the screen as well as here.
// A period count answers "how many people reached this stage last month". A
// cohort walk answers "of the people who first visited in January, how many
// eventually paid" — a different, slower question that C9.08's cohort reports
// are for.
//
// Choosing period counts is not laziness. A cohort funnel drawn over a real
// business collapses almost to nothing, because most customers never visited
// the site before the work began: the walk-in, the referral, the phone call.
// A chart claiming a 0.4% conversion rate would be arithmetically true and
// wrong about the business, and an owner would rightly stop reading it.
//
// What that costs is the honest caveat that a person can appear in a later
// band without appearing in an earlier one. Rather than hide it, every band
// also reports how many of its people were in the previous band — so the
// overlap the drop-off rate implies can be checked rather than assumed.
import { sql } from "drizzle-orm";
import { z } from "zod";
import { listed, row } from "@/core/contract";
import { defineService } from "@/core/service";
import {
  FUNNEL_BANDS,
  funnelBandStages,
  funnelStages,
  type FunnelBand,
  type FunnelStage,
  type FunnelWindow,
} from "@/core/funnel/stages";

/** The union of a set of stages: everybody who reached any one of them. */
function union(stages: readonly FunnelStage[], window: FunnelWindow) {
  return sql.join(
    stages.map((stage) => sql`(${stage.people(window)})`),
    sql` union `,
  );
}

export const funnel = defineService({
  name: "analytics.funnel",
  summary: "How many people reached each stage, from visit to paid.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    days: z.number().int().min(1).max(365).default(30),
  }),
  output: row({
    from: z.date(),
    to: z.date(),
    bands: listed(
      row({
        band: z.enum(FUNNEL_BANDS),
        people: z.number().int(),
        /** The band before this one that had any stages at all. */
        previousBand: z.enum(FUNNEL_BANDS).nullable(),
        /**
         * How many of this band's people were also in that one.
         *
         * Not the same as `people`, and the gap is the point: it is the number
         * that says whether the drop-off rate above it describes the same
         * humans moving along, or two populations that happen to be adjacent.
         */
        fromPrevious: z.number().int().nullable(),
        stages: listed(
          row({
            key: z.string(),
            module: z.string(),
            labelKey: z.string(),
            definitionKey: z.string(),
            people: z.number().int(),
          }),
        ),
      }),
    ),
  }),
  handler: async (input, ctx) => {
    const to = new Date();
    const from = new Date(to.getTime() - input.days * 86_400_000);
    const window: FunnelWindow = { from, to };

    const counted = async (fragment: ReturnType<typeof sql.join>) => {
      const result = await ctx.tx.execute(
        sql`select count(*)::int as n from (${fragment}) as reached`,
      );
      const rows = result as unknown as Array<{ n: number }>;
      return Number(rows[0]?.n ?? 0);
    };

    const bands = [];
    // Carried rather than recomputed: the previous band is whichever one last
    // had somebody to count, so an uninstalled module leaves no hole in the
    // chart for a reader to misread as a collapse in conversion.
    let previous: { band: FunnelBand; stages: readonly FunnelStage[] } | null = null;

    for (const band of FUNNEL_BANDS) {
      const stages = funnelBandStages(band);
      if (stages.length === 0) continue;

      const people = await counted(union(stages, window));
      const fromPrevious = previous
        ? await counted(
            sql.join(
              [
                sql`select person from (${union(stages, window)}) as here`,
                sql`select person from (${union(previous.stages, window)}) as before_`,
              ],
              sql` intersect `,
            ),
          )
        : null;

      bands.push({
        band,
        people,
        previousBand: previous?.band ?? null,
        fromPrevious,
        stages: await Promise.all(
          stages.map(async (stage) => ({
            key: stage.key,
            module: stage.module,
            labelKey: stage.labelKey,
            definitionKey: stage.definitionKey,
            people: await counted(union([stage], window)),
          })),
        ),
      });
      // The `returned` band is what happens after the funnel, so it is never
      // anybody's "previous": a refund must not become the denominator of a
      // conversion rate.
      if (band !== "returned") previous = { band, stages };
    }

    return { from, to, bands };
  },
});

/**
 * What every number on the funnel is made of.
 *
 * C9.07 asks for the query definitions to be inspectable, and this is that:
 * one row per stage, naming the module that answers for it and stating in
 * plain words what it counts. A business that cannot say how a number was
 * reached cannot defend it — to an accountant, to an ad platform, or to
 * itself — and "leads" is the word most likely to mean three things at once.
 */
export const funnelDefinitions = defineService({
  name: "analytics.funnelDefinitions",
  summary: "What each funnel stage and attribution model counts, in plain words.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: row({
    stages: listed(
      row({
        key: z.string(),
        module: z.string(),
        band: z.enum(FUNNEL_BANDS),
        labelKey: z.string(),
        definitionKey: z.string(),
      }),
    ),
    attribution: listed(
      row({
        model: z.enum(["first_touch", "last_touch"]),
        labelKey: z.string(),
        definitionKey: z.string(),
      }),
    ),
  }),
  handler: async () => ({
    stages: funnelStages().map((stage) => ({
      key: stage.key,
      module: stage.module,
      band: stage.band,
      labelKey: stage.labelKey,
      definitionKey: stage.definitionKey,
    })),
    // The two models `analytics.campaignAttribution` already offers, said out
    // loud. Which one a report used is not a detail: first and last touch
    // routinely disagree about which channel deserves the credit, and an owner
    // comparing two numbers needs to know they were asked different questions.
    attribution: [
      {
        model: "first_touch" as const,
        labelKey: "funnel.attribution.firstTouch",
        definitionKey: "funnel.definition.firstTouch",
      },
      {
        model: "last_touch" as const,
        labelKey: "funnel.attribution.lastTouch",
        definitionKey: "funnel.definition.lastTouch",
      },
    ],
  }),
});

export default [funnel, funnelDefinitions];
