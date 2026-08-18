// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Experiment impressions and conversions (C2.18).
//
// Outcomes live on the analytics ledger so they join contacts and money
// through the same contact_id as every other event. Reporting refuses to
// crown a winner when there are too few unique visitors.
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { listed, row } from "@/core/contract";
import { defineService } from "@/core/service";
import { analyticsEvents } from "./schema";

export const MIN_COMPARE_VISITORS = 30;

function dayKey(at = new Date()): string {
  return at.toISOString().slice(0, 10);
}

export function comparable(uniqueVisitors: number): boolean {
  return uniqueVisitors >= MIN_COMPARE_VISITORS;
}

export const recordExperimentImpressions = defineService({
  name: "analytics.recordExperimentImpressions",
  summary: "Record one impression per experiment for this visitor today.",
  kind: "mutation",
  permission: "public",
  input: z.object({
    anonId: z.string().min(1).max(64),
    sessionId: z.string().min(1).max(64),
    path: z.string().max(2000).default("/"),
    locale: z.string().max(20).optional(),
    assignments: z.record(z.string().min(1).max(80), z.string().min(1).max(40)),
  }),
  output: z.object({ recorded: z.number().int() }),
  handler: async (input, ctx) => {
    const { track } = await import("./service");
    const day = dayKey();
    let recorded = 0;
    for (const [experimentKey, variant] of Object.entries(input.assignments)) {
      await ctx.call(track, {
        anonId: input.anonId,
        sessionId: input.sessionId,
        name: "experiment.impressed",
        eventKey: `exp.imp:${input.anonId}:${experimentKey}:${day}`,
        path: input.path,
        locale: input.locale,
        props: { experimentKey, variant },
      });
      recorded += 1;
    }
    return { recorded };
  },
});

export const recordExperimentConversion = defineService({
  name: "analytics.recordExperimentConversion",
  summary: "Attribute a conversion to this visitor's current experiments.",
  kind: "mutation",
  permission: "public",
  input: z.object({
    anonId: z.string().min(1).max(64),
    sessionId: z.string().min(1).max(64),
    contactId: z.string().uuid().optional(),
    kind: z.string().min(1).max(40),
    amountMinor: z.number().int().nonnegative().optional(),
    currency: z.string().length(3).optional(),
    path: z.string().max(2000).default("/"),
  }),
  output: z.object({
    recorded: z.number().int(),
    experiments: z.number().int(),
  }),
  handler: async (input, ctx) => {
    const rows = await ctx.tx
      .select({ props: analyticsEvents.props })
      .from(analyticsEvents)
      .where(
        and(
          eq(analyticsEvents.anonId, input.anonId),
          eq(analyticsEvents.name, "experiment.impressed"),
        ),
      );
    const latest = new Map<string, string>();
    for (const row of rows) {
      const props = row.props as { experimentKey?: unknown; variant?: unknown };
      if (typeof props.experimentKey === "string" && typeof props.variant === "string") {
        latest.set(props.experimentKey, props.variant);
      }
    }
    const { track } = await import("./service");
    const day = dayKey();
    let recorded = 0;
    for (const [experimentKey, variant] of latest) {
      await ctx.call(track, {
        anonId: input.anonId,
        sessionId: input.sessionId,
        contactId: input.contactId,
        name: "experiment.converted",
        eventKey: `exp.conv:${input.anonId}:${experimentKey}:${input.kind}:${day}`,
        path: input.path,
        props: {
          experimentKey,
          variant,
          kind: input.kind,
          amountMinor: input.amountMinor ?? null,
          currency: input.currency ?? null,
        },
      });
      recorded += 1;
    }
    return { recorded, experiments: latest.size };
  },
});

export interface ExperimentVariantRow {
  variant: string;
  impressions: number;
  uniqueVisitors: number;
  conversions: number;
  revenueMinor: number;
}

export const experimentReport = defineService({
  name: "analytics.experimentReport",
  summary: "Impressions, conversions and revenue per variant. No winner below 30 visitors.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: listed(
    z.object({
      experimentKey: z.string(),
      variants: listed(
        row({
          variant: z.string(),
          impressions: z.number().int(),
          uniqueVisitors: z.number().int(),
          conversions: z.number().int(),
          revenueMinor: z.number().int(),
        }),
      ),
      uniqueVisitors: z.number().int(),
      comparable: z.boolean(),
    }),
  ),
  handler: async (_input, ctx) => {
    const rows = await ctx.tx
      .select({
        name: analyticsEvents.name,
        anonId: analyticsEvents.anonId,
        props: analyticsEvents.props,
        visitorKind: analyticsEvents.visitorKind,
        classificationOverride: analyticsEvents.classificationOverride,
      })
      .from(analyticsEvents)
      .where(
        inArray(analyticsEvents.name, ["experiment.impressed", "experiment.converted"]),
      );
    const grouped = new Map<string, Map<string, ExperimentVariantRow & { visitors: Set<string> }>>();
    for (const row of rows) {
      const kind = row.classificationOverride ?? row.visitorKind;
      if (kind !== "human") continue;
      const props = row.props as { experimentKey?: unknown; variant?: unknown; amountMinor?: unknown };
      if (typeof props.experimentKey !== "string" || typeof props.variant !== "string") continue;
      if (!grouped.has(props.experimentKey)) grouped.set(props.experimentKey, new Map());
      const variants = grouped.get(props.experimentKey)!;
      const current = variants.get(props.variant) ?? {
        variant: props.variant,
        impressions: 0,
        uniqueVisitors: 0,
        conversions: 0,
        revenueMinor: 0,
        visitors: new Set<string>(),
      };
      if (row.name === "experiment.impressed") {
        current.impressions += 1;
        current.visitors.add(row.anonId);
        current.uniqueVisitors = current.visitors.size;
      } else {
        current.conversions += 1;
        if (typeof props.amountMinor === "number") current.revenueMinor += props.amountMinor;
      }
      variants.set(props.variant, current);
    }
    return [...grouped.entries()].map(([experimentKey, variants]) => {
      const list = [...variants.values()].map(({ visitors: _visitors, ...row }) => row);
      const uniqueVisitors = list.reduce((sum, row) => sum + row.uniqueVisitors, 0);
      return {
        experimentKey,
        variants: list,
        uniqueVisitors,
        comparable: comparable(uniqueVisitors),
      };
    });
  },
});
