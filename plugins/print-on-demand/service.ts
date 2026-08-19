// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { desc } from "drizzle-orm";
import { z } from "zod";
import { listed, row, uuid } from "@/core/contract";
import { defineService } from "@/core/service";
import { podJobs } from "./schema";

const jobRow = row({
  id: uuid,
  sku: z.string(),
  provider: z.string(),
  status: z.string(),
});

export const queuePodJob = defineService({
  name: "printOnDemand.queue",
  summary: "Queue a print-on-demand job. Fulfillment still goes through catalog orders.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    sku: z.string().min(1),
    provider: z.string().min(1),
    payload: z.record(z.string(), z.unknown()).default({}),
  }),
  output: jobRow,
  handler: async (input, ctx) => {
    const [row] = await ctx.tx.insert(podJobs).values(input).returning();
    ctx.setSubject("pod_job", row!.id);
    ctx.queueEvent("printOnDemand.queued", { id: row!.id, sku: row!.sku });
    return row!;
  },
});

export const listPodJobs = defineService({
  name: "printOnDemand.list",
  summary: "Queued print-on-demand jobs.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: listed(jobRow),
  handler: (_input, ctx) => ctx.tx.select().from(podJobs).orderBy(desc(podJobs.createdAt)),
});

export default [queuePodJob, listPodJobs];
