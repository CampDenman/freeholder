// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Managed writes honour the autonomy ladder (C4.03, MASTER.md §40).
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { listed, row, timestamp, uuid } from "@/core/contract";
import {
  defineService,
  getService,
  redact,
  ServiceError,
  type ServiceContext,
} from "@/core/service";
import {
  agentApprovals,
  agentRuns,
  agents,
  agentTasks,
} from "@/core/agents/schema";
import { effectiveAutonomy } from "@/core/agents/service";
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
  status: z.enum(["pending", "approved", "rejected", "expired"]),
  expiresAt: timestamp.nullable(),
  createdAt: timestamp,
});

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
    const current = (await ctx.callAsSystem(reader, { id })) as { blocks?: unknown };
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
    if (ctx.actor.kind !== "agent") {
      throw new ServiceError(
        "permission",
        "This is for agents running a claimed task. Present the agent's API key.",
      );
    }

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
    if (!run || run.status !== "running") {
      throw new ServiceError("not_found", "No such active run.");
    }

    const [agent] = await ctx.tx
      .select({
        id: agents.id,
        name: agents.name,
        autonomy: agents.autonomy,
        apiKeyId: agents.apiKeyId,
      })
      .from(agents)
      .where(eq(agents.id, run.agentId))
      .limit(1);
    if (!agent) throw new ServiceError("not_found", "That run has no agent.");

    const keyName = `agent:${agent.name}`;
    if (ctx.actor.keyName !== keyName) {
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
    const kind = classifyManagedWrite(input.serviceName, input.input);
    const preview = buildWritePreview(
      kind,
      input.serviceName,
      input.input,
      { beforeBlocks: await beforeBlocks(ctx, input.serviceName, input.input) },
    );
    const summary = input.summary ?? previewSummary(kind, input.serviceName);

    if (service.def.kind === "query") {
      const result = await ctx.call(service, input.input);
      return { outcome: "executed" as const, result, approval: null };
    }

    const autonomy = effectiveAutonomy(
      agent.autonomy,
      task.autonomyCeiling,
      task.inputTrust,
    );
    const mustApprove = autonomy !== "autonomous" || alwaysRequiresApproval(kind);

    if (!mustApprove) {
      const result = await ctx.call(service, input.input);
      return { outcome: "executed" as const, result, approval: null };
    }

    const awaiting = autonomy === "approve" || alwaysRequiresApproval(kind);
    const [row] = await ctx.tx
      .insert(agentApprovals)
      .values({
        runId: run.id,
        taskId: task.id,
        kind,
        summary,
        preview,
        serviceName: input.serviceName,
        input: redact(input.input) ?? {},
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

    ctx.setSubject("agent_approval", row!.id);
    ctx.queueEvent("agentApproval.proposed", {
      id: row!.id,
      taskId: task.id,
      kind,
    });
    return {
      outcome: awaiting ? ("awaiting_approval" as const) : ("proposed" as const),
      result: null,
      approval: row!,
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
    return ctx.tx
      .select()
      .from(agentApprovals)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(agentApprovals.createdAt))
      .limit(input.limit);
  },
});

export default [proposeWrite, listApprovals];
