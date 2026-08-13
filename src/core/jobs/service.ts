// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Owner-visible queue operations (MASTER.md §43 C1.10).
import { z } from "zod";
import {
  cancelJob,
  DEAD_LETTER_QUEUE,
  getJob,
  isJobStuck,
  jobOperationalSummary,
  listJobHistory,
  listJobs,
  redriveDeadLetters,
  retryJob,
  type JobHistoryRow,
  type JobOperationalSummary,
} from "@/core/jobs";
import {
  defineService,
  redact,
  ServiceError,
  type Actor,
} from "@/core/service";

const jobState = z.enum([
  "created",
  "retry",
  "active",
  "completed",
  "cancelled",
  "failed",
]);

function requireHumanOrSystem(actor: Actor): void {
  if (actor.kind === "user" || actor.kind === "system") return;
  throw new ServiceError(
    "permission",
    "Sign in as a staff member with platform access to inspect background work.",
  );
}

function requireKnownQueue(name: string): void {
  if (name === DEAD_LETTER_QUEUE || listJobs().has(name)) return;
  throw new ServiceError("not_found", "No background-job queue has that name.");
}

function safeJob(job: JobHistoryRow): JobHistoryRow {
  return {
    ...job,
    data: redact(job.data) as Record<string, unknown>,
    output: redact(job.output) as Record<string, unknown>,
  };
}

export const listJobRuns = defineService({
  name: "platform.listJobs",
  summary: "List retained background-job runs and their current state.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    name: z.string().max(120).optional(),
    state: jobState.optional(),
    limit: z.number().int().min(1).max(100).default(50),
    offset: z.number().int().min(0).max(1_000_000).default(0),
  }),
  handler: async (input, ctx) => {
    requireHumanOrSystem(ctx.actor);
    if (input.name) requireKnownQueue(input.name);
    const result = await listJobHistory(input);
    return { ...result, items: result.items.map(safeJob) };
  },
});

export const getJobRun = defineService({
  name: "platform.getJob",
  summary: "Inspect one retained background-job run.",
  kind: "query",
  permission: "scoped",
  input: z.object({ name: z.string().min(1).max(120), id: z.uuid() }),
  handler: async (input, ctx) => {
    requireHumanOrSystem(ctx.actor);
    requireKnownQueue(input.name);
    const job = await getJob(input.name, input.id);
    if (!job) throw new ServiceError("not_found", "No retained job has that ID.");
    return safeJob({ ...job, stuck: isJobStuck(job) });
  },
});

export const getJobSummary = defineService({
  name: "platform.jobSummary",
  summary: "Count queued, active, failed, dead-lettered and stuck background work.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  handler: async (_input, ctx) => {
    requireHumanOrSystem(ctx.actor);
    return jobOperationalSummary();
  },
});

export const listJobQueues = defineService({
  name: "platform.listJobQueues",
  summary: "List registered background-job queues available for inspection.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  handler: async (_input, ctx) => {
    requireHumanOrSystem(ctx.actor);
    return jobQueueNames();
  },
});

export const cancelJobRun = defineService({
  name: "platform.cancelJob",
  summary: "Cancel queued work or request cooperative cancellation of active work.",
  kind: "mutation",
  permission: "scoped",
  stepUp: true,
  input: z.object({
    name: z.string().min(1).max(120),
    id: z.uuid(),
    confirm: z.literal("CANCEL"),
  }),
  handler: async (input, ctx) => {
    requireHumanOrSystem(ctx.actor);
    requireKnownQueue(input.name);
    if (input.name === DEAD_LETTER_QUEUE) {
      throw new ServiceError("conflict", "Dead letters are redriven, not cancelled.");
    }
    if (!(await cancelJob(ctx.tx, input.name, input.id))) {
      throw new ServiceError("conflict", "That job has already reached a terminal state.");
    }
    ctx.setSubject("job", input.id);
    ctx.queueEvent("job.cancelled", { name: input.name, id: input.id });
    return { cancelled: true };
  },
});

export const retryJobRun = defineService({
  name: "platform.retryJob",
  summary: "Deliberately retry one retained failed or cancelled job.",
  kind: "mutation",
  permission: "scoped",
  stepUp: true,
  input: z.object({
    name: z.string().min(1).max(120),
    id: z.uuid(),
    confirm: z.literal("RETRY"),
  }),
  handler: async (input, ctx) => {
    requireHumanOrSystem(ctx.actor);
    requireKnownQueue(input.name);
    if (input.name === DEAD_LETTER_QUEUE) {
      throw new ServiceError("conflict", "Use dead-letter redrive for that run.");
    }
    if (!(await retryJob(ctx.tx, input.name, input.id))) {
      throw new ServiceError("conflict", "Only retained failed or cancelled jobs can retry.");
    }
    ctx.setSubject("job", input.id);
    ctx.queueEvent("job.retried", { name: input.name, id: input.id });
    return { retried: true };
  },
});

export const redriveJobDeadLetters = defineService({
  name: "platform.redriveDeadLetters",
  summary: "Move retained dead letters back to their original queue.",
  kind: "mutation",
  permission: "scoped",
  stepUp: true,
  input: z.object({
    sourceName: z.string().min(1).max(120).optional(),
    limit: z.number().int().min(1).max(100).default(1),
    confirm: z.literal("REDRIVE"),
  }),
  handler: async (input, ctx) => {
    requireHumanOrSystem(ctx.actor);
    if (input.sourceName) requireKnownQueue(input.sourceName);
    const moved = await redriveDeadLetters(ctx.tx, input);
    if (moved === 0) throw new ServiceError("not_found", "No matching dead letters remain.");
    ctx.setSubject("job_dead_letter", input.sourceName ?? DEAD_LETTER_QUEUE);
    ctx.queueEvent("job.deadLettersRedriven", {
      sourceName: input.sourceName,
      moved,
    });
    return { moved };
  },
});

export interface JobBriefingContribution {
  source: "core";
  key: "platform.jobs";
  title: string;
  body: string;
  severity: "warning" | "danger";
  href: "/admin/jobs";
  items: Array<{
    kind: "failed" | "dead_letter" | "stuck";
    count: number;
  }>;
}

/** Contributor seam consumed by §42's future briefing assembler (C4.15). */
export async function backgroundJobsBriefingContribution(
  summary?: JobOperationalSummary,
): Promise<JobBriefingContribution | null> {
  const current = summary ?? (await jobOperationalSummary());
  const items: JobBriefingContribution["items"] = [];
  if (current.failed > 0) items.push({ kind: "failed", count: current.failed });
  if (current.deadLetters > 0) {
    items.push({ kind: "dead_letter", count: current.deadLetters });
  }
  if (current.stuck > 0) items.push({ kind: "stuck", count: current.stuck });
  if (items.length === 0) return null;
  return {
    source: "core",
    key: "platform.jobs",
    title: "Background work needs attention",
    body: "Failed, dead-lettered, or lease-stuck work is waiting for review.",
    severity: current.deadLetters > 0 || current.stuck > 0 ? "danger" : "warning",
    href: "/admin/jobs",
    items,
  };
}

export function jobQueueNames(): string[] {
  return [...listJobs().keys(), DEAD_LETTER_QUEUE].sort();
}

export default [
  listJobRuns,
  getJobRun,
  getJobSummary,
  listJobQueues,
  cancelJobRun,
  retryJobRun,
  redriveJobDeadLetters,
];
