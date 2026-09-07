// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { listed, okResult, row, uuid } from "@/core/contract";
import {
  defineOrchestratedService,
  defineService,
  ServiceError,
} from "@/core/service";
import { podProvider } from "./adapter";
import { podJobs } from "./schema";

const jobRow = row({
  id: uuid,
  sku: z.string(),
  provider: z.string(),
  status: z.string(),
  externalRef: z.string().nullable(),
  lastError: z.string().nullable(),
});

const claimSubmit = defineService({
  name: "printOnDemand.claimSubmit",
  summary: "Lock a queued or failed print job before talking to the provider.",
  kind: "mutation",
  permission: "scoped",
  external: false,
  writeClass: "write",
  input: z.object({ jobId: z.string().uuid() }),
  output: row({
    jobId: uuid,
    sku: z.string(),
    provider: z.string(),
    payload: z.record(z.string(), z.unknown()),
  }),
  handler: async (input, ctx) => {
    const [job] = await ctx.tx.select().from(podJobs).where(eq(podJobs.id, input.jobId)).limit(1);
    if (!job) throw new ServiceError("not_found", "No such print job.");
    if (job.status === "submitted") {
      throw new ServiceError("conflict", "That print job is already with the provider.");
    }
    if (job.status === "submitting") {
      throw new ServiceError("conflict", "That print job is already being submitted.");
    }
    await ctx.tx
      .update(podJobs)
      .set({ status: "submitting", lastError: null })
      .where(eq(podJobs.id, job.id));
    return {
      jobId: job.id,
      sku: job.sku,
      provider: job.provider,
      payload: (job.payload ?? {}) as Record<string, unknown>,
    };
  },
});

const applySubmit = defineService({
  name: "printOnDemand.applySubmit",
  summary: "Record the print provider's response on the job.",
  kind: "mutation",
  permission: "scoped",
  external: false,
  writeClass: "write",
  input: z.object({
    jobId: z.string().uuid(),
    externalRef: z.string().max(200).optional(),
    lastError: z.string().max(500).optional(),
  }),
  output: okResult,
  handler: async (input, ctx) => {
    if (input.externalRef) {
      await ctx.tx
        .update(podJobs)
        .set({ status: "submitted", externalRef: input.externalRef, lastError: null })
        .where(eq(podJobs.id, input.jobId));
    } else {
      await ctx.tx
        .update(podJobs)
        .set({
          status: "failed",
          lastError: input.lastError ?? "The print provider could not take that job.",
        })
        .where(eq(podJobs.id, input.jobId));
    }
    return { ok: true as const };
  },
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
    const [created] = await ctx.tx.insert(podJobs).values(input).returning();
    ctx.setSubject("pod_job", created!.id);
    ctx.queueEvent("printOnDemand.queued", { id: created!.id, sku: created!.sku });
    return created!;
  },
});

export const submitPodJob = defineOrchestratedService({
  name: "printOnDemand.submit",
  summary: "Send a queued print job to the provider, or retry a failed one.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({ jobId: z.string().uuid() }),
  output: jobRow,
  handler: async (input) => {
    const claimed = await claimSubmit.call(input, { kind: "system" });
    try {
      const result = await podProvider().submit({
        sku: claimed.sku,
        provider: claimed.provider,
        payload: claimed.payload,
      });
      await applySubmit.call(
        { jobId: claimed.jobId, externalRef: result.externalRef },
        { kind: "system" },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "The print provider could not take that job.";
      await applySubmit.call(
        { jobId: claimed.jobId, lastError: message.slice(0, 500) },
        { kind: "system" },
      );
    }
    const found = (await listPodJobs.call({}, { kind: "system" })).find((row) => row.id === claimed.jobId);
    if (!found) throw new ServiceError("not_found", "No such print job.");
    return found;
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

export default [queuePodJob, claimSubmit, applySubmit, submitPodJob, listPodJobs];
