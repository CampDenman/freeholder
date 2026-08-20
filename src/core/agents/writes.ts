// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Managed writes honour the autonomy ladder (C4.03, MASTER.md §40).
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { listed, row, timestamp, uuid } from "@/core/contract";
import {
  defineService,
  getService,
  permits,
  redact,
  ServiceError,
  type ServiceContext,
} from "@/core/service";
import { agentApprovals, agentRuns, agentTasks } from "@/core/agents/schema";
import { effectiveAutonomy } from "@/core/agents/service";
import { agentForActor } from "@/core/agents/execution";
import {
  alwaysRequiresApproval,
  buildWritePreview,
  classifyManagedWrite,
  previewSummary,
  WRITE_KINDS,
} from "@/core/agents/previews";

const approvalRow = row({
  id: uuid,
  runId: uuid.nullable(),
  taskId: uuid,
  kind: z.enum(WRITE_KINDS),
  summary: z.string(),
  preview: z.unknown(),
  serviceName: z.string(),
  input: z.unknown(),
  proposedAutonomy: z.enum(["suggest", "approve", "autonomous"]),
  status: z.enum(["pending", "approved", "rejected", "expired"]),
  expiresAt: timestamp.nullable(),
  createdAt: timestamp,
});

/** What proposeWrite hands back: secrets stay out of agent-visible copies. */
function redactedApproval<T extends { input: unknown }>(approval: T): T {
  return { ...approval, input: redact(approval.input) ?? {} };
}

async function beforeBlocks(
  ctx: ServiceContext,
  serviceName: string,
  input: unknown,
): Promise<unknown> {
  if (serviceName !== "cms.updatePage" && serviceName !== "cms.updateSection") {
    return null;
  }
  if (!input || typeof input !== "object" || !("id" in input)) return null;
  const id = input.id;
  if (typeof id !== "string") return null;
  try {
    const reader =
      serviceName === "cms.updatePage" ? getService("cms.getPage") : getService("cms.getSection");
    // The agent's own permission, not system: the before half of a diff must
    // never show an agent content its key could not read directly.
    const current = (await ctx.call(reader, { id })) as { blocks?: unknown };
    return current?.blocks ?? null;
  } catch {
    return null;
  }
}

export const proposeWrite = defineService({
  name: "agents.proposeWrite",
  summary: "The managed write gate: execute, propose, or wait for approval.",
  kind: "mutation",
  permission: "public",
  input: z.object({
    runId: z.uuid(),
    serviceName: z.string().min(1).max(120),
    input: z.record(z.string(), z.unknown()).default({}),
    summary: z.string().max(500).optional(),
  }),
  output: row({
    outcome: z.enum(["executed", "proposed", "awaiting_approval"]),
    result: z.unknown().nullable(),
    approval: approvalRow.nullable(),
  }),
  handler: async (input, ctx) => {
    // Resolves through the key join and refuses paused agents and paused
    // connections — the same gate every other agent verb passes through, so
    // the kill switch also stops writes mid-lease.
    const agent = await agentForActor(ctx.tx, ctx.actor);

    const [run] = await ctx.tx
      .select({
        id: agentRuns.id,
        taskId: agentRuns.taskId,
        agentId: agentRuns.agentId,
        status: agentRuns.status,
      })
      .from(agentRuns)
      .where(eq(agentRuns.id, input.runId))
      .limit(1);
    if (!run || run.status !== "running" || run.agentId !== agent.id) {
      throw new ServiceError("not_found", "No such active run.");
    }

    const [task] = await ctx.tx
      .select({
        id: agentTasks.id,
        inputTrust: agentTasks.inputTrust,
        autonomyCeiling: agentTasks.autonomyCeiling,
      })
      .from(agentTasks)
      .where(eq(agentTasks.id, run.taskId))
      .limit(1);
    if (!task) throw new ServiceError("not_found", "That run has no task.");

    const service = getService(input.serviceName);
    // The gate must not widen the agent's reach: a proposal for a service the
    // key could not call directly is refused before any preview is built, so
    // neither the before-read nor the parked approval leaks or requests
    // authority the agent does not hold.
    if (
      !permits(ctx.actor, service.def.permission, service.def.name, service.def.kind) ||
      service.def.agentCallable === false
    ) {
      throw new ServiceError(
        "permission",
        `This agent's key is not allowed to call ${service.def.name}, so it cannot propose it either.`,
      );
    }

    if (service.def.kind === "query") {
      const result = await ctx.call(service, input.input);
      return { outcome: "executed" as const, result, approval: null };
    }

    const classification = classifyManagedWrite(service.def);
    const kind = classification.kind;
    const preview = buildWritePreview(kind, input.serviceName, input.input, {
      beforeBlocks: await beforeBlocks(ctx, input.serviceName, input.input),
    });
    const summary = input.summary ?? previewSummary(kind, input.serviceName);

    const autonomy = effectiveAutonomy(
      agent.autonomy,
      task.autonomyCeiling,
      task.inputTrust,
    );
    const mustApprove = autonomy !== "autonomous" || alwaysRequiresApproval(classification);

    if (!mustApprove) {
      const result = await ctx.call(service, input.input);
      return { outcome: "executed" as const, result, approval: null };
    }

    // Suggest is the lowest rung: it only ever records a proposal. Approval
    // requests come from the approve rung, or from autonomous work that hit
    // an irreversible or undeclared write.
    const awaiting = autonomy !== "suggest";
    const [inserted] = await ctx.tx
      .insert(agentApprovals)
      .values({
        runId: run.id,
        taskId: task.id,
        kind,
        summary,
        preview,
        serviceName: input.serviceName,
        // Verbatim, as the schema promises: C4.04 executes exactly what was
        // approved. Redaction happens on every read surface instead.
        input: input.input,
        proposedAutonomy: autonomy,
        status: "pending",
        expiresAt: sql`now() + interval '7 days'`,
      })
      .returning();

    if (awaiting) {
      await ctx.tx
        .update(agentTasks)
        .set({ status: "waiting_approval" })
        .where(eq(agentTasks.id, task.id));
    }

    ctx.setSubject("agent_approval", inserted!.id);
    ctx.queueEvent("agentApproval.proposed", {
      id: inserted!.id,
      taskId: task.id,
      kind,
    });
    return {
      outcome: awaiting ? ("awaiting_approval" as const) : ("proposed" as const),
      result: null,
      approval: redactedApproval(inserted!),
    };
  },
});

export const listApprovals = defineService({
  name: "agents.listApprovals",
  summary: "Pending and decided managed-write approvals.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    taskId: z.uuid().optional(),
    status: z.enum(["pending", "approved", "rejected", "expired"]).optional(),
    limit: z.number().int().min(1).max(200).default(50),
  }),
  output: listed(approvalRow),
  handler: async (input, ctx) => {
    if (ctx.actor.kind === "agent") {
      throw new ServiceError(
        "permission",
        "An agent cannot review its own approvals. Sign in as the owner.",
      );
    }
    const filters = [
      input.taskId ? eq(agentApprovals.taskId, input.taskId) : undefined,
      input.status ? eq(agentApprovals.status, input.status) : undefined,
    ].filter((clause) => clause !== undefined);
    const rows = await ctx.tx
      .select()
      .from(agentApprovals)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(agentApprovals.createdAt))
      .limit(input.limit);
    // Stored verbatim for once-only execution; redacted wherever it is shown.
    return rows.map(redactedApproval);
  },
});

export default [proposeWrite, listApprovals];
