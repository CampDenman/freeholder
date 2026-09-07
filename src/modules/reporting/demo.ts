// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { eq } from "drizzle-orm";
import {
  demoHandlerInputSchema,
  demoLoadResultSchema,
  demoPurgeResultSchema,
  demoVerifyResultSchema,
} from "@/core/onboarding/contract";
import { requireDemoHandlerRun } from "@/core/demo/handler";
import { defineService, getService } from "@/core/service";
import { reportViews } from "./schema";

const CONTRIBUTION = { key: "reporting.demo-view", version: 1 } as const;
const NAMES = {
  en: "[Demo] Last 90 days of revenue",
  fr: "[Demo] Recettes des 90 derniers jours",
  es: "[Demo] Ingresos de los últimos 90 días",
} as const;

export const loadDemoReportView = defineService({
  name: "reporting.loadDemoFixture",
  summary: "Save a marked revenue question the owner can open.",
  kind: "mutation",
  permission: "scoped",
  input: demoHandlerInputSchema,
  output: demoLoadResultSchema,
  handler: async (input, ctx) => {
    await requireDemoHandlerRun(ctx.tx, input, CONTRIBUTION, "load");
    const name = NAMES[input.locale as keyof typeof NAMES] ?? NAMES.en;
    const view = (await ctx.callAsSystem(getService("reports.saveView"), {
      name,
      key: "revenue",
      params: { days: 90, timezone: "America/Vancouver" },
    })) as { id: string };
    return demoLoadResultSchema.parse({
      records: [{ fixtureKey: "revenue-view", subjectType: "report_view", subjectId: view.id, label: name }],
    });
  },
});

export const purgeDemoReportView = defineService({
  name: "reporting.purgeDemoFixture",
  summary: "Delete only saved views proven to belong to a tracked demo run.",
  kind: "mutation",
  permission: "scoped",
  input: demoHandlerInputSchema,
  output: demoPurgeResultSchema,
  handler: async (input, ctx) => {
    await requireDemoHandlerRun(ctx.tx, input, CONTRIBUTION, "purge");
    for (const record of input.records) {
      await ctx.callAsSystem(getService("reports.deleteView"), { id: record.subjectId });
    }
    return demoPurgeResultSchema.parse({
      purged: input.records.map((record) => ({
        subjectType: record.subjectType,
        subjectId: record.subjectId,
      })),
    });
  },
});

export const verifyDemoReportView = defineService({
  name: "reporting.verifyDemoFixture",
  summary: "Verify the marked revenue view is still saved.",
  kind: "query",
  permission: "scoped",
  input: demoHandlerInputSchema,
  output: demoVerifyResultSchema,
  handler: async (input, ctx) => {
    await requireDemoHandlerRun(ctx.tx, input, CONTRIBUTION, "verify");
    const id = input.records[0]?.subjectId;
    const [view] = id
      ? await ctx.tx.select({ name: reportViews.name, key: reportViews.key }).from(reportViews).where(eq(reportViews.id, id)).limit(1)
      : [];
    return demoVerifyResultSchema.parse({
      outcomes: [
        {
          key: "reporting.demo-view.visible",
          achieved: view?.key === "revenue" && Boolean(view.name.startsWith("[Demo]")),
          detail: view?.name,
        },
      ],
    });
  },
});

export default [loadDemoReportView, purgeDemoReportView, verifyDemoReportView];
